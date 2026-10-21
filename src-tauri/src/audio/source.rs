use super::*;

pub(super) struct PlaybackStart<'a> {
    pub(super) file_path: &'a str,
    pub(super) duration: f64,
    pub(super) start_secs: f64,
    pub(super) generation: u64,
    pub(super) initial_volume: Option<f32>,
}

const MAX_REFILL_ATTEMPTS: usize = 64;
const MIN_AUDIO_SAMPLE_RATE: u32 = 8_000;
const MAX_AUDIO_SAMPLE_RATE: u32 = 384_000;
pub(super) const MAX_DECODED_SAMPLES_PER_PACKET: usize = 16_777_216;

type OpenedDecoder = (Box<dyn FormatReader>, Box<dyn SymphoniaDecoder>, f64);

fn open_decoder_for_file(file_path: &str) -> Result<OpenedDecoder, String> {
    crate::parse_guard::guard(file_path, || open_decoder_for_file_unguarded(file_path))?
}

fn open_decoder_for_file_unguarded(file_path: &str) -> Result<OpenedDecoder, String> {
    let file = File::open(file_path).map_err(|e| format!("open error: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
    {
        hint.with_extension(ext);
    }

    let probed = get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions {
                enable_gapless: true,
                ..Default::default()
            },
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("probe error: {}", e))?;
    let reader = probed.format;
    let track = reader
        .default_track()
        .ok_or_else(|| "no default track".to_string())?;
    let decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("decoder error: {}", e))?;

    let duration = if let (Some(tb), Some(frames)) =
        (track.codec_params.time_base, track.codec_params.n_frames)
    {
        let t = tb.calc_time(frames);
        // `frac` is already a fraction of a second.
        t.seconds as f64 + t.frac
    } else {
        // Without a frame count, near-end detection (gapless and crossfade) needs an estimate.
        crate::metadata::probe_duration_secs(file_path).unwrap_or(0.0)
    };

    Ok((reader, decoder, duration))
}

/// Runs on the audio command thread. Opening, seeking (container index parsing) and packet
/// skipping are guarded as one unit: a parser panic here would otherwise end that thread and leave
/// playback dead for the rest of the session.
pub(super) fn prepare_source(
    file_path: &str,
    requested_start: f64,
    state: &Arc<Mutex<PlaybackState>>,
    emitted_samples: &Arc<AtomicU64>,
) -> Result<(SymphoniaSource, f64, f64), String> {
    crate::parse_guard::guard(file_path, || {
        prepare_source_with_seek(
            file_path,
            requested_start,
            state,
            emitted_samples,
            seek_decoder,
        )
    })?
}

type SeekFn = fn(&mut dyn SymphoniaDecoder, &mut dyn FormatReader, f64) -> Result<u64, String>;

fn prepare_source_with_seek(
    file_path: &str,
    requested_start: f64,
    state: &Arc<Mutex<PlaybackState>>,
    emitted_samples: &Arc<AtomicU64>,
    seek: SeekFn,
) -> Result<(SymphoniaSource, f64, f64), String> {
    let (mut format, mut decoder, mut duration) = open_decoder_for_file(file_path)?;
    let mut actual_start = requested_start.max(0.0);
    if duration > 0.0 {
        actual_start = actual_start.min(duration);
    }

    let mut start = SeekStart::default();
    if actual_start > 0.0 {
        match seek(decoder.as_mut(), format.as_mut(), actual_start) {
            Ok(skip_frames) => start.skip_frames = skip_frames,
            Err(seek_err) => {
                // Unseekable streams (for example some MP3s): read packet headers from the start
                // up to the target instead of restarting the track at 0:00.
                eprintln!(
                    "Seek to {} failed for {} ({}); skipping packets from the start",
                    actual_start, file_path, seek_err
                );
                let reopened = open_decoder_for_file(file_path)?;
                format = reopened.0;
                decoder = reopened.1;
                duration = reopened.2;
                start = skip_packets_to(format.as_mut(), actual_start).map_err(|err| {
                    format!("seek failed ({}) and fallback failed ({})", seek_err, err)
                })?;
            }
        }
    }

    let mut source = SymphoniaSource::new(
        decoder,
        format,
        state.lock().booster.clone(),
        emitted_samples.clone(),
        file_path.to_string(),
    )
    .ok_or_else(|| "missing channels or sample rate in codec params".to_string())?;
    source.pending_packet = start.packet;
    source.skip_samples = (start.skip_frames as usize).saturating_mul(source.channels as usize);

    Ok((source, duration, actual_start))
}

