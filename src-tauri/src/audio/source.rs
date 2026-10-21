use super::time_stretch::PitchPreservingSource;
use super::*;
use rodio::source::SeekError;

pub(super) struct PlaybackStart<'a> {
    pub(super) file_path: &'a str,
    pub(super) duration: f64,
    pub(super) start_secs: f64,
    pub(super) generation: u64,
    pub(super) initial_volume: Option<f32>,
    pub(super) start_paused: bool,
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
) -> Result<(PitchPreservingSource<BufferedSymphoniaSource>, f64, f64), String> {
    let (source, duration, actual_start) = crate::parse_guard::guard(file_path, || {
        prepare_source_with_seek(file_path, requested_start, seek_decoder)
    })??;
    let (speed_control, booster) = {
        let state = state.lock();
        (state.speed_control.clone(), state.booster.clone())
    };
    let underrun_signal = Arc::new(AtomicBool::new(false));
    let buffered_source =
        BufferedSymphoniaSource::new(source, Arc::clone(&underrun_signal))?;
    let mut source = PitchPreservingSource::new(
        buffered_source,
        speed_control,
        booster,
        emitted_samples.clone(),
    )?;
    source.set_underrun_signal(underrun_signal);
    Ok((source, duration, actual_start))
}

type SeekFn = fn(&mut dyn SymphoniaDecoder, &mut dyn FormatReader, f64) -> Result<u64, String>;

