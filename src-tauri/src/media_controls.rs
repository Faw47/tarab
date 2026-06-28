use crate::audio::SharedAudioManager;
use parking_lot::Mutex;
#[cfg(target_os = "windows")]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use souvlaki::{MediaControlEvent, MediaControls};
#[cfg(target_os = "windows")]
use souvlaki::{MediaMetadata, PlatformConfig};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[allow(dead_code)]
pub struct SouvlakiState {
    pub controls: Arc<Mutex<MediaControls>>,
}

#[cfg(target_os = "windows")]
/// Initializes souvlaki MediaControls for Windows SMTC.
pub fn init_souvlaki<R: Runtime>(app: &AppHandle<R>) -> Result<SouvlakiState, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    // souvlaki requires a window handle on Windows to attach the SMTC
    let hwnd = match window
        .window_handle()
        .map_err(|e| format!("{e:?}"))?
        .as_raw()
    {
        RawWindowHandle::Win32(h) => Some(h.hwnd.get() as *mut std::ffi::c_void),
        _ => None,
    };

    let config = PlatformConfig {
        display_name: "Tarab",
        dbus_name: "tarab", // Used on Linux, but required in struct
        hwnd,
    };

    let mut controls = MediaControls::new(config).map_err(|e| format!("{e:?}"))?;

    let app_handle = app.clone();
    controls
        .attach(move |event| {
            handle_media_control_event(&app_handle, event);
        })
        .map_err(|e| format!("{e:?}"))?;

    Ok(SouvlakiState {
        controls: Arc::new(Mutex::new(controls)),
    })
}

#[allow(dead_code)]
#[cfg(not(target_os = "windows"))]
/// Non-Windows fallback for souvlaki initialization.
pub fn init_souvlaki<R: Runtime>(_app: &AppHandle<R>) -> Result<SouvlakiState, String> {
    // This implementation is platform-guarded to Windows per requirements.
    Err("Souvlaki is only used on Windows in this project".to_string())
}

#[allow(dead_code)]
/// Maps souvlaki events to internal audio playback commands or Tauri events.
fn handle_media_control_event<R: Runtime>(app: &AppHandle<R>, event: MediaControlEvent) {
    if let Some(audio_manager) = app.try_state::<SharedAudioManager>() {
        match event {
            MediaControlEvent::Play => {
                let _ = audio_manager.resume();
            }
            MediaControlEvent::Pause => {
                let _ = audio_manager.pause();
            }
            MediaControlEvent::Toggle => {
                // Toggle logic: trigger whatever the app considers a play/pause toggle
                // Emitting desktop-control-action ensures UI stays in sync
                let _ = app.emit("desktop-control-action", "toggle-play");
            }
            MediaControlEvent::Next => {
                // Emit event to frontend queue manager as no direct backend skip command exists
                let _ = app.emit("next-track", ());
                let _ = app.emit("desktop-control-action", "next");
            }
            MediaControlEvent::Previous => {
                // Emit event to frontend queue manager as no direct backend skip command exists
                let _ = app.emit("previous-track", ());
                let _ = app.emit("desktop-control-action", "previous");
            }
            MediaControlEvent::Stop => {
                let _ = audio_manager.stop();
            }
            _ => {}
        }
    }
}

#[tauri::command]
/// Updates the Windows SMTC metadata (Title, Artist, Album).
pub fn update_media_metadata(
    _title: String,
    _artist: String,
    _album: String,
    _state: tauri::State<'_, SouvlakiState>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut controls = _state.controls.lock();
        controls
            .set_metadata(MediaMetadata {
                title: Some(&_title),
                artist: Some(&_artist),
                album: Some(&_album),
                ..Default::default()
            })
            .map_err(|e| format!("{e:?}"))?;
    }

    Ok(())
}
