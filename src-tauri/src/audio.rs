use parking_lot::Mutex;
use rodio::{Sink, Source};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, sync_channel, Sender, SyncSender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::file_ops::{
    consume_play_once_file_access, ensure_existing_path_allowed, FileIdentity, SharedLibraryRoots,
};

mod crossfade;
mod device;
mod events;
mod source;
mod state;

use crossfade::{
    apply_crossfade_mix, apply_crossfade_step, crossfade_progress, normalized_progress,
    CrossfadeState,
};
use device::{
    enumerate_output_devices, open_output_stream, AudioOutputDeviceInfo, AudioOutputSelection,
    AudioOutputState,
};
use events::{
    emit_playback_error, emit_playback_transition, PlaybackNearEndEvent, PlaybackPositionEvent,
    PlaybackTransition,
};
pub use events::{
    GaplessCancellationOutcome, GaplessHandoff, GaplessPreloadIdentity, PlaybackEndedPayload,
};
use source::{
    play_with_source, prepare_source, GaplessBoundary, GaplessBoundaryState, PlaybackStart,
    PrepareSource, SourceWorkerError,
};
pub use state::PlaybackState;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSourceIdentity {
    pub generation: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SeekPlaybackOutcome {
    Applied {
        position: f64,
        gapless_cancellation: Option<GaplessCancellationOutcome>,
    },
    Stale {
        expected_source: PlaybackSourceIdentity,
        active_source: Option<PlaybackSourceIdentity>,
        gapless_cancellation: Option<GaplessCancellationOutcome>,
    },
    Failed {
        message: String,
        gapless_cancellation: Option<GaplessCancellationOutcome>,
    },
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputSwitchOutcome {
    pub selection: AudioOutputSelection,
    pub gapless_cancellation: Option<GaplessCancellationOutcome>,
}

enum AudioCommand {
    Play {
        file_path: String,
        open_path: String,
        start_pos: Option<f64>,
        generation: u64,
        expected_identity: Option<FileIdentity>,
    },
    CrossfadeTo {
        file_path: String,
        open_path: String,
        start_pos: Option<f64>,
        duration_ms: u64,
        generation: u64,
    },
    Pause,
    Resume,
    Stop {
        generation: u64,
    },
    Seek {
        position_secs: f64,
        expected_source: PlaybackSourceIdentity,
        response: SyncSender<SeekPlaybackOutcome>,
    },
    SetVolume(f32),
    SetVolumeRamp {
        from: f32,
        to: f32,
        duration_ms: u64,
    },
    SetSpeed(f32),
    SetCrossfade(f32),
    SetBooster(f32),
    SetOutputDevice {
        device_id: Option<String>,
        response: SyncSender<Result<AudioOutputSwitchOutcome, String>>,
    },
    PreloadNext {
        file_path: String,
        open_path: String,
        preload: GaplessPreloadIdentity,
        response: SyncSender<Result<GaplessPreloadIdentity, String>>,
    },
    CancelGaplessPreload {
        preload: GaplessPreloadIdentity,
        response: SyncSender<GaplessCancellationOutcome>,
    },
    SourceRenamed {
        old_path: String,
        new_path: String,
        new_open_path: String,
    },
}

pub struct AudioManager {
    command_sender: Sender<AudioCommand>,
    pub playback_state: Arc<Mutex<PlaybackState>>,
    active_emitted_samples: Arc<Mutex<Arc<AtomicU64>>>,
    next_generation: AtomicU64,
    next_preload_id: AtomicU64,
    generation_command_lock: Mutex<()>,
}

struct VolumeRampState {
    from: f32,
    to: f32,
    start: Instant,
    duration: Duration,
}

struct PendingGaplessSource {
    preload: GaplessPreloadIdentity,
    open_path: String,
    outgoing_path: String,
    outgoing_generation: u64,
    duration: f64,
    actual_start: f64,
    sample_rate: u32,
    channels: u16,
    emitted_samples: Arc<AtomicU64>,
    cancelled: Arc<AtomicBool>,
    boundary: Arc<GaplessBoundary>,
}

#[derive(Default)]
struct GaplessProtocol {
    pending: Option<PendingGaplessSource>,
    last_handoff: Option<GaplessHandoff>,
}

impl GaplessProtocol {
    fn complete(
        &mut self,
        state: &Arc<Mutex<PlaybackState>>,
        active_counter: &Arc<Mutex<Arc<AtomicU64>>>,
        app: &AppHandle,
    ) -> Option<GaplessHandoff> {
        let handoff = complete_gapless_handoff(&mut self.pending, state, active_counter, app)?;
        self.last_handoff = Some(handoff.clone());
        Some(handoff)
    }

    fn cancel(
        &mut self,
        expected: Option<&GaplessPreloadIdentity>,
        state: &Arc<Mutex<PlaybackState>>,
        active_counter: &Arc<Mutex<Arc<AtomicU64>>>,
        app: &AppHandle,
    ) -> Option<GaplessCancellationOutcome> {
        if let Some(expected) = expected {
            if self
                .pending
                .as_ref()
                .is_none_or(|pending| pending.preload != *expected)
            {
                return Some(
                    self.last_handoff
                        .as_ref()
                        .filter(|handoff| handoff.preload == *expected)
                        .cloned()
                        .map(|handoff| GaplessCancellationOutcome::HandedOff { handoff })
                        .unwrap_or_else(|| GaplessCancellationOutcome::Stale {
                            preload: expected.clone(),
                        }),
                );
            }
        }

        let boundary_state = self.pending.as_ref()?.boundary.cancel();
        match boundary_state {
            GaplessBoundaryState::Started => self
                .complete(state, active_counter, app)
                .map(|handoff| GaplessCancellationOutcome::HandedOff { handoff }),
            GaplessBoundaryState::Cancelled => {
                let pending = self.pending.take()?;
                pending.cancelled.store(true, Ordering::Release);
                Some(GaplessCancellationOutcome::Cancelled {
                    preload: pending.preload,
                })
            }
            GaplessBoundaryState::Armed => None,
        }
    }

    fn cancel_expected(
        &mut self,
        expected: &GaplessPreloadIdentity,
        state: &Arc<Mutex<PlaybackState>>,
        active_counter: &Arc<Mutex<Arc<AtomicU64>>>,
        app: &AppHandle,
    ) -> GaplessCancellationOutcome {
        self.cancel(Some(expected), state, active_counter, app)
            .unwrap_or_else(|| GaplessCancellationOutcome::Stale {
                preload: expected.clone(),
            })
    }

    fn cancel_any(
        &mut self,
        state: &Arc<Mutex<PlaybackState>>,
        active_counter: &Arc<Mutex<Arc<AtomicU64>>>,
        app: &AppHandle,
    ) -> Option<GaplessCancellationOutcome> {
        self.cancel(None, state, active_counter, app)
    }

    fn handoff_for_outgoing_source(
        &self,
        source: &PlaybackSourceIdentity,
        active_source: Option<&PlaybackSourceIdentity>,
    ) -> Option<GaplessCancellationOutcome> {
        self.last_handoff
            .as_ref()
            .filter(|handoff| {
                handoff.outgoing_generation == source.generation
                    && handoff.outgoing_path == source.path
                    && active_source.is_some_and(|active| {
                        active.generation == handoff.preload.generation
                            && active.path == handoff.preload.path
                    })
            })
            .cloned()
            .map(|handoff| GaplessCancellationOutcome::HandedOff { handoff })
    }
}

fn active_source_identity(state: &PlaybackState) -> Option<PlaybackSourceIdentity> {
    state
        .current_file
        .as_ref()
        .map(|path| PlaybackSourceIdentity {
            generation: state.generation,
            path: path.clone(),
        })
}

fn seek_source_matches(state: &PlaybackState, expected: &PlaybackSourceIdentity) -> bool {
    state.generation == expected.generation
        && state.current_file.as_deref() == Some(expected.path.as_str())
}

fn complete_gapless_handoff(
    slot: &mut Option<PendingGaplessSource>,
    state: &Arc<Mutex<PlaybackState>>,
    active_counter: &Arc<Mutex<Arc<AtomicU64>>>,
    app: &AppHandle,
) -> Option<GaplessHandoff> {
    let is_ready = slot
        .as_ref()
        .is_some_and(|pending| pending.boundary.state() == GaplessBoundaryState::Started);
    if !is_ready {
        return None;
    }

    let pending = slot.take()?;
    if pending.cancelled.load(Ordering::Acquire) {
        return None;
    }

    {
        let mut playback_state = state.lock();
        if playback_state.generation != pending.outgoing_generation
            || playback_state.current_file.as_deref() != Some(pending.outgoing_path.as_str())
        {
            pending.cancelled.store(true, Ordering::Release);
            return None;
        }
        *active_counter.lock() = Arc::clone(&pending.emitted_samples);
        playback_state.current_file = Some(pending.preload.path.clone());
        playback_state.current_open_file = Some(pending.open_path);
        playback_state.current_file_identity = None;
        playback_state.generation = pending.preload.generation;
        playback_state.duration = pending.duration;
        playback_state.start_position = pending.actual_start;
        playback_state.position_sample_rate = pending.sample_rate;
        playback_state.position_channels = pending.channels;
        playback_state.is_playing = true;
        playback_state.is_paused = false;
        playback_state.warned_near_end = false;
    }

    let handoff = GaplessHandoff {
        outgoing_path: pending.outgoing_path,
        outgoing_generation: pending.outgoing_generation,
        preload: pending.preload,
    };
    let payload = PlaybackEndedPayload {
        path: Some(handoff.outgoing_path.clone()),
        generation: handoff.outgoing_generation,
        seamless: true,
        handoff: Some(handoff.clone()),
    };
    let _ = app.emit("playback-ended", payload);
    emit_playback_transition(
        app,
        handoff.preload.generation,
        PlaybackTransition::Playing,
        Some(handoff.preload.path.clone()),
        None,
        true,
    );
    Some(handoff)
}

fn emit_source_worker_error(app: &AppHandle, error: SourceWorkerError) {
    if error.cancelled.load(Ordering::Acquire) {
        return;
    }
    emit_playback_error(
        app,
        error.file_path.clone(),
        error.generation,
        "decode",
        error.message.clone(),
        true,
    );
    emit_playback_transition(
        app,
        error.generation,
        PlaybackTransition::DecodeFailed,
        Some(error.file_path),
        Some(error.message),
        true,
    );
}

fn position_from_samples(state: &PlaybackState, emitted_samples: u64) -> f64 {
    if state.position_sample_rate == 0 || state.position_channels == 0 {
        return state.start_position;
    }
    let sample_rate = state.position_sample_rate as f64;
    let channels = state.position_channels as f64;
    state.start_position + (emitted_samples as f64 / (sample_rate * channels))
}

fn reset_active_counter(slot: &Arc<Mutex<Arc<AtomicU64>>>) {
    let counter = slot.lock().clone();
    counter.store(0, Ordering::Relaxed);
}

fn set_active_counter(slot: &Arc<Mutex<Arc<AtomicU64>>>, counter: Arc<AtomicU64>) {
    *slot.lock() = counter;
}

fn apply_volume_ramp_step(
    ramp: &mut Option<VolumeRampState>,
    state: &Arc<Mutex<PlaybackState>>,
    sink: Option<&Sink>,
) {
    let Some(current) = ramp.as_ref() else {
        return;
    };

    let elapsed = current.start.elapsed();
    let progress = normalized_progress(elapsed, current.duration);
    let value = current.from + (current.to - current.from) * progress;

    {
        let mut playback_state = state.lock();
        playback_state.volume = value.clamp(0.0, 1.0);
    }
    if let Some(active_sink) = sink {
        active_sink.set_volume(value.clamp(0.0, 1.0));
    }

    if progress >= 1.0 {
        *ramp = None;
    }
}

impl AudioManager {
    pub fn new(app: AppHandle) -> Self {
        let (sender, receiver) = channel::<AudioCommand>();
        let playback_state = Arc::new(Mutex::new(PlaybackState::default()));
        let emitted_samples = Arc::new(AtomicU64::new(0));
        let active_emitted_samples = Arc::new(Mutex::new(Arc::clone(&emitted_samples)));
        let booster_gain = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        let (source_error_sender, source_error_receiver) = channel::<SourceWorkerError>();
        let state_clone = Arc::clone(&playback_state);
        let is_running = Arc::new(std::sync::atomic::AtomicBool::new(true));

        // Emit position updates (100ms) from decoded sample counts for accuracy.
        let app_clone = app.clone();
        let position_state_clone = Arc::clone(&playback_state);
        let active_emitted_for_position = Arc::clone(&active_emitted_samples);
        let position_is_running = Arc::clone(&is_running);
        thread::spawn(move || {
            let mut last_emitted = 0.0;
            while position_is_running.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(100));

                let mut position_to_emit = None;
                let mut near_end_to_emit = None;
                {
                    let mut state = position_state_clone.lock();
                    if !state.is_playing || state.is_paused {
                        drop(state);
                        // Sleep longer while idle to reduce CPU wakeups.
                        thread::sleep(Duration::from_millis(400));
                        continue;
                    }

                    let emitted = {
                        let counter = active_emitted_for_position.lock().clone();
                        counter.load(Ordering::Relaxed)
                    };
                    let current_pos = position_from_samples(&state, emitted);
                    let remaining = state.duration - current_pos;
                    let threshold = (state.crossfade_secs as f64) + 0.25;

                    if remaining.is_finite() && remaining > threshold + 0.5 {
                        // Reset if we moved away from end (e.g., seek).
                        state.warned_near_end = false;
                    }
                    if remaining.is_finite()
                        && remaining <= threshold
                        && !state.warned_near_end
                        && state.duration > 0.0
                    {
                        state.warned_near_end = true;
                        near_end_to_emit = Some(PlaybackNearEndEvent {
                            generation: state.generation,
                            remaining: remaining.max(0.0),
                        });
                    }

                    if (current_pos - last_emitted).abs() >= 0.05 {
                        position_to_emit = Some(PlaybackPositionEvent {
                            generation: state.generation,
                            position: current_pos,
                        });
                        last_emitted = current_pos;
                    }
                }

                if let Some(payload) = position_to_emit {
                    let _ = app_clone.emit("playback-position", payload);
                }
                if let Some(payload) = near_end_to_emit {
                    let _ = app_clone.emit("playback-near-end", payload);
                }
            }
        });

        // Spawn dedicated audio thread
        let app_for_audio = app.clone();
        let active_emitted_for_audio = Arc::clone(&active_emitted_samples);
        let booster_for_audio = Arc::clone(&booster_gain);
        let audio_is_running = Arc::clone(&is_running);
        thread::spawn(move || {
            // Missing startup hardware is recoverable; keep receiving commands so a later
            // device selection can install the first usable stream.
            let mut output_state = AudioOutputState::unavailable();
            if let Err(error) =
                output_state.apply_open_result(open_output_stream(None).map(|opened| opened.output))
            {
                eprintln!("Failed to create audio stream: {}", error);
                emit_playback_error(
                    &app_for_audio,
                    "",
                    0,
                    "stream",
                    format!("Failed to create audio stream: {}", error),
                    true,
                );
            }

            let mut current_sink: Option<Sink> = None;
            let mut crossfade_state: Option<CrossfadeState> = None;
            let mut volume_ramp: Option<VolumeRampState> = None;
            let mut gapless_protocol = GaplessProtocol::default();

            loop {
                gapless_protocol.complete(&state_clone, &active_emitted_for_audio, &app_for_audio);
                while let Ok(error) = source_error_receiver.try_recv() {
                    emit_source_worker_error(&app_for_audio, error);
                }

                match receiver.recv_timeout(Duration::from_millis(20)) {
                    Ok(command) => {
                        gapless_protocol.complete(
                            &state_clone,
                            &active_emitted_for_audio,
                            &app_for_audio,
                        );
                        while let Ok(error) = source_error_receiver.try_recv() {
                            emit_source_worker_error(&app_for_audio, error);
                        }

                        match command {
                            AudioCommand::Play {
                                file_path,
                                open_path,
                                start_pos,
                                generation,
                                expected_identity,
                            } => {
                                emit_playback_transition(
                                    &app_for_audio,
                                    generation,
                                    PlaybackTransition::Loading,
                                    Some(file_path.clone()),
                                    None,
                                    true,
                                );
                                let _ = gapless_protocol.cancel_any(
                                    &state_clone,
                                    &active_emitted_for_audio,
                                    &app_for_audio,
                                );
                                let requested_start = start_pos.unwrap_or(0.0).max(0.0);
                                if let Some(active) = crossfade_state.take() {
                                    active.outgoing_sink.stop();
                                }
                                if let Some(sink) = current_sink.take() {
                                    sink.stop();
                                }
                                volume_ramp = None;
                                reset_active_counter(&active_emitted_for_audio);
                                {
                                    let mut state = state_clone.lock();
                                    state.current_file = Some(file_path.clone());
                                    state.current_open_file = Some(open_path.clone());
                                    state.current_file_identity = expected_identity;
                                    state.generation = generation;
                                    state.start_position = requested_start;
                                    state.duration = 0.0;
                                    state.position_sample_rate = 0;
                                    state.position_channels = 0;
                                    state.is_playing = false;
                                    state.is_paused = false;
                                    state.warned_near_end = false;
                                }
                                let (_, stream_handle) = match output_state.current() {
                                    Ok(output) => output,
                                    Err(error) => {
                                        emit_playback_error(
                                            &app_for_audio,
                                            file_path.clone(),
                                            generation,
                                            "stream",
                                            error,
                                            true,
                                        );
                                        continue;
                                    }
                                };
                                let emitted_for_play = Arc::new(AtomicU64::new(0));
                                match prepare_source(
                                    PrepareSource {
                                        open_path: &open_path,
                                        file_path: &file_path,
                                        expected_identity,
                                        generation,
                                        requested_start,
                                    },
                                    &emitted_for_play,
                                    &booster_for_audio,
                                    &source_error_sender,
                                ) {
                                    Ok((source, duration, actual_start)) => {
                                        if let Some(new_sink) = play_with_source(
                                            stream_handle,
                                            source,
                                            &state_clone,
                                            PlaybackStart {
                                                file_path: &file_path,
                                                open_file_path: &open_path,
                                                expected_identity,
                                                duration,
                                                start_secs: actual_start,
                                                generation,
                                                initial_volume: None,
                                            },
                                        ) {
                                            current_sink = Some(new_sink);
                                            set_active_counter(
                                                &active_emitted_for_audio,
                                                Arc::clone(&emitted_for_play),
                                            );
                                            volume_ramp = None;
                                            emit_playback_transition(
                                                &app_for_audio,
                                                generation,
                                                PlaybackTransition::Playing,
                                                Some(file_path.clone()),
                                                None,
                                                true,
                                            );
                                        } else {
                                            emit_playback_error(
                                                &app_for_audio,
                                                file_path.clone(),
                                                generation,
                                                "stream",
                                                "Failed to initialize audio output stream",
                                                false,
                                            );
                                        }
                                    }
                                    Err(err) => {
                                        emit_playback_error(
                                            &app_for_audio,
                                            file_path.clone(),
                                            generation,
                                            "decode",
                                            err.clone(),
                                            false,
                                        );
                                        emit_playback_transition(
                                            &app_for_audio,
                                            generation,
                                            PlaybackTransition::DecodeFailed,
                                            Some(file_path.clone()),
                                            Some(err),
                                            false,
                                        );
                                    }
                                }
                            }
                            AudioCommand::CrossfadeTo {
                                file_path,
                                open_path,
                                start_pos,
                                duration_ms,
                                generation,
                            } => {
                                emit_playback_transition(
                                    &app_for_audio,
                                    generation,
                                    PlaybackTransition::Loading,
                                    Some(file_path.clone()),
                                    None,
                                    true,
                                );
                                let _ = gapless_protocol.cancel_any(
                                    &state_clone,
                                    &active_emitted_for_audio,
                                    &app_for_audio,
                                );
                                let (_, stream_handle) = match output_state.current() {
                                    Ok(output) => output,
                                    Err(error) => {
                                        emit_playback_error(
                                            &app_for_audio,
                                            file_path.clone(),
                                            generation,
                                            "stream",
                                            error,
                                            true,
                                        );
                                        continue;
                                    }
                                };
                                if crossfade_state.is_some() {
                                    let message =
                                        "A crossfade transition is already active".to_string();
                                    emit_playback_error(
                                        &app_for_audio,
                                        file_path.clone(),
                                        generation,
                                        "stream",
                                        message.clone(),
                                        true,
                                    );
                                    emit_playback_transition(
                                        &app_for_audio,
                                        generation,
                                        PlaybackTransition::DecodeFailed,
                                        Some(file_path),
                                        Some(message),
                                        true,
                                    );
                                    continue;
                                }

                                let requested_start = start_pos.unwrap_or(0.0).max(0.0);
                                let should_fallback_to_play =
                                    current_sink.is_none() || duration_ms == 0;
                                let emitted_for_crossfade = Arc::new(AtomicU64::new(0));

                                match prepare_source(
                                    PrepareSource {
                                        open_path: &open_path,
                                        file_path: &file_path,
                                        expected_identity: None,
                                        generation,
                                        requested_start,
                                    },
                                    &emitted_for_crossfade,
                                    &booster_for_audio,
                                    &source_error_sender,
                                ) {
                                    Ok((source, duration, actual_start)) => {
                                        let initial_volume = if should_fallback_to_play {
                                            None
                                        } else {
                                            Some(0.0)
                                        };
                                        if let Some(new_sink) = play_with_source(
                                            stream_handle,
                                            source,
                                            &state_clone,
                                            PlaybackStart {
                                                file_path: &file_path,
                                                open_file_path: &open_path,
                                                expected_identity: None,
                                                duration,
                                                start_secs: actual_start,
                                                generation,
                                                initial_volume,
                                            },
                                        ) {
                                            if should_fallback_to_play {
                                                if let Some(sink) = current_sink.take() {
                                                    sink.stop();
                                                }
                                                current_sink = Some(new_sink);
                                            } else if let Some(outgoing_sink) = current_sink.take()
                                            {
                                                current_sink = Some(new_sink);
                                                crossfade_state = Some(CrossfadeState {
                                                    outgoing_sink,
                                                    start: Instant::now(),
                                                    duration: Duration::from_millis(
                                                        duration_ms.max(1),
                                                    ),
                                                    generation,
                                                    incoming_path: file_path.clone(),
                                                });
                                                apply_crossfade_step(
                                                    &mut crossfade_state,
                                                    &state_clone,
                                                    current_sink.as_ref(),
                                                );
                                            } else {
                                                current_sink = Some(new_sink);
                                            }

                                            set_active_counter(
                                                &active_emitted_for_audio,
                                                Arc::clone(&emitted_for_crossfade),
                                            );
                                            volume_ramp = None;
                                            emit_playback_transition(
                                                &app_for_audio,
                                                generation,
                                                if should_fallback_to_play {
                                                    PlaybackTransition::Playing
                                                } else {
                                                    PlaybackTransition::CrossfadeStarted
                                                },
                                                Some(file_path.clone()),
                                                None,
                                                true,
                                            );
                                        } else {
                                            emit_playback_error(
                                                &app_for_audio,
                                                file_path.clone(),
                                                generation,
                                                "stream",
                                                "Failed to initialize audio output stream",
                                                true,
                                            );
                                        }
                                    }
                                    Err(err) => {
                                        emit_playback_error(
                                            &app_for_audio,
                                            file_path.clone(),
                                            generation,
                                            "decode",
                                            err.clone(),
                                            true,
                                        );
                                        emit_playback_transition(
                                            &app_for_audio,
                                            generation,
                                            PlaybackTransition::DecodeFailed,
                                            Some(file_path.clone()),
                                            Some(err),
                                            true,
                                        );
                                    }
                                }
                            }
                            AudioCommand::Seek {
                                position_secs,
                                expected_source,
                                response,
                            } => {
                                let active_source = {
                                    let state = state_clone.lock();
                                    if seek_source_matches(&state, &expected_source) {
                                        None
                                    } else {
                                        Some(active_source_identity(&state))
                                    }
                                };
                                if let Some(active_source) = active_source {
                                    let gapless_cancellation = gapless_protocol
                                        .handoff_for_outgoing_source(
                                            &expected_source,
                                            active_source.as_ref(),
                                        );
                                    let _ = response.send(SeekPlaybackOutcome::Stale {
                                        expected_source,
                                        active_source,
                                        gapless_cancellation,
                                    });
                                    continue;
                                }

                                let gapless_cancellation = gapless_protocol.cancel_any(
                                    &state_clone,
                                    &active_emitted_for_audio,
                                    &app_for_audio,
                                );
                                let (
                                    active_source,
                                    active_path,
                                    active_open_path,
                                    active_identity,
                                    was_paused,
                                    had_sink,
                                    duration,
                                ) = {
                                    let state = state_clone.lock();
                                    (
                                        active_source_identity(&state),
                                        state.current_file.clone().unwrap_or_default(),
                                        state.current_open_file.clone().unwrap_or_default(),
                                        state.current_file_identity,
                                        state.is_paused,
                                        current_sink.is_some(),
                                        state.duration,
                                    )
                                };
                                if active_source.as_ref() != Some(&expected_source) {
                                    let gapless_cancellation = gapless_cancellation.or_else(|| {
                                        gapless_protocol.handoff_for_outgoing_source(
                                            &expected_source,
                                            active_source.as_ref(),
                                        )
                                    });
                                    let _ = response.send(SeekPlaybackOutcome::Stale {
                                        expected_source,
                                        active_source,
                                        gapless_cancellation,
                                    });
                                    continue;
                                }

                                let generation = expected_source.generation;
                                let (_, stream_handle) = match output_state.current() {
                                    Ok(output) => output,
                                    Err(error) => {
                                        emit_playback_error(
                                            &app_for_audio,
                                            active_path.clone(),
                                            generation,
                                            "stream",
                                            error,
                                            true,
                                        );
                                        let _ = response.send(SeekPlaybackOutcome::Failed {
                                            message: error.to_string(),
                                            gapless_cancellation,
                                        });
                                        continue;
                                    }
                                };
                                if active_path.is_empty() || active_open_path.is_empty() {
                                    let _ = response.send(SeekPlaybackOutcome::Failed {
                                        message: "Active audio source is unavailable".to_string(),
                                        gapless_cancellation,
                                    });
                                    continue;
                                }
                                if let Some(active) = crossfade_state.take() {
                                    active.outgoing_sink.stop();
                                }
                                let target_position = position_secs.max(0.0);
                                let normalized_position = if duration > 0.0 {
                                    target_position.min(duration)
                                } else {
                                    target_position
                                };

                                if !had_sink {
                                    {
                                        let mut state = state_clone.lock();
                                        state.start_position = normalized_position;
                                        state.warned_near_end = false;
                                    }
                                    reset_active_counter(&active_emitted_for_audio);
                                    let _ = app_for_audio.emit(
                                        "playback-seeked",
                                        PlaybackPositionEvent {
                                            generation,
                                            position: normalized_position,
                                        },
                                    );
                                    let _ = response.send(SeekPlaybackOutcome::Applied {
                                        position: normalized_position,
                                        gapless_cancellation,
                                    });
                                    continue;
                                }

                                if let Some(sink) = current_sink.take() {
                                    sink.stop();
                                }

                                let emitted_for_seek = Arc::new(AtomicU64::new(0));
                                match prepare_source(
                                    PrepareSource {
                                        open_path: &active_open_path,
                                        file_path: &active_path,
                                        expected_identity: active_identity,
                                        generation,
                                        requested_start: normalized_position,
                                    },
                                    &emitted_for_seek,
                                    &booster_for_audio,
                                    &source_error_sender,
                                ) {
                                    Ok((source, updated_duration, actual_start)) => {
                                        if let Some(sink) = play_with_source(
                                            stream_handle,
                                            source,
                                            &state_clone,
                                            PlaybackStart {
                                                file_path: &active_path,
                                                open_file_path: &active_open_path,
                                                expected_identity: active_identity,
                                                duration: updated_duration,
                                                start_secs: actual_start,
                                                generation,
                                                initial_volume: None,
                                            },
                                        ) {
                                            if was_paused {
                                                sink.pause();
                                                let mut state = state_clone.lock();
                                                state.is_playing = true;
                                                state.is_paused = true;
                                            }
                                            current_sink = Some(sink);
                                            set_active_counter(
                                                &active_emitted_for_audio,
                                                Arc::clone(&emitted_for_seek),
                                            );
                                            let _ = app_for_audio.emit(
                                                "playback-seeked",
                                                PlaybackPositionEvent {
                                                    generation,
                                                    position: actual_start,
                                                },
                                            );
                                            let _ = response.send(SeekPlaybackOutcome::Applied {
                                                position: actual_start,
                                                gapless_cancellation,
                                            });
                                        } else {
                                            let message =
                                                "Failed to resume audio stream after seek";
                                            emit_playback_error(
                                                &app_for_audio,
                                                active_path.clone(),
                                                generation,
                                                "stream",
                                                message,
                                                true,
                                            );
                                            let _ = response.send(SeekPlaybackOutcome::Failed {
                                                message: message.to_string(),
                                                gapless_cancellation,
                                            });
                                        }
                                    }
                                    Err(err) => {
                                        let message = format!("Failed to seek playback: {err}");
                                        emit_playback_error(
                                            &app_for_audio,
                                            active_path.clone(),
                                            generation,
                                            "seek",
                                            message.clone(),
                                            true,
                                        );
                                        let _ = response.send(SeekPlaybackOutcome::Failed {
                                            message,
                                            gapless_cancellation,
                                        });
                                    }
                                }
                            }
                            AudioCommand::Pause => {
                                if let Some(ref sink) = current_sink {
                                    let mut state = state_clone.lock();
                                    if !state.is_paused {
                                        sink.pause();
                                        if let Some(ref active) = crossfade_state {
                                            active.outgoing_sink.pause();
                                        }
                                        state.is_paused = true;
                                        emit_playback_transition(
                                            &app_for_audio,
                                            state.generation,
                                            PlaybackTransition::Paused,
                                            state.current_file.clone(),
                                            None,
                                            true,
                                        );
                                    }
                                }
                            }
                            AudioCommand::Resume => {
                                if let Some(ref sink) = current_sink {
                                    let mut state = state_clone.lock();
                                    if state.is_paused {
                                        sink.play();
                                        if let Some(ref active) = crossfade_state {
                                            active.outgoing_sink.play();
                                        }
                                        state.is_paused = false;
                                        emit_playback_transition(
                                            &app_for_audio,
                                            state.generation,
                                            PlaybackTransition::Playing,
                                            state.current_file.clone(),
                                            None,
                                            true,
                                        );
                                    }
                                }
                            }
                            AudioCommand::Stop { generation } => {
                                let _ = gapless_protocol.cancel_any(
                                    &state_clone,
                                    &active_emitted_for_audio,
                                    &app_for_audio,
                                );
                                if let Some(sink) = current_sink.take() {
                                    sink.stop();
                                }
                                if let Some(active) = crossfade_state.take() {
                                    active.outgoing_sink.stop();
                                }
                                volume_ramp = None;
                                let mut state = state_clone.lock();
                                state.generation = generation;
                                state.is_playing = false;
                                state.start_position = 0.0;
                                state.duration = 0.0;
                                state.position_sample_rate = 0;
                                state.position_channels = 0;
                                state.current_file = None;
                                state.current_open_file = None;
                                state.current_file_identity = None;
                                state.is_paused = false;
                                state.warned_near_end = false;
                                reset_active_counter(&active_emitted_for_audio);
                            }
                            AudioCommand::SetVolume(volume) => {
                                volume_ramp = None;
                                let mut state = state_clone.lock();
                                state.volume = volume;
                                if crossfade_state.is_some() {
                                    if let Some(ref active) = crossfade_state {
                                        apply_crossfade_mix(active, current_sink.as_ref(), volume);
                                    }
                                } else if let Some(ref sink) = current_sink {
                                    sink.set_volume(volume);
                                }
                            }
                            AudioCommand::SetVolumeRamp {
                                from,
                                to,
                                duration_ms,
                            } => {
                                let clamped_from = from.clamp(0.0, 1.0);
                                let clamped_to = to.clamp(0.0, 1.0);
                                if duration_ms == 0 {
                                    volume_ramp = None;
                                    let mut state = state_clone.lock();
                                    state.volume = clamped_to;
                                    if crossfade_state.is_some() {
                                        if let Some(ref active) = crossfade_state {
                                            apply_crossfade_mix(
                                                active,
                                                current_sink.as_ref(),
                                                clamped_to,
                                            );
                                        }
                                    } else if let Some(ref sink) = current_sink {
                                        sink.set_volume(clamped_to);
                                    }
                                } else {
                                    {
                                        let mut state = state_clone.lock();
                                        state.volume = clamped_from;
                                    }
                                    if crossfade_state.is_some() {
                                        if let Some(ref active) = crossfade_state {
                                            apply_crossfade_mix(
                                                active,
                                                current_sink.as_ref(),
                                                clamped_from,
                                            );
                                        }
                                    } else if let Some(ref sink) = current_sink {
                                        sink.set_volume(clamped_from);
                                    }
                                    volume_ramp = Some(VolumeRampState {
                                        from: clamped_from,
                                        to: clamped_to,
                                        start: Instant::now(),
                                        duration: Duration::from_millis(duration_ms),
                                    });
                                }
                            }
                            AudioCommand::SetSpeed(speed) => {
                                let mut state = state_clone.lock();
                                state.speed = speed;
                                if let Some(ref sink) = current_sink {
                                    sink.set_speed(speed);
                                }
                                if let Some(ref active) = crossfade_state {
                                    active.outgoing_sink.set_speed(speed);
                                }
                            }
                            AudioCommand::SetCrossfade(seconds) => {
                                let mut state = state_clone.lock();
                                state.crossfade_secs = seconds.clamp(0.0, 12.0);
                            }
                            AudioCommand::SetBooster(level) => {
                                let level = level.clamp(1.0, 2.0);
                                booster_for_audio.store(level.to_bits(), Ordering::Release);
                                let mut state = state_clone.lock();
                                state.booster = level;
                            }
                            AudioCommand::PreloadNext {
                                file_path,
                                open_path,
                                preload,
                                response,
                            } => {
                                if file_path.is_empty() || preload.path != file_path {
                                    let _ = response.send(Err(
                                        "Gapless preload identity does not match its source"
                                            .to_string(),
                                    ));
                                    continue;
                                }
                                let Some(sink) = current_sink.as_ref() else {
                                    let _ = response
                                        .send(Err("Cannot preload without an active audio sink"
                                            .to_string()));
                                    continue;
                                };
                                if sink.is_paused() || !state_clone.lock().is_playing {
                                    let _ =
                                        response
                                            .send(Err("Cannot preload while playback is paused"
                                                .to_string()));
                                    continue;
                                }
                                let (outgoing_path, outgoing_generation) = {
                                    let state = state_clone.lock();
                                    (
                                        state.current_file.clone().unwrap_or_default(),
                                        state.generation,
                                    )
                                };
                                if outgoing_path.is_empty() {
                                    let _ =
                                        response
                                            .send(Err("Cannot preload without an active source"
                                                .to_string()));
                                    continue;
                                }

                                let emitted_for_next = Arc::new(AtomicU64::new(0));
                                let (mut source, duration, actual_start) = match prepare_source(
                                    PrepareSource {
                                        open_path: &open_path,
                                        file_path: &file_path,
                                        expected_identity: None,
                                        generation: preload.generation,
                                        requested_start: 0.0,
                                    },
                                    &emitted_for_next,
                                    &booster_for_audio,
                                    &source_error_sender,
                                ) {
                                    Ok(prepared) => prepared,
                                    Err(error) => {
                                        emit_playback_error(
                                            &app_for_audio,
                                            file_path.clone(),
                                            preload.generation,
                                            "decode",
                                            error.clone(),
                                            true,
                                        );
                                        emit_playback_transition(
                                            &app_for_audio,
                                            preload.generation,
                                            PlaybackTransition::DecodeFailed,
                                            Some(file_path),
                                            Some(error.clone()),
                                            true,
                                        );
                                        let _ = response.send(Err(error));
                                        continue;
                                    }
                                };

                                gapless_protocol.complete(
                                    &state_clone,
                                    &active_emitted_for_audio,
                                    &app_for_audio,
                                );

                                let channels = source.channels();
                                let sample_rate = source.sample_rate();
                                let cancelled = source.cancellation_token();
                                let boundary = Arc::new(GaplessBoundary::new());
                                source.arm_gapless_boundary(Arc::clone(&boundary));

                                let _ = gapless_protocol.cancel_any(
                                    &state_clone,
                                    &active_emitted_for_audio,
                                    &app_for_audio,
                                );
                                {
                                    let state = state_clone.lock();
                                    if state.generation != outgoing_generation
                                        || state.current_file.as_deref()
                                            != Some(outgoing_path.as_str())
                                    {
                                        let _ = response.send(Err(
                                            "Active source changed while gapless preload was prepared"
                                                .to_string(),
                                        ));
                                        continue;
                                    }
                                }

                                gapless_protocol.pending = Some(PendingGaplessSource {
                                    preload: preload.clone(),
                                    open_path,
                                    outgoing_path,
                                    outgoing_generation,
                                    duration,
                                    actual_start,
                                    sample_rate,
                                    channels,
                                    emitted_samples: Arc::clone(&emitted_for_next),
                                    cancelled,
                                    boundary,
                                });
                                sink.append(source);
                                let _ = response.send(Ok(preload));
                            }
                            AudioCommand::CancelGaplessPreload { preload, response } => {
                                let outcome = gapless_protocol.cancel_expected(
                                    &preload,
                                    &state_clone,
                                    &active_emitted_for_audio,
                                    &app_for_audio,
                                );
                                let _ = response.send(outcome);
                            }
                            AudioCommand::SourceRenamed {
                                old_path,
                                new_path,
                                new_open_path,
                            } => {
                                if let Some(pending) = gapless_protocol.pending.as_mut() {
                                    if pending.outgoing_path == old_path {
                                        pending.outgoing_path = new_path.clone();
                                    }
                                }
                                let mut state = state_clone.lock();
                                if state.current_file.as_deref() == Some(old_path.as_str()) {
                                    state.current_file = Some(new_path.clone());
                                    state.current_open_file = Some(new_open_path);
                                    emit_playback_transition(
                                        &app_for_audio,
                                        state.generation,
                                        PlaybackTransition::SourceRenamed,
                                        Some(new_path),
                                        None,
                                        true,
                                    );
                                }
                            }
                            AudioCommand::SetOutputDevice {
                                device_id,
                                response,
                            } => {
                                let preferred = device_id.as_deref();
                                match open_output_stream(preferred) {
                                    Ok(opened) => {
                                        let new_stream_bundle = opened.output;
                                        let selection = opened.selection;
                                        gapless_protocol.complete(
                                            &state_clone,
                                            &active_emitted_for_audio,
                                            &app_for_audio,
                                        );
                                        let (was_paused, had_playback) = {
                                            let state = state_clone.lock();
                                            (state.is_paused, state.is_playing)
                                        };
                                        let suspended_at = if had_playback && current_sink.is_some()
                                        {
                                            let suspended_at = Instant::now();
                                            if let Some(sink) = current_sink.as_ref() {
                                                sink.pause();
                                            }
                                            if let Some(active) = crossfade_state.as_ref() {
                                                active.outgoing_sink.pause();
                                            }
                                            (!was_paused).then_some(suspended_at)
                                        } else {
                                            None
                                        };
                                        let (
                                            active_path,
                                            active_open_path,
                                            active_identity,
                                            position,
                                            current_generation,
                                        ) = {
                                            let state = state_clone.lock();
                                            let emitted = {
                                                let counter =
                                                    active_emitted_for_audio.lock().clone();
                                                counter.load(Ordering::Relaxed)
                                            };
                                            (
                                                state.current_file.clone(),
                                                state.current_open_file.clone(),
                                                state.current_file_identity,
                                                position_from_samples(&state, emitted),
                                                state.generation,
                                            )
                                        };

                                        let mut replacement = if had_playback {
                                            active_path
                                            .as_ref()
                                            .zip(active_open_path.as_ref())
                                            .and_then(|(path, open_path)| {
                                                let emitted_for_replacement =
                                                    Arc::new(AtomicU64::new(0));
                                                let (source, duration, actual_start) =
                                                    match prepare_source(
                                                        PrepareSource {
                                                            open_path,
                                                            file_path: path,
                                                            expected_identity: active_identity,
                                                            generation: current_generation,
                                                            requested_start: position,
                                                        },
                                                        &emitted_for_replacement,
                                                        &booster_for_audio,
                                                        &source_error_sender,
                                                    ) {
                                                        Ok(prepared) => prepared,
                                                        Err(error) => {
                                                            emit_playback_error(
                                                                &app_for_audio,
                                                                path,
                                                                current_generation,
                                                                "deviceSwitch",
                                                                error.clone(),
                                                                true,
                                                            );
                                                            emit_playback_transition(
                                                                &app_for_audio,
                                                                current_generation,
                                                                PlaybackTransition::DeviceSwitchFailed,
                                                                Some(path.clone()),
                                                                Some(error),
                                                                true,
                                                            );
                                                            return None;
                                                        }
                                                    };
                                                let Some(sink) = play_with_source(
                                                    &new_stream_bundle.1,
                                                    source,
                                                    &state_clone,
                                                    PlaybackStart {
                                                         file_path: path,
                                                         open_file_path: open_path,
                                                         expected_identity: active_identity,
                                                         duration,
                                                        start_secs: actual_start,
                                                        generation: current_generation,
                                                        initial_volume: None,
                                                    },
                                                ) else {
                                                    let error = "Failed to initialize replacement audio output stream";
                                                    emit_playback_error(
                                                        &app_for_audio,
                                                        path,
                                                        current_generation,
                                                        "deviceSwitch",
                                                        error,
                                                        true,
                                                    );
                                                    emit_playback_transition(
                                                        &app_for_audio,
                                                        current_generation,
                                                        PlaybackTransition::DeviceSwitchFailed,
                                                        Some(path.clone()),
                                                        Some(error.to_string()),
                                                        true,
                                                    );
                                                    return None;
                                                };
                                                if was_paused {
                                                    sink.pause();
                                                    let mut state = state_clone.lock();
                                                    state.is_paused = true;
                                                    state.is_playing = true;
                                                }
                                                Some((sink, emitted_for_replacement))
                                            })
                                        } else {
                                            None
                                        };

                                        if had_playback && replacement.is_none() {
                                            if let Some(suspended_at) = suspended_at {
                                                let suspended_for = suspended_at.elapsed();
                                                if let Some(ramp) = volume_ramp.as_mut() {
                                                    ramp.start += suspended_for;
                                                }
                                                if let Some(active) = crossfade_state.as_mut() {
                                                    active.start += suspended_for;
                                                    active.outgoing_sink.play();
                                                }
                                                if let Some(sink) = current_sink.as_ref() {
                                                    sink.play();
                                                }
                                            }
                                            let _ = response.send(Err(
                                                "Failed to move active playback to the selected audio output"
                                                    .to_string(),
                                            ));
                                            continue;
                                        }

                                        let gapless_cancellation = gapless_protocol.cancel_any(
                                            &state_clone,
                                            &active_emitted_for_audio,
                                            &app_for_audio,
                                        );
                                        if matches!(
                                            gapless_cancellation,
                                            Some(GaplessCancellationOutcome::HandedOff { .. })
                                        ) {
                                            if let Some((replacement_sink, _)) = replacement.take()
                                            {
                                                replacement_sink.stop();
                                            }
                                            if let Some(suspended_at) = suspended_at {
                                                let suspended_for = suspended_at.elapsed();
                                                if let Some(ramp) = volume_ramp.as_mut() {
                                                    ramp.start += suspended_for;
                                                }
                                                if let Some(active) = crossfade_state.as_mut() {
                                                    active.start += suspended_for;
                                                    active.outgoing_sink.play();
                                                }
                                                if let Some(sink) = current_sink.as_ref() {
                                                    sink.play();
                                                }
                                            }
                                            let _ = response.send(Err(
                                                "Gapless handoff completed while switching audio output; retry the device switch"
                                                    .to_string(),
                                            ));
                                            continue;
                                        }
                                        if let Some(active) = crossfade_state.take() {
                                            active.outgoing_sink.stop();
                                        }
                                        if let Some(old_sink) = current_sink.take() {
                                            old_sink.stop();
                                        }
                                        if let Some((new_sink, counter)) = replacement {
                                            current_sink = Some(new_sink);
                                            set_active_counter(
                                                &active_emitted_for_audio,
                                                Arc::clone(&counter),
                                            );
                                        } else {
                                            reset_active_counter(&active_emitted_for_audio);
                                        }
                                        volume_ramp = None;
                                        output_state.install(new_stream_bundle);
                                        let _ = response.send(Ok(AudioOutputSwitchOutcome {
                                            selection,
                                            gapless_cancellation,
                                        }));
                                    }
                                    Err(e) => {
                                        emit_playback_error(
                                            &app_for_audio,
                                            "",
                                            state_clone.lock().generation,
                                            "deviceSwitch",
                                            e.clone(),
                                            true,
                                        );
                                        emit_playback_transition(
                                            &app_for_audio,
                                            state_clone.lock().generation,
                                            PlaybackTransition::DeviceSwitchFailed,
                                            state_clone.lock().current_file.clone(),
                                            Some(e.clone()),
                                            true,
                                        );
                                        let _ = response.send(Err(e));
                                    }
                                }
                            }
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        gapless_protocol.complete(
                            &state_clone,
                            &active_emitted_for_audio,
                            &app_for_audio,
                        );
                        while let Ok(error) = source_error_receiver.try_recv() {
                            emit_source_worker_error(&app_for_audio, error);
                        }

                        if crossfade_state
                            .as_ref()
                            .map(|active| active.outgoing_sink.empty())
                            .unwrap_or(false)
                        {
                            if let Some(active) = crossfade_state.take() {
                                active.outgoing_sink.stop();
                                if let Some(incoming) = current_sink.as_ref() {
                                    incoming.set_volume(state_clone.lock().volume.clamp(0.0, 1.0));
                                }
                                emit_playback_transition(
                                    &app_for_audio,
                                    active.generation,
                                    PlaybackTransition::CrossfadeCompleted,
                                    Some(active.incoming_path),
                                    None,
                                    true,
                                );
                            }
                        }

                        // Check if track ended.
                        if current_sink
                            .as_ref()
                            .map(|sink| sink.empty())
                            .unwrap_or(false)
                        {
                            gapless_protocol.complete(
                                &state_clone,
                                &active_emitted_for_audio,
                                &app_for_audio,
                            );
                            let _ = gapless_protocol.cancel_any(
                                &state_clone,
                                &active_emitted_for_audio,
                                &app_for_audio,
                            );
                            if let Some(active) = crossfade_state.take() {
                                active.outgoing_sink.stop();
                            }
                            current_sink = None;
                            let mut ended_path = None;
                            let mut ended_generation = 0;
                            let mut should_emit_ended = false;
                            {
                                let mut state = state_clone.lock();
                                if state.is_playing {
                                    ended_path = state.current_file.clone();
                                    ended_generation = state.generation;
                                    state.start_position = state.duration;
                                    state.is_playing = false;
                                    state.is_paused = false;
                                    state.warned_near_end = false;
                                    should_emit_ended = true;
                                }
                            }
                            reset_active_counter(&active_emitted_for_audio);
                            if should_emit_ended {
                                let payload = PlaybackEndedPayload {
                                    path: ended_path,
                                    generation: ended_generation,
                                    seamless: false,
                                    handoff: None,
                                };
                                let _ = app_for_audio.emit("playback-ended", payload);
                                emit_playback_transition(
                                    &app_for_audio,
                                    ended_generation,
                                    PlaybackTransition::Ended,
                                    state_clone.lock().current_file.clone(),
                                    None,
                                    true,
                                );
                            }
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        let _ = gapless_protocol.cancel_any(
                            &state_clone,
                            &active_emitted_for_audio,
                            &app_for_audio,
                        );
                        audio_is_running.store(false, Ordering::Relaxed);
                        break;
                    }
                }

                if crossfade_state.is_some() {
                    let completed_crossfade = crossfade_state.as_ref().and_then(|active| {
                        (crossfade_progress(active) >= 1.0)
                            .then(|| (active.generation, active.incoming_path.clone()))
                    });
                    apply_volume_ramp_step(&mut volume_ramp, &state_clone, None);
                    apply_crossfade_step(&mut crossfade_state, &state_clone, current_sink.as_ref());
                    if let Some((generation, path)) = completed_crossfade {
                        emit_playback_transition(
                            &app_for_audio,
                            generation,
                            PlaybackTransition::CrossfadeCompleted,
                            Some(path),
                            None,
                            true,
                        );
                    }
                } else {
                    apply_volume_ramp_step(&mut volume_ramp, &state_clone, current_sink.as_ref());
                }
            }
        });

        Self {
            command_sender: sender,
            playback_state,
            active_emitted_samples,
            next_generation: AtomicU64::new(0),
            next_preload_id: AtomicU64::new(0),
            generation_command_lock: Mutex::new(()),
        }
    }

    fn allocate_generation(&self) -> u64 {
        next_playback_generation(&self.next_generation)
    }

    fn allocate_preload_id(&self) -> String {
        next_gapless_preload_id(&self.next_preload_id)
    }

    pub fn play(
        &self,
        file_path: String,
        open_path: String,
        start_pos: Option<f64>,
        expected_identity: Option<FileIdentity>,
    ) -> Result<u64, String> {
        let _order = self.generation_command_lock.lock();
        let generation = self.allocate_generation();
        self.command_sender
            .send(AudioCommand::Play {
                file_path,
                open_path,
                start_pos,
                generation,
                expected_identity,
            })
            .map_err(|e| format!("Failed to send play command: {}", e))?;
        Ok(generation)
    }

    pub fn pause(&self) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::Pause)
            .map_err(|e| format!("Failed to send pause command: {}", e))
    }

    pub fn resume(&self) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::Resume)
            .map_err(|e| format!("Failed to send resume command: {}", e))
    }

    pub fn stop(&self) -> Result<u64, String> {
        let _order = self.generation_command_lock.lock();
        let generation = self.allocate_generation();
        self.command_sender
            .send(AudioCommand::Stop { generation })
            .map_err(|e| format!("Failed to send stop command: {}", e))?;
        Ok(generation)
    }

    pub fn seek(
        &self,
        position_secs: f64,
        expected_source: PlaybackSourceIdentity,
    ) -> Result<SeekPlaybackOutcome, String> {
        let (response, response_receiver) = sync_channel(1);
        self.command_sender
            .send(AudioCommand::Seek {
                position_secs,
                expected_source,
                response,
            })
            .map_err(|e| format!("Failed to send seek command: {e}"))?;
        response_receiver
            .recv()
            .map_err(|e| format!("Audio thread dropped the seek response: {e}"))
    }

    pub fn crossfade_to(
        &self,
        file_path: String,
        open_path: String,
        start_pos: Option<f64>,
        duration_secs: f32,
    ) -> Result<u64, String> {
        let _order = self.generation_command_lock.lock();
        let duration_ms = (duration_secs.clamp(0.0, 12.0) * 1000.0).round() as u64;
        let generation = self.allocate_generation();
        self.command_sender
            .send(AudioCommand::CrossfadeTo {
                file_path,
                open_path,
                start_pos,
                duration_ms,
                generation,
            })
            .map_err(|e| format!("Failed to send crossfade command: {}", e))?;
        Ok(generation)
    }

    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::SetVolume(volume.clamp(0.0, 1.0)))
            .map_err(|e| format!("Failed to send volume command: {}", e))
    }

    pub fn set_volume_ramp(&self, from: f32, to: f32, duration_ms: u64) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::SetVolumeRamp {
                from: from.clamp(0.0, 1.0),
                to: to.clamp(0.0, 1.0),
                duration_ms: duration_ms.min(60_000),
            })
            .map_err(|e| format!("Failed to send volume ramp command: {}", e))
    }

    pub fn set_speed(&self, speed: f32) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::SetSpeed(speed.clamp(0.5, 2.0)))
            .map_err(|e| format!("Failed to send speed command: {}", e))
    }

    pub fn set_crossfade(&self, seconds: f32) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::SetCrossfade(seconds.clamp(0.0, 12.0)))
            .map_err(|e| format!("Failed to set crossfade: {}", e))
    }

    pub fn set_booster(&self, level: f32) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::SetBooster(level.clamp(1.0, 2.0)))
            .map_err(|e| format!("Failed to set booster: {}", e))
    }

    pub fn set_output_device(
        &self,
        device_id: Option<String>,
    ) -> Result<AudioOutputSwitchOutcome, String> {
        let (response, response_receiver) = sync_channel(1);
        self.command_sender
            .send(AudioCommand::SetOutputDevice {
                device_id,
                response,
            })
            .map_err(|e| format!("Failed to set output device: {e}"))?;
        response_receiver
            .recv()
            .map_err(|e| format!("Audio thread dropped the output-device response: {e}"))?
    }

    pub fn preload_next(
        &self,
        source_path: (String, String),
    ) -> Result<GaplessPreloadIdentity, String> {
        let _order = self.generation_command_lock.lock();
        let (file_path, open_path) = source_path;
        let preload = GaplessPreloadIdentity {
            preload_id: self.allocate_preload_id(),
            generation: self.allocate_generation(),
            path: file_path.clone(),
        };
        let (response, response_receiver) = sync_channel(1);
        self.command_sender
            .send(AudioCommand::PreloadNext {
                file_path,
                open_path,
                preload,
                response,
            })
            .map_err(|e| format!("Failed to preload next track: {}", e))?;
        response_receiver
            .recv()
            .map_err(|e| format!("Audio thread dropped the gapless preload response: {e}"))?
    }

    pub fn cancel_gapless_preload(
        &self,
        preload: GaplessPreloadIdentity,
    ) -> Result<GaplessCancellationOutcome, String> {
        let _order = self.generation_command_lock.lock();
        let (response, response_receiver) = sync_channel(1);
        self.command_sender
            .send(AudioCommand::CancelGaplessPreload { preload, response })
            .map_err(|e| format!("Failed to cancel gapless preload: {e}"))?;
        response_receiver
            .recv()
            .map_err(|e| format!("Audio thread dropped the gapless cancellation response: {e}"))
    }

    pub fn source_renamed(
        &self,
        old_path: String,
        new_path: String,
        new_open_path: String,
    ) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::SourceRenamed {
                old_path,
                new_path,
                new_open_path,
            })
            .map_err(|e| format!("Failed to update active playback source: {}", e))
    }

    pub fn get_position(&self) -> f64 {
        let state = self.playback_state.lock();
        if state.is_playing {
            let emitted = {
                let counter = self.active_emitted_samples.lock().clone();
                counter.load(Ordering::Relaxed)
            };
            position_from_samples(&state, emitted)
        } else {
            state.start_position
        }
    }

    pub fn get_duration(&self) -> f64 {
        self.playback_state.lock().duration
    }
}

