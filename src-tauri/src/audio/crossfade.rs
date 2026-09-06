use parking_lot::Mutex;
use rodio::Sink;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::PlaybackState;

pub(super) struct CrossfadeState {
    pub outgoing_sink: Sink,
    pub start: Instant,
    pub duration: Duration,
    pub generation: u64,
    pub incoming_path: String,
}

pub(super) fn normalized_progress(elapsed: Duration, duration: Duration) -> f32 {
    let duration_secs = duration.as_secs_f32();
    if duration_secs <= 0.0 {
        1.0
    } else {
        (elapsed.as_secs_f32() / duration_secs).clamp(0.0, 1.0)
    }
}

pub(super) fn crossfade_progress(active: &CrossfadeState) -> f32 {
    normalized_progress(active.start.elapsed(), active.duration)
}

pub(super) fn apply_crossfade_mix(
    active: &CrossfadeState,
    incoming_sink: Option<&Sink>,
    target_volume: f32,
) {
    let progress = crossfade_progress(active);
    let target = target_volume.clamp(0.0, 1.0);
    let incoming_volume = (target * progress).clamp(0.0, 1.0);
    let outgoing_volume = (target * (1.0 - progress)).clamp(0.0, 1.0);

    if let Some(incoming) = incoming_sink {
        incoming.set_volume(incoming_volume);
    }
    active.outgoing_sink.set_volume(outgoing_volume);
}

pub(super) fn apply_crossfade_step(
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