/// Where decoding starts after a seek: an already-read packet to decode first, and how many
/// decoded frames to drop so playback starts exactly at the target.
#[derive(Default)]
struct SeekStart {
    packet: Option<Packet>,
    skip_frames: u64,
}

struct TrackTiming {
    track_id: u32,
    time_base: TimeBase,
    sample_rate: Option<u32>,
}

fn default_track_timing(format: &dyn FormatReader) -> Result<TrackTiming, String> {
    let track = format
        .default_track()
        .ok_or_else(|| "no default track".to_string())?;
    let time_base = track
        .codec_params
        .time_base
        .ok_or_else(|| "no time base".to_string())?;
    Ok(TrackTiming {
        track_id: track.id,
        time_base,
        sample_rate: track.codec_params.sample_rate,
    })
}

/// Converts a timestamp difference to audio frames. Most containers count timestamps in frames
/// (time base 1/sample rate), but Matroska uses milliseconds and MP4 its own timescale.
fn ts_delta_to_frames(delta: u64, timing: &TrackTiming) -> u64 {
    let Some(sample_rate) = timing.sample_rate else {
        return delta;
    };
    let tb = timing.time_base;
    if tb.denom == 0 {
        return delta;
    }
    let frames =
        u128::from(delta) * u128::from(tb.numer) * u128::from(sample_rate) / u128::from(tb.denom);
    u64::try_from(frames).unwrap_or(u64::MAX)
}

/// Seeks accurately and returns the frames to drop between the seeked packet and the target, so
/// the reported position matches the audio (coarse MP3 seeks assume a constant bitrate).
fn seek_decoder(
    decoder: &mut dyn SymphoniaDecoder,
    format: &mut dyn FormatReader,
    position_secs: f64,
) -> Result<u64, String> {
    let timing = default_track_timing(format)?;
    let seeked = format
        .seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time: Time::from(position_secs),
                track_id: None,
            },
        )
        .map_err(|e| format!("seek error: {}", e))?;
    decoder.reset();
    Ok(ts_delta_to_frames(
        seeked.required_ts.saturating_sub(seeked.actual_ts),
        &timing,
    ))
}

/// Reads packets without decoding until the one containing `position_secs`. A target past the
/// real end (the estimated duration can be too long) leaves the reader at the end, so the track
/// ends and the queue advances normally.
fn skip_packets_to(format: &mut dyn FormatReader, position_secs: f64) -> Result<SeekStart, String> {
    crate::parse_guard::guard("packets", || {
        skip_packets_to_unguarded(format, position_secs)
    })?
}

fn skip_packets_to_unguarded(
    format: &mut dyn FormatReader,
    position_secs: f64,
) -> Result<SeekStart, String> {
    let timing = default_track_timing(format)?;
    let target = timing.time_base.calc_timestamp(Time::from(position_secs));
    loop {
        let Ok(packet) = format.next_packet() else {
            return Ok(SeekStart::default());
        };
        if packet.track_id() != timing.track_id {
            continue;
        }
        if packet.ts().saturating_add(packet.dur()) > target {
            let skip_frames = ts_delta_to_frames(target.saturating_sub(packet.ts()), &timing);
            return Ok(SeekStart {
                packet: Some(packet),
                skip_frames,
            });
        }
    }
}

pub(super) fn play_with_source(
    stream_handle: &OutputStreamHandle,
    source: SymphoniaSource,
    state: &Arc<Mutex<PlaybackState>>,
    start: PlaybackStart<'_>,
) -> Option<Sink> {
    let sink = Sink::try_new(stream_handle).ok()?;
    let channels = source.channels();
    let sample_rate = source.sample_rate();
    {
        let s = state.lock();
        sink.set_volume(start.initial_volume.unwrap_or(s.volume).clamp(0.0, 1.0));
        sink.set_speed(s.speed);
    }

    sink.append(source);
    if sink.len() == 0 {
        return None;
    }

    {
        let mut s = state.lock();
        s.current_file = Some(start.file_path.to_string());
        s.generation = start.generation;
        s.duration = start.duration;
        s.start_position = start.start_secs;
        s.position_sample_rate = sample_rate;
        s.position_channels = channels;
        s.is_playing = true;
        s.is_paused = false;
        s.warned_near_end = false;
    }
    Some(sink)
}

