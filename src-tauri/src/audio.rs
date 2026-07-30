use parking_lot::Mutex;
use rodio::{OutputStream, OutputStreamHandle, Sink, Source};
use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::Decoder as SymphoniaDecoder;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::get_probe;
use tauri::{AppHandle, Emitter};

use crate::file_ops::{
    consume_transient_file, ensure_existing_path_allowed, ensure_path_allowed_by_state,
    SharedLibraryRoots,
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
use device::open_output_stream;
pub use device::{enumerate_output_devices, AudioOutputDeviceInfo};
pub use events::PlaybackEndedPayload;
use events::{
    emit_playback_error, emit_playback_transition, PlaybackNearEndEvent, PlaybackPositionEvent,
    PlaybackTransition,
};
use source::{play_with_source, prepare_source, GaplessHandoffSource, PlaybackStart};
pub use state::PlaybackState;

enum AudioCommand {
    Play {
        file_path: String,
        start_pos: Option<f64>,
        generation: u64,
    },
    CrossfadeTo {
        file_path: String,
        start_pos: Option<f64>,
        duration_ms: u64,
        generation: u64,
    },
    Pause,
    Resume,
    Stop,
    Seek(f64),
    SetVolume(f32),
    SetVolumeRamp {
        from: f32,
        to: f32,
        duration_ms: u64,
    },
    SetSpeed(f32),
    SetCrossfade(f32),
    SetBooster(f32),
    SetOutputDevice(Option<String>),
    PreloadNext(Option<(String, u64)>),
    SourceRenamed {
        old_path: String,
        new_path: String,
    },
}

pub struct AudioManager {
    command_sender: Sender<AudioCommand>,
    pub playback_state: Arc<Mutex<PlaybackState>>,
    active_emitted_samples: Arc<Mutex<Arc<AtomicU64>>>,
    next_generation: AtomicU64,
}

struct VolumeRampState {
    from: f32,
    to: f32,
    start: Instant,
    duration: Duration,
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
    counter.store(0, Ordering::Relaxed);
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
        let pending_gapless_path = Arc::new(Mutex::new(None::<String>));
        let pending_gapless_path_thread = Arc::clone(&pending_gapless_path);
        let audio_is_running = Arc::clone(&is_running);
        thread::spawn(move || {
            let mut stream_bundle: Option<(OutputStream, OutputStreamHandle)> =
                match open_output_stream(None) {
                    Ok(pair) => Some(pair),
                    Err(e) => {
                        eprintln!("Failed to create audio stream: {}", e);
                        emit_playback_error(
                            &app_for_audio,
                            "",
                            0,
                            "stream",
                            format!("Failed to create audio stream: {}", e),
                            false,
                        );
                        None
                    }
                };

            if stream_bundle.is_none() {
                return;
            }

            let mut current_sink: Option<Sink> = None;
            let mut crossfade_state: Option<CrossfadeState> = None;
            let mut volume_ramp: Option<VolumeRampState> = None;

            loop {
                match receiver.recv_timeout(Duration::from_millis(20)) {
                    Ok(command) => match command {
                        AudioCommand::Play {
                            file_path,
                            start_pos,
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
                            *pending_gapless_path_thread.lock() = None;
                            let Some((_, stream_handle)) = stream_bundle.as_ref() else {
                                emit_playback_error(
                                    &app_for_audio,
                                    "",
                                    generation,
                                    "stream",
                                    "Audio output is not available",
                                    false,
                                );
                                continue;
                            };
                            if let Some(active) = crossfade_state.take() {
                                active.outgoing_sink.stop();
                            }
                            let requested_start = start_pos.unwrap_or(0.0).max(0.0);
                            let emitted_for_play = Arc::new(AtomicU64::new(0));
                            match prepare_source(
                                &file_path,
                                requested_start,
                                &state_clone,
                                &emitted_for_play,
                            ) {
                                Ok((source, duration, actual_start)) => {
                                    if let Some(new_sink) = play_with_source(
                                        stream_handle,
                                        source,
                                        &state_clone,
                                        PlaybackStart {
                                            file_path: &file_path,
                                            duration,
                                            start_secs: actual_start,
                                            generation,
                                            initial_volume: None,
                                        },
                                    ) {
                                        if let Some(sink) = current_sink.take() {
                                            sink.stop();
                                        }
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
                                    eprintln!("Failed to start playback: {}", err);
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
                            *pending_gapless_path_thread.lock() = None;
                            let Some((_, stream_handle)) = stream_bundle.as_ref() else {
                                emit_playback_error(
                                    &app_for_audio,
                                    "",
                                    generation,
                                    "stream",
                                    "Audio output is not available",
                                    false,
                                );
                                continue;
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
                                &file_path,
                                requested_start,
                                &state_clone,
                                &emitted_for_crossfade,
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
                                        } else if let Some(outgoing_sink) = current_sink.take() {
                                            current_sink = Some(new_sink);
                                            crossfade_state = Some(CrossfadeState {
                                                outgoing_sink,
                                                start: Instant::now(),
                                                duration: Duration::from_millis(duration_ms.max(1)),
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
                        AudioCommand::Seek(position_secs) => {
                            let generation = state_clone.lock().generation;
                            *pending_gapless_path_thread.lock() = None;
                            let Some((_, stream_handle)) = stream_bundle.as_ref() else {
                                emit_playback_error(
                                    &app_for_audio,
                                    "",
                                    generation,
                                    "stream",
                                    "Audio output is not available",
                                    false,
                                );
                                continue;
                            };
                            if let Some(active) = crossfade_state.take() {
                                active.outgoing_sink.stop();
                            }
                            let target_position = position_secs.max(0.0);
                            let (active_path, was_paused, had_sink, duration) = {
                                let state = state_clone.lock();
                                (
                                    state.current_file.clone().unwrap_or_default(),
                                    state.is_paused,
                                    current_sink.is_some(),
                                    state.duration,
                                )
                            };

                            if active_path.is_empty() {
                                continue;
                            }

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
                                let _ = app_for_audio.emit("playback-seeked", normalized_position);
                                continue;
                            }

                            if let Some(sink) = current_sink.take() {
                                sink.stop();
                            }

                            let emitted_for_seek = Arc::new(AtomicU64::new(0));
                            match prepare_source(
                                &active_path,
                                normalized_position,
                                &state_clone,
                                &emitted_for_seek,
                            ) {
                                Ok((source, updated_duration, actual_start)) => {
                                    if let Some(sink) = play_with_source(
                                        stream_handle,
                                        source,
                                        &state_clone,
                                        PlaybackStart {
                                            file_path: &active_path,
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
                                        let _ = app_for_audio.emit("playback-seeked", actual_start);
                                    } else {
                                        emit_playback_error(
                                            &app_for_audio,
                                            active_path.clone(),
                                            generation,
                                            "stream",
                                            "Failed to resume audio stream after seek",
                                            true,
                                        );
                                    }
                                }
                                Err(err) => {
                                    emit_playback_error(
                                        &app_for_audio,
                                        active_path.clone(),
                                        generation,
                                        "seek",
                                        format!("Failed to seek playback: {}", err),
                                        true,
                                    );
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
                        AudioCommand::Stop => {
                            *pending_gapless_path_thread.lock() = None;
                            if let Some(sink) = current_sink.take() {
                                sink.stop();
                            }
                            if let Some(active) = crossfade_state.take() {
                                active.outgoing_sink.stop();
                            }
                            volume_ramp = None;
                            let mut state = state_clone.lock();
                            state.is_playing = false;
                            state.start_position = 0.0;
                            state.duration = 0.0;
                            state.position_sample_rate = 0;
                            state.position_channels = 0;
                            state.current_file = None;
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
                            let mut state = state_clone.lock();
                            state.booster = level.clamp(1.0, 2.0);
                        }
                        AudioCommand::PreloadNext(maybe_source) => match maybe_source {
                            None => {
                                *pending_gapless_path_thread.lock() = None;
                            }
                            Some((path, _)) if path.is_empty() => {
                                *pending_gapless_path_thread.lock() = None;
                            }
                            Some((path, next_generation)) => {
                                let Some(sink) = current_sink.as_ref() else {
                                    continue;
                                };
                                if sink.is_paused() {
                                    continue;
                                }
                                if !state_clone.lock().is_playing {
                                    continue;
                                }
                                {
                                    let pending = pending_gapless_path_thread.lock();
                                    if pending.as_ref() == Some(&path) {
                                        continue;
                                    }
                                }
                                let out_path =
                                    state_clone.lock().current_file.clone().unwrap_or_default();
                                let outgoing_generation = state_clone.lock().generation;
                                if out_path.is_empty() {
                                    continue;
                                }

                                let emitted_for_next = Arc::new(AtomicU64::new(0));
                                let prep =
                                    prepare_source(&path, 0.0, &state_clone, &emitted_for_next);
                                let Ok((source2, duration2, actual_start2)) = prep else {
                                    eprintln!("Gapless preload failed to decode: {}", path);
                                    continue;
                                };

                                let ch2 = source2.channels();
                                let sr2 = source2.sample_rate();
                                let app_emit = app_for_audio.clone();
                                let state_emit = state_clone.clone();
                                let active_slot = active_emitted_for_audio.clone();
                                let pending_slot = pending_gapless_path_thread.clone();
                                let out_clone = out_path.clone();
                                let next_clone = path.clone();
                                let cnt_next = Arc::clone(&emitted_for_next);

                                let handoff = GaplessHandoffSource::new(source2, move || {
                                    set_active_counter(&active_slot, Arc::clone(&cnt_next));
                                    {
                                        let mut s = state_emit.lock();
                                        s.current_file = Some(next_clone.clone());
                                        s.generation = next_generation;
                                        s.duration = duration2;
                                        s.start_position = actual_start2;
                                        s.position_sample_rate = sr2;
                                        s.position_channels = ch2;
                                        s.warned_near_end = false;
                                    }
                                    let payload = PlaybackEndedPayload {
                                        path: Some(out_clone),
                                        generation: outgoing_generation,
                                        seamless: true,
                                        next_generation: Some(next_generation),
                                    };
                                    let _ = app_emit.emit("playback-ended", payload);
                                    emit_playback_transition(
                                        &app_emit,
                                        next_generation,
                                        PlaybackTransition::Playing,
                                        Some(next_clone.clone()),
                                        None,
                                        true,
                                    );
                                    *pending_slot.lock() = None;
                                });

                                sink.append(handoff);
                                *pending_gapless_path_thread.lock() = Some(path);
                            }
                        },
                        AudioCommand::SourceRenamed { old_path, new_path } => {
                            let mut state = state_clone.lock();
                            if state.current_file.as_deref() == Some(old_path.as_str()) {
                                state.current_file = Some(new_path.clone());
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
                        AudioCommand::SetOutputDevice(device_id) => {
                            let preferred = device_id.as_deref();
                            match open_output_stream(preferred) {
                                Ok(new_stream_bundle) => {
                                    let (active_path, position, was_paused, had_playback) = {
                                        let state = state_clone.lock();
                                        let emitted = {
                                            let counter = active_emitted_for_audio.lock().clone();
                                            counter.load(Ordering::Relaxed)
                                        };
                                        (
                                            state.current_file.clone(),
                                            position_from_samples(&state, emitted),
                                            state.is_paused,
                                            state.is_playing,
                                        )
                                    };

                                    let replacement = if had_playback {
                                        active_path.as_ref().and_then(|path| {
                                            let emitted_for_replacement =
                                                Arc::new(AtomicU64::new(0));
                                            let (source, duration, actual_start) =
                                                match prepare_source(
                                                    path,
                                                    position,
                                                    &state_clone,
                                                    &emitted_for_replacement,
                                                ) {
                                                    Ok(prepared) => prepared,
                                                    Err(error) => {
                                                        emit_playback_error(
                                                            &app_for_audio,
                                                            path,
                                                            state_clone.lock().generation,
                                                            "deviceSwitch",
                                                            error.clone(),
                                                            true,
                                                        );
                                                        emit_playback_transition(
                                                            &app_for_audio,
                                                            state_clone.lock().generation,
                                                            PlaybackTransition::DeviceSwitchFailed,
                                                            Some(path.clone()),
                                                            Some(error),
                                                            true,
                                                        );
                                                        return None;
                                                    }
                                                };
                                            let current_generation = state_clone.lock().generation;
                                            let sink = play_with_source(
                                                &new_stream_bundle.1,
                                                source,
                                                &state_clone,
                                                PlaybackStart {
                                                    file_path: path,
                                                    duration,
                                                    start_secs: actual_start,
                                                    generation: current_generation,
                                                    initial_volume: None,
                                                },
                                            )?;
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
                                        continue;
                                    }

                                    *pending_gapless_path_thread.lock() = None;
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
                                    stream_bundle = Some(new_stream_bundle);
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
                                        Some(e),
                                        true,
                                    );
                                }
                            }
                        }
                    },
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if crossfade_state
                            .as_ref()
                            .map(|active| active.outgoing_sink.empty())
                            .unwrap_or(false)
                        {
                            if let Some(active) = crossfade_state.take() {
                                active.outgoing_sink.stop();
                            }
                        }

                        // Check if track ended.
                        if current_sink
                            .as_ref()
                            .map(|sink| sink.empty())
                            .unwrap_or(false)
                        {
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
                                    next_generation: None,
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
        }
    }

    fn allocate_generation(&self) -> u64 {
        next_playback_generation(&self.next_generation)
    }

    pub fn play(&self, file_path: String, start_pos: Option<f64>) -> Result<u64, String> {
        let generation = self.allocate_generation();
        self.command_sender
            .send(AudioCommand::Play {
                file_path,
                start_pos,
                generation,
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

    pub fn stop(&self) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::Stop)
            .map_err(|e| format!("Failed to send stop command: {}", e))
    }

    pub fn seek(&self, position_secs: f64) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::Seek(position_secs))
            .map_err(|e| format!("Failed to send seek command: {}", e))
    }

    pub fn crossfade_to(
        &self,
        file_path: String,
        start_pos: Option<f64>,
        duration_secs: f32,
    ) -> Result<u64, String> {
        let duration_ms = (duration_secs.clamp(0.0, 12.0) * 1000.0).round() as u64;
        let generation = self.allocate_generation();
        self.command_sender
            .send(AudioCommand::CrossfadeTo {
                file_path,
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

    pub fn set_output_device(&self, device_id: Option<String>) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::SetOutputDevice(device_id))
            .map_err(|e| format!("Failed to set output device: {}", e))
    }

    pub fn preload_next(&self, file_path: Option<String>) -> Result<Option<u64>, String> {
        let source = file_path.map(|path| (path, self.allocate_generation()));
        let generation = source.as_ref().map(|(_, generation)| *generation);
        self.command_sender
            .send(AudioCommand::PreloadNext(source))
            .map_err(|e| format!("Failed to preload next track: {}", e))?;
        Ok(generation)
    }

    pub fn source_renamed(&self, old_path: String, new_path: String) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::SourceRenamed { old_path, new_path })
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

pub type SharedAudioManager = Arc<AudioManager>;

pub fn create_audio_manager(app: AppHandle) -> SharedAudioManager {
    Arc::new(AudioManager::new(app))
}

fn ensure_audio_file_allowed(
    file_path: &str,
    roots: &[std::path::PathBuf],
    action: &str,
) -> Result<(), String> {
    ensure_existing_path_allowed(Path::new(file_path), roots, action)?;
    Ok(())
}

#[tauri::command]
pub fn play_track(
    file_path: String,
    start_pos: Option<f64>,
    state: tauri::State<'_, SharedAudioManager>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<u64, String> {
    {
        let roots = roots_state.inner().read();
        ensure_path_allowed_by_state(Path::new(&file_path), &roots, "play audio file")?;
    }
    let generation = state.play(file_path.clone(), start_pos)?;
    consume_transient_file(roots_state.inner(), Path::new(&file_path));
    Ok(generation)
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
    ensure_audio_file_allowed(&file_path, &roots, "crossfade audio file")?;
    state.crossfade_to(file_path, start_pos, duration_secs)
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
pub fn stop_playback(state: tauri::State<'_, SharedAudioManager>) -> Result<(), String> {
    state.stop()
}

#[tauri::command]
pub fn seek_playback(
    position_secs: f64,
    state: tauri::State<'_, SharedAudioManager>,
) -> Result<(), String> {
    state.seek(position_secs)
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
) -> Result<(), String> {
    let normalized = if device_id.is_empty() || device_id == "system" {
        None
    } else {
        Some(device_id)
    };
    state.set_output_device(normalized)
}

#[tauri::command]
pub fn preload_next_track(
    file_path: Option<String>,
    state: tauri::State<'_, SharedAudioManager>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Option<u64>, String> {
    if let Some(path) = file_path.as_deref() {
        let roots = roots_state.inner().read().roots.clone();
        ensure_audio_file_allowed(path, &roots, "preload audio file")?;
    }
    state.preload_next(file_path)
}

#[cfg(test)]
mod tests {
    use super::source::{validate_decoded_packet, MAX_DECODED_SAMPLES_PER_PACKET};
    use super::*;
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
    fn active_counter_swap_and_reset_work() {
        let slot = Arc::new(Mutex::new(Arc::new(AtomicU64::new(123))));
        reset_active_counter(&slot);
        assert_eq!(slot.lock().load(Ordering::Relaxed), 0);

        let replacement = Arc::new(AtomicU64::new(999));
        set_active_counter(&slot, Arc::clone(&replacement));
        assert_eq!(replacement.load(Ordering::Relaxed), 0);
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
