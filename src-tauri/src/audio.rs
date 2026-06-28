use cpal::traits::{DeviceTrait, HostTrait};
use parking_lot::Mutex;
use rodio::{OutputStream, OutputStreamHandle, Sink, Source};
use serde::Serialize;
use std::fs::File;
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDeviceInfo {
    pub id: String,
    pub name: String,
}

pub fn enumerate_output_devices() -> Result<Vec<AudioOutputDeviceInfo>, String> {
    let host = cpal::default_host();
    let mut list = vec![AudioOutputDeviceInfo {
        id: "system".to_string(),
        name: "System default".to_string(),
    }];
    let devices = host
        .output_devices()
        .map_err(|e| format!("Failed to list output devices: {}", e))?;
    for device in devices {
        let name = match device.name() {
            Ok(n) => n,
            Err(e) => {
                eprintln!("Skipping audio device (name error): {}", e);
                continue;
            }
        };
        list.push(AudioOutputDeviceInfo {
            id: name.clone(),
            name,
        });
    }
    Ok(list)
}

fn open_output_stream(
    device_name: Option<&str>,
) -> Result<(OutputStream, OutputStreamHandle), String> {
    match device_name {
        None | Some("") | Some("system") => OutputStream::try_default()
            .map_err(|e| format!("Failed to open default audio output: {}", e)),
        Some(name) => {
            let host = cpal::default_host();
            let devices = host
                .output_devices()
                .map_err(|e| format!("Failed to list output devices: {}", e))?;
            for device in devices {
                let dev_name = match device.name() {
                    Ok(n) => n,
                    Err(_) => continue,
                };
                if dev_name == name {
                    return OutputStream::try_from_device(&device)
                        .map_err(|e| format!("Failed to open audio device \"{}\": {}", name, e));
                }
            }
            eprintln!(
                "Audio device \"{}\" not found; falling back to system default",
                name
            );
            OutputStream::try_default()
                .map_err(|e| format!("Failed to open default audio output: {}", e))
        }
    }
}

enum AudioCommand {
    Play(String, Option<f64>),
    CrossfadeTo {
        file_path: String,
        start_pos: Option<f64>,
        duration_ms: u64,
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
    PreloadNext(Option<String>),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackEndedPayload {
    pub path: Option<String>,
    #[serde(default)]
    pub seamless: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackErrorEvent {
    file_path: String,
    stage: &'static str,
    message: String,
    recoverable: bool,
}

fn emit_playback_error(
    app: &AppHandle,
    file_path: impl Into<String>,
    stage: &'static str,
    message: impl Into<String>,
    recoverable: bool,
) {
    let payload = PlaybackErrorEvent {
        file_path: file_path.into(),
        stage,
        message: message.into(),
        recoverable,
    };
    let _ = app.emit("playback-error", payload);
}

// Shared state for position tracking
pub struct PlaybackState {
    pub current_file: Option<String>,
    pub duration: f64,
    pub start_position: f64,
    pub position_sample_rate: u32,
    pub position_channels: u16,
    pub speed: f32,
    pub volume: f32,
    // Used as threshold for the "playback-near-end" event.
    // Backend sample-mixing crossfade is intentionally disabled for now.
    pub crossfade_secs: f32,
    pub booster: f32,
    pub is_paused: bool,
    pub is_playing: bool,
    pub warned_near_end: bool,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            current_file: None,
            duration: 0.0,
            start_position: 0.0,
            position_sample_rate: 0,
            position_channels: 0,
            speed: 1.0,
            volume: 0.8,
            crossfade_secs: 0.0,
            booster: 1.0,
            is_paused: false,
            is_playing: false,
            warned_near_end: false,
        }
    }
}

pub struct AudioManager {
    command_sender: Sender<AudioCommand>,
    pub playback_state: Arc<Mutex<PlaybackState>>,
    active_emitted_samples: Arc<Mutex<Arc<AtomicU64>>>,
}

struct VolumeRampState {
    from: f32,
    to: f32,
    start: Instant,
    duration: Duration,
}

struct CrossfadeState {
    outgoing_sink: Sink,
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

fn normalized_progress(elapsed: Duration, duration: Duration) -> f32 {
    let duration_secs = duration.as_secs_f32();
    if duration_secs <= 0.0 {
        1.0
    } else {
        (elapsed.as_secs_f32() / duration_secs).clamp(0.0, 1.0)
    }
}

fn crossfade_progress(active: &CrossfadeState) -> f32 {
    normalized_progress(active.start.elapsed(), active.duration)
}

fn apply_crossfade_mix(active: &CrossfadeState, incoming_sink: Option<&Sink>, target_volume: f32) {
    let progress = crossfade_progress(active);
    let target = target_volume.clamp(0.0, 1.0);
    let incoming_volume = (target * progress).clamp(0.0, 1.0);
    let outgoing_volume = (target * (1.0 - progress)).clamp(0.0, 1.0);

    if let Some(incoming) = incoming_sink {
        incoming.set_volume(incoming_volume);
    }
    active.outgoing_sink.set_volume(outgoing_volume);
}

fn apply_crossfade_step(
    crossfade: &mut Option<CrossfadeState>,
    state: &Arc<Mutex<PlaybackState>>,
    incoming_sink: Option<&Sink>,
) {
    let target_volume = { state.lock().volume.clamp(0.0, 1.0) };
    let mut should_finish = false;

    if let Some(active) = crossfade.as_ref() {
        apply_crossfade_mix(active, incoming_sink, target_volume);
        should_finish = crossfade_progress(active) >= 1.0;
    }

    if should_finish {
        if let Some(active) = crossfade.take() {
            active.outgoing_sink.stop();
        }
        if let Some(incoming) = incoming_sink {
            incoming.set_volume(target_volume);
        }
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
                        near_end_to_emit = Some(remaining.max(0.0));
                    }

                    if (current_pos - last_emitted).abs() >= 0.05 {
                        position_to_emit = Some(current_pos);
                        last_emitted = current_pos;
                    }
                }