fn next_playback_generation(counter: &AtomicU64) -> u64 {
    counter.fetch_add(1, Ordering::Relaxed) + 1
}

fn next_gapless_preload_id(counter: &AtomicU64) -> String {
    format!(
        "gapless-{:016x}",
        counter.fetch_add(1, Ordering::Relaxed) + 1
    )
}

pub type SharedAudioManager = Arc<AudioManager>;

pub fn create_audio_manager(app: AppHandle) -> SharedAudioManager {
    Arc::new(AudioManager::new(app))
}

fn ensure_audio_file_allowed(
    file_path: &str,
    roots: &[std::path::PathBuf],
    action: &str,
) -> Result<std::path::PathBuf, String> {
    ensure_existing_path_allowed(Path::new(file_path), roots, action)
}

#[tauri::command]
pub fn play_track(
    file_path: String,
    start_pos: Option<f64>,
    authority_id: Option<String>,
    state: tauri::State<'_, SharedAudioManager>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<u64, String> {
    let access = consume_play_once_file_access(
        roots_state.inner(),
        Path::new(&file_path),
        authority_id.as_deref(),
        "play audio file",
    )?;
    state.play(
        file_path,
        access.canonical_path.to_string_lossy().into_owned(),
        start_pos,
        access.expected_identity,
    )
}

