use parking_lot::Mutex;

pub struct PlaybackState {
    pub generation: u64,
    pub current_file: Option<String>,
    pub duration: f64,
    pub start_position: f64,
    pub position_sample_rate: u32,
    pub position_channels: u16,
    pub speed: f32,
    pub volume: f32,
    pub crossfade_secs: f32,
    pub booster: f32,
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
            volume: 0.8,
            crossfade_secs: 0.0,
            booster: 1.0,
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
