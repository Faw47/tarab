use parking_lot::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

/// Volume booster gain shared with decoder sources. The mixer thread reads it once per sample, so
/// it is an atomic instead of a field behind the playback lock.
#[derive(Clone)]
pub struct BoosterGain(Arc<AtomicU32>);

/// Playback tempo shared with active and preloaded sources without locking on the mixer thread.
#[derive(Clone)]
pub struct SpeedControl(Arc<AtomicU32>);

impl SpeedControl {
    pub fn new(speed: f32) -> Self {
        Self(Arc::new(AtomicU32::new(speed.to_bits())))
    }

    pub fn get(&self) -> f32 {
        f32::from_bits(self.0.load(Ordering::Relaxed))
    }

    pub fn set(&self, speed: f32) {
        self.0.store(speed.to_bits(), Ordering::Relaxed);
    }
}

/// Keep speed values finite and inside the range supported by the playback controls.
pub fn normalize_speed(speed: f32) -> f32 {
    if speed.is_finite() {
        speed.clamp(0.5, 2.0)
    } else {
        1.0
    }
}

impl BoosterGain {
    pub fn new(level: f32) -> Self {
        Self(Arc::new(AtomicU32::new(level.to_bits())))
    }

    pub fn get(&self) -> f32 {
        f32::from_bits(self.0.load(Ordering::Relaxed))
    }

    pub fn set(&self, level: f32) {
        self.0.store(level.to_bits(), Ordering::Relaxed);
    }
}

pub struct PlaybackState {
    pub generation: u64,
    pub current_file: Option<String>,
    pub duration: f64,
    pub start_position: f64,
    pub position_sample_rate: u32,
    pub position_channels: u16,
    pub speed: f32,
    pub speed_control: SpeedControl,
    pub volume: f32,
    pub crossfade_secs: f32,
    pub booster: BoosterGain,
    pub is_paused: bool,
    pub is_playing: bool,
    pub warned_near_end: bool,
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            generation: 0,
            current_file: None,
            duration: 0.0,
            start_position: 0.0,
            position_sample_rate: 0,
            position_channels: 0,
            speed: 1.0,
            speed_control: SpeedControl::new(1.0),
            volume: 0.8,
            crossfade_secs: 0.0,
            booster: BoosterGain::new(1.0),
            is_paused: false,
            is_playing: false,
            warned_near_end: false,
        }
    }
}

/// Reads the active generation and file under a single lock and releases it before returning.
///
/// Callers emit IPC events with these values. Taking `state.lock()` more than once inside one
/// call expression deadlocks, because `parking_lot` mutexes are not reentrant and each temporary
/// guard lives until the end of the statement.
pub fn playback_identity(state: &Mutex<PlaybackState>) -> (u64, Option<String>) {
    let guard = state.lock();
    (guard.generation, guard.current_file.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn booster_gain_is_shared_between_clones_without_the_playback_lock() {
        let state = Mutex::new(PlaybackState::default());
        let source_gain = state.lock().booster.clone();
        state.lock().booster.set(1.5);
        assert_eq!(source_gain.get(), 1.5);
    }

    #[test]
    fn playback_identity_reads_both_fields_and_releases_the_lock() {
        let state = Mutex::new(PlaybackState {
            generation: 7,
            current_file: Some("/music/a.flac".to_string()),
            ..PlaybackState::default()
        });

        let (generation, file) = playback_identity(&state);

        assert_eq!(generation, 7);
        assert_eq!(file.as_deref(), Some("/music/a.flac"));
        assert!(
            state.try_lock().is_some(),
            "the state lock must be free before events are emitted"
        );
    }
}