fn prepare_source_with_seek(
    file_path: &str,
    requested_start: f64,
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

    let mut source = SymphoniaSource::new(decoder, format, file_path.to_string())
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

pub(super) fn play_with_source<S>(
    stream_handle: &OutputStreamHandle,
    source: S,
    state: &Arc<Mutex<PlaybackState>>,
    start: PlaybackStart<'_>,
    cancelled_handoffs: &[Arc<AtomicBool>],
) -> Option<Arc<Sink>>
where
    S: Source<Item = f32> + Send + 'static,
{
    let sink = Sink::try_new(stream_handle).ok()?;
    let channels = source.channels();
    let sample_rate = source.sample_rate();
    {
        let s = state.lock();
        sink.set_volume(start.initial_volume.unwrap_or(s.volume).clamp(0.0, 1.0));
    }
    if start.start_paused {
        sink.pause();
    }

    sink.append(source);
    if sink.len() == 0 {
        return None;
    }

    {
        let mut s = state.lock();
        for cancelled in cancelled_handoffs {
            cancelled.store(true, Ordering::Release);
        }
        s.current_file = Some(start.file_path.to_string());
        s.generation = start.generation;
        s.duration = start.duration;
        s.start_position = start.start_secs;
        s.position_sample_rate = sample_rate;
        s.position_channels = channels;
        s.is_playing = true;
        s.is_paused = start.start_paused;
        s.warned_near_end = false;
    }
    Some(Arc::new(sink))
}

pub(super) struct SymphoniaSource {
    decoder: Box<dyn SymphoniaDecoder>,
    format: Box<dyn FormatReader>,
    track_id: u32,
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
    yield_to_mixer: Arc<AtomicBool>,
}

fn packet_for_track(packet: Packet, selected_track_id: u32) -> Option<Packet> {
    (packet.track_id() == selected_track_id).then_some(packet)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RefillResult {
    SamplesReady,
    YieldToMixer,
}

fn foreign_packet_budget_exhausted(foreign_packets: &mut usize) -> bool {
    *foreign_packets = (*foreign_packets).saturating_add(1);
    *foreign_packets >= MAX_REFILL_ATTEMPTS
}

impl SymphoniaSource {
    pub(super) fn new(
        decoder: Box<dyn SymphoniaDecoder>,
        format: Box<dyn FormatReader>,
        file_path: String,
    ) -> Option<Self> {
        let channels = decoder.codec_params().channels?.count() as u16;
        let sample_rate = decoder.codec_params().sample_rate?;
        let track_id = format.default_track()?.id;

        Some(Self {
            decoder,
            format,
            track_id,
            file_path,
            buffer: Vec::new(),
            scratch: None,
            pending_packet: None,
            skip_samples: 0,
            buf_pos: 0,
            channels,
            sample_rate,
            yield_to_mixer: Arc::new(AtomicBool::new(false)),
        })
    }

    fn refill(&mut self) -> Option<RefillResult> {
        let mut attempts = 0;
        let mut foreign_packets = 0;
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

            let Some(packet) = packet_for_track(packet, self.track_id) else {
                if foreign_packet_budget_exhausted(&mut foreign_packets) {
                    // None from Iterator::next permanently ends the source. Return a silent
                    // sample instead so packet scanning can continue on the next mixer request.
                    return Some(RefillResult::YieldToMixer);
                }
                continue;
            };
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
                            return Some(RefillResult::SamplesReady);
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

    fn seek_to(&mut self, position_secs: f64) -> Result<(), String> {
        let seek_result = crate::parse_guard::guard(&self.file_path, || {
            seek_decoder(self.decoder.as_mut(), self.format.as_mut(), position_secs)
        })?;

        let (pending_packet, skip_frames) = match seek_result {
            Ok(skip_frames) => (None, skip_frames),
            Err(target_error) => {
                // Some file formats can seek only from their beginning. Restart the already-open
                // reader and scan packet headers instead of reopening the file.
                let fallback = crate::parse_guard::guard(&self.file_path, || {
                    self.format
                        .seek(
                            SeekMode::Accurate,
                            SeekTo::Time {
                                time: Time::from(0.0),
                                track_id: None,
                            },
                        )
                        .map_err(|error| format!("seek to start error: {}", error))?;
                    self.decoder.reset();
                    skip_packets_to(self.format.as_mut(), position_secs)
                })?;
                let start = fallback.map_err(|fallback_error| {
                    format!(
                        "{}; in-place fallback failed: {}",
                        target_error, fallback_error
                    )
                })?;
                (start.packet, start.skip_frames)
            }
        };

        self.buffer.clear();
        self.buf_pos = 0;
        self.pending_packet = pending_packet;
        self.skip_samples = usize::try_from(skip_frames)
            .unwrap_or(usize::MAX)
            .saturating_mul(usize::from(self.channels));
        Ok(())
    }
}


const PREFETCH_CHUNK_SAMPLES: usize = 4_096;
const PREFETCH_QUEUE_CHUNKS: usize = 64;
const PREFETCH_STARTUP_WAIT: std::time::Duration = std::time::Duration::from_millis(250);
const PREFETCH_COMMAND_POLL: std::time::Duration = std::time::Duration::from_millis(2);

enum PrefetchCommand {
    Seek {
        generation: u64,
        position: std::time::Duration,
        response: std::sync::mpsc::SyncSender<Result<(), String>>,
    },
}

enum PrefetchMessage {
    Samples { generation: u64, samples: Vec<f32> },
    End { generation: u64 },
}

enum PrefetchSend {
    Sent,
    Superseded,
    Command(PrefetchCommand),
    Closed,
}

trait PrefetchableSource: Source<Item = f32> + Send + 'static {
    fn seek_for_prefetch(&mut self, position: std::time::Duration) -> Result<(), String>;
    fn take_synthetic_sample(&self) -> bool;
}

impl PrefetchableSource for SymphoniaSource {
    fn seek_for_prefetch(&mut self, position: std::time::Duration) -> Result<(), String> {
        self.seek_to(position.as_secs_f64())
    }

    fn take_synthetic_sample(&self) -> bool {
        self.yield_to_mixer.swap(false, Ordering::AcqRel)
    }
}

/// Fills a bounded chunk off the device callback. Synthetic samples only mark the end of a
/// foreign-packet batch; they are omitted while the producer continues scanning.
fn read_prefetch_chunk<S: PrefetchableSource>(source: &mut S) -> (Vec<f32>, bool) {
    let mut samples = Vec::with_capacity(PREFETCH_CHUNK_SAMPLES);
    while samples.len() < PREFETCH_CHUNK_SAMPLES {
        match source.next() {
            Some(sample) if source.take_synthetic_sample() => {
                let _ = sample;
            }
            Some(sample) => samples.push(sample),
            None => return (samples, true),
        }
    }
    (samples, false)
}

fn send_prefetch_message(
    sender: &std::sync::mpsc::SyncSender<PrefetchMessage>,
    commands: &std::sync::mpsc::Receiver<PrefetchCommand>,
    generation: &AtomicU64,
    expected_generation: u64,
    mut message: PrefetchMessage,
) -> PrefetchSend {
    loop {
        if generation.load(Ordering::Acquire) != expected_generation {
            return PrefetchSend::Superseded;
        }
        match sender.try_send(message) {
            Ok(()) => return PrefetchSend::Sent,
            Err(std::sync::mpsc::TrySendError::Disconnected(_)) => return PrefetchSend::Closed,
            Err(std::sync::mpsc::TrySendError::Full(returned)) => {
                message = returned;
                match commands.recv_timeout(PREFETCH_COMMAND_POLL) {
                    Ok(command) => return PrefetchSend::Command(command),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        return PrefetchSend::Closed;
                    }
                }
            }
        }
    }
}

fn run_prefetch_worker<S: PrefetchableSource>(
    mut source: S,
    commands: std::sync::mpsc::Receiver<PrefetchCommand>,
    output: std::sync::mpsc::SyncSender<PrefetchMessage>,
    active_generation: Arc<AtomicU64>,
) {
    let mut generation = 0;
    let mut finished = false;
    let mut pending_command = None;

    loop {
        let command = if pending_command.is_some() {
            pending_command.take()
        } else if active_generation.load(Ordering::Acquire) != generation || finished {
            match commands.recv() {
                Ok(command) => Some(command),
                Err(_) => return,
            }
        } else {
            match commands.try_recv() {
                Ok(command) => Some(command),
                Err(std::sync::mpsc::TryRecvError::Disconnected) => return,
                Err(std::sync::mpsc::TryRecvError::Empty) => None,
            }
        };

        if let Some(PrefetchCommand::Seek {
            generation: seek_generation,
            position,
            response,
        }) = command
        {
            if let Err(error) = source.seek_for_prefetch(position) {
                let _ = response.send(Err(error));
                return;
            }
            generation = seek_generation;
            finished = false;
            let (samples, reached_end) = read_prefetch_chunk(&mut source);

            if !samples.is_empty() {
                match send_prefetch_message(
                    &output,
                    &commands,
                    &active_generation,
                    generation,
                    PrefetchMessage::Samples {
                        generation,
                        samples,
                    },
                ) {
                    PrefetchSend::Sent => {}
                    PrefetchSend::Superseded => {
                        let _ = response.send(Err("seek superseded".to_string()));
                        continue;
                    }
                    PrefetchSend::Command(command) => {
                        let _ = response.send(Err("seek superseded".to_string()));
                        pending_command = Some(command);
                        continue;
                    }
                    PrefetchSend::Closed => {
                        let _ = response.send(Err("decoder source closed".to_string()));
                        return;
                    }
                }
            }

            if reached_end {
                match send_prefetch_message(
                    &output,
                    &commands,
                    &active_generation,
                    generation,
                    PrefetchMessage::End { generation },
                ) {
                    PrefetchSend::Sent => {}
                    PrefetchSend::Superseded => {
                        let _ = response.send(Err("seek superseded".to_string()));
                        continue;
                    }
                    PrefetchSend::Command(command) => {
                        let _ = response.send(Err("seek superseded".to_string()));
                        pending_command = Some(command);
                        continue;
                    }
                    PrefetchSend::Closed => {
                        let _ = response.send(Err("decoder source closed".to_string()));
                        return;
                    }
                }
            }

            let _ = response.send(Ok(()));
            finished = reached_end;
            continue;
        }

        if finished {
            continue;
        }

        let (samples, reached_end) = read_prefetch_chunk(&mut source);
        if !samples.is_empty() {
            match send_prefetch_message(
                &output,
                &commands,
                &active_generation,
                generation,
                PrefetchMessage::Samples {
                    generation,
                    samples,
                },
            ) {
                PrefetchSend::Sent => {}
                PrefetchSend::Superseded => continue,
                PrefetchSend::Command(command) => {
                    pending_command = Some(command);
                    continue;
                }
                PrefetchSend::Closed => return,
            }
        }

        if reached_end {
            match send_prefetch_message(
                &output,
                &commands,
                &active_generation,
                generation,
                PrefetchMessage::End { generation },
            ) {
                PrefetchSend::Sent => {}
                PrefetchSend::Superseded => continue,
                PrefetchSend::Command(command) => {
                    pending_command = Some(command);
                    continue;
                }
                PrefetchSend::Closed => return,
            }
        }
        finished = reached_end;
    }
}

/// A bounded decoded-sample queue keeps packet reads and decoder work away from Rodio's output
/// callback. The callback only copies already-decoded samples or marks a brief buffer underrun.
pub(super) struct BufferedSymphoniaSource {
    commands: std::sync::mpsc::Sender<PrefetchCommand>,
    output: std::sync::mpsc::Receiver<PrefetchMessage>,
    generation: Arc<AtomicU64>,
    underrun_signal: Arc<AtomicBool>,
    pending: Vec<f32>,
    pending_pos: usize,
    channels: u16,
    sample_rate: u32,
    ended: bool,
}

impl BufferedSymphoniaSource {
    fn new<S: PrefetchableSource>(
        source: S,
        underrun_signal: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        let channels = source.channels();
        let sample_rate = source.sample_rate();
        let generation = Arc::new(AtomicU64::new(0));
        let worker_generation = Arc::clone(&generation);
        let (command_sender, command_receiver) = std::sync::mpsc::channel();
        let (output_sender, output_receiver) =
            std::sync::mpsc::sync_channel(PREFETCH_QUEUE_CHUNKS);

        std::thread::Builder::new()
            .name("tarab-decoder-prefetch".to_string())
            .spawn(move || {
                run_prefetch_worker(
                    source,
                    command_receiver,
                    output_sender,
                    worker_generation,
                );
            })
            .map_err(|error| format!("failed to start decoder prefetch: {error}"))?;

        let (pending, ended) = match output_receiver.recv_timeout(PREFETCH_STARTUP_WAIT) {
            Ok(PrefetchMessage::Samples {
                generation: 0,
                samples,
            }) => (samples, false),
            Ok(PrefetchMessage::End { generation: 0 }) => (Vec::new(), true),
            Ok(_) => (Vec::new(), false),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => (Vec::new(), false),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => (Vec::new(), true),
        };

        Ok(Self {
            commands: command_sender,
            output: output_receiver,
            generation,
            underrun_signal,
            pending,
            pending_pos: 0,
            channels,
            sample_rate,
            ended,
        })
    }

    fn receive_next_chunk(&mut self) -> bool {
        let generation = self.generation.load(Ordering::Acquire);
        loop {
            match self.output.try_recv() {
                Ok(PrefetchMessage::Samples {
                    generation: message_generation,
                    samples,
                }) if message_generation == generation => {
                    if samples.is_empty() {
                        continue;
                    }
                    self.pending = samples;
                    self.pending_pos = 0;
                    return true;
                }
                Ok(PrefetchMessage::End {
                    generation: message_generation,
                }) if message_generation == generation => {
                    self.ended = true;
                    return false;
                }
                Ok(_) => continue,
                Err(std::sync::mpsc::TryRecvError::Empty) => return false,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    self.ended = true;
                    return false;
                }
            }
        }
    }
}

