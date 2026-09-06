use parking_lot::Mutex;
use rodio::{OutputStreamHandle, Sink, Source};
use std::collections::VecDeque;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{Decoder as SymphoniaDecoder, DecoderOptions};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::get_probe;

use crate::file_ops::{open_file_with_identity, FileIdentity};

use super::PlaybackState;

pub(super) struct PlaybackStart<'a> {
    pub(super) file_path: &'a str,
    pub(super) open_file_path: &'a str,
    pub(super) expected_identity: Option<FileIdentity>,
    pub(super) duration: f64,
    pub(super) start_secs: f64,
    pub(super) generation: u64,
    pub(super) initial_volume: Option<f32>,
}

pub(super) struct PrepareSource<'a> {
    pub(super) open_path: &'a str,
    pub(super) file_path: &'a str,
    pub(super) expected_identity: Option<FileIdentity>,
    pub(super) generation: u64,
    pub(super) requested_start: f64,
}

#[derive(Debug)]
pub(super) struct SourceWorkerError {
    pub(super) file_path: String,
    pub(super) generation: u64,
    pub(super) message: String,
    pub(super) cancelled: Arc<AtomicBool>,
}

const MAX_DECODE_FAILURES: usize = 64;
const MAX_SKIPPED_PACKETS: usize = 4_096;
const MIN_AUDIO_SAMPLE_RATE: u32 = 8_000;
const MAX_AUDIO_SAMPLE_RATE: u32 = 384_000;
const MAX_AUDIO_CHANNELS: u16 = 32;
pub(super) const MAX_DECODED_SAMPLES_PER_PACKET: usize = 16_777_216;
pub(super) const PCM_CHUNK_SAMPLES: usize = 16_384;
pub(super) const PCM_QUEUE_CAPACITY: usize = 4;
const UNDERRUN_RETRY_FRAMES: usize = 32;
const DECODER_INIT_TIMEOUT: Duration = Duration::from_secs(10);

const TERMINAL_RUNNING: u8 = 0;
const TERMINAL_EOF: u8 = 1;
const TERMINAL_ERROR: u8 = 2;
const TERMINAL_CANCELLED: u8 = 3;

const GAPLESS_BOUNDARY_ARMED: u8 = 0;
const GAPLESS_BOUNDARY_STARTED: u8 = 1;
const GAPLESS_BOUNDARY_CANCELLED: u8 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum GaplessBoundaryState {
    Armed,
    Started,
    Cancelled,
}

pub(super) struct GaplessBoundary {
    state: AtomicU8,
}

impl GaplessBoundary {
    pub(super) fn new() -> Self {
        Self {
            state: AtomicU8::new(GAPLESS_BOUNDARY_ARMED),
        }
    }

    pub(super) fn state(&self) -> GaplessBoundaryState {
        match self.state.load(Ordering::Acquire) {
            GAPLESS_BOUNDARY_ARMED => GaplessBoundaryState::Armed,
            GAPLESS_BOUNDARY_STARTED => GaplessBoundaryState::Started,
            _ => GaplessBoundaryState::Cancelled,
        }
    }

    pub(super) fn cancel(&self) -> GaplessBoundaryState {
        match self.state.compare_exchange(
            GAPLESS_BOUNDARY_ARMED,
            GAPLESS_BOUNDARY_CANCELLED,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => GaplessBoundaryState::Cancelled,
            Err(GAPLESS_BOUNDARY_STARTED) => GaplessBoundaryState::Started,
            Err(GAPLESS_BOUNDARY_CANCELLED) => GaplessBoundaryState::Cancelled,
            Err(_) => GaplessBoundaryState::Armed,
        }
    }

    fn begin_first_sample(&self) -> bool {
        match self.state.compare_exchange(
            GAPLESS_BOUNDARY_ARMED,
            GAPLESS_BOUNDARY_STARTED,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) | Err(GAPLESS_BOUNDARY_STARTED) => true,
            Err(_) => false,
        }
    }
}

type OpenedDecoder = (Box<dyn FormatReader>, Box<dyn SymphoniaDecoder>, u32, f64);

struct PcmQueues {
    ready: VecDeque<Vec<f32>>,
    free: Vec<Vec<f32>>,
}

