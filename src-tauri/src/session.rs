use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::ErrorKind,
    path::PathBuf,
};
use tauri::{AppHandle, Manager};

fn default_booster_level() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    pub version: u8,
    pub current_track_id: Option<String>,
    pub queue_ids: Vec<String>,
    pub queue_index: i32,
    pub current_time: f64,
    pub playback_speed: f64,
    #[serde(default = "default_booster_level")]
    pub booster_level: f64,
    pub volume: f64,
    pub was_playing: bool,
    pub shuffle_enabled: bool,
    pub loop_mode: String,
    pub stop_after_current: bool,
    pub last_view: Option<String>,
    pub last_opened_album: Option<String>,
    pub last_opened_artist: Option<String>,
    pub timestamp: i64,
}

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App data directory not available: {}", e))?;
    if let Err(err) = fs::create_dir_all(&path) {
        return Err(format!("Failed to create app data dir: {}", err));
    }
    path.push("session.json");
    Ok(path)
}

#[tauri::command]
pub async fn load_playback_session(app: AppHandle) -> Result<Option<PlaybackSession>, String> {
    tauri::async_runtime::spawn_blocking(move || read_session(&app))
        .await
        .map_err(|e| e.to_string())?
}

fn read_session(app: &AppHandle) -> Result<Option<PlaybackSession>, String> {
    let path = session_path(app)?;
    let contents = match fs::read_to_string(&path) {
        Ok(data) => data,
        Err(err) => {
            return if err.kind() == ErrorKind::NotFound {
                Ok(None)
            } else {
                Err(format!("Failed to read session: {}", err))
            }
        }
    };

    match serde_json::from_str::<PlaybackSession>(&contents) {
        Ok(session) => Ok(Some(session)),
        Err(_err) => {
            log::warn!("Failed to parse playback session; continuing without restoring it");
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_session() -> serde_json::Value {
        serde_json::json!({
            "version": 1,
            "currentTrackId": null,
            "queueIds": [],
            "queueIndex": -1,
            "currentTime": 0.0,
            "playbackSpeed": 1.0,
            "volume": 0.8,
            "wasPlaying": false,
            "shuffleEnabled": false,
            "loopMode": "all",
            "stopAfterCurrent": false,
            "lastView": null,
            "lastOpenedAlbum": null,
            "lastOpenedArtist": null,
            "timestamp": 0
        })
    }

    #[test]
    fn round_trip_preserves_saved_booster_level() {
        let mut value = legacy_session();
        value["boosterLevel"] = serde_json::json!(1.6);

        let session: PlaybackSession = serde_json::from_value(value).expect("parse session");
        let saved = serde_json::to_value(session).expect("serialize session");

        assert_eq!(saved["boosterLevel"], 1.6);
    }

    #[test]
    fn legacy_session_without_booster_defaults_to_unity() {
        let session: PlaybackSession =
            serde_json::from_value(legacy_session()).expect("parse legacy session");
        let saved = serde_json::to_value(session).expect("serialize session");

        assert_eq!(saved["boosterLevel"], 1.0);
    }
}
