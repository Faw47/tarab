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
        t.seconds as f64 + t.frac / tb.denom as f64
    } else {
        0.0
    };

    Ok((reader, decoder, duration))
}

pub(super) fn prepare_source(
    file_path: &str,
    requested_start: f64,
    state: &Arc<Mutex<PlaybackState>>,
    emitted_samples: &Arc<AtomicU64>,
) -> Result<(SymphoniaSource, f64, f64), String> {
    let (mut format, mut decoder, mut duration) = open_decoder_for_file(file_path)?;
    let mut actual_start = requested_start.max(0.0);
    if duration > 0.0 {
        actual_start = actual_start.min(duration);
    }

    if actual_start > 0.0 {
        if let Err(seek_err) = seek_decoder(decoder.as_mut(), format.as_mut(), actual_start) {
            eprintln!(
                "Seek to {} failed for {} ({}); reopening from start",
                actual_start, file_path, seek_err
            );
            let reopened = open_decoder_for_file(file_path)?;
            format = reopened.0;
            decoder = reopened.1;
            duration = reopened.2;
            actual_start = 0.0;
        }
    }

    let source = SymphoniaSource::new(
        decoder,
        format,
        state.clone(),
        emitted_samples.clone(),
        file_path.to_string(),
    )
    .ok_or_else(|| "missing channels or sample rate in codec params".to_string())?;

    Ok((source, duration, actual_start))
}

fn seek_decoder(
    decoder: &mut dyn SymphoniaDecoder,
    format: &mut dyn FormatReader,
    position_secs: f64,
) -> Result<(), String> {
    let tb = format
        .default_track()
        .and_then(|t| t.codec_params.time_base)
        .ok_or_else(|| "no time base".to_string())?;
    let ts = (position_secs * tb.denom as f64 / tb.numer as f64) as u64;

    format
        .seek(
            SeekMode::Coarse,
            SeekTo::Time {
                time: tb.calc_time(ts),
                track_id: None,
            },
        )
        .map_err(|e| format!("seek error: {}", e))?;
    decoder.reset();
    Ok(())
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
    decoder: Box<dyn SymphoniaDecoder>,
    format: Box<dyn FormatReader>,
    state: Arc<Mutex<PlaybackState>>,
    emitted_samples: Arc<AtomicU64>,
    file_path: String,
    buffer: Vec<f32>,
    buf_pos: usize,
    channels: u16,
    sample_rate: u32,
}

impl SymphoniaSource {
    pub(super) fn new(
        decoder: Box<dyn SymphoniaDecoder>,
        format: Box<dyn FormatReader>,
        state: Arc<Mutex<PlaybackState>>,
        emitted_samples: Arc<AtomicU64>,
        file_path: String,
    ) -> Option<Self> {
        let channels = decoder.codec_params().channels?.count() as u16;
        let sample_rate = decoder.codec_params().sample_rate?;

        Some(Self {
            decoder,
            format,
            state,
            emitted_samples,
            file_path,
            buffer: Vec::new(),
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

            let packet = match self.format.next_packet() {
                Ok(packet) => packet,
                Err(_) => return None,
            };

            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    if let Some((out, chans, rate)) = convert_to_f32(decoded) {
                        self.channels = chans;
                        self.sample_rate = rate;
                        self.buffer = out;
                        self.buf_pos = 0;
                        return Some(());
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
        let gain = {
            let state = self.state.lock();
            state.booster
        };
        sample = (sample * gain).clamp(-1.0, 1.0);
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

fn convert_to_f32(buf: AudioBufferRef) -> Option<(Vec<f32>, u16, u32)> {
    let chans = buf.spec().channels.count() as u16;
    let rate = buf.spec().rate;
    let frames = buf.frames();
    let sample_count = validate_decoded_packet(chans, frames, rate)?;

    let mut converted = buf.make_equivalent::<f32>();
    buf.convert(&mut converted);
    let mut out = Vec::with_capacity(sample_count);
    for frame_idx in 0..frames {
        for chan_idx in 0..chans as usize {
            out.push(*converted.chan(chan_idx).get(frame_idx)?);
        }
    }
    Some((out, chans, rate))
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