impl Iterator for BufferedSymphoniaSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.pending_pos >= self.pending.len() {
            if self.ended {
                return None;
            }
            if !self.receive_next_chunk() {
                if self.ended {
                    return None;
                }
                self.underrun_signal.store(true, Ordering::Release);
                return Some(0.0);
            }
        }

        let sample = self.pending[self.pending_pos];
        self.pending_pos += 1;
        Some(sample)
    }
}

impl Source for BufferedSymphoniaSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<std::time::Duration> {
        None
    }

    fn try_seek(
        &mut self,
        position: std::time::Duration,
    ) -> Result<(), rodio::source::SeekError> {
        let generation = self.generation.fetch_add(1, Ordering::AcqRel).wrapping_add(1);
        self.pending.clear();
        self.pending_pos = 0;
        self.ended = false;
        self.underrun_signal.store(false, Ordering::Release);

        // Remove queued samples from the old position before asking the producer to seek. New
        // samples are not sent until the producer receives the command.
        while self.output.try_recv().is_ok() {}

        let (response_sender, response_receiver) = std::sync::mpsc::sync_channel(1);
        self.commands
            .send(PrefetchCommand::Seek {
                generation,
                position,
                response: response_sender,
            })
            .map_err(|error| {
                rodio::source::SeekError::Other(Box::new(std::io::Error::other(
                    error.to_string(),
                )))
            })?;

        match response_receiver.recv() {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => Err(rodio::source::SeekError::Other(Box::new(
                std::io::Error::other(error),
            ))),
            Err(error) => Err(rodio::source::SeekError::Other(Box::new(
                std::io::Error::other(error.to_string()),
            ))),
        }
    }
}

