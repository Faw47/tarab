use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, Runtime, Size, Wry,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_media::{
    InitializeMediaSessionRequest, MediaControlEventType, MediaExt, MediaMetadata, PlaybackInfo,
    PlaybackStatus, RepeatMode,
};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::audio::SharedAudioManager;

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const MINI_WINDOW_LABEL: &str = "mini-player";
const TRAY_ICON_ID: &str = "desktop-status-icon";

const EVENT_DESKTOP_CONTROL_ACTION: &str = "desktop-control-action";

const MENU_PLAY_PAUSE_ID: &str = "desktop.menu.play-pause";
const MENU_NEXT_ID: &str = "desktop.menu.next";
const MENU_PREVIOUS_ID: &str = "desktop.menu.previous";
const MENU_SHOW_MAIN_ID: &str = "desktop.menu.show-main";
const MENU_TOGGLE_MINI_ID: &str = "desktop.menu.toggle-mini";
const MENU_VIEW_SHOW_MAIN_ID: &str = "desktop.menu.view.show-main";
const MENU_VIEW_TOGGLE_MINI_ID: &str = "desktop.menu.view.toggle-mini";
const MENU_WINDOW_SHOW_MAIN_ID: &str = "desktop.menu.window.show-main";
const MENU_QUIT_ID: &str = "desktop.menu.quit";

