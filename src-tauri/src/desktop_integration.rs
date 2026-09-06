use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
#[cfg(target_os = "macos")]
use tauri::image::Image;
use tauri::{
    menu::{MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, Runtime, Size, Wry,
};
use tauri_plugin_media::{
    InitializeMediaSessionRequest, MediaControlEventType, MediaExt, MediaMetadata, PlaybackInfo,
    PlaybackStatus, RepeatMode,
};
use tauri_plugin_positioner::{Position, WindowExt};

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const MINI_WINDOW_LABEL: &str = "mini-player";
const TRAY_ICON_ID: &str = "desktop-status-icon";

#[cfg(target_os = "macos")]
const MACOS_TRAY_ICON_RGBA: &[u8] = include_bytes!("../icons/tray-headphones-template.rgba");

const EVENT_DESKTOP_CONTROL_ACTION: &str = "desktop-control-action";
const EVENT_DESKTOP_NATIVE_SEEK_TO: &str = "desktop-native-seek-to";
const EVENT_DESKTOP_NATIVE_VOLUME: &str = "desktop-native-volume";
const EVENT_DESKTOP_SEEK: &str = "desktop-seek";
const EVENT_DESKTOP_SNAPSHOT_REQUEST: &str = "desktop-snapshot-request";
const MAX_MEDIA_ARTWORK_BYTES: usize = 8 * 1024 * 1024;
const MAX_MINI_SOURCE_ID_BYTES: usize = 128;
const QUIT_FALLBACK_DELAY: Duration = Duration::from_secs(8);

const MENU_PLAY_PAUSE_ID: &str = "desktop.menu.play-pause";
const MENU_NEXT_ID: &str = "desktop.menu.next";
const MENU_PREVIOUS_ID: &str = "desktop.menu.previous";
const MENU_SHOW_MAIN_ID: &str = "desktop.menu.show-main";
const MENU_TOGGLE_MINI_ID: &str = "desktop.menu.toggle-mini";
const MENU_VIEW_SHOW_MAIN_ID: &str = "desktop.menu.view.show-main";
const MENU_VIEW_TOGGLE_MINI_ID: &str = "desktop.menu.view.toggle-mini";
const MENU_WINDOW_SHOW_MAIN_ID: &str = "desktop.menu.window.show-main";
const MENU_QUIT_ID: &str = "desktop.menu.quit";

const LINUX_MENU_NEXT_ACCELERATOR: &str = "CmdOrCtrl+Alt+Right";
const LINUX_MENU_PREVIOUS_ACCELERATOR: &str = "CmdOrCtrl+Alt+Left";

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
    Stop,
    Next,
    Previous,
    SeekBackward,
    SeekForward,
    ToggleShuffle,
    CycleRepeat,
    ShowMain,
    ToggleMini,
    HideMini,
    Quit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DesktopMiniControlAction {
    TogglePlay,
    Next,
    Previous,
    ShowMain,
    HideMini,
}

impl From<DesktopMiniControlAction> for DesktopControlAction {
    fn from(action: DesktopMiniControlAction) -> Self {
        match action {
            DesktopMiniControlAction::TogglePlay => Self::TogglePlay,
            DesktopMiniControlAction::Next => Self::Next,
            DesktopMiniControlAction::Previous => Self::Previous,
            DesktopMiniControlAction::ShowMain => Self::ShowMain,
            DesktopMiniControlAction::HideMini => Self::HideMini,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMiniSeekPayload {
    pub position_secs: f64,
    pub source_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DesktopMenuDispatch {
    Emit(DesktopControlAction),
    RequestQuit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DefaultPlaybackShortcut {
    Next,
    Previous,
}

fn default_playback_menu_accelerator(
    target_os: &str,
    shortcut: DefaultPlaybackShortcut,
) -> Option<&'static str> {
    if target_os != "linux" {
        return None;
    }

    Some(match shortcut {
        DefaultPlaybackShortcut::Next => LINUX_MENU_NEXT_ACCELERATOR,
        DefaultPlaybackShortcut::Previous => LINUX_MENU_PREVIOUS_ACCELERATOR,
    })
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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

fn default_repeat_mode() -> DesktopRepeatMode {
    DesktopRepeatMode::Off
}

fn default_playback_rate() -> f64 {
    1.0
}

fn default_volume() -> f64 {
    1.0
}

fn initial_native_ui_state() -> DesktopNativeUiStatePayload {
    DesktopNativeUiStatePayload {
        status_icon_enabled: true,
        hide_to_status_icon_on_close: true,
        ..DesktopNativeUiStatePayload::default()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopMediaSessionSyncPayload {
    #[serde(default)]
    pub enabled: bool,
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
    #[serde(default = "default_volume")]
    pub volume: f64,
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
    menu_handles: Mutex<Option<DesktopMenuHandles>>,
    tray_handles: Option<DesktopTrayHandles>,
    tray_visible: AtomicBool,
    media_session_initialized: Mutex<bool>,
    quit: QuitCoordination,
}

#[derive(Default)]
struct QuitCoordination {
    renderer_ready: AtomicBool,
    pending: AtomicBool,
}

impl QuitCoordination {
    fn request(&self) -> (bool, bool) {
        let first_request = !self.pending.swap(true, Ordering::AcqRel);
        (self.renderer_ready.load(Ordering::Acquire), first_request)
    }

    fn mark_renderer_ready(&self) -> bool {
        self.renderer_ready.store(true, Ordering::Release);
        self.pending.load(Ordering::Acquire)
    }

    fn complete(&self) {
        self.pending.store(false, Ordering::Release);
    }

    fn is_pending(&self) -> bool {
        self.pending.load(Ordering::Acquire)
    }
}

pub fn setup(app: &mut tauri::App<Wry>) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle().clone();

    let menu_handles = if cfg!(any(target_os = "windows", target_os = "macos")) {
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

    let tray_available = tray_handles.is_some();
    app.manage(DesktopIntegrationState {
        native_ui: Mutex::new(initial_native_ui_state()),
        menu_handles: Mutex::new(menu_handles),
        tray_handles,
        tray_visible: AtomicBool::new(tray_available),
        media_session_initialized: Mutex::new(false),
        quit: QuitCoordination::default(),
    });

    app_handle.on_menu_event(|app, event| {
        match desktop_dispatch_for_menu_id(event.id().as_ref()) {
            Some(DesktopMenuDispatch::Emit(action)) => emit_desktop_control_action(app, action),
            Some(DesktopMenuDispatch::RequestQuit) => request_desktop_quit(app),
            None => {}
        }
    });

    setup_media_session_handler(&app_handle);

    if let Some(state) = app_handle.try_state::<DesktopIntegrationState>() {
        apply_native_ui_state(&app_handle, &state);
    }

    Ok(())
}

pub fn should_hide_main_window_on_close(app: &AppHandle<Wry>) -> bool {
    let Some(desktop_state) = app.try_state::<DesktopIntegrationState>() else {
        return false;
    };

    let should_hide = should_hide_for_close(
        &desktop_state.native_ui.lock(),
        desktop_state.tray_visible.load(Ordering::Acquire),
    );
    should_hide
}

fn should_hide_for_close(native_ui: &DesktopNativeUiStatePayload, tray_available: bool) -> bool {
    tray_available && native_ui.status_icon_enabled && native_ui.hide_to_status_icon_on_close
}

pub fn request_desktop_control_action(app: &AppHandle<Wry>, action: DesktopControlAction) {
    if action == DesktopControlAction::Quit {
        request_desktop_quit(app);
    } else {
        emit_desktop_control_action(app, action);
    }
}

fn authorize_mini_window(
    window_label: &str,
    mini_window_enabled: bool,
    allow_disabled_cleanup: bool,
) -> Result<(), String> {
    if window_label != MINI_WINDOW_LABEL {
        return Err("Mini-player command rejected for non-mini window".to_string());
    }
    if !mini_window_enabled && !allow_disabled_cleanup {
        return Err("Mini player window is disabled by settings".to_string());
    }
    Ok(())
}

fn authorize_mini_control(
    window_label: &str,
    mini_window_enabled: bool,
    action: DesktopMiniControlAction,
) -> Result<(), String> {
    authorize_mini_window(
        window_label,
        mini_window_enabled,
        action == DesktopMiniControlAction::HideMini,
    )
}

fn validate_mini_seek_payload(payload: &DesktopMiniSeekPayload) -> Result<(), String> {
    if !payload.position_secs.is_finite() || payload.position_secs < 0.0 {
        return Err("Mini-player seek position must be a finite non-negative number".to_string());
    }
    if payload.source_id.is_empty() || payload.source_id.len() > MAX_MINI_SOURCE_ID_BYTES {
        return Err("Mini-player seek source identifier is invalid".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_mini_control(
    action: DesktopMiniControlAction,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DesktopIntegrationState>,
) -> Result<(), String> {
    authorize_mini_control(
        window.label(),
        state.native_ui.lock().mini_window_enabled,
        action,
    )?;
    window
        .app_handle()
        .emit_to(
            MAIN_WINDOW_LABEL,
            EVENT_DESKTOP_CONTROL_ACTION,
            DesktopControlAction::from(action),
        )
        .map_err(|error| format!("Failed to forward mini-player control: {error}"))
}

#[tauri::command]
pub fn desktop_mini_seek(
    payload: DesktopMiniSeekPayload,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DesktopIntegrationState>,
) -> Result<(), String> {
    authorize_mini_window(
        window.label(),
        state.native_ui.lock().mini_window_enabled,
        false,
    )?;
    validate_mini_seek_payload(&payload)?;
    window
        .app_handle()
        .emit_to(MAIN_WINDOW_LABEL, EVENT_DESKTOP_SEEK, payload)
        .map_err(|error| format!("Failed to forward mini-player seek: {error}"))
}

#[tauri::command]
pub fn desktop_mini_request_snapshot(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, DesktopIntegrationState>,
) -> Result<(), String> {
    authorize_mini_window(
        window.label(),
        state.native_ui.lock().mini_window_enabled,
        false,
    )?;
    window
        .app_handle()
        .emit_to(MAIN_WINDOW_LABEL, EVENT_DESKTOP_SNAPSHOT_REQUEST, ())
        .map_err(|error| format!("Failed to request mini-player snapshot: {error}"))
}

#[tauri::command]
pub fn desktop_open_mini_window(app: AppHandle) -> Result<(), String> {
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
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    window
        .move_window(Position::BottomRight)
        .map_err(|e| e.to_string())?;
    let _ = app.emit_to(MAIN_WINDOW_LABEL, EVENT_DESKTOP_SNAPSHOT_REQUEST, ());
    Ok(())
}

/// Hides the mini player webview so it can be shown again (does not destroy the window).
#[tauri::command]
pub fn desktop_close_mini_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MINI_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_toggle_mini_window(app: AppHandle) -> Result<(), String> {
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
    let minimized = window.is_minimized().map_err(|e| e.to_string())?;
    if visible && !minimized {
        window.hide().map_err(|e| e.to_string())
    } else {
        desktop_open_mini_window(app)
    }
}

#[tauri::command]
pub fn desktop_focus_main_window(app: AppHandle) -> Result<(), String> {
    focus_main_window(&app)
}

#[tauri::command]
pub fn desktop_quit_application(app: AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<DesktopIntegrationState>() {
        state.quit.complete();
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn desktop_mark_renderer_ready(
    app: AppHandle,
    state: tauri::State<'_, DesktopIntegrationState>,
) {
    if state.quit.mark_renderer_ready() {
        emit_desktop_control_action(&app, DesktopControlAction::Quit);
    }
}

#[tauri::command]
pub fn desktop_set_native_ui_state(
    payload: DesktopNativeUiStatePayload,
    app: AppHandle,
    state: tauri::State<'_, DesktopIntegrationState>,
) -> Result<(), String> {
    {
        let mut native = state.native_ui.lock();
        *native = payload.clone();
    }

    apply_native_ui_state(&app, &state);

    if !payload.mini_window_enabled {
        let _ = desktop_close_mini_window(app);
    }

    Ok(())
}

#[tauri::command]
pub fn desktop_sync_media_session(
    payload: DesktopMediaSessionSyncPayload,
    app: AppHandle,
    state: tauri::State<'_, DesktopIntegrationState>,
) -> Result<(), String> {
    if !payload.enabled {
        disable_media_session(&app, &state)?;
        return Ok(());
    }

    ensure_media_session(&app, &state)?;

    if let Some(title) = payload.title.as_ref() {
        let artwork_data = decode_optional_artwork(payload.artwork_data_base64.as_deref())?;

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
            playback_rate: if payload.playback_rate.is_finite() {
                payload.playback_rate.clamp(0.5, 2.0)
            } else {
                1.0
            },
        })
        .map_err(|e| e.to_string())?;
    app.media()
        .set_volume(if payload.volume.is_finite() {
            payload.volume.clamp(0.0, 1.0)
        } else {
            1.0
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn decode_optional_artwork(data: Option<&str>) -> Result<Option<Vec<u8>>, String> {
    let Some(encoded) = data else {
        return Ok(None);
    };
    let max_encoded_len = MAX_MEDIA_ARTWORK_BYTES.div_ceil(3) * 4;
    if encoded.len() > max_encoded_len {
        return Err(format!(
            "Media artwork payload exceeds the {} byte limit",
            MAX_MEDIA_ARTWORK_BYTES
        ));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|err| format!("Invalid media artwork payload: {err}"))?;
    if bytes.len() > MAX_MEDIA_ARTWORK_BYTES {
        return Err(format!(
            "Media artwork payload exceeds the {} byte limit",
            MAX_MEDIA_ARTWORK_BYTES
        ));
    }
    crate::image_cache::validated_artwork_mime(&bytes)
        .map_err(|err| format!("Invalid media artwork payload: {err}"))?;
    Ok(Some(bytes))
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
    let mut next_builder = MenuItemBuilder::with_id(MENU_NEXT_ID, "Next");
    if let Some(accelerator) =
        default_playback_menu_accelerator(std::env::consts::OS, DefaultPlaybackShortcut::Next)
    {
        next_builder = next_builder.accelerator(accelerator);
    }
    let next = next_builder.build(app)?;

    let mut previous_builder = MenuItemBuilder::with_id(MENU_PREVIOUS_ID, "Previous");
    if let Some(accelerator) =
        default_playback_menu_accelerator(std::env::consts::OS, DefaultPlaybackShortcut::Previous)
    {
        previous_builder = previous_builder.accelerator(accelerator);
    }
    let previous = previous_builder.build(app)?;

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

fn apply_native_ui_state(app: &AppHandle<Wry>, state: &DesktopIntegrationState) {
    let native = state.native_ui.lock().clone();

    let play_label = if native.is_playing { "Pause" } else { "Play" };
    let track_label = native.track_label.as_deref().unwrap_or("No track playing");

    if let Some(menu_handles) = state.menu_handles.lock().as_ref() {
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
        if !native.status_icon_enabled && state.tray_visible.load(Ordering::Acquire) {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                if !window.is_visible().unwrap_or(false) {
                    let _ = focus_main_window(app);
                }
            }
        }

        match tray_handles
            .tray_icon
            .set_visible(native.status_icon_enabled)
        {
            Ok(()) => state
                .tray_visible
                .store(native.status_icon_enabled, Ordering::Release),
            Err(err) => {
                state.tray_visible.store(false, Ordering::Release);
                eprintln!("Failed to update status icon visibility: {err}");
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn replace_menu_handles(
    app: &AppHandle<Wry>,
    play_pause: MenuItem<Wry>,
    previous: MenuItem<Wry>,
    next: MenuItem<Wry>,
) {
    if let Some(state) = app.try_state::<DesktopIntegrationState>() {
        *state.menu_handles.lock() = Some(DesktopMenuHandles {
            play_pause,
            previous,
            next,
        });
        apply_native_ui_state(app, &state);
    }
}

fn ensure_media_session(
    app: &AppHandle<Wry>,
    state: &DesktopIntegrationState,
) -> Result<(), String> {
    let mut initialized = state.media_session_initialized.lock();
    if *initialized {
        return Ok(());
    }

    app.media()
        .initialize_session(InitializeMediaSessionRequest {
            app_id: "tarab.desktop".to_string(),
            app_name: app.package_info().name.clone(),
        })
        .map_err(|err| format!("Failed to initialize media session: {err}"))?;
    *initialized = true;
    Ok(())
}

fn disable_media_session(
    app: &AppHandle<Wry>,
    state: &DesktopIntegrationState,
) -> Result<(), String> {
    let mut initialized = state.media_session_initialized.lock();
    if !*initialized {
        return Ok(());
    }

    let mut errors = Vec::new();
    if let Err(err) = app.media().set_playback_status(PlaybackStatus::Stopped) {
        errors.push(err.to_string());
    }
    if let Err(err) = app.media().clear_metadata() {
        errors.push(err.to_string());
    }
    if let Err(err) = app.media().disable_session() {
        errors.push(err.to_string());
    }
    *initialized = false;

    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Failed to fully disable media session: {}",
            errors.join("; ")
        ))
    }
}

fn setup_media_session_handler(app: &AppHandle<Wry>) {
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
            MediaControlEventType::Stop => Some(DesktopControlAction::Stop),
            MediaControlEventType::FastForward => Some(DesktopControlAction::SeekForward),
            MediaControlEventType::Rewind => Some(DesktopControlAction::SeekBackward),
            MediaControlEventType::SetPosition(position)
            | MediaControlEventType::SeekTo(position) => {
                if position.is_finite() {
                    let _ = app_handle.emit_to(
                        MAIN_WINDOW_LABEL,
                        EVENT_DESKTOP_NATIVE_SEEK_TO,
                        position.max(0.0),
                    );
                }
                None
            }
            MediaControlEventType::SetVolume(volume) => {
                if volume.is_finite() {
                    let _ = app_handle.emit_to(
                        MAIN_WINDOW_LABEL,
                        EVENT_DESKTOP_NATIVE_VOLUME,
                        volume.clamp(0.0, 1.0),
                    );
                }
                None
            }
            MediaControlEventType::Raise => Some(DesktopControlAction::ShowMain),
            MediaControlEventType::Quit => {
                request_desktop_quit(&app_handle);
                None
            }
            _ => None,
        };

        if let Some(action) = action {
            emit_desktop_control_action(&app_handle, action);
        }
    });
}

fn emit_desktop_control_action<R: Runtime>(app: &AppHandle<R>, action: DesktopControlAction) {
    let _ = app.emit_to(MAIN_WINDOW_LABEL, EVENT_DESKTOP_CONTROL_ACTION, action);
}

fn request_desktop_quit(app: &AppHandle<Wry>) {
    let Some(state) = app.try_state::<DesktopIntegrationState>() else {
        app.exit(0);
        return;
    };

    let (renderer_ready, first_request) = state.quit.request();
    if renderer_ready {
        emit_desktop_control_action(app, DesktopControlAction::Quit);
    }
    if !first_request {
        return;
    }

    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_FALLBACK_DELAY);
        if app_handle
            .try_state::<DesktopIntegrationState>()
            .is_some_and(|state| state.quit.is_pending())
        {
            eprintln!("Renderer did not complete quit coordination; exiting natively");
            app_handle.exit(0);
        }
    });
}

fn desktop_dispatch_for_menu_id(id: &str) -> Option<DesktopMenuDispatch> {
    match id {
        MENU_PLAY_PAUSE_ID | TRAY_PLAY_PAUSE_ID => {
            Some(DesktopMenuDispatch::Emit(DesktopControlAction::TogglePlay))
        }
        MENU_NEXT_ID | TRAY_NEXT_ID => Some(DesktopMenuDispatch::Emit(DesktopControlAction::Next)),
        MENU_PREVIOUS_ID | TRAY_PREVIOUS_ID => {
            Some(DesktopMenuDispatch::Emit(DesktopControlAction::Previous))
        }
        MENU_SHOW_MAIN_ID
        | MENU_VIEW_SHOW_MAIN_ID
        | MENU_WINDOW_SHOW_MAIN_ID
        | TRAY_SHOW_MAIN_ID => Some(DesktopMenuDispatch::Emit(DesktopControlAction::ShowMain)),
        MENU_TOGGLE_MINI_ID | MENU_VIEW_TOGGLE_MINI_ID | TRAY_TOGGLE_MINI_ID => {
            Some(DesktopMenuDispatch::Emit(DesktopControlAction::ToggleMini))
        }
        MENU_QUIT_ID | TRAY_QUIT_ID => Some(DesktopMenuDispatch::RequestQuit),
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
    fn linux_menu_owns_default_next_and_previous_accelerators() {
        assert_eq!(
            default_playback_menu_accelerator("linux", DefaultPlaybackShortcut::Next),
            Some(LINUX_MENU_NEXT_ACCELERATOR)
        );
        assert_eq!(
            default_playback_menu_accelerator("linux", DefaultPlaybackShortcut::Previous),
            Some(LINUX_MENU_PREVIOUS_ACCELERATOR)
        );
    }

    #[test]
    fn non_linux_menus_do_not_claim_linux_default_accelerators() {
        for target_os in ["windows", "macos"] {
            assert_eq!(
                default_playback_menu_accelerator(target_os, DefaultPlaybackShortcut::Next),
                None
            );
            assert_eq!(
                default_playback_menu_accelerator(target_os, DefaultPlaybackShortcut::Previous),
                None
            );
        }
    }

    #[test]
    fn maps_known_menu_ids_to_desktop_dispatches() {
        assert_eq!(
            desktop_dispatch_for_menu_id(MENU_PLAY_PAUSE_ID),
            Some(DesktopMenuDispatch::Emit(DesktopControlAction::TogglePlay))
        );
        assert_eq!(
            desktop_dispatch_for_menu_id(MENU_NEXT_ID),
            Some(DesktopMenuDispatch::Emit(DesktopControlAction::Next))
        );
        assert_eq!(
            desktop_dispatch_for_menu_id(MENU_PREVIOUS_ID),
            Some(DesktopMenuDispatch::Emit(DesktopControlAction::Previous))
        );
        assert_eq!(
            desktop_dispatch_for_menu_id(MENU_SHOW_MAIN_ID),
            Some(DesktopMenuDispatch::Emit(DesktopControlAction::ShowMain))
        );
        assert_eq!(
            desktop_dispatch_for_menu_id(MENU_TOGGLE_MINI_ID),
            Some(DesktopMenuDispatch::Emit(DesktopControlAction::ToggleMini))
        );
        assert_eq!(desktop_dispatch_for_menu_id("desktop.menu.unknown"), None);
    }

    #[test]
    fn routes_app_menu_and_tray_quit_through_quit_coordination() {
        assert_eq!(
            desktop_dispatch_for_menu_id(MENU_QUIT_ID),
            Some(DesktopMenuDispatch::RequestQuit)
        );
        assert_eq!(
            desktop_dispatch_for_menu_id(TRAY_QUIT_ID),
            Some(DesktopMenuDispatch::RequestQuit)
        );
    }

    #[test]
    fn pre_hydration_native_defaults_match_the_visible_tray_product_defaults() {
        let state = initial_native_ui_state();

        assert!(state.status_icon_enabled);
        assert!(state.hide_to_status_icon_on_close);
        assert!(!state.media_keys_enabled);
        assert!(!state.mini_window_enabled);
    }

    #[test]
    fn close_hides_only_when_the_enabled_status_icon_is_available() {
        let enabled = DesktopNativeUiStatePayload {
            status_icon_enabled: true,
            hide_to_status_icon_on_close: true,
            ..DesktopNativeUiStatePayload::default()
        };

        assert!(should_hide_for_close(&enabled, true));
        assert!(!should_hide_for_close(&enabled, false));
        assert!(!should_hide_for_close(
            &DesktopNativeUiStatePayload::default(),
            true
        ));
    }

    #[test]
    fn retains_startup_quit_until_the_renderer_bridge_is_ready() {
        let quit = QuitCoordination::default();

        assert_eq!(quit.request(), (false, true));
        assert!(quit.is_pending());
        assert!(quit.mark_renderer_ready());
        assert_eq!(quit.request(), (true, false));

        quit.complete();
        assert!(!quit.is_pending());
        assert!(!QuitCoordination::default().mark_renderer_ready());
    }

    #[test]
    fn media_artwork_accepts_only_fully_decodable_jpeg_png_and_webp() {
        use base64::Engine as _;
        use image::{DynamicImage, ImageFormat};
        use std::io::Cursor;

        let image = DynamicImage::new_rgb8(2, 2);
        for format in [ImageFormat::Jpeg, ImageFormat::Png, ImageFormat::WebP] {
            let mut encoded_image = Cursor::new(Vec::new());
            image
                .write_to(&mut encoded_image, format)
                .expect("encode media artwork");
            let bytes = encoded_image.into_inner();
            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
            assert_eq!(decode_optional_artwork(Some(&encoded)), Ok(Some(bytes)));
        }
    }

    #[test]
    fn media_artwork_rejects_arbitrary_malformed_and_oversized_base64() {
        use base64::Engine as _;

        let invalid = "!!!invalid!!!".to_string();
        let arbitrary = base64::engine::general_purpose::STANDARD.encode(b"hello");
        let truncated_png = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\n");
        let gif = base64::engine::general_purpose::STANDARD
            .encode(b"GIF89a\x01\x00\x01\x00\x00\x00\x00\x00");

        assert_eq!(decode_optional_artwork(None), Ok(None));
        assert!(decode_optional_artwork(Some(&invalid)).is_err());
        assert!(decode_optional_artwork(Some(&arbitrary)).is_err());
        assert!(decode_optional_artwork(Some(&truncated_png)).is_err());
        assert!(decode_optional_artwork(Some(&gif)).is_err());
        assert!(decode_optional_artwork(Some(
            &"A".repeat(MAX_MEDIA_ARTWORK_BYTES.div_ceil(3) * 4 + 1)
        ))
        .is_err());
    }

    #[test]
    fn serializes_every_renderer_control_action_with_the_shared_names() {
        let actions = [
            (DesktopControlAction::Stop, "\"stop\""),
            (DesktopControlAction::SeekBackward, "\"seek-backward\""),
            (DesktopControlAction::SeekForward, "\"seek-forward\""),
            (DesktopControlAction::ToggleShuffle, "\"toggle-shuffle\""),
            (DesktopControlAction::CycleRepeat, "\"cycle-repeat\""),
            (DesktopControlAction::HideMini, "\"hide-mini\""),
        ];

        for (action, expected) in actions {
            assert_eq!(serde_json::to_string(&action).unwrap(), expected);
        }
    }

    #[test]
    fn mini_commands_require_the_exact_window_and_enabled_native_state() {
        assert_eq!(
            authorize_mini_window(MINI_WINDOW_LABEL, true, false),
            Ok(())
        );
        assert!(authorize_mini_window(MINI_WINDOW_LABEL, false, false).is_err());
        assert!(authorize_mini_window(MAIN_WINDOW_LABEL, true, false).is_err());
        assert!(authorize_mini_window("mini-player-spoof", true, false).is_err());
        assert!(authorize_mini_window(MAIN_WINDOW_LABEL, false, true).is_err());
    }

    #[test]
    fn disabled_mini_bridge_allows_only_idempotent_hide_cleanup() {
        for action in [
            DesktopMiniControlAction::TogglePlay,
            DesktopMiniControlAction::Next,
            DesktopMiniControlAction::Previous,
            DesktopMiniControlAction::ShowMain,
        ] {
            assert!(authorize_mini_control(MINI_WINDOW_LABEL, false, action).is_err());
        }
        assert_eq!(
            authorize_mini_control(MINI_WINDOW_LABEL, false, DesktopMiniControlAction::HideMini),
            Ok(())
        );
    }

    #[test]
    fn mini_control_allowlist_excludes_privileged_desktop_actions() {
        let allowed = [
            (
                DesktopMiniControlAction::TogglePlay,
                DesktopControlAction::TogglePlay,
            ),
            (DesktopMiniControlAction::Next, DesktopControlAction::Next),
            (
                DesktopMiniControlAction::Previous,
                DesktopControlAction::Previous,
            ),
            (
                DesktopMiniControlAction::ShowMain,
                DesktopControlAction::ShowMain,
            ),
            (
                DesktopMiniControlAction::HideMini,
                DesktopControlAction::HideMini,
            ),
        ];

        for (mini_action, desktop_action) in allowed {
            assert_eq!(DesktopControlAction::from(mini_action), desktop_action);
        }
        for rejected in ["quit", "play", "pause", "stop", "toggle-mini"] {
            assert!(
                serde_json::from_str::<DesktopMiniControlAction>(&format!("\"{rejected}\""))
                    .is_err()
            );
        }
    }

    #[test]
    fn mini_seek_payload_validation_rejects_invalid_values() {
        let valid = DesktopMiniSeekPayload {
            position_secs: 42.5,
            source_id: "source-1".to_string(),
        };
        assert_eq!(validate_mini_seek_payload(&valid), Ok(()));

        for position_secs in [f64::NAN, f64::INFINITY, -0.1] {
            assert!(validate_mini_seek_payload(&DesktopMiniSeekPayload {
                position_secs,
                source_id: "source-1".to_string(),
            })
            .is_err());
        }
        assert!(validate_mini_seek_payload(&DesktopMiniSeekPayload {
            position_secs: 1.0,
            source_id: String::new(),
        })
        .is_err());
        assert!(validate_mini_seek_payload(&DesktopMiniSeekPayload {
            position_secs: 1.0,
            source_id: "x".repeat(MAX_MINI_SOURCE_ID_BYTES + 1),
        })
        .is_err());
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
