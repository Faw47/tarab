use base64::Engine;
use parking_lot::Mutex;
use tauri::async_runtime::Mutex as AsyncMutex;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use tauri::image::Image;
use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, Runtime, Size, WebviewUrl, WebviewWindowBuilder, Wry,
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

#[cfg(target_os = "macos")]
const MACOS_TRAY_ICON_RGBA: &[u8] = include_bytes!("../icons/tray-headphones-template.rgba");

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
const MENU_HELP_ID: &str = "help.help";

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

fn default_repeat_mode() -> DesktopRepeatMode {
    DesktopRepeatMode::Off
}

fn default_playback_rate() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMediaSessionSyncPayload {
    #[serde(default)]
    pub enabled: bool,
    /// The renderer already applied this track's metadata and artwork; update playback only.
    #[serde(default)]
    pub metadata_unchanged: bool,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub album: Option<String>,
    #[serde(default)]
    pub album_artist: Option<String>,
    #[serde(default)]
    pub artwork_data_base64: Option<String>,
    #[serde(default)]
    pub is_playing: bool,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub shuffle: bool,
    #[serde(default = "default_repeat_mode")]
    pub repeat_mode: DesktopRepeatMode,
    #[serde(default = "default_playback_rate")]
    pub playback_rate: f64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopRepeatMode {
    #[default]
    Off,
    One,
    All,
}

pub(crate) struct DesktopMenuHandles {
    pub(crate) play_pause: MenuItem<Wry>,
    pub(crate) previous: MenuItem<Wry>,
    pub(crate) next: MenuItem<Wry>,
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
    mini_window_creation_lock: AsyncMutex<()>,
    menu_handles: Option<DesktopMenuHandles>,
    tray_handles: Option<DesktopTrayHandles>,
}

pub fn setup(app: &mut tauri::App<Wry>) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();

    let menu_handles = build_platform_menu(app)
        .inspect_err(|_| {
            log::error!("Failed to initialize app menu");
        })
        .ok()
        .flatten();
    let tray_handles = build_tray_menu(&app_handle)
        .inspect_err(|_| {
            log::error!("Failed to initialize tray menu");
        })
        .ok();

    app.manage(DesktopIntegrationState {
        native_ui: Mutex::new(DesktopNativeUiStatePayload::default()),
        mini_window_creation_lock: AsyncMutex::new(()),
        menu_handles,
        tray_handles,
    });

    app_handle.on_menu_event(|app, event| {
        if let Some(action) = desktop_action_for_menu_id(event.id().as_ref()) {
            emit_desktop_control_action(app, action);
        } else if cfg!(not(target_os = "macos")) {
            // The macOS menu already forwards help.help from macos_menu.rs.
            if let Some(action) = native_menu_action_for_menu_id(event.id().as_ref()) {
                let _ = app.emit_to(MAIN_WINDOW_LABEL, "native-menu-action", action);
            }
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

fn is_minimized_launch(arguments: &[String]) -> bool {
    arguments
        .iter()
        .skip(1)
        .any(|argument| argument == "--minimized")
}

fn should_start_minimized(arguments: &[String], tray_available: bool) -> bool {
    is_minimized_launch(arguments) && tray_available
}

#[tauri::command]
pub fn desktop_should_start_minimized(app: AppHandle) -> bool {
    let tray_available = app
        .try_state::<DesktopIntegrationState>()
        .is_some_and(|state| state.tray_handles.is_some());
    should_start_minimized(&std::env::args().collect::<Vec<_>>(), tray_available)
}

fn open_mini_window_locked(
    app: &AppHandle<Wry>,
    state: &DesktopIntegrationState,
) -> Result<(), String> {
    if !state.native_ui.lock().mini_window_enabled {
        return Err("Mini player window is disabled by settings".to_string());
    }

    let window = match app.get_webview_window(MINI_WINDOW_LABEL) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(
            app,
            MINI_WINDOW_LABEL,
            WebviewUrl::App("mini-player.html".into()),
        )
        .title("Tarab Mini")
        .inner_size(320.0, 92.0)
        .min_inner_size(320.0, 92.0)
        .max_inner_size(320.0, 92.0)
        .resizable(false)
        .decorations(false)
        .minimizable(true)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .build()
        .map_err(|_error| {
            log::error!("Failed to create mini-player webview");
            "Failed to create mini-player webview".to_string()
        })?,
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

fn hide_mini_window_locked(app: &AppHandle<Wry>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn desktop_open_mini_window(app: AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<DesktopIntegrationState>() else {
        return Err("Desktop integration state is unavailable".to_string());
    };
    let _creation_lock = state.mini_window_creation_lock.lock().await;
    open_mini_window_locked(&app, &state)
}

/// Hides the mini player webview so it can be shown again (does not destroy the window).
#[tauri::command]
pub async fn desktop_close_mini_window(app: AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<DesktopIntegrationState>() else {
        return Ok(());
    };
    let _creation_lock = state.mini_window_creation_lock.lock().await;
    hide_mini_window_locked(&app)
}

#[tauri::command]
pub async fn desktop_toggle_mini_window(app: AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<DesktopIntegrationState>() else {
        return Err("Desktop integration state is unavailable".to_string());
    };
    let _creation_lock = state.mini_window_creation_lock.lock().await;
    if !state.native_ui.lock().mini_window_enabled {
        return Err("Mini player window is disabled by settings".to_string());
    }

    if let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        if window.is_visible().map_err(|e| e.to_string())? {
            hide_mini_window_locked(&app)
        } else {
            open_mini_window_locked(&app, &state)
        }
    } else {
        open_mini_window_locked(&app, &state)
    }
}

#[tauri::command]
pub fn desktop_focus_main_window(app: AppHandle) -> Result<(), String> {
    focus_main_window(&app)
}

#[tauri::command]
pub fn desktop_quit_application(app: AppHandle) -> Result<(), String> {
    crate::shutdown::approve_exit(&app);
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn desktop_set_native_ui_state(
    payload: DesktopNativeUiStatePayload,
    app: AppHandle,
    state: tauri::State<'_, DesktopIntegrationState>,
) -> Result<(), String> {
    let _creation_lock = state.mini_window_creation_lock.lock().await;
    {
        let mut native = state.native_ui.lock();
        *native = payload.clone();
    }

    apply_native_ui_state(&state);

    if !payload.mini_window_enabled {
        let _ = hide_mini_window_locked(&app);
    }

    Ok(())
}

#[tauri::command]
pub fn desktop_focus_main_window(app: AppHandle) -> Result<(), String> {
    focus_main_window(&app)
}

#[tauri::command]
pub fn desktop_quit_application(app: AppHandle) -> Result<(), String> {
    crate::shutdown::approve_exit(&app);
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn desktop_set_native_ui_state(
    payload: DesktopNativeUiStatePayload,
    app: AppHandle,
    state: tauri::State<'_, DesktopIntegrationState>,
) -> Result<(), String> {
    {
        let _creation_lock = state.mini_window_creation_lock.lock();
        let mut native = state.native_ui.lock();
        *native = payload.clone();
    }

    apply_native_ui_state(&state);

    if !payload.mini_window_enabled {
        let _ = desktop_close_mini_window(app);
    }

    Ok(())
}

/// Largest base64 artwork payload accepted for the OS media session (about 6 MiB decoded).
const MAX_MEDIA_ARTWORK_BASE64_LEN: usize = 8 * 1024 * 1024;

/// Returns whether the OS media session now holds this payload's metadata. The renderer only
/// sends `metadata_unchanged` after a sync that returned true.
#[tauri::command]
pub fn desktop_sync_media_session(
    payload: DesktopMediaSessionSyncPayload,
    app: AppHandle,
) -> Result<bool, String> {
    // Typed parameter: a malformed payload is rejected to the caller by the IPC layer instead of
    // being logged verbatim (titles, artwork) and reported as success.

    if !payload.enabled {
        let _ = app.media().set_playback_status(PlaybackStatus::Stopped);
        let _ = app.media().clear_metadata();
        return Ok(false);
    }

    // On Windows this reports whether any system media session exists, so it can change.
    if !app.media().is_enabled().map_err(|e| e.to_string())? {
        return Ok(false);
    }

    if payload.metadata_unchanged {
        // Keep the metadata and artwork already set on the OS media session.
    } else if let Some(title) = payload.title.as_ref() {
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

    Ok(true)
}

fn decode_optional_artwork(data: Option<&String>) -> Option<Vec<u8>> {
    let encoded = data?;
    if encoded.len() > MAX_MEDIA_ARTWORK_BASE64_LEN {
        log::warn!(
            "Ignoring media artwork payload of {} bytes (limit {})",
            encoded.len(),
            MAX_MEDIA_ARTWORK_BASE64_LEN
        );
        return None;
    }

    match base64::engine::general_purpose::STANDARD.decode(encoded) {
        Ok(bytes) => Some(bytes),
        Err(_) => {
            log::warn!("Failed to decode media artwork payload");
            None
        }
    }
}

/// One menu per platform. macOS uses the `macos_menu` bar, whose playback items follow the native
/// UI state. Linux attaches this menu to the main window only, because an app-wide menu is added
/// to every window there, including the 320x92 mini player. Windows has no app menu.
fn build_platform_menu(app: &tauri::App<Wry>) -> tauri::Result<Option<DesktopMenuHandles>> {
    #[cfg(target_os = "macos")]
    {
        crate::macos_menu::build_menu(app).map(Some)
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        Ok(None)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        build_app_menu(app.handle()).map(Some)
    }
}

// Compiled on every platform so its builders and menu IDs stay checked; only Linux installs it.
#[cfg_attr(any(target_os = "macos", target_os = "windows"), allow(dead_code))]
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

    let help_item = MenuItemBuilder::with_id(MENU_HELP_ID, "Tarab Help").build(app)?;
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

    match app.get_webview_window(MAIN_WINDOW_LABEL) {
        Some(main) => {
            main.set_menu(menu)?;
        }
        None => log::warn!("Main window not found; the app menu was not attached"),
    }

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

    #[cfg(target_os = "macos")]
    {
        let icon = Image::new(MACOS_TRAY_ICON_RGBA, 44, 44);
        tray_builder = tray_builder.icon(icon).icon_as_template(true);
    }

    #[cfg(not(target_os = "macos"))]
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
    for (shortcut, action) in media_shortcuts {
        if app
            .global_shortcut()
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
            .is_err()
        {
            // Media key registration can fail on some hosts (e.g. unavailable
            // watcher support). Do not fail app startup; keep tray/menu/media
            // session features active.
            failures += 1;
        }
    }

    if failures > 0 {
        log::warn!(
            "Media key global shortcuts unavailable ({failures} registration failures); continuing without global media-key hooks"
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

    if init.is_err() {
        log::error!("Failed to initialize media session");
    }

    let app_handle = app.clone();
    app.media().set_event_handler(move |event| {
        if let Some(state) = app_handle.try_state::<DesktopIntegrationState>() {
            if !state.native_ui.lock().media_keys_enabled {
                return;
            }
        }

        if let Some(action) = desktop_action_for_media_event(&event.event_type) {
            emit_desktop_control_action(&app_handle, action);
        }
    });
}

fn desktop_action_for_media_event(event: &MediaControlEventType) -> Option<DesktopControlAction> {
    match event {
        MediaControlEventType::PlayPause => Some(DesktopControlAction::TogglePlay),
        MediaControlEventType::Next => Some(DesktopControlAction::Next),
        MediaControlEventType::Previous => Some(DesktopControlAction::Previous),
        MediaControlEventType::Play => Some(DesktopControlAction::Play),
        // The OS Stop button (enabled on Windows SMTC) pauses, keeping the queue and position.
        MediaControlEventType::Pause | MediaControlEventType::Stop => {
            Some(DesktopControlAction::Pause)
        }
        _ => None,
    }
}

fn emit_desktop_control_action<R: Runtime>(app: &AppHandle<R>, action: DesktopControlAction) {
    if matches!(action, DesktopControlAction::Quit) {
        crate::shutdown::request_quit(app);
    } else {
        let _ = app.emit_to(MAIN_WINDOW_LABEL, EVENT_DESKTOP_CONTROL_ACTION, action);
    }
}

fn native_menu_action_for_menu_id(id: &str) -> Option<&'static str> {
    match id {
        MENU_HELP_ID => Some(MENU_HELP_ID),
        _ => None,
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
    fn os_stop_button_pauses_playback() {
        // Regression for AR-12: after souvlaki was removed, SMTC Stop mapped to nothing.
        assert!(matches!(
            desktop_action_for_media_event(&MediaControlEventType::Stop),
            Some(DesktopControlAction::Pause)
        ));
        assert!(desktop_action_for_media_event(&MediaControlEventType::Rewind).is_none());
    }

    #[test]
    fn media_session_payload_rejects_a_non_numeric_position() {
        // Regression for PB-01/SEC-11: an object position used to be swallowed as success.
        let raw = serde_json::json!({
            "enabled": true,
            "title": "Song",
            "isPlaying": true,
            "position": { "generation": 3, "position": 61.5 },
        });
        assert!(serde_json::from_value::<DesktopMediaSessionSyncPayload>(raw).is_err());
    }

    #[test]
    fn media_session_payload_accepts_the_renderer_shape() {
        let raw = serde_json::json!({
            "enabled": true,
            "title": "Song",
            "artist": "Artist",
            "album": null,
            "albumArtist": null,
            "artworkDataBase64": null,
            "isPlaying": true,
            "position": 61.5,
            "duration": 200.0,
            "shuffle": false,
            "repeatMode": "all",
            "playbackRate": 1.0,
        });
        let payload: DesktopMediaSessionSyncPayload =
            serde_json::from_value(raw).expect("renderer payload parses");
        assert_eq!(payload.position, 61.5);
        assert!(matches!(payload.repeat_mode, DesktopRepeatMode::All));
    }

    #[test]
    fn oversized_media_artwork_is_ignored() {
        let oversized = "A".repeat(MAX_MEDIA_ARTWORK_BASE64_LEN + 4);
        assert!(decode_optional_artwork(Some(&oversized)).is_none());
        assert_eq!(
            decode_optional_artwork(Some(&"AAAA".to_string())),
            Some(vec![0, 0, 0])
        );
    }

    #[test]
    fn minimized_launch_only_matches_the_explicit_flag() {
        // Regression for QA-11: autostart's --minimized was never consumed.
        assert!(is_minimized_launch(&[
            "tarab".to_string(),
            "--minimized".to_string(),
        ]));
        assert!(!is_minimized_launch(&["tarab".to_string()]));
        assert!(!is_minimized_launch(&[
            "tarab".to_string(),
            "--minimized-extra".to_string(),
        ]));
        assert!(!is_minimized_launch(&["--minimized".to_string()]));
        // An unavailable tray must never leave the app hidden at startup.
        let minimized = ["tarab".to_string(), "--minimized".to_string()];
        assert!(should_start_minimized(&minimized, true));
        assert!(!should_start_minimized(&minimized, false));
    }

    #[test]
    fn help_menu_routes_to_the_renderer() {
        // Regression for QA-10: the non-macOS Help item was disabled and had no action ID.
        assert_eq!(
            native_menu_action_for_menu_id(MENU_HELP_ID),
            Some("help.help")
        );
        assert_eq!(native_menu_action_for_menu_id("desktop.menu.unknown"), None);
        assert_eq!(desktop_action_for_menu_id(MENU_HELP_ID), None);
    }

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

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_tray_icon_is_a_transparent_native_sized_template() {
        let icon = Image::new(MACOS_TRAY_ICON_RGBA, 44, 44);

        assert_eq!((icon.width(), icon.height()), (44, 44));
        assert_eq!(MACOS_TRAY_ICON_RGBA.len(), 44 * 44 * 4);
        assert_eq!(icon.rgba()[3], 0, "top-left pixel should be transparent");
        assert!(
            icon.rgba().chunks_exact(4).any(|pixel| pixel[3] == 255),
            "template should contain opaque artwork"
        );
    }
}