pub(super) fn apply_booster(sample: f32, gain: f32) -> f32 {
    if sample.is_nan() || gain.is_nan() {
        return 0.0;
    }

    let boosted = sample * gain;
    if !boosted.is_finite() {
        return if boosted.is_sign_negative() {
            -1.0
        } else {
            1.0
        };
    }
    if gain <= 1.0 {
        return boosted.clamp(-1.0, 1.0);
    }

    const KNEE_START: f32 = 0.95;
    const KNEE_WIDTH: f32 = 0.05;
    let magnitude = boosted.abs();
    if magnitude <= KNEE_START {
        return boosted;
    }

    let excess = magnitude - KNEE_START;
    let limited_magnitude = KNEE_START + excess / (1.0 + excess / KNEE_WIDTH);
    boosted.signum() * limited_magnitude
}

impl Iterator for SymphoniaSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.buf_pos >= self.buffer.len() {
            match self.refill()? {
                RefillResult::SamplesReady => {}
                RefillResult::YieldToMixer => {
                    self.yield_to_mixer.store(true, Ordering::Release);
                    return Some(0.0);
                }
            }
        }

        let sample = *self.buffer.get(self.buf_pos)?;
        self.buf_pos += 1;
        self.yield_to_mixer.store(false, Ordering::Release);
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

    fn try_seek(&mut self, position: Duration) -> Result<(), SeekError> {
        self.seek_to(position.as_secs_f64())
            .map_err(|error| SeekError::Other(Box::new(std::io::Error::other(error))))
    }
}