#[tauri::command]
pub fn crossfade_to_track(
    file_path: String,
    start_pos: Option<f64>,
    duration_secs: f32,
    state: tauri::State<'_, SharedAudioManager>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<u64, String> {
    let roots = roots_state.inner().read().roots.clone();
    let canonical = ensure_audio_file_allowed(&file_path, &roots, "crossfade audio file")?;
    state.crossfade_to(
        file_path,
        canonical.to_string_lossy().into_owned(),
        start_pos,
        duration_secs,
    )
}

#[tauri::command]
pub fn pause_playback(state: tauri::State<'_, SharedAudioManager>) -> Result<(), String> {
    state.pause()
}

#[tauri::command]
pub fn resume_playback(state: tauri::State<'_, SharedAudioManager>) -> Result<(), String> {
    state.resume()
}

#[tauri::command]
pub fn stop_playback(state: tauri::State<'_, SharedAudioManager>) -> Result<u64, String> {
    state.stop()
}

#[tauri::command]
pub fn seek_playback(
    position_secs: f64,
    expected_source: PlaybackSourceIdentity,
    state: tauri::State<'_, SharedAudioManager>,
) -> Result<SeekPlaybackOutcome, String> {
    state.seek(position_secs, expected_source)
}

#[tauri::command]
pub fn get_playback_position(state: tauri::State<'_, SharedAudioManager>) -> f64 {
    state.get_position()
}