struct DecodedPcmBuffer {
    queues: Mutex<PcmQueues>,
    retired_callback_buffer: Mutex<Option<Vec<f32>>>,
    cancelled: Arc<AtomicBool>,
    terminal: AtomicU8,
    worker_running: AtomicBool,
    consumer_alive: AtomicBool,
    max_ready_depth: AtomicUsize,
    underrun_samples: AtomicU64,
}

enum ReadyChunk {
    Ready,
    RunningEmpty,
    Contended,
    Terminal,
}

impl DecodedPcmBuffer {
    fn new() -> Self {
        let mut free = Vec::with_capacity(PCM_QUEUE_CAPACITY + 1);
        for _ in 0..=PCM_QUEUE_CAPACITY {
            free.push(Vec::with_capacity(PCM_CHUNK_SAMPLES));
        }

        Self {
            queues: Mutex::new(PcmQueues {
                ready: VecDeque::with_capacity(PCM_QUEUE_CAPACITY),
                free,
            }),
            retired_callback_buffer: Mutex::new(None),
            cancelled: Arc::new(AtomicBool::new(false)),
            terminal: AtomicU8::new(TERMINAL_RUNNING),
            worker_running: AtomicBool::new(false),
            consumer_alive: AtomicBool::new(true),
            max_ready_depth: AtomicUsize::new(0),
            underrun_samples: AtomicU64::new(0),
        }
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.terminal.store(TERMINAL_CANCELLED, Ordering::Release);
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    fn set_terminal(&self, terminal: u8) {
        self.terminal.store(terminal, Ordering::Release);
    }

    fn acquire_free_buffer(&self) -> Option<Vec<f32>> {
        loop {
            if self.is_cancelled() {
                return None;
            }
            if let Some(mut buffer) = self.queues.lock().free.pop() {
                buffer.clear();
                return Some(buffer);
            }
            thread::park_timeout(Duration::from_millis(1));
        }
    }

    fn try_push_ready(&self, buffer: Vec<f32>) -> Result<(), Vec<f32>> {
        let mut queues = self.queues.lock();
        if queues.ready.len() >= PCM_QUEUE_CAPACITY {
            return Err(buffer);
        }
        queues.ready.push_back(buffer);
        self.max_ready_depth
            .fetch_max(queues.ready.len(), Ordering::Relaxed);
        Ok(())
    }

    fn push_ready(&self, mut buffer: Vec<f32>) -> Result<(), Vec<f32>> {
        loop {
            if self.is_cancelled() {
                return Err(buffer);
            }
            match self.try_push_ready(buffer) {
                Ok(()) => return Ok(()),
                Err(returned) => buffer = returned,
            }
            thread::park_timeout(Duration::from_millis(1));
        }
    }

    fn try_take_ready(&self, current: &mut Vec<f32>) -> ReadyChunk {
        let Some(mut queues) = self.queues.try_lock() else {
            return ReadyChunk::Contended;
        };

        if current.capacity() >= PCM_CHUNK_SAMPLES {
            current.clear();
            queues.free.push(std::mem::take(current));
        }

        if let Some(next) = queues.ready.pop_front() {
            *current = next;
            ReadyChunk::Ready
        } else if self.terminal.load(Ordering::Acquire) == TERMINAL_RUNNING {
            ReadyChunk::RunningEmpty
        } else {
            ReadyChunk::Terminal
        }
    }

    fn retire_callback_buffer(&self, current: &mut Vec<f32>) {
        if current.capacity() < PCM_CHUNK_SAMPLES {
            return;
        }
        if let Some(mut retired) = self.retired_callback_buffer.try_lock() {
            current.clear();
            *retired = Some(std::mem::take(current));
        }
    }
}

#[derive(Debug)]
struct WorkerInit {
    channels: u16,
    sample_rate: u32,
    duration: f64,
    actual_start: f64,
    initial_chunk: Vec<f32>,
}

struct DecoderWorkerContext {
    open_path: String,
    file_path: String,
    expected_identity: Option<FileIdentity>,
    generation: u64,
    requested_start: f64,
    shared: Arc<DecodedPcmBuffer>,
    init_sender: Option<SyncSender<Result<WorkerInit, String>>>,
    error_sender: Sender<SourceWorkerError>,
}

enum WorkerExit {
    EndOfStream,
    Cancelled,
    Failed(String),
}

struct WorkerRunningGuard(Arc<DecodedPcmBuffer>);

impl Drop for WorkerRunningGuard {
    fn drop(&mut self) {
        self.0.worker_running.store(false, Ordering::Release);
    }
}

fn duration_from_frames(tb: symphonia::core::units::TimeBase, frames: u64) -> f64 {
    let time = tb.calc_time(frames);
    time.seconds as f64 + time.frac
}

fn open_decoder_for_file(
    file_path: &str,
    expected_identity: Option<&FileIdentity>,
) -> Result<OpenedDecoder, String> {
    let file = open_file_with_identity(Path::new(file_path), expected_identity)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = Path::new(file_path)
        .extension()
        .and_then(|ext| ext.to_str())
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
        .map_err(|e| format!("probe error: {e}"))?;
    let reader = probed.format;
    let track = reader
        .default_track()
        .ok_or_else(|| "no default track".to_string())?;
    let track_id = track.id;
    let decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("decoder error: {e}"))?;