pub(super) struct SymphoniaSource {
    track_id: u32,
    decoder: Box<dyn SymphoniaDecoder>,
    format: Box<dyn FormatReader>,
    booster: BoosterGain,
    emitted_samples: Arc<AtomicU64>,
    file_path: String,
    buffer: Vec<f32>,
    // Reused for every packet so decoding does not allocate on the mixer thread.
    scratch: Option<SampleBuffer<f32>>,
    /// Packet read while seeking that must be decoded before the next one from the reader.
    pending_packet: Option<Packet>,
    /// Decoded samples to drop before output, so playback starts exactly at the seek target.
    skip_samples: usize,
    buf_pos: usize,
    channels: u16,
    sample_rate: u32,
}

impl SymphoniaSource {
    pub(super) fn new(
        decoder: Box<dyn SymphoniaDecoder>,
        format: Box<dyn FormatReader>,
        booster: BoosterGain,
        emitted_samples: Arc<AtomicU64>,
        file_path: String,
    ) -> Option<Self> {
        let track_id = format.default_track()?.id;
        let channels = decoder.codec_params().channels?.count() as u16;
        let sample_rate = decoder.codec_params().sample_rate?;

        Some(Self {
            track_id,
            decoder,
            format,
            booster,
            emitted_samples,
            file_path,
            buffer: Vec::new(),
            scratch: None,
            pending_packet: None,
            skip_samples: 0,
            buf_pos: 0,
            channels,
            sample_rate,
        })
    }

    fn refill(&mut self) -> Option<()> {
        let mut attempts = 0;
        loop {
            if attempts >= MAX_REFILL_ATTEMPTS {
                eprintln!(
                    "Decoder refill exceeded {} attempts for {}",
                    MAX_REFILL_ATTEMPTS, self.file_path
                );
                return None;
            }

            let packet = match self.pending_packet.take() {
                Some(packet) => packet,
                // This runs on the audio device's callback thread, where a panic cannot unwind;
                // a parser panic ends the track instead.
                None => {
                    match crate::parse_guard::guard(&self.file_path, || self.format.next_packet()) {
                        Ok(Ok(packet)) => packet,
                        Ok(Err(_)) => return None,
                        Err(error) => {
                            eprintln!("{}", error);
                            return None;
                        }
                    }
                }
            };

            // Other streams share the container, but not this decoder or its retry budget.
            if packet.track_id() != self.track_id {
                continue;
            }

            let decoded =
                match crate::parse_guard::guard(&self.file_path, || self.decoder.decode(&packet)) {
                    Ok(result) => result,
                    Err(error) => {
                        eprintln!("{}", error);
                        return None;
                    }
                };
            match decoded {
                Ok(decoded) => {
                    if let Some((chans, rate)) =
                        convert_to_f32(decoded, &mut self.scratch, &mut self.buffer)
                    {
                        self.channels = chans;
                        self.sample_rate = rate;
                        let skipped = self.skip_samples.min(self.buffer.len());
                        self.skip_samples -= skipped;
                        self.buf_pos = skipped;
                        if self.buf_pos < self.buffer.len() {
                            return Some(());
                        }
                        // The whole packet precedes the seek target; decode the next one.
                        continue;
                    }
                    attempts += 1;
                    eprintln!(
                        "Decoded packet yielded no samples for {}; retrying",
                        self.file_path
                    );
                }
                Err(symphonia::core::errors::Error::DecodeError(_)) => {
                    attempts += 1;
                }
                Err(_) => {
                    attempts += 1;
                }
            }
        }
    }
}

impl Iterator for SymphoniaSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.buf_pos >= self.buffer.len() {
            self.refill()?;
        }

        let mut sample = *self.buffer.get(self.buf_pos)?;
        self.buf_pos += 1;
        sample = (sample * self.booster.get()).clamp(-1.0, 1.0);
        self.emitted_samples.fetch_add(1, Ordering::Relaxed);
        Some(sample)
    }
}

impl Source for SymphoniaSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

/// Runs a one-shot callback on the first audio sample of the appended segment (gapless handoff).
pub(super) struct GaplessHandoffSource {
    inner: SymphoniaSource,
    on_first_sample: Option<Box<dyn FnOnce() + Send>>,
    started: bool,
}