const TRAY_TRACK_LABEL_ID: &str = "desktop.tray.track-label";
const TRAY_PLAY_PAUSE_ID: &str = "desktop.tray.play-pause";
const TRAY_NEXT_ID: &str = "desktop.tray.next";
const TRAY_PREVIOUS_ID: &str = "desktop.tray.previous";
const TRAY_SHOW_MAIN_ID: &str = "desktop.tray.show-main";
const TRAY_TOGGLE_MINI_ID: &str = "desktop.tray.toggle-mini";
const TRAY_QUIT_ID: &str = "desktop.tray.quit";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DesktopControlAction {
    TogglePlay,
    Play,
    Pause,
    Next,
    Previous,
    ShowMain,
    ToggleMini,
    Quit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNativeUiStatePayload {
    pub track_label: Option<String>,
    pub is_playing: bool,
    pub has_track: bool,
    pub has_previous: bool,
    pub has_next: bool,
    pub status_icon_enabled: bool,
    pub media_keys_enabled: bool,
    pub mini_window_enabled: bool,
    pub hide_to_status_icon_on_close: bool,
}

impl Default for DesktopNativeUiStatePayload {
    fn default() -> Self {
        Self {
            track_label: None,
            is_playing: false,
            has_track: false,
            has_previous: false,
            has_next: false,
            status_icon_enabled: true,
            media_keys_enabled: true,
            mini_window_enabled: false,
            hide_to_status_icon_on_close: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMediaSessionSyncPayload {
    pub enabled: bool,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub artwork_data_base64: Option<String>,
    pub is_playing: bool,
    pub position: f64,
    pub duration: Option<f64>,
    pub shuffle: bool,
    pub repeat_mode: DesktopRepeatMode,
    pub playback_rate: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopRepeatMode {
    Off,
    One,
    All,
}

struct DesktopMenuHandles {
    play_pause: MenuItem<Wry>,
    previous: MenuItem<Wry>,
    next: MenuItem<Wry>,
}

struct DesktopTrayHandles {
    tray_icon: TrayIcon<Wry>,
    track_label: MenuItem<Wry>,
    play_pause: MenuItem<Wry>,
    previous: MenuItem<Wry>,
    next: MenuItem<Wry>,
}

pub struct DesktopIntegrationState {
    native_ui: Mutex<DesktopNativeUiStatePayload>,
    menu_handles: Option<DesktopMenuHandles>,
    tray_handles: Option<DesktopTrayHandles>,
}

pub fn setup(app: &mut tauri::App<Wry>) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();

    let menu_handles = if cfg!(target_os = "windows") {
        None
    } else {
        build_app_menu(&app_handle)
            .map_err(|e| {
                eprintln!("Failed to initialize app menu: {}", e);
                e
            })
            .ok()
    };
    let tray_handles = build_tray_menu(&app_handle)
        .map_err(|e| {
            eprintln!("Failed to initialize tray menu: {}", e);
            e
        })
        .ok();

    app.manage(DesktopIntegrationState {
        native_ui: Mutex::new(DesktopNativeUiStatePayload::default()),
        menu_handles,
        tray_handles,
    });

    app_handle.on_menu_event(|app, event| {
        if let Some(action) = desktop_action_for_menu_id(event.id().as_ref()) {
            emit_desktop_control_action(app, action);
        }
    });

    register_media_shortcuts(&app_handle);
    setup_media_session_handler(&app_handle);

    if let Some(state) = app_handle.try_state::<DesktopIntegrationState>() {
        apply_native_ui_state(&state);
    }

    Ok(())
}

pub fn should_hide_main_window_on_close(app: &AppHandle<Wry>) -> bool {
    let Some(desktop_state) = app.try_state::<DesktopIntegrationState>() else {
        return false;
    };

    let native_ui = desktop_state.native_ui.lock().clone();
    if !native_ui.status_icon_enabled || !native_ui.hide_to_status_icon_on_close {
        return false;
    }

    let Some(audio_state) = app.try_state::<SharedAudioManager>() else {
        return false;
    };

    let playback = audio_state.playback_state.lock();
    playback.is_playing
}

#[tauri::command]
pub fn desktop_open_mini_window(app: AppHandle<Wry>) -> Result<(), String> {
    let Some(state) = app.try_state::<DesktopIntegrationState>() else {
        return Err("Desktop integration state is unavailable".to_string());
    };

    if !state.native_ui.lock().mini_window_enabled {
        return Err("Mini player window is disabled by settings".to_string());
    }

    let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) else {
        return Err("Mini player window is not registered (missing tauri.conf window)".to_string());
    };

    let logical = LogicalSize::new(320.0, 92.0);
    window
        .set_min_size(Some(Size::Logical(logical)))
        .map_err(|e| e.to_string())?;
    window
        .set_max_size(Some(Size::Logical(logical)))
        .map_err(|e| e.to_string())?;
    window
        .set_size(Size::Logical(logical))
        .map_err(|e| e.to_string())?;
    window.set_resizable(false).map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    window
        .move_window(Position::BottomRight)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Hides the mini player webview so it can be shown again (does not destroy the window).
#[tauri::command]
pub fn desktop_close_mini_window(app: AppHandle<Wry>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_toggle_mini_window(app: AppHandle<Wry>) -> Result<(), String> {
    let Some(state) = app.try_state::<DesktopIntegrationState>() else {
        return Err("Desktop integration state is unavailable".to_string());
    };

    if !state.native_ui.lock().mini_window_enabled {
        return Err("Mini player window is disabled by settings".to_string());
    }

    let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) else {
        return Err("Mini player window is not registered (missing tauri.conf window)".to_string());
    };

    let visible = window.is_visible().map_err(|e| e.to_string())?;
    if visible {
        window.hide().map_err(|e| e.to_string())
    } else {
        desktop_open_mini_window(app)
    }
}

#[tauri::command]
pub fn desktop_focus_main_window(app: AppHandle<Wry>) -> Result<(), String> {
    focus_main_window(&app)
}

#[tauri::command]
pub fn desktop_quit_application(app: AppHandle<Wry>) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn desktop_set_native_ui_state(
    payload: DesktopNativeUiStatePayload,
    app: AppHandle<Wry>,
    state: tauri::State<'_, DesktopIntegrationState>,
) -> Result<(), String> {
    {
        let mut native = state.native_ui.lock();
        *native = payload.clone();
    }

    apply_native_ui_state(&state);

    if !payload.mini_window_enabled {
        let _ = desktop_close_mini_window(app);
    }

    Ok(())
}

#[tauri::command]
pub fn desktop_sync_media_session(
    payload: DesktopMediaSessionSyncPayload,
    app: AppHandle<Wry>,
) -> Result<(), String> {
    if !payload.enabled {
        let _ = app.media().set_playback_status(PlaybackStatus::Stopped);
        let _ = app.media().clear_metadata();
        return Ok(());
    }

    if !app.media().is_enabled().map_err(|e| e.to_string())? {
        return Ok(());
    }

    if let Some(title) = payload.title.as_ref() {
        let artwork_data = decode_optional_artwork(payload.artwork_data_base64.as_ref());

        app.media()
            .set_metadata(MediaMetadata {
                title: title.clone(),
                artist: payload.artist.clone(),
                album: payload.album.clone(),
                album_artist: payload.album_artist.clone(),
                duration: payload.duration.filter(|d| d.is_finite() && *d >= 0.0),
                artwork_url: None,
                artwork_data,
            })
            .map_err(|e| e.to_string())?;
    } else {
        app.media().clear_metadata().map_err(|e| e.to_string())?;
    }

    let repeat_mode = match payload.repeat_mode {
        DesktopRepeatMode::Off => RepeatMode::None,
        DesktopRepeatMode::One => RepeatMode::Track,
        DesktopRepeatMode::All => RepeatMode::List,
    };

    let position = if payload.position.is_finite() {
        payload.position.max(0.0)
    } else {
        0.0
    };

    let status = if payload.is_playing {
        PlaybackStatus::Playing
    } else {
        PlaybackStatus::Paused
    };

    app.media()
        .set_playback_info(PlaybackInfo {
            status,
            position,
            shuffle: payload.shuffle,
            repeat_mode,
            playback_rate: payload.playback_rate.clamp(0.5, 2.0),
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn decode_optional_artwork(data: Option<&String>) -> Option<Vec<u8>> {
    let encoded = data?;

    match base64::engine::general_purpose::STANDARD.decode(encoded) {
        Ok(bytes) => Some(bytes),
        Err(err) => {
            eprintln!("Failed to decode media artwork payload: {}", err);
            None
        }
    }
}

fn build_app_menu(app: &AppHandle<Wry>) -> tauri::Result<DesktopMenuHandles> {
    let show_main_file = MenuItemBuilder::with_id(MENU_SHOW_MAIN_ID, "Show Main Window")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;
    let toggle_mini_file = MenuItemBuilder::with_id(MENU_TOGGLE_MINI_ID, "Toggle Mini Player")
        .accelerator("CmdOrCtrl+Shift+M")
        .build(app)?;

    let play_pause = MenuItemBuilder::with_id(MENU_PLAY_PAUSE_ID, "Play")
        .accelerator("CmdOrCtrl+Alt+P")
        .build(app)?;
    let next = MenuItemBuilder::with_id(MENU_NEXT_ID, "Next")
        .accelerator("CmdOrCtrl+Alt+Right")
        .build(app)?;
    let previous = MenuItemBuilder::with_id(MENU_PREVIOUS_ID, "Previous")
        .accelerator("CmdOrCtrl+Alt+Left")
        .build(app)?;

    let view_show_main =
        MenuItemBuilder::with_id(MENU_VIEW_SHOW_MAIN_ID, "Show Main Window").build(app)?;
    let view_toggle_mini =
        MenuItemBuilder::with_id(MENU_VIEW_TOGGLE_MINI_ID, "Toggle Mini Player").build(app)?;

    let window_show_main =
        MenuItemBuilder::with_id(MENU_WINDOW_SHOW_MAIN_ID, "Show Main Window").build(app)?;

    let quit_item = MenuItemBuilder::with_id(MENU_QUIT_ID, "Quit Tarab")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let app_submenu = SubmenuBuilder::new(app, "App")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit_item)
        .build()?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&show_main_file)
        .item(&toggle_mini_file)
        .separator()
        .close_window()
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(&view_show_main)
        .item(&view_toggle_mini)
        .separator()
        .fullscreen()
        .build()?;

    let playback_submenu = SubmenuBuilder::new(app, "Playback")
        .item(&play_pause)
        .item(&next)
        .item(&previous)
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .item(&window_show_main)
        .build()?;

    let help_item = MenuItemBuilder::new("Tarab Help")
        .enabled(false)
        .build(app)?;
    let help_submenu = SubmenuBuilder::new(app, "Help").item(&help_item).build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&playback_submenu)
        .item(&window_submenu)
        .item(&help_submenu)
        .build()?;

    app.set_menu(menu)?;

    Ok(DesktopMenuHandles {
        play_pause,
        previous,
        next,
    })
}

fn build_tray_menu(app: &AppHandle<Wry>) -> tauri::Result<DesktopTrayHandles> {
    let track_label = MenuItemBuilder::with_id(TRAY_TRACK_LABEL_ID, "No track playing")
        .enabled(false)
        .build(app)?;
    let play_pause = MenuItemBuilder::with_id(TRAY_PLAY_PAUSE_ID, "Play").build(app)?;
    let next = MenuItemBuilder::with_id(TRAY_NEXT_ID, "Next").build(app)?;
    let previous = MenuItemBuilder::with_id(TRAY_PREVIOUS_ID, "Previous").build(app)?;
    let show_main = MenuItemBuilder::with_id(TRAY_SHOW_MAIN_ID, "Show Main Window").build(app)?;
    let toggle_mini =
        MenuItemBuilder::with_id(TRAY_TOGGLE_MINI_ID, "Toggle Mini Player").build(app)?;
    let quit = MenuItemBuilder::with_id(TRAY_QUIT_ID, "Quit Tarab").build(app)?;

    let tray_menu = MenuBuilder::new(app)
        .item(&track_label)
        .separator()
        .item(&play_pause)
        .item(&next)
        .item(&previous)
        .separator()
        .item(&show_main)
        .item(&toggle_mini)
        .separator()
        .item(&quit)
        .build()?;

    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .menu(&tray_menu)
        .tooltip("Tarab")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                emit_desktop_control_action(tray.app_handle(), DesktopControlAction::ShowMain);
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    let tray_icon = tray_builder.build(app)?;

    Ok(DesktopTrayHandles {
        tray_icon,
        track_label,
        play_pause,
        previous,
        next,
    })
}

fn apply_native_ui_state(state: &DesktopIntegrationState) {
    let native = state.native_ui.lock().clone();

    let play_label = if native.is_playing { "Pause" } else { "Play" };
    let track_label = native.track_label.as_deref().unwrap_or("No track playing");

    if let Some(menu_handles) = &state.menu_handles {
        let _ = menu_handles.play_pause.set_text(play_label);
        let _ = menu_handles.play_pause.set_enabled(native.has_track);
        let _ = menu_handles.previous.set_enabled(native.has_previous);
        let _ = menu_handles.next.set_enabled(native.has_next);
    }

    if let Some(tray_handles) = &state.tray_handles {
        let _ = tray_handles.track_label.set_text(track_label);
        let _ = tray_handles.play_pause.set_text(play_label);
        let _ = tray_handles.play_pause.set_enabled(native.has_track);
        let _ = tray_handles.previous.set_enabled(native.has_previous);
        let _ = tray_handles.next.set_enabled(native.has_next);
        let _ = tray_handles
            .tray_icon
            .set_visible(native.status_icon_enabled);
    }
}

fn register_media_shortcuts(app: &AppHandle<Wry>) {
    let media_shortcuts = [
        (
            Shortcut::new(None, Code::MediaPlayPause),
            DesktopControlAction::TogglePlay,
        ),
        (
            Shortcut::new(None, Code::MediaTrackNext),
            DesktopControlAction::Next,
        ),
        (
            Shortcut::new(None, Code::MediaTrackPrevious),
            DesktopControlAction::Previous,
        ),
    ];

    let mut failures = 0usize;
    let mut first_error: Option<String> = None;
    for (shortcut, action) in media_shortcuts {
        if let Err(err) =
            app.global_shortcut()
                .on_shortcut(shortcut, move |app_handle, _shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }

                    if let Some(state) = app_handle.try_state::<DesktopIntegrationState>() {
                        if !state.native_ui.lock().media_keys_enabled {
                            return;
                        }
                    }

                    emit_desktop_control_action(app_handle, action);
                })
        {
            // Media key registration can fail on some hosts (e.g. unavailable
            // watcher support). Do not fail app startup; keep tray/menu/media
            // session features active.
            failures += 1;
            if first_error.is_none() {
                first_error = Some(err.to_string());
            }
        }
    }

    if failures > 0 {
        eprintln!(
            "Media key global shortcuts unavailable ({} registration failures; first error: {}). Continuing without global media-key hooks.",
            failures,
            first_error.unwrap_or_else(|| "unknown".to_string())
        );
    }
}

fn setup_media_session_handler(app: &AppHandle<Wry>) {
    let init = app
        .media()
        .initialize_session(InitializeMediaSessionRequest {
            app_id: "tarab.desktop".to_string(),
            app_name: app.package_info().name.clone(),
        });

    if let Err(err) = init {
        eprintln!("Failed to initialize media session: {}", err);
    }

    let app_handle = app.clone();
    app.media().set_event_handler(move |event| {
        if let Some(state) = app_handle.try_state::<DesktopIntegrationState>() {
            if !state.native_ui.lock().media_keys_enabled {
                return;
            }
        }

        let action = match event.event_type {
            MediaControlEventType::PlayPause => Some(DesktopControlAction::TogglePlay),
            MediaControlEventType::Next => Some(DesktopControlAction::Next),
            MediaControlEventType::Previous => Some(DesktopControlAction::Previous),
            MediaControlEventType::Play => Some(DesktopControlAction::Play),
            MediaControlEventType::Pause => Some(DesktopControlAction::Pause),
            _ => None,
        };

        if let Some(action) = action {
            emit_desktop_control_action(&app_handle, action);
        }
    });
}

fn emit_desktop_control_action<R: Runtime>(app: &AppHandle<R>, action: DesktopControlAction) {
    let _ = app.emit_to(MAIN_WINDOW_LABEL, EVENT_DESKTOP_CONTROL_ACTION, action);

    // Also emit specific tray events for backward compatibility or direct frontend handling if requested
    match action {
        DesktopControlAction::TogglePlay
        | DesktopControlAction::Play
        | DesktopControlAction::Pause => {
            let _ = app.emit("tray-toggle-playback", ());
        }
        DesktopControlAction::Next => {
            let _ = app.emit("tray-next-track", ());
        }
        _ => {}
    }
}

fn desktop_action_for_menu_id(id: &str) -> Option<DesktopControlAction> {
    match id {
        MENU_PLAY_PAUSE_ID | TRAY_PLAY_PAUSE_ID => Some(DesktopControlAction::TogglePlay),
        MENU_NEXT_ID | TRAY_NEXT_ID => Some(DesktopControlAction::Next),
        MENU_PREVIOUS_ID | TRAY_PREVIOUS_ID => Some(DesktopControlAction::Previous),
        MENU_SHOW_MAIN_ID
        | MENU_VIEW_SHOW_MAIN_ID
        | MENU_WINDOW_SHOW_MAIN_ID
        | TRAY_SHOW_MAIN_ID => Some(DesktopControlAction::ShowMain),
        MENU_TOGGLE_MINI_ID | MENU_VIEW_TOGGLE_MINI_ID | TRAY_TOGGLE_MINI_ID => {
            Some(DesktopControlAction::ToggleMini)
        }
        MENU_QUIT_ID | TRAY_QUIT_ID => Some(DesktopControlAction::Quit),
        _ => None,
    }
}

fn focus_main_window(app: &AppHandle<Wry>) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Err("Main window is unavailable".to_string());
    };

    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_known_menu_ids_to_desktop_actions() {
        assert_eq!(
            desktop_action_for_menu_id(MENU_PLAY_PAUSE_ID),
            Some(DesktopControlAction::TogglePlay)
        );
        assert_eq!(
            desktop_action_for_menu_id(MENU_NEXT_ID),
            Some(DesktopControlAction::Next)
        );
        assert_eq!(
            desktop_action_for_menu_id(MENU_PREVIOUS_ID),
            Some(DesktopControlAction::Previous)
        );
        assert_eq!(
            desktop_action_for_menu_id(MENU_SHOW_MAIN_ID),
            Some(DesktopControlAction::ShowMain)
        );
        assert_eq!(
            desktop_action_for_menu_id(MENU_TOGGLE_MINI_ID),
            Some(DesktopControlAction::ToggleMini)
        );
        assert_eq!(
            desktop_action_for_menu_id(MENU_QUIT_ID),
            Some(DesktopControlAction::Quit)
        );
        assert_eq!(desktop_action_for_menu_id("desktop.menu.unknown"), None);
    }

    #[test]
    fn decodes_artwork_payloads_safely() {
        let valid = "aGVsbG8=".to_string();
        let invalid = "!!!invalid!!!".to_string();

        assert_eq!(decode_optional_artwork(None), None);
        assert_eq!(
            decode_optional_artwork(Some(&valid)),
            Some(b"hello".to_vec())
        );
        assert_eq!(decode_optional_artwork(Some(&invalid)), None);
    }
}