    let duration = if let (Some(tb), Some(frames)) =
        (track.codec_params.time_base, track.codec_params.n_frames)
    {
        duration_from_frames(tb, frames)
    } else {
        0.0
    };

    Ok((reader, decoder, track_id, duration))
}

pub(super) fn prepare_source(
    request: PrepareSource<'_>,
    emitted_samples: &Arc<AtomicU64>,
    booster_gain: &Arc<AtomicU32>,
    error_sender: &Sender<SourceWorkerError>,
) -> Result<(SymphoniaSource, f64, f64), String> {
    let PrepareSource {
        open_path,
        file_path,
        expected_identity,
        generation,
        requested_start,
    } = request;
    let shared = Arc::new(DecodedPcmBuffer::new());
    let (init_sender, init_receiver) = sync_channel(1);
    let context = DecoderWorkerContext {
        open_path: open_path.to_string(),
        file_path: file_path.to_string(),
        expected_identity,
        generation,
        requested_start,
        shared: Arc::clone(&shared),
        init_sender: Some(init_sender),
        error_sender: error_sender.clone(),
    };

    shared.worker_running.store(true, Ordering::Release);
    if let Err(error) = thread::Builder::new()
        .name(format!("tarab-decoder-{generation}"))
        .spawn(move || decoder_worker(context))
    {
        shared.worker_running.store(false, Ordering::Release);
        return Err(format!("failed to start decoder worker: {error}"));
    }

    let init = wait_for_decoder_initialization(&init_receiver, &shared, DECODER_INIT_TIMEOUT)?;

    let duration = init.duration;
    let actual_start = init.actual_start;
    let source = SymphoniaSource {
        shared,
        emitted_samples: Arc::clone(emitted_samples),
        booster_gain: Arc::clone(booster_gain),
        current_chunk: init.initial_chunk,
        chunk_position: 0,
        channels: init.channels,
        sample_rate: init.sample_rate,
        gapless_boundary: None,
        first_sample_emitted: false,
        underrun_retry_samples: 0,
    };

    Ok((source, duration, actual_start))
}

fn wait_for_decoder_initialization(
    receiver: &Receiver<Result<WorkerInit, String>>,
    shared: &Arc<DecodedPcmBuffer>,
    timeout: Duration,
) -> Result<WorkerInit, String> {
    match receiver.recv_timeout(timeout) {
        Ok(Ok(init)) => Ok(init),
        Ok(Err(error)) => {
            shared.cancel();
            shared.consumer_alive.store(false, Ordering::Release);
            Err(error)
        }
        Err(RecvTimeoutError::Timeout) => {
            shared.cancel();
            shared.consumer_alive.store(false, Ordering::Release);
            Err(format!(
                "decoder initialization timed out after {} ms",
                timeout.as_millis()
            ))
        }
        Err(RecvTimeoutError::Disconnected) => {
            shared.cancel();
            shared.consumer_alive.store(false, Ordering::Release);
            Err("decoder worker stopped during initialization".to_string())
        }
    }
}

