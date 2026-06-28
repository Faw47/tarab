use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{ErrorKind, Write},
    path::PathBuf,
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    pub version: u8,
    pub current_track_id: Option<String>,
    pub queue_ids: Vec<String>,
    pub queue_index: i32,
    pub current_time: f64,
    pub playback_speed: f64,
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

fn write_atomic(path: &PathBuf, data: &[u8]) -> Result<(), String> {
    let mut tmp = path.clone();
    tmp.set_extension("json.tmp");
    let mut file =
        fs::File::create(&tmp).map_err(|e| format!("Failed to create temp session file: {}", e))?;
    file.write_all(data)
        .map_err(|e| format!("Failed to write session: {}", e))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync session file: {}", e))?;
    fs::rename(&tmp, path).map_err(|e| format!("Failed to replace session file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_playback_session(app: AppHandle) -> Result<Option<PlaybackSession>, String> {
    let path = session_path(&app)?;
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
        Err(err) => {
            eprintln!("Failed to parse playback session: {}", err);
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn save_playback_session(app: AppHandle, session: PlaybackSession) -> Result<(), String> {
    let path = session_path(&app)?;
    let data =
        serde_json::to_vec(&session).map_err(|e| format!("Failed to serialize session: {}", e))?;
    write_atomic(&path, &data)
}