#[tauri::command]
pub fn get_duration(state: tauri::State<'_, SharedAudioManager>) -> f64 {
    state.get_duration()
}

#[tauri::command]
pub fn set_volume(volume: f32, state: tauri::State<'_, SharedAudioManager>) -> Result<(), String> {
    state.set_volume(volume)
}

#[tauri::command]
pub fn set_volume_ramp(
    from: f32,
    to: f32,
    duration_ms: u64,
    state: tauri::State<'_, SharedAudioManager>,
) -> Result<(), String> {
    state.set_volume_ramp(from, to, duration_ms)
}

#[tauri::command]
pub fn set_playback_speed(
    speed: f32,
    state: tauri::State<'_, SharedAudioManager>,
) -> Result<(), String> {
    state.set_speed(speed)
}

#[tauri::command]
pub fn set_crossfade_duration(
    seconds: f32,
    state: tauri::State<'_, SharedAudioManager>,
) -> Result<(), String> {
    state.set_crossfade(seconds)
}

#[tauri::command]
pub fn set_audio_booster(
    level: f32,
    state: tauri::State<'_, SharedAudioManager>,
) -> Result<(), String> {
    state.set_booster(level)
}

#[tauri::command]
pub fn list_audio_output_devices() -> Result<Vec<AudioOutputDeviceInfo>, String> {
    enumerate_output_devices()
}