fn decoder_worker(mut context: DecoderWorkerContext) {
    let shared = Arc::clone(&context.shared);
    let initialized = {
        let _running = WorkerRunningGuard(Arc::clone(&shared));
        let mut init_sender = context.init_sender.take();
        let result = run_decoder_worker(&context, &mut init_sender);
        let initialized = init_sender.is_none();

        match result {
            WorkerExit::EndOfStream => {
                if let Some(sender) = init_sender.take() {
                    let _ =
                        sender.send(Err("audio stream contains no decodable samples".to_string()));
                    shared.set_terminal(TERMINAL_ERROR);
                } else {
                    shared.set_terminal(TERMINAL_EOF);
                }
            }
            WorkerExit::Cancelled => shared.set_terminal(TERMINAL_CANCELLED),
            WorkerExit::Failed(message) => {
                shared.set_terminal(TERMINAL_ERROR);
                if let Some(sender) = init_sender.take() {
                    let _ = sender.send(Err(message));
                } else if !shared.is_cancelled() {
                    let _ = context.error_sender.send(SourceWorkerError {
                        file_path: context.file_path,
                        generation: context.generation,
                        message,
                        cancelled: Arc::clone(&shared.cancelled),
                    });
                }
            }
        }
        initialized
    };

    // Keep the PCM pool's final owners off the Rodio callback thread. The worker
    // itself holds the two remaining references (`shared` and `context.shared`).
    while initialized
        && (shared.consumer_alive.load(Ordering::Acquire) || Arc::strong_count(&shared) > 2)
    {
        thread::park_timeout(Duration::from_millis(1));
    }
}

fn run_decoder_worker(
    context: &DecoderWorkerContext,
    init_sender: &mut Option<SyncSender<Result<WorkerInit, String>>>,
) -> WorkerExit {
    let opened = match open_decoder_for_file(&context.open_path, context.expected_identity.as_ref())
    {
        Ok(opened) => opened,
        Err(error) => return WorkerExit::Failed(error),
    };
    if context.shared.is_cancelled() {
        drop(opened);
        return WorkerExit::Cancelled;
    }
    let (mut format, mut decoder, mut track_id, mut duration) = opened;

    let mut actual_start = context.requested_start.max(0.0);
    if duration > 0.0 {
        actual_start = actual_start.min(duration);
    }

    if actual_start > 0.0 {
        if context.shared.is_cancelled() {
            return WorkerExit::Cancelled;
        }
        if seek_decoder(decoder.as_mut(), format.as_mut(), actual_start).is_err() {
            let reopened =
                match open_decoder_for_file(&context.open_path, context.expected_identity.as_ref())
                {
                    Ok(reopened) => reopened,
                    Err(error) => return WorkerExit::Failed(error),
                };
            if context.shared.is_cancelled() {
                drop(reopened);
                return WorkerExit::Cancelled;
            }
            format = reopened.0;
            decoder = reopened.1;
            track_id = reopened.2;
            duration = reopened.3;
            actual_start = 0.0;
        }
    }

    let mut expected_format = None;
    let mut decode_failures = 0;
    let mut skipped_packets = 0;

    loop {
        if context.shared.is_cancelled() {
            return WorkerExit::Cancelled;
        }

        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(error) if is_end_of_stream(&error) => return WorkerExit::EndOfStream,
            Err(error) => return WorkerExit::Failed(format!("packet read error: {error}")),
        };
        if context.shared.is_cancelled() {
            return WorkerExit::Cancelled;
        }

        if packet.track_id() != track_id {
            skipped_packets += 1;
            if skipped_packets >= MAX_SKIPPED_PACKETS {
                return WorkerExit::Failed("too many non-audio packets".to_string());
            }
            continue;
        }
        skipped_packets = 0;

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => {
                decode_failures += 1;
                if decode_failures >= MAX_DECODE_FAILURES {
                    return WorkerExit::Failed(format!(
                        "decoder exceeded {MAX_DECODE_FAILURES} consecutive recovery attempts"
                    ));
                }
                continue;
            }
            Err(error) => {
                decode_failures += 1;
                if decode_failures >= MAX_DECODE_FAILURES {
                    return WorkerExit::Failed(format!("decoder error: {error}"));
                }
                continue;
            }
        };
        if context.shared.is_cancelled() {
            return WorkerExit::Cancelled;
        }

        match queue_decoded_buffer(
            decoded,
            context,
            init_sender,
            &mut expected_format,
            duration,
            actual_start,
        ) {
            Ok(()) => decode_failures = 0,
            Err(exit) => return exit,
        }
    }
}