                if let Some(pos) = position_to_emit {
                    let _ = app_clone.emit("playback-position", pos);
                }
                if let Some(remaining) = near_end_to_emit {
                    let _ = app_clone.emit("playback-near-end", remaining);
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
                        AudioCommand::Play(file_path, start_pos) => {
                            *pending_gapless_path_thread.lock() = None;
                            let Some((_, stream_handle)) = stream_bundle.as_ref() else {
                                emit_playback_error(
                                    &app_for_audio,
                                    "",
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
                                        &file_path,
                                        duration,
                                        actual_start,
                                        None,
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
                                    } else {
                                        emit_playback_error(
                                            &app_for_audio,
                                            file_path.clone(),
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
                                        "decode",
                                        err,
                                        false,
                                    );
                                }
                            }
                        }
                        AudioCommand::CrossfadeTo {
                            file_path,
                            start_pos,
                            duration_ms,
                        } => {
                            *pending_gapless_path_thread.lock() = None;
                            let Some((_, stream_handle)) = stream_bundle.as_ref() else {
                                emit_playback_error(
                                    &app_for_audio,
                                    "",
                                    "stream",
                                    "Audio output is not available",
                                    false,
                                );
                                continue;
                            };
                            if crossfade_state.is_some() {
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
                                        &file_path,
                                        duration,
                                        actual_start,
                                        initial_volume,
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
                                    } else {
                                        emit_playback_error(
                                            &app_for_audio,
                                            file_path.clone(),
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
                                        "decode",
                                        err,
                                        true,
                                    );
                                }
                            }
                        }
                        AudioCommand::Seek(position_secs) => {
                            *pending_gapless_path_thread.lock() = None;
                            let Some((_, stream_handle)) = stream_bundle.as_ref() else {
                                emit_playback_error(
                                    &app_for_audio,
                                    "",
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
                                        &active_path,
                                        updated_duration,
                                        actual_start,
                                        None,
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
                        AudioCommand::PreloadNext(maybe_path) => match maybe_path {
                            None => {
                                *pending_gapless_path_thread.lock() = None;
                            }
                            Some(path) if path.is_empty() => {
                                *pending_gapless_path_thread.lock() = None;
                            }
                            Some(path) => {
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
                                        s.duration = duration2;
                                        s.start_position = actual_start2;
                                        s.position_sample_rate = sr2;
                                        s.position_channels = ch2;
                                        s.warned_near_end = false;
                                    }
                                    let payload = PlaybackEndedPayload {
                                        path: Some(out_clone),
                                        seamless: true,
                                    };
                                    let _ = app_emit.emit("playback-ended", payload);
                                    *pending_slot.lock() = None;
                                });

                                sink.append(handoff);
                                *pending_gapless_path_thread.lock() = Some(path);
                            }
                        },
                        AudioCommand::SetOutputDevice(device_id) => {
                            *pending_gapless_path_thread.lock() = None;
                            if let Some(sink) = current_sink.take() {
                                sink.stop();
                            }
                            if let Some(active) = crossfade_state.take() {
                                active.outgoing_sink.stop();
                            }
                            volume_ramp = None;
                            reset_active_counter(&active_emitted_for_audio);
                            {
                                let mut state = state_clone.lock();
                                state.is_playing = false;
                                state.is_paused = false;
                                state.current_file = None;
                                state.duration = 0.0;
                                state.start_position = 0.0;
                                state.position_sample_rate = 0;
                                state.position_channels = 0;
                                state.warned_near_end = false;
                            }
                            let preferred = device_id.as_deref();
                            match open_output_stream(preferred) {
                                Ok(pair) => {
                                    stream_bundle = Some(pair);
                                }
                                Err(e) => {
                                    emit_playback_error(&app_for_audio, "", "stream", e, true);
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
                            let mut should_emit_ended = false;
                            {
                                let mut state = state_clone.lock();
                                if state.is_playing {
                                    ended_path = state.current_file.clone();
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
                                    seamless: false,
                                };
                                let _ = app_for_audio.emit("playback-ended", payload);
                            }
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        audio_is_running.store(false, Ordering::Relaxed);
                        break;
                    }
                }

                if crossfade_state.is_some() {
                    apply_volume_ramp_step(&mut volume_ramp, &state_clone, None);
                    apply_crossfade_step(&mut crossfade_state, &state_clone, current_sink.as_ref());
                } else {
                    apply_volume_ramp_step(&mut volume_ramp, &state_clone, current_sink.as_ref());
                }
            }
        });

        Self {
            command_sender: sender,
            playback_state,
            active_emitted_samples,
        }
    }

    pub fn play(&self, file_path: String, start_pos: Option<f64>) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::Play(file_path, start_pos))
            .map_err(|e| format!("Failed to send play command: {}", e))
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
    ) -> Result<(), String> {
        let duration_ms = (duration_secs.clamp(0.0, 12.0) * 1000.0).round() as u64;
        self.command_sender
            .send(AudioCommand::CrossfadeTo {
                file_path,
                start_pos,
                duration_ms,
            })
            .map_err(|e| format!("Failed to send crossfade command: {}", e))
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

    pub fn preload_next(&self, file_path: Option<String>) -> Result<(), String> {
        self.command_sender
            .send(AudioCommand::PreloadNext(file_path))
            .map_err(|e| format!("Failed to preload next track: {}", e))
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

const MAX_REFILL_ATTEMPTS: usize = 64;

fn open_decoder_for_file(
    file_path: &str,
) -> Result<(Box<dyn FormatReader>, Box<dyn SymphoniaDecoder>, f64), String> {
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

fn prepare_source(
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

fn play_with_source(
    stream_handle: &OutputStreamHandle,
    source: SymphoniaSource,
    state: &Arc<Mutex<PlaybackState>>,
    file_path: &str,
    duration: f64,
    start_secs: f64,
    initial_volume: Option<f32>,
) -> Option<Sink> {
    let sink = Sink::try_new(stream_handle).ok()?;
    let channels = source.channels();
    let sample_rate = source.sample_rate();
    {
        let s = state.lock();
        sink.set_volume(initial_volume.unwrap_or(s.volume).clamp(0.0, 1.0));
        sink.set_speed(s.speed);
    }

    sink.append(source);
    if sink.len() == 0 {
        return None;
    }

    {
        let mut s = state.lock();
        s.current_file = Some(file_path.to_string());
        s.duration = duration;
        s.start_position = start_secs;
        s.position_sample_rate = sample_rate;
        s.position_channels = channels;
        s.is_playing = true;
        s.is_paused = false;
        s.warned_near_end = false;
    }
    Some(sink)
}

struct SymphoniaSource {
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
    fn new(
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
struct GaplessHandoffSource {
    inner: SymphoniaSource,
    on_first_sample: Option<Box<dyn FnOnce() + Send>>,
    started: bool,
}

impl GaplessHandoffSource {
    fn new(inner: SymphoniaSource, on_first_sample: impl FnOnce() + Send + 'static) -> Self {
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
    if chans == 0 || frames == 0 {
        return None;
    }

    let mut converted = buf.make_equivalent::<f32>();
    buf.convert(&mut converted);
    let mut out = Vec::with_capacity(frames * chans as usize);
    for frame_idx in 0..frames {
        for chan_idx in 0..chans as usize {
            out.push(*converted.chan(chan_idx).get(frame_idx)?);
        }
    }
    Some((out, chans, rate))
}

pub type SharedAudioManager = Arc<AudioManager>;

pub fn create_audio_manager(app: AppHandle) -> SharedAudioManager {
    Arc::new(AudioManager::new(app))
}

#[tauri::command]
pub fn play_track(
    file_path: String,
    start_pos: Option<f64>,
    state: tauri::State<'_, SharedAudioManager>,
) -> Result<(), String> {
    state.play(file_path, start_pos)
}

#[tauri::command]
pub fn crossfade_to_track(
    file_path: String,
    start_pos: Option<f64>,
    duration_secs: f32,
    state: tauri::State<'_, SharedAudioManager>,
) -> Result<(), String> {
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
) -> Result<(), String> {
    state.preload_next(file_path)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