/// Runs a one-shot callback on the first audio sample of the appended segment (gapless handoff).
pub(super) struct GaplessHandoffSource<S> {
    inner: S,
    real_content_started: Arc<AtomicBool>,
    on_first_sample: Option<Box<dyn FnOnce() + Send>>,
    started: bool,
}

impl<S> GaplessHandoffSource<S> {
    pub(super) fn new_after_real_content(
        inner: S,
        real_content_started: Arc<AtomicBool>,
        on_first_sample: impl FnOnce() + Send + 'static,
    ) -> Self {
        Self {
            inner,
            real_content_started,
            on_first_sample: Some(Box::new(on_first_sample)),
            started: false,
        }
    }
}

impl<S: Iterator<Item = f32>> Iterator for GaplessHandoffSource<S> {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;
        if !self.started && self.real_content_started.load(Ordering::Acquire) {
            self.started = true;
            if let Some(cb) = self.on_first_sample.take() {
                cb();
            }
        }
        Some(sample)
    }
}

impl<S: Source<Item = f32>> Source for GaplessHandoffSource<S> {
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

    fn try_seek(&mut self, position: Duration) -> Result<(), SeekError> {
        self.inner.try_seek(position)
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
    use std::sync::atomic::AtomicUsize;
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

    struct CountingDecoder {
        inner: Box<dyn SymphoniaDecoder>,
        decode_calls: Arc<std::sync::atomic::AtomicUsize>,
    }

    impl SymphoniaDecoder for CountingDecoder {
        fn try_new(
            _params: &symphonia::core::codecs::CodecParameters,
            _options: &DecoderOptions,
        ) -> symphonia::core::errors::Result<Self>
        where
            Self: Sized,
        {
            unreachable!("CountingDecoder wraps an existing decoder")
        }

        fn supported_codecs() -> &'static [symphonia::core::codecs::CodecDescriptor]
        where
            Self: Sized,
        {
            &[]
        }

        fn reset(&mut self) {
            self.inner.reset();
        }

        fn codec_params(&self) -> &symphonia::core::codecs::CodecParameters {
            self.inner.codec_params()
        }

        fn decode(
            &mut self,
            packet: &Packet,
        ) -> symphonia::core::errors::Result<symphonia::core::audio::AudioBufferRef<'_>> {
            self.decode_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.inner.decode(packet)
        }

        fn finalize(&mut self) -> symphonia::core::codecs::FinalizeResult {
            self.inner.finalize()
        }

        fn last_decoded(&self) -> symphonia::core::audio::AudioBufferRef<'_> {
            self.inner.last_decoded()
        }
    }

    struct PrefetchProbeSource {
        foreign_batches: usize,
        samples_left: usize,
        synthetic_sample: Arc<AtomicBool>,
        last_read_thread: Arc<std::sync::Mutex<Option<std::thread::ThreadId>>>,
    }

    impl Iterator for PrefetchProbeSource {
        type Item = f32;

        fn next(&mut self) -> Option<Self::Item> {
            if let Ok(mut thread) = self.last_read_thread.lock() {
                *thread = Some(std::thread::current().id());
            }
            if self.foreign_batches > 0 {
                self.foreign_batches -= 1;
                self.synthetic_sample.store(true, Ordering::Release);
                return Some(0.0);
            }
            if self.samples_left == 0 {
                return None;
            }
            self.samples_left -= 1;
            Some(0.25)
        }
    }

    impl Source for PrefetchProbeSource {
        fn current_frame_len(&self) -> Option<usize> {
            None
        }

        fn channels(&self) -> u16 {
            2
        }

        fn sample_rate(&self) -> u32 {
            44_100
        }

        fn total_duration(&self) -> Option<Duration> {
            None
        }

        fn try_seek(&mut self, _position: Duration) -> Result<(), SeekError> {
            Ok(())
        }
    }

    impl PrefetchableSource for PrefetchProbeSource {
        fn seek_for_prefetch(&mut self, _position: Duration) -> Result<(), String> {
            Ok(())
        }

        fn take_synthetic_sample(&self) -> bool {
            self.synthetic_sample.swap(false, Ordering::AcqRel)
        }
    }

    #[test]
    fn callback_pulls_prefilled_audio_after_foreign_packet_batches() {
        let read_thread = Arc::new(std::sync::Mutex::new(None));
        let source = PrefetchProbeSource {
            foreign_batches: 8,
            samples_left: PREFETCH_CHUNK_SAMPLES * 2,
            synthetic_sample: Arc::new(AtomicBool::new(false)),
            last_read_thread: Arc::clone(&read_thread),
        };
        let underrun = Arc::new(AtomicBool::new(false));
        let mut buffered =
            BufferedSymphoniaSource::new(source, Arc::clone(&underrun)).expect("start prefetch");

        let producer_thread = read_thread
            .lock()
            .expect("read thread lock")
            .expect("producer decoded before playback started");
        assert_ne!(producer_thread, std::thread::current().id());

        // One modeled 512-frame stereo callback only drains the prefilled queue.
        let output: Vec<_> = (0..1_024)
            .map(|_| buffered.next().expect("prefilled sample"))
            .collect();
        assert!(output.iter().all(|sample| (*sample - 0.25).abs() < f32::EPSILON));
        assert_eq!(
            *read_thread.lock().expect("read thread lock"),
            Some(producer_thread),
            "callback pulls must not call into the decoder source"
        );
        assert!(!underrun.load(Ordering::Acquire));
    }

    #[test]
    fn refill_yields_after_a_bounded_foreign_packet_batch_without_ending_track() {
        let mut foreign_packets = 0;
        for _ in 0..MAX_REFILL_ATTEMPTS - 1 {
            assert!(!foreign_packet_budget_exhausted(&mut foreign_packets));
        }
        assert!(foreign_packet_budget_exhausted(&mut foreign_packets));

        // A later selected-track packet remains eligible on the next mixer request.
        let mut next_batch_foreign_packets = 0;
        assert!(!foreign_packet_budget_exhausted(
            &mut next_batch_foreign_packets
        ));
        let selected = Packet::new_from_slice(1, 0, 0, &[0_u8]);
        assert!(packet_for_track(selected, 1).is_some());
    }

    #[test]
    fn gapless_handoff_waits_for_real_content_after_a_silent_mixer_yield() {
        let content_started = Arc::new(AtomicBool::new(false));
        let callback_count = Arc::new(AtomicUsize::new(0));
        let callback_count_for_handoff = Arc::clone(&callback_count);
        let mut handoff = GaplessHandoffSource::new_after_real_content(
            std::iter::repeat_n(0.0, 2),
            Arc::clone(&content_started),
            move || {
                callback_count_for_handoff.fetch_add(1, Ordering::Relaxed);
            },
        );

        assert_eq!(handoff.next(), Some(0.0));
        assert_eq!(callback_count.load(Ordering::Relaxed), 0);
        content_started.store(true, Ordering::Release);
        assert_eq!(handoff.next(), Some(0.0));
        assert_eq!(callback_count.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn refill_skips_seek_buffered_foreign_track_packets_before_decoding() {
        let path = write_temp_wav("foreign-track", 8);
        let (mut source, _, _) =
            prepare_source_with_seek(path.to_str().expect("utf-8 path"), 0.0, seek_decoder)
                .expect("prepare raw decoder source");

        // Exhaust the reader so refill can only see the packet retained from seek.
        let _: Vec<f32> = source.by_ref().collect();
        let params = source.decoder.codec_params().clone();
        let decode_calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        source.decoder = Box::new(CountingDecoder {
            inner: symphonia::default::get_codecs()
                .make(&params, &DecoderOptions::default())
                .expect("create counting decoder inner"),
            decode_calls: decode_calls.clone(),
        });
        source.pending_packet = Some(Packet::new_from_slice(
            source.track_id.wrapping_add(1),
            0,
            0,
            &[0_u8],
        ));

        assert!(source.refill().is_none());
        assert_eq!(
            decode_calls.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "foreign packets retained by seek must never reach the decoder"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn boosted_samples_are_soft_limited_without_hard_clipping() {
        let path = write_temp_wav("soft-clip", 8000);
        let state = Arc::new(Mutex::new(PlaybackState::default()));
        state.lock().booster.set(2.0);
        let counter = Arc::new(AtomicU64::new(0));
        let (source, _, _) =
            prepare_source(path.to_str().expect("utf-8 path"), 0.0, &state, &counter)
                .expect("prepare source");
        let samples: Vec<f32> = source.collect();
        let _ = std::fs::remove_file(&path);

        // Frame 7,500 is close enough to full scale that 2x gain exceeds the output range.
        let left = samples[7_500 * 2];
        let right = samples[7_500 * 2 + 1];
        assert!(
            left > 0.95 && left < 1.0,
            "left sample {left} should be softly limited"
        );
        assert!(
            right < -0.95 && right > -1.0,
            "right sample {right} should be softly limited"
        );
        assert!(
            (left + right).abs() < 1e-6,
            "stereo polarity should stay symmetric"
        );
    }

    #[test]
    fn decoded_samples_stay_interleaved_across_packets() {
        let path = write_temp_wav("interleave", 3000);
        let (source, _, _) =
            prepare_source_with_seek(path.to_str().expect("utf-8 path"), 0.0, seek_decoder)
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
        let (mut source, _, actual_start) =
            prepare_source_with_seek(path.to_str().expect("utf-8 path"), 0.5123, seek_decoder)
                .expect("prepare source");
        let frame = first_frame_value(&mut source);
        let _ = std::fs::remove_file(&path);

        assert!((actual_start - 0.5123).abs() < 1e-9);
        // 0.5123 s at 8 kHz is frame 4098.
        assert_eq!(frame.round() as i64, 4098);
    }

    #[test]
    fn an_open_source_seeks_again_without_reopening_the_decoder() {
        let path = write_temp_wav("in-place-seek", 8000);
        let (mut source, _, _) =
            prepare_source_with_seek(path.to_str().expect("utf-8 path"), 0.0, seek_decoder)
                .expect("prepare source");

        let _: Vec<_> = source.by_ref().take(100).collect();
        source
            .try_seek(Duration::from_secs_f64(0.5123))
            .expect("seek in the existing decoder");
        let frame = first_frame_value(&mut source);
        let _ = std::fs::remove_file(&path);

        assert_eq!(frame.round() as i64, 4098);
    }

    #[test]
    fn gapless_handoff_source_forwards_in_place_seek_without_repeating_handoff() {
        let path = write_temp_wav("gapless-seek", 8000);
        let state = Arc::new(Mutex::new(PlaybackState::default()));
        let counter = Arc::new(AtomicU64::new(0));
        let (source, _, _) =
            prepare_source(path.to_str().expect("utf-8 path"), 0.0, &state, &counter)
                .expect("prepare source");
        let handoff_count = Arc::new(AtomicUsize::new(0));
        let handoff_count_for_callback = Arc::clone(&handoff_count);
        let mut source = GaplessHandoffSource::new_after_real_content(
            source,
            Arc::new(AtomicBool::new(true)),
            move || {
                handoff_count_for_callback.fetch_add(1, Ordering::Relaxed);
            },
        );

        let _ = source.next().expect("first sample starts handoff");
        source
            .try_seek(Duration::from_secs_f64(0.5123))
            .expect("seek through gapless wrapper");
        let sample = source.next().expect("sample after seek");
        let _ = std::fs::remove_file(&path);

        // WSOLA changes individual window samples; the raw decoder seek test above checks the
        // exact target frame, while this verifies the wrapped source resumes after seeking.
        assert!(sample.is_finite());
        assert!(counter.load(Ordering::Relaxed) > 0);
        assert_eq!(handoff_count.load(Ordering::Relaxed), 1);
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
        let (mut source, _, actual_start) =
            prepare_source_with_seek(path.to_str().expect("utf-8 path"), 0.75, unseekable)
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
        let prepared =
            prepare_source_with_seek(path.to_str().expect("utf-8 path"), 5.0, unseekable);
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
}