fn queue_decoded_buffer(
    decoded: AudioBufferRef<'_>,
    context: &DecoderWorkerContext,
    init_sender: &mut Option<SyncSender<Result<WorkerInit, String>>>,
    expected_format: &mut Option<(u16, u32)>,
    duration: f64,
    actual_start: f64,
) -> Result<(), WorkerExit> {
    if context.shared.is_cancelled() {
        return Err(WorkerExit::Cancelled);
    }
    let channels = decoded.spec().channels.count() as u16;
    let sample_rate = decoded.spec().rate;
    let frames = decoded.frames();
    validate_decoded_packet(channels, frames, sample_rate).ok_or_else(|| {
        WorkerExit::Failed(format!(
            "invalid decoded packet: {channels} channels, {frames} frames, {sample_rate} Hz"
        ))
    })?;

    if let Some((expected_channels, expected_rate)) = expected_format {
        if *expected_channels != channels || *expected_rate != sample_rate {
            return Err(WorkerExit::Failed(format!(
                "audio format changed from {expected_channels}ch/{expected_rate}Hz to {channels}ch/{sample_rate}Hz"
            )));
        }
    } else {
        *expected_format = Some((channels, sample_rate));
    }

    let mut converted = decoded.make_equivalent::<f32>();
    decoded.convert(&mut converted);
    let chunk_limit = (PCM_CHUNK_SAMPLES / channels as usize) * channels as usize;
    let mut chunk = None;

    for frame_index in 0..frames {
        if frame_index % 1_024 == 0 && context.shared.is_cancelled() {
            return Err(WorkerExit::Cancelled);
        }
        for channel_index in 0..channels as usize {
            if chunk.is_none() {
                chunk = context.shared.acquire_free_buffer();
                if chunk.is_none() {
                    return Err(WorkerExit::Cancelled);
                }
            }
            let sample = converted
                .chan(channel_index)
                .get(frame_index)
                .copied()
                .ok_or_else(|| {
                    WorkerExit::Failed("decoded sample buffer was truncated".to_string())
                })?;
            let active = chunk.as_mut().ok_or_else(|| {
                WorkerExit::Failed("decoder failed to acquire a PCM chunk".to_string())
            })?;
            active.push(sample);
            if active.len() == chunk_limit {
                let full_chunk = chunk.take().ok_or_else(|| {
                    WorkerExit::Failed("decoder lost a completed PCM chunk".to_string())
                })?;
                dispatch_chunk(
                    full_chunk,
                    context,
                    init_sender,
                    channels,
                    sample_rate,
                    duration,
                    actual_start,
                )?;
            }
        }
    }

    if let Some(chunk) = chunk {
        if !chunk.is_empty() {
            dispatch_chunk(
                chunk,
                context,
                init_sender,
                channels,
                sample_rate,
                duration,
                actual_start,
            )?;
        }
    }
    Ok(())
}

fn dispatch_chunk(
    chunk: Vec<f32>,
    context: &DecoderWorkerContext,
    init_sender: &mut Option<SyncSender<Result<WorkerInit, String>>>,
    channels: u16,
    sample_rate: u32,
    duration: f64,
    actual_start: f64,
) -> Result<(), WorkerExit> {
    if context.shared.is_cancelled() {
        return Err(WorkerExit::Cancelled);
    }
    if let Some(sender) = init_sender.take() {
        sender
            .send(Ok(WorkerInit {
                channels,
                sample_rate,
                duration,
                actual_start,
                initial_chunk: chunk,
            }))
            .map_err(|_| WorkerExit::Cancelled)
    } else {
        context
            .shared
            .push_ready(chunk)
            .map_err(|_| WorkerExit::Cancelled)
    }
}

fn seek_decoder(
    decoder: &mut dyn SymphoniaDecoder,
    format: &mut dyn FormatReader,
    position_secs: f64,
) -> Result<(), String> {
    let tb = format
        .default_track()
        .and_then(|track| track.codec_params.time_base)
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
        .map_err(|e| format!("seek error: {e}"))?;
    decoder.reset();
    Ok(())
}

