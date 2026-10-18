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
    /// File that started playing at a seamless gapless handoff.
    pub next_path: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Shared with the renderer tests, which feed these payloads to the real event handlers. A
    /// change to an event struct fails here until the fixture, and with it the renderer tests, is
    /// updated.
    const FIXTURE: &str = include_str!("../../../src/test/ipc-fixtures/playback-events.json");

    #[test]
    fn playback_event_payloads_match_the_renderer_fixture() {
        // Regression for QA-18 and QA-31: renderer tests sent payload shapes Rust never emits.
        let fixture: serde_json::Value = serde_json::from_str(FIXTURE).expect("fixture");
        let emitted = serde_json::json!({
            "playback-position": PlaybackPositionEvent { generation: 3, position: 12.5 },
            "playback-seeked": PlaybackPositionEvent { generation: 3, position: 30.25 },
            "playback-near-end": PlaybackNearEndEvent { generation: 3, remaining: 4.5 },
            "playback-ended": PlaybackEndedPayload {
                path: Some("/music/a.flac".to_string()),
                generation: 3,
                seamless: true,
                next_generation: Some(4),
                next_path: Some("/music/b.flac".to_string()),
            },
            "playback-transition": PlaybackTransitionEvent {
                generation: 3,
                state: PlaybackTransition::CrossfadeStarted,
                file_path: Some("/music/a.flac".to_string()),
                message: None,
                recoverable: true,
            },
            "playback-error": PlaybackErrorEvent {
                file_path: "/music/a.flac".to_string(),
                generation: 3,
                stage: "decode",
                message: "bad packet".to_string(),
                recoverable: true,
            },
        });
        assert_eq!(emitted, fixture);
    }
}