#[tauri::command]
pub fn set_audio_output_device(
    device_id: String,
    state: tauri::State<'_, SharedAudioManager>,
) -> Result<AudioOutputSwitchOutcome, String> {
    let normalized = if device_id.is_empty() || device_id == "system" {
        None
    } else {
        Some(device_id)
    };
    state.set_output_device(normalized)
}

#[tauri::command]
pub fn preload_next_track(
    file_path: String,
    state: tauri::State<'_, SharedAudioManager>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<GaplessPreloadIdentity, String> {
    let roots = roots_state.inner().read().roots.clone();
    let canonical = ensure_audio_file_allowed(&file_path, &roots, "preload audio file")?;
    state.preload_next((file_path, canonical.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn cancel_gapless_preload(
    preload: GaplessPreloadIdentity,
    state: tauri::State<'_, SharedAudioManager>,
) -> Result<GaplessCancellationOutcome, String> {
    state.cancel_gapless_preload(preload)
}

#[cfg(test)]
mod tests {
    use super::source::{validate_decoded_packet, MAX_DECODED_SAMPLES_PER_PACKET};
    use super::*;
    use crate::file_ops::{authorize_transient_file, create_library_roots_state};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tarab-audio-{}-{}", name, nonce));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn audio_file_validation_rejects_paths_outside_library_roots() {
        let allowed_root = temp_dir("allowed");
        let outside_root = temp_dir("outside");
        let outside_file = outside_root.join("outside.mp3");
        fs::write(&outside_file, b"not audio").expect("write outside file");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result =
            ensure_audio_file_allowed(&outside_file.to_string_lossy(), &roots, "play audio file");

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("outside configured library roots"));

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn malformed_decode_cannot_reuse_consumed_play_once_authority() {
        let root = temp_dir("malformed-play-once");
        let file = root.join("malformed.mp3");
        fs::write(&file, b"not an audio stream").expect("write malformed audio");
        let roots = create_library_roots_state();
        let authority_id = authorize_transient_file(&roots, &file).expect("authorize file");
        let access =
            consume_play_once_file_access(&roots, &file, Some(&authority_id), "play audio file")
                .expect("consume playback authority");
        let emitted = Arc::new(AtomicU64::new(0));
        let booster = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        let (errors, _error_receiver) = channel();

        let result = prepare_source(
            PrepareSource {
                open_path: &access.canonical_path.to_string_lossy(),
                file_path: &file.to_string_lossy(),
                expected_identity: access.expected_identity,
                generation: 1,
                requested_start: 0.0,
            },
            &emitted,
            &booster,
            &errors,
        );

        assert!(result.is_err());
        assert!(consume_play_once_file_access(
            &roots,
            &file,
            Some(&authority_id),
            "play audio file"
        )
        .is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn normalized_progress_is_clamped() {
        assert!(
            (normalized_progress(Duration::from_secs(0), Duration::from_secs(0)) - 1.0).abs()
                < 1e-6
        );
        assert!(
            (normalized_progress(Duration::from_millis(500), Duration::from_secs(2)) - 0.25).abs()
                < 1e-6
        );
        assert!(
            (normalized_progress(Duration::from_secs(3), Duration::from_secs(2)) - 1.0).abs()
                < 1e-6
        );
    }

    #[test]
    fn position_from_samples_accounts_for_rate_and_channels() {
        let state = PlaybackState {
            start_position: 5.0,
            position_sample_rate: 48_000,
            position_channels: 2,
            ..PlaybackState::default()
        };
        // 96_000 samples at 48k stereo = 1 second.
        let position = position_from_samples(&state, 96_000);
        assert!((position - 6.0).abs() < 1e-6);
    }

    #[test]
    fn active_counter_swap_preserves_new_source_progress_and_reset_works() {
        let slot = Arc::new(Mutex::new(Arc::new(AtomicU64::new(123))));
        reset_active_counter(&slot);
        assert_eq!(slot.lock().load(Ordering::Relaxed), 0);

        let replacement = Arc::new(AtomicU64::new(999));
        set_active_counter(&slot, Arc::clone(&replacement));
        assert_eq!(replacement.load(Ordering::Relaxed), 999);
        assert!(Arc::ptr_eq(&slot.lock(), &replacement));
    }

    #[test]
    fn playback_generations_are_monotonic() {
        let counter = AtomicU64::new(0);

        assert_eq!(next_playback_generation(&counter), 1);
        assert_eq!(next_playback_generation(&counter), 2);
        assert_eq!(next_playback_generation(&counter), 3);
    }

    #[test]
    fn gapless_preload_ids_are_monotonic_and_opaque() {
        let counter = AtomicU64::new(0);

        assert_eq!(
            next_gapless_preload_id(&counter),
            "gapless-0000000000000001"
        );
        assert_eq!(
            next_gapless_preload_id(&counter),
            "gapless-0000000000000002"
        );
    }

    #[test]
    fn gapless_handoff_before_seek_dispatch_rejects_the_outgoing_source() {
        let expected_source = PlaybackSourceIdentity {
            generation: 7,
            path: "C:/music/outgoing.flac".to_string(),
        };
        let incoming = GaplessPreloadIdentity {
            preload_id: "gapless-0000000000000008".to_string(),
            generation: 8,
            path: "C:/music/incoming.flac".to_string(),
        };
        let handoff = GaplessHandoff {
            outgoing_path: expected_source.path.clone(),
            outgoing_generation: expected_source.generation,
            preload: incoming.clone(),
        };
        let protocol = GaplessProtocol {
            pending: None,
            last_handoff: Some(handoff.clone()),
        };
        let state = PlaybackState {
            generation: incoming.generation,
            current_file: Some(incoming.path.clone()),
            ..PlaybackState::default()
        };

        assert!(!seek_source_matches(&state, &expected_source));
        assert_eq!(
            protocol.handoff_for_outgoing_source(
                &expected_source,
                active_source_identity(&state).as_ref()
            ),
            Some(GaplessCancellationOutcome::HandedOff { handoff })
        );
    }

    #[test]
    fn seek_source_validation_checks_both_generation_and_path() {
        let state = PlaybackState {
            generation: 11,
            current_file: Some("C:/music/active.flac".to_string()),
            ..PlaybackState::default()
        };

        assert!(seek_source_matches(
            &state,
            &PlaybackSourceIdentity {
                generation: 11,
                path: "C:/music/active.flac".to_string(),
            }
        ));
        assert!(!seek_source_matches(
            &state,
            &PlaybackSourceIdentity {
                generation: 10,
                path: "C:/music/active.flac".to_string(),
            }
        ));
        assert!(!seek_source_matches(
            &state,
            &PlaybackSourceIdentity {
                generation: 11,
                path: "C:/music/other.flac".to_string(),
            }
        ));
    }

    #[test]
    fn seek_and_output_switch_serialize_implicit_gapless_cancellation() {
        let preload = GaplessPreloadIdentity {
            preload_id: "gapless-0000000000000002".to_string(),
            generation: 2,
            path: "C:/music/next.flac".to_string(),
        };
        let cancellation = GaplessCancellationOutcome::Cancelled {
            preload: preload.clone(),
        };
        let seek = SeekPlaybackOutcome::Applied {
            position: 42.0,
            gapless_cancellation: Some(cancellation.clone()),
        };
        let output = AudioOutputSwitchOutcome {
            selection: AudioOutputSelection::Selected {
                device_id: "system".to_string(),
            },
            gapless_cancellation: Some(cancellation),
        };

        assert_eq!(
            serde_json::to_value(seek).expect("serialize seek outcome"),
            serde_json::json!({
                "status": "applied",
                "position": 42.0,
                "gaplessCancellation": {
                    "status": "cancelled",
                    "preload": {
                        "preloadId": preload.preload_id,
                        "generation": preload.generation,
                        "path": preload.path,
                    }
                }
            })
        );
        assert_eq!(
            serde_json::to_value(output).expect("serialize output switch outcome"),
            serde_json::json!({
                "selection": { "status": "selected", "deviceId": "system" },
                "gaplessCancellation": {
                    "status": "cancelled",
                    "preload": {
                        "preloadId": "gapless-0000000000000002",
                        "generation": 2,
                        "path": "C:/music/next.flac",
                    }
                }
            })
        );
    }

    #[test]
    fn decoded_packet_limits_reject_invalid_media_parameters() {
        assert_eq!(validate_decoded_packet(2, 1_024, 48_000), Some(2_048));
        assert_eq!(validate_decoded_packet(2, 1_024, 0), None);
        assert_eq!(validate_decoded_packet(0, 1_024, 48_000), None);
        assert_eq!(
            validate_decoded_packet(2, MAX_DECODED_SAMPLES_PER_PACKET, 48_000),
            None
        );
        assert_eq!(validate_decoded_packet(2, 1_024, 768_000), None);
    }
}