fn is_end_of_stream(error: &SymphoniaError) -> bool {
    matches!(error, SymphoniaError::IoError(error) if error.kind() == ErrorKind::UnexpectedEof)
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
        let state = state.lock();
        sink.set_volume(start.initial_volume.unwrap_or(state.volume).clamp(0.0, 1.0));
        sink.set_speed(state.speed);
    }

    sink.append(source);
    if sink.len() == 0 {
        return None;
    }

    {
        let mut state = state.lock();
        state.current_file = Some(start.file_path.to_string());
        state.current_open_file = Some(start.open_file_path.to_string());
        state.current_file_identity = start.expected_identity;
        state.generation = start.generation;
        state.duration = start.duration;
        state.start_position = start.start_secs;
        state.position_sample_rate = sample_rate;
        state.position_channels = channels;
        state.is_playing = true;
        state.is_paused = false;
        state.warned_near_end = false;
    }
    Some(sink)
}

pub(super) struct SymphoniaSource {
    shared: Arc<DecodedPcmBuffer>,
    emitted_samples: Arc<AtomicU64>,
    booster_gain: Arc<AtomicU32>,
    current_chunk: Vec<f32>,
    chunk_position: usize,
    channels: u16,
    sample_rate: u32,
    gapless_boundary: Option<Arc<GaplessBoundary>>,
    first_sample_emitted: bool,
    underrun_retry_samples: usize,
}

impl SymphoniaSource {
    pub(super) fn cancellation_token(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.shared.cancelled)
    }

    pub(super) fn arm_gapless_boundary(&mut self, boundary: Arc<GaplessBoundary>) {
        self.gapless_boundary = Some(boundary);
    }

    fn next_decoded_sample(&mut self) -> Option<f32> {
        loop {
            if self.shared.is_cancelled() {
                return None;
            }

            if let Some(sample) = self.current_chunk.get(self.chunk_position).copied() {
                if !self.first_sample_emitted {
                    if self
                        .gapless_boundary
                        .as_ref()
                        .is_some_and(|boundary| !boundary.begin_first_sample())
                    {
                        self.shared.cancel();
                        return None;
                    }
                    if self.shared.is_cancelled() {
                        return None;
                    }
                    self.first_sample_emitted = true;
                }
                self.chunk_position += 1;
                self.emitted_samples.fetch_add(1, Ordering::Relaxed);
                let gain = f32::from_bits(self.booster_gain.load(Ordering::Relaxed));
                return Some((sample * gain).clamp(-1.0, 1.0));
            }

            if self.underrun_retry_samples > 0
                && self.shared.terminal.load(Ordering::Acquire) == TERMINAL_RUNNING
            {
                self.underrun_retry_samples -= 1;
                self.shared.underrun_samples.fetch_add(1, Ordering::Relaxed);
                return Some(0.0);
            }

            match self.shared.try_take_ready(&mut self.current_chunk) {
                ReadyChunk::Ready => {
                    self.chunk_position = 0;
                    self.underrun_retry_samples = 0;
                }
                ReadyChunk::RunningEmpty | ReadyChunk::Contended => {
                    self.underrun_retry_samples =
                        UNDERRUN_RETRY_FRAMES * self.channels as usize - 1;
                    self.shared.underrun_samples.fetch_add(1, Ordering::Relaxed);
                    return Some(0.0);
                }
                ReadyChunk::Terminal => return None,
            }
        }
    }
}

impl Iterator for SymphoniaSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        self.next_decoded_sample()
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

impl Drop for SymphoniaSource {
    fn drop(&mut self) {
        if self.shared.terminal.load(Ordering::Acquire) == TERMINAL_RUNNING {
            self.shared.cancel();
        }
        self.shared.retire_callback_buffer(&mut self.current_chunk);
        self.shared.consumer_alive.store(false, Ordering::Release);
    }
}

