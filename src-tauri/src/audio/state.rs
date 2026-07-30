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
