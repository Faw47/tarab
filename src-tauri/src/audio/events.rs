use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackEndedPayload {
    pub path: Option<String>,
    pub generation: u64,
    #[serde(default)]
    pub seamless: bool,
    pub next_generation: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackErrorEvent {
    file_path: String,
    generation: u64,
    stage: &'static str,
    message: String,
    recoverable: bool,
}

pub(super) fn emit_playback_error(
    app: &AppHandle,
    file_path: impl Into<String>,
    generation: u64,
    stage: &'static str,
    message: impl Into<String>,
    recoverable: bool,
) {
    let payload = PlaybackErrorEvent {
        file_path: file_path.into(),
        generation,
        stage,
        message: message.into(),
        recoverable,
    };
    let _ = app.emit("playback-error", payload);
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum PlaybackTransition {
    Loading,
    Playing,
    Paused,
    CrossfadeStarted,
    CrossfadeCompleted,
    Ended,
    DecodeFailed,
    DeviceSwitchFailed,
    SourceRenamed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackTransitionEvent {
    generation: u64,
    state: PlaybackTransition,
    file_path: Option<String>,
    message: Option<String>,
    recoverable: bool,
}

pub(super) fn emit_playback_transition(
    app: &AppHandle,
    generation: u64,
    state: PlaybackTransition,
    file_path: Option<String>,
    message: Option<String>,
    recoverable: bool,
) {
    let _ = app.emit(
        "playback-transition",
        PlaybackTransitionEvent {
            generation,
            state,
            file_path,
            message,
            recoverable,
        },
    );
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PlaybackPositionEvent {
    pub generation: u64,
    pub position: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PlaybackNearEndEvent {
    pub generation: u64,
    pub remaining: f64,
}
