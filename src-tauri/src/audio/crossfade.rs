use parking_lot::Mutex;
use rodio::Sink;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::PlaybackState;

pub(super) struct CrossfadeState {
    pub outgoing_sink: Arc<Sink>,
    pub start: Instant,
    pub paused_at: Option<Instant>,
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

pub(super) fn crossfade_elapsed(
    start: Instant,
    paused_at: Option<Instant>,
    now: Instant,
) -> Duration {
    paused_at.unwrap_or(now).saturating_duration_since(start)
}

pub(super) fn resume_crossfade_clock(
    start: Instant,
    paused_at: Option<Instant>,
    resumed_at: Instant,
) -> Instant {
    match paused_at {
        Some(paused_at) => start + resumed_at.saturating_duration_since(paused_at),
        None => start,
    }
}

impl CrossfadeState {
    pub(super) fn pause_at(&mut self, paused_at: Instant) {
        self.paused_at.get_or_insert(paused_at);
    }

    pub(super) fn resume_at(&mut self, resumed_at: Instant) {
        self.start = resume_crossfade_clock(self.start, self.paused_at.take(), resumed_at);
    }

    pub(super) fn set_paused(&mut self, paused: bool, at: Instant) {
        if paused {
            self.pause_at(at);
            self.outgoing_sink.pause();
        } else {
            self.resume_at(at);
            self.outgoing_sink.play();
        }
    }
}

pub(super) fn crossfade_progress(active: &CrossfadeState) -> f32 {
    crossfade_progress_at(active, Instant::now())
}

fn crossfade_progress_at(active: &CrossfadeState, now: Instant) -> f32 {
    normalized_progress(
        crossfade_elapsed(active.start, active.paused_at, now),
        active.duration,
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crossfade_progress_clock_stays_frozen_while_paused() {
        let start = Instant::now();
        let paused_at = start + Duration::from_millis(250);
        let later = paused_at + Duration::from_secs(5);

        assert_eq!(
            crossfade_elapsed(start, Some(paused_at), later),
            Duration::from_millis(250)
        );
    }

    #[test]
    fn crossfade_state_freezes_and_resumes_progress_and_outgoing_sink() {
        let (outgoing_sink, _queue) = Sink::new_idle();
        let start = Instant::now();
        let mut active = CrossfadeState {
            outgoing_sink: Arc::new(outgoing_sink),
            start,
            paused_at: None,
            duration: Duration::from_secs(1),
            generation: 1,
            incoming_path: "next-track".to_string(),
        };
        let paused_at = start + Duration::from_millis(250);

        active.set_paused(true, paused_at);

        assert!(active.outgoing_sink.is_paused());
        let resumed_at = paused_at + Duration::from_secs(5);
        assert_eq!(crossfade_progress_at(&active, resumed_at), 0.25);

        active.set_paused(false, resumed_at);

        assert!(!active.outgoing_sink.is_paused());
        assert_eq!(
            crossfade_progress_at(&active, resumed_at + Duration::from_millis(500)),
            0.75
        );
    }

    #[test]
    fn crossfade_progress_resumes_after_the_paused_duration() {
        let start = Instant::now();
        let paused_at = start + Duration::from_millis(250);
        let resumed_at = paused_at + Duration::from_secs(5);
        let resumed_start = resume_crossfade_clock(start, Some(paused_at), resumed_at);

        assert_eq!(
            crossfade_elapsed(resumed_start, None, resumed_at + Duration::from_millis(500)),
            Duration::from_millis(750)
        );
    }
}