impl GaplessHandoffSource {
    pub(super) fn new(
        inner: SymphoniaSource,
        on_first_sample: impl FnOnce() + Send + 'static,
    ) -> Self {
        Self {
            inner,
            on_first_sample: Some(Box::new(on_first_sample)),
            started: false,
        }
    }
}

impl Iterator for GaplessHandoffSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;
        if !self.started {
            self.started = true;
            if let Some(cb) = self.on_first_sample.take() {
                cb();
            }
        }
        Some(sample)
    }
}

impl Source for GaplessHandoffSource {
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

/// Interleaves a decoded packet into `out`, reusing `scratch` and `out` across packets.
fn convert_to_f32(
    buf: AudioBufferRef,
    scratch: &mut Option<SampleBuffer<f32>>,
    out: &mut Vec<f32>,
) -> Option<(u16, u32)> {
    let spec = *buf.spec();
    let chans = spec.channels.count() as u16;
    let rate = spec.rate;
    let frames = buf.frames();
    let sample_count = validate_decoded_packet(chans, frames, rate)?;

    let fits = scratch
        .as_ref()
        .is_some_and(|existing| existing.capacity() >= sample_count);
    if !fits {
        *scratch = Some(SampleBuffer::new(buf.capacity() as u64, spec));
    }
    let samples = scratch.as_mut()?;
    samples.copy_interleaved_ref(buf);
    out.clear();
    out.extend_from_slice(samples.samples());
    (out.len() == sample_count).then_some((chans, rate))
}

pub(super) fn validate_decoded_packet(
    channels: u16,
    frames: usize,
    sample_rate: u32,
) -> Option<usize> {
    let sample_count = frames.checked_mul(channels as usize)?;
    (channels > 0
        && frames > 0
        && (MIN_AUDIO_SAMPLE_RATE..=MAX_AUDIO_SAMPLE_RATE).contains(&sample_rate)
        && sample_count <= MAX_DECODED_SAMPLES_PER_PACKET)
        .then_some(sample_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// A 16-bit stereo PCM WAV whose left channel counts up and right channel counts down.
    fn stereo_wav(frames: u16) -> Vec<u8> {
        let data_len = u32::from(frames) * 4;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&8_000_u32.to_le_bytes());
        bytes.extend_from_slice(&32_000_u32.to_le_bytes());
        bytes.extend_from_slice(&4_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for frame in 0..frames {
            let value = (frame as i16) * 4;
            bytes.extend_from_slice(&value.to_le_bytes());
            bytes.extend_from_slice(&(-value).to_le_bytes());
        }
        bytes
    }

    fn write_temp_wav(name: &str, frames: u16) -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path = std::env::temp_dir().join(format!("tarab-source-{name}-{nonce}.wav"));
        std::fs::write(&path, stereo_wav(frames)).expect("write wav");
        path
    }

    #[test]
    fn decoded_samples_stay_interleaved_across_packets() {
        let path = write_temp_wav("interleave", 3000);
        let state = Arc::new(Mutex::new(PlaybackState::default()));
        let counter = Arc::new(AtomicU64::new(0));
        let (source, _, _) =
            prepare_source(path.to_str().expect("utf-8 path"), 0.0, &state, &counter)
                .expect("prepare source");

        let samples: Vec<f32> = source.collect();
        let _ = std::fs::remove_file(&path);

        assert_eq!(samples.len(), 6000);
        for (frame, pair) in samples.chunks(2).enumerate() {
            let expected = (frame as f32 * 4.0) / 32768.0;
            assert!((pair[0] - expected).abs() < 1e-6, "left sample {frame}");
            assert!((pair[1] + expected).abs() < 1e-6, "right sample {frame}");
        }
    }

    fn first_frame_value(source: &mut SymphoniaSource) -> f32 {
        source.next().expect("first sample") * 32768.0 / 4.0
    }

    #[test]
    fn seeking_starts_at_the_requested_frame_not_the_packet_boundary() {
        // Regression for PB-07: the seeked packet's start was reported as the requested time.
        let path = write_temp_wav("seek", 8000);
        let state = Arc::new(Mutex::new(PlaybackState::default()));
        let counter = Arc::new(AtomicU64::new(0));
        let (mut source, _, actual_start) =
            prepare_source(path.to_str().expect("utf-8 path"), 0.5123, &state, &counter)
                .expect("prepare source");
        let frame = first_frame_value(&mut source);
        let _ = std::fs::remove_file(&path);

        assert!((actual_start - 0.5123).abs() < 1e-9);
        // 0.5123 s at 8 kHz is frame 4098.
        assert_eq!(frame.round() as i64, 4098);
    }

    #[test]
    fn a_failed_seek_skips_packets_instead_of_restarting_at_zero() {
        // Regression for PB-08: an unseekable stream restarted the track at 0:00.
        fn unseekable(
            _: &mut dyn SymphoniaDecoder,
            _: &mut dyn FormatReader,
            _: f64,
        ) -> Result<u64, String> {
            Err("seek error: unseekable".to_string())
        }
        let path = write_temp_wav("fallback", 8000);
        let state = Arc::new(Mutex::new(PlaybackState::default()));
        let counter = Arc::new(AtomicU64::new(0));
        let (mut source, _, actual_start) = prepare_source_with_seek(
            path.to_str().expect("utf-8 path"),
            0.75,
            &state,
            &counter,
            unseekable,
        )
        .expect("prepare source");
        let frame = first_frame_value(&mut source);
        let remaining = source.count() + 1;
        let _ = std::fs::remove_file(&path);

        assert!((actual_start - 0.75).abs() < 1e-9);
        assert_eq!(frame.round() as i64, 6000);
        assert_eq!(remaining, (8000 - 6000) * 2);
    }

    #[test]
    fn a_seek_past_the_real_end_ends_the_track() {
        // A too-long duration estimate let the seek target pass the end; that stopped playback
        // with an error instead of ending the track so the queue could advance.
        fn unseekable(
            _: &mut dyn SymphoniaDecoder,
            _: &mut dyn FormatReader,
            _: f64,
        ) -> Result<u64, String> {
            Err("seek error: out of range".to_string())
        }
        let path = write_temp_wav("past-end", 800);
        let state = Arc::new(Mutex::new(PlaybackState::default()));
        let counter = Arc::new(AtomicU64::new(0));
        let prepared = prepare_source_with_seek(
            path.to_str().expect("utf-8 path"),
            5.0,
            &state,
            &counter,
            unseekable,
        );
        let _ = std::fs::remove_file(&path);

        let (source, _, _) = prepared.expect("an exhausted source, not an error");
        assert_eq!(source.count(), 0);
    }

    #[test]
    fn timestamp_deltas_convert_to_frames_for_millisecond_time_bases() {
        let millis = TrackTiming {
            track_id: 1,
            time_base: TimeBase::new(1, 1000),
            sample_rate: Some(44_100),
        };
        assert_eq!(ts_delta_to_frames(500, &millis), 22_050);
        let frames = TrackTiming {
            track_id: 1,
            time_base: TimeBase::new(1, 44_100),
            sample_rate: Some(44_100),
        };
        assert_eq!(ts_delta_to_frames(500, &frames), 500);
    }

    #[test]
    fn decoder_duration_keeps_the_fractional_second() {
        let path = write_temp_wav("duration", 8004);
        let opened = open_decoder_for_file(path.to_str().expect("utf-8 path"));
        let estimated = crate::metadata::probe_duration_secs(path.to_str().expect("utf-8 path"));
        let _ = std::fs::remove_file(&path);

        let duration = opened.expect("open").2;
        assert!((duration - 1.0005).abs() < 1e-9, "duration {duration}");
        assert!(estimated.is_some_and(|secs| (secs - 1.0).abs() < 0.01));
    }

    #[test]
    fn source_produces_samples_while_the_playback_lock_is_held() {
        // Regression for PB-09: the mixer used to take the playback lock for every sample.
        let path = write_temp_wav("lock", 2000);
        let state = Arc::new(Mutex::new(PlaybackState::default()));
        let counter = Arc::new(AtomicU64::new(0));
        let (mut source, _, _) =
            prepare_source(path.to_str().expect("utf-8 path"), 0.0, &state, &counter)
                .expect("prepare source");

        let guard = state.lock();
        let (done_tx, done_rx) = mpsc::channel();
        let mixer = std::thread::spawn(move || {
            let pulled = (0..1000).filter_map(|_| source.next()).count();
            let _ = done_tx.send(pulled);
        });
        let pulled = done_rx.recv_timeout(Duration::from_secs(2));
        drop(guard);
        let _ = mixer.join();
        let _ = std::fs::remove_file(&path);

        assert_eq!(pulled, Ok(1000));
    }

    /// Deterministic demux output with a real PCM decoder. The default track is deliberately
    /// second and nonzero, so filtering cannot assume the first track or track zero.
    struct InterleavedReader {
        inner: Box<dyn FormatReader>,
        tracks: Vec<symphonia::core::formats::Track>,
        packets: std::collections::VecDeque<Packet>,
    }

    impl FormatReader for InterleavedReader {
        fn try_new(
            _: MediaSourceStream,
            _: &FormatOptions,
        ) -> symphonia::core::errors::Result<Self> {
            unreachable!("constructed from a real WAV reader")
        }

        fn cues(&self) -> &[symphonia::core::formats::Cue] {
            self.inner.cues()
        }

        fn metadata(&mut self) -> symphonia::core::meta::Metadata<'_> {
            self.inner.metadata()
        }

        fn seek(
            &mut self,
            mode: SeekMode,
            to: SeekTo,
        ) -> symphonia::core::errors::Result<symphonia::core::formats::SeekedTo> {
            self.inner.seek(mode, to)
        }

        fn tracks(&self) -> &[symphonia::core::formats::Track] {
            &self.tracks
        }

        fn default_track(&self) -> Option<&symphonia::core::formats::Track> {
            self.tracks.get(1)
        }

        fn next_packet(&mut self) -> symphonia::core::errors::Result<Packet> {
            self.packets.pop_front().ok_or_else(|| {
                symphonia::core::errors::Error::IoError(std::io::Error::from(
                    std::io::ErrorKind::UnexpectedEof,
                ))
            })
        }

        fn into_inner(self: Box<Self>) -> MediaSourceStream {
            self.inner.into_inner()
        }
    }