pub(super) fn validate_decoded_packet(
    channels: u16,
    frames: usize,
    sample_rate: u32,
) -> Option<usize> {
    let sample_count = frames.checked_mul(channels as usize)?;
    (channels > 0
        && channels <= MAX_AUDIO_CHANNELS
        && frames > 0
        && (MIN_AUDIO_SAMPLE_RATE..=MAX_AUDIO_SAMPLE_RATE).contains(&sample_rate)
        && sample_count <= MAX_DECODED_SAMPLES_PER_PACKET)
        .then_some(sample_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    struct DropFlag(Arc<AtomicBool>);

    impl Drop for DropFlag {
        fn drop(&mut self) {
            self.0.store(true, Ordering::Release);
        }
    }

    fn synthetic_source(
        samples: Vec<f32>,
        terminal: u8,
    ) -> (SymphoniaSource, Arc<DecodedPcmBuffer>, Arc<AtomicU64>) {
        let shared = Arc::new(DecodedPcmBuffer::new());
        shared.set_terminal(terminal);
        let emitted = Arc::new(AtomicU64::new(0));
        let source = SymphoniaSource {
            shared: Arc::clone(&shared),
            emitted_samples: Arc::clone(&emitted),
            booster_gain: Arc::new(AtomicU32::new(1.0_f32.to_bits())),
            current_chunk: samples,
            chunk_position: 0,
            channels: 1,
            sample_rate: 48_000,
            gapless_boundary: None,
            first_sample_emitted: false,
            underrun_retry_samples: 0,
        };
        (source, shared, emitted)
    }

    #[test]
    fn decoded_pcm_queue_never_exceeds_its_fixed_capacity() {
        let shared = DecodedPcmBuffer::new();
        for value in 0..PCM_QUEUE_CAPACITY {
            let mut chunk = shared.acquire_free_buffer().expect("free buffer");
            chunk.push(value as f32);
            shared.try_push_ready(chunk).expect("queue has capacity");
        }

        let mut overflow = shared
            .acquire_free_buffer()
            .expect("active buffer allowance");
        overflow.push(99.0);
        assert!(shared.try_push_ready(overflow).is_err());
        let queues = shared.queues.lock();
        assert_eq!(queues.ready.len(), PCM_QUEUE_CAPACITY);
        assert_eq!(
            shared.max_ready_depth.load(Ordering::Relaxed),
            PCM_QUEUE_CAPACITY
        );
        assert!(queues
            .ready
            .iter()
            .all(|chunk| chunk.len() <= PCM_CHUNK_SAMPLES));
    }

    #[test]
    fn dropping_source_releases_a_producer_waiting_on_a_full_queue() {
        let (source, shared, _) = synthetic_source(vec![0.25], TERMINAL_RUNNING);
        for _ in 0..PCM_QUEUE_CAPACITY {
            let mut chunk = shared.acquire_free_buffer().expect("free buffer");
            chunk.push(0.5);
            shared.try_push_ready(chunk).expect("queue has capacity");
        }
        let mut blocked_chunk = shared.acquire_free_buffer().expect("producer buffer");
        blocked_chunk.push(0.75);
        shared.worker_running.store(true, Ordering::Release);
        let worker_shared = Arc::clone(&shared);
        let worker = thread::spawn(move || {
            let result = worker_shared.push_ready(blocked_chunk);
            worker_shared.worker_running.store(false, Ordering::Release);
            result
        });

        drop(source);
        assert!(worker.join().expect("worker exits").is_err());

        assert!(shared.is_cancelled());
        assert!(!shared.consumer_alive.load(Ordering::Acquire));
        assert!(!shared.worker_running.load(Ordering::Acquire));
    }

    #[test]
    fn decoder_initialization_timeout_cancels_and_late_worker_exit_releases_handles() {
        let shared = Arc::new(DecodedPcmBuffer::new());
        shared.worker_running.store(true, Ordering::Release);
        let (sender, receiver) = sync_channel(1);
        let release_worker = Arc::new(AtomicBool::new(false));
        let handle_dropped = Arc::new(AtomicBool::new(false));
        let late_send_failed = Arc::new(AtomicBool::new(false));
        let worker_shared = Arc::clone(&shared);
        let worker_release = Arc::clone(&release_worker);
        let worker_handle_dropped = Arc::clone(&handle_dropped);
        let worker_send_failed = Arc::clone(&late_send_failed);
        let worker = thread::spawn(move || {
            let _running = WorkerRunningGuard(worker_shared);
            let _handle = DropFlag(worker_handle_dropped);
            while !worker_release.load(Ordering::Acquire) {
                thread::park_timeout(Duration::from_millis(1));
            }
            worker_send_failed.store(
                sender.send(Err("late initialization".to_string())).is_err(),
                Ordering::Release,
            );
        });

        let started = Instant::now();
        let error = wait_for_decoder_initialization(&receiver, &shared, Duration::from_millis(10))
            .expect_err("initialization should time out");

        assert!(error.contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(shared.is_cancelled());
        assert!(!shared.consumer_alive.load(Ordering::Acquire));
        assert!(shared.worker_running.load(Ordering::Acquire));

        drop(receiver);
        release_worker.store(true, Ordering::Release);
        worker.thread().unpark();
        worker.join().expect("late worker exits");

        assert!(late_send_failed.load(Ordering::Acquire));
        assert!(handle_dropped.load(Ordering::Acquire));
        assert!(!shared.worker_running.load(Ordering::Acquire));
    }

    #[test]
    fn eof_and_error_finish_only_after_buffered_samples() {
        for terminal in [TERMINAL_EOF, TERMINAL_ERROR] {
            let (mut source, _, emitted) = synthetic_source(vec![0.25, -0.5], terminal);
            assert_eq!(source.next(), Some(0.25));
            assert_eq!(source.next(), Some(-0.5));
            assert_eq!(source.next(), None);
            assert_eq!(emitted.load(Ordering::Relaxed), 2);
        }
    }

    #[test]
    fn position_counter_ignores_nonblocking_underrun_silence() {
        let (mut source, shared, emitted) = synthetic_source(vec![0.25, 0.5], TERMINAL_RUNNING);
        assert_eq!(source.next(), Some(0.25));
        assert_eq!(source.next(), Some(0.5));
        assert_eq!(source.next(), Some(0.0));
        assert_eq!(emitted.load(Ordering::Relaxed), 2);
        assert_eq!(shared.underrun_samples.load(Ordering::Relaxed), 1);

        shared.set_terminal(TERMINAL_EOF);
        assert_eq!(source.next(), None);
    }

    #[test]
    fn gapless_boundary_is_claimed_by_the_first_decoded_sample() {
        let (mut source, _, _) = synthetic_source(vec![0.25], TERMINAL_EOF);
        let boundary = Arc::new(GaplessBoundary::new());
        source.arm_gapless_boundary(Arc::clone(&boundary));

        assert_eq!(boundary.state(), GaplessBoundaryState::Armed);
        assert_eq!(source.next(), Some(0.25));
        assert_eq!(boundary.state(), GaplessBoundaryState::Started);
        assert_eq!(source.next(), None);
    }

    #[test]
    fn cancellation_immediately_before_first_sample_wins_the_boundary() {
        let (mut source, shared, emitted) = synthetic_source(vec![0.25], TERMINAL_RUNNING);
        let boundary = Arc::new(GaplessBoundary::new());
        source.arm_gapless_boundary(Arc::clone(&boundary));

        assert_eq!(boundary.cancel(), GaplessBoundaryState::Cancelled);

        assert_eq!(source.next(), None);
        assert_eq!(boundary.state(), GaplessBoundaryState::Cancelled);
        assert!(shared.is_cancelled());
        assert_eq!(emitted.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn cancellation_immediately_after_first_sample_reports_started() {
        let (mut source, shared, emitted) = synthetic_source(vec![0.25], TERMINAL_RUNNING);
        let boundary = Arc::new(GaplessBoundary::new());
        source.arm_gapless_boundary(Arc::clone(&boundary));

        assert_eq!(source.next(), Some(0.25));
        assert_eq!(boundary.cancel(), GaplessBoundaryState::Started);

        assert_eq!(boundary.state(), GaplessBoundaryState::Started);
        assert!(!shared.is_cancelled());
        assert_eq!(emitted.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn callback_side_empty_queue_check_does_not_wait_for_queue_lock() {
        let (mut source, shared, _) = synthetic_source(Vec::new(), TERMINAL_RUNNING);
        let _queue_guard = shared.queues.lock();
        let started = Instant::now();

        assert_eq!(source.next(), Some(0.0));
        assert!(started.elapsed() < Duration::from_millis(20));
    }

    #[test]
    fn frame_duration_preserves_fractional_seconds() {
        let duration = duration_from_frames(symphonia::core::units::TimeBase::new(1, 320), 12_345);

        assert!((duration - 38.578_125).abs() < f64::EPSILON);
    }
}