    fn pcm_packet(track_id: u32, value: i16) -> Packet {
        let mut data = Vec::new();
        data.extend_from_slice(&value.to_le_bytes());
        data.extend_from_slice(&(-value).to_le_bytes());
        Packet::new_from_slice(track_id, 0, 1, &data)
    }

    fn interleaved_source(packets: Vec<Packet>) -> SymphoniaSource {
        let path = write_temp_wav("interleaved-reader", 1);
        let (format, decoder, _) =
            open_decoder_for_file(path.to_str().expect("utf-8 path")).expect("open PCM decoder");
        let mut selected = format.default_track().expect("WAV track").clone();
        selected.id = 7;
        let mut other = selected.clone();
        other.id = 99;
        let reader = InterleavedReader {
            inner: format,
            tracks: vec![other, selected],
            packets: packets.into(),
        };
        let source = SymphoniaSource::new(
            decoder,
            Box::new(reader),
            PlaybackState::default().booster,
            Arc::new(AtomicU64::new(0)),
            path.to_string_lossy().into_owned(),
        )
        .expect("source");
        let _ = std::fs::remove_file(path);
        source
    }

    #[test]
    fn refill_outputs_only_the_selected_tracks_samples() {
        let source = interleaved_source(vec![
            pcm_packet(99, 30000),
            pcm_packet(7, 1000),
            pcm_packet(99, 20000),
            pcm_packet(7, 2000),
        ]);
        let samples: Vec<f32> = source.collect();
        assert_eq!(
            samples,
            vec![1000.0, -1000.0, 2000.0, -2000.0]
                .into_iter()
                .map(|sample| sample / 32768.0)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn foreign_packets_do_not_exhaust_the_decode_error_budget() {
        let mut packets = vec![Packet::new_from_slice(99, 0, 1, &[0]); 65];
        packets.push(pcm_packet(7, 1000));
        let source = interleaved_source(packets);
        assert_eq!(source.count(), 2);
    }

    #[test]
    fn foreign_pending_packet_does_not_consume_the_seek_skip() {
        let mut source = interleaved_source(vec![pcm_packet(7, 1000), pcm_packet(7, 2000)]);
        source.pending_packet = Some(pcm_packet(99, 30000));
        source.skip_samples = 2;
        let samples: Vec<f32> = source.collect();
        assert_eq!(samples, vec![2000.0 / 32768.0, -2000.0 / 32768.0]);
    }
}
