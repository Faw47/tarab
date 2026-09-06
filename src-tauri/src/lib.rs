mod audio;
mod database;
mod desktop_integration;
mod embedded_art;
mod file_ops;
mod fixed_store;
mod image_cache;
mod launch_intents;
mod library;
mod library_watcher;
mod lyrics;
#[cfg(target_os = "macos")]
mod macos_menu;
mod metadata;
mod playlist;
mod session;
mod tageditor;
#[cfg(target_os = "windows")]
mod taskbar;
mod vibrancy;
mod waveform;

use audio::{create_audio_manager, SharedAudioManager};
use database::create_database;
use file_ops::{load_library_roots_state, SharedLibraryRoots};
use image_cache::{
    create_image_cache, is_valid_thumbnail_hash, is_valid_thumbnail_size, SharedImageCache,
};
use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Read;
use std::path::Path;
use std::time::Instant;
use tauri::http;
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;
use waveform::{create_waveform_generator, SharedWaveformGenerator};

const MINI_PLAYER_COMMANDS: [&str; 3] = [
    "desktop_mini_control",
    "desktop_mini_seek",
    "desktop_mini_request_snapshot",
];
const APP_IDENTIFIER: &str = "com.fawaz.tarab";
const APP_LOG_FILE_NAME: &str = "Tarab.log";

fn app_log_file_path() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    let base = dirs::home_dir()?.join("Library/Logs");
    #[cfg(not(target_os = "macos"))]
    let base = dirs::data_local_dir()?;

    #[cfg(target_os = "macos")]
    let directory = base.join(APP_IDENTIFIER);
    #[cfg(not(target_os = "macos"))]
    let directory = base.join(APP_IDENTIFIER).join("logs");
    Some(directory.join(APP_LOG_FILE_NAME))
}

fn ensure_log_file_access(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "app log file has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create app log directory: {error}"))?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map(|_| ())
        .map_err(|error| format!("app log file is not writable: {error}"))
}

fn create_log_builder() -> tauri_plugin_log::Builder {
    match app_log_file_path()
        .ok_or_else(|| "app log directory is unavailable".to_string())
        .and_then(|path| ensure_log_file_access(&path))
    {
        Ok(()) => tauri_plugin_log::Builder::default(),
        Err(error) => {
            eprintln!("[startup] file logging disabled: {error}");
            tauri_plugin_log::Builder::default().clear_targets().target(
                tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            )
        }
    }
}

fn custom_command_allowed(window_label: &str, command: &str) -> bool {
    if MINI_PLAYER_COMMANDS.contains(&command) {
        return window_label == desktop_integration::MINI_WINDOW_LABEL;
    }
    window_label == desktop_integration::MAIN_WINDOW_LABEL
}

#[tauri::command]
fn get_initial_deep_links(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    app.deep_link()
        .get_current()
        .map(|urls| {
            urls.unwrap_or_default()
                .into_iter()
                .map(|url| url.to_string())
                .collect()
        })
        .map_err(|error| format!("Failed to read startup deep links: {}", error))
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectedArtwork {
    base64: String,
    mime: String,
}

fn read_selected_artwork(path: &Path) -> Result<SelectedArtwork, String> {
    let link_metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect selected image: {error}"))?;
    if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
        return Err("Selected image must be a regular file".to_string());
    }

    let file = std::fs::File::open(path)
        .map_err(|error| format!("Failed to open selected image: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("Failed to inspect selected image: {error}"))?;
    if !metadata.is_file() {
        return Err("Selected image must be a regular file".to_string());
    }
    if metadata.len() > image_cache::MAX_ENCODED_IMAGE_BYTES as u64 {
        return Err(format!(
            "Selected image is too large: {} bytes exceeds {} byte limit",
            metadata.len(),
            image_cache::MAX_ENCODED_IMAGE_BYTES
        ));
    }

    let mut data = Vec::with_capacity(metadata.len() as usize);
    file.take(image_cache::MAX_ENCODED_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut data)
        .map_err(|error| format!("Failed to read selected image: {error}"))?;
    if data.len() > image_cache::MAX_ENCODED_IMAGE_BYTES {
        return Err("Selected image exceeds the encoded byte limit".to_string());
    }
    let mime = image_cache::validated_artwork_mime(&data)?;

    use base64::Engine;
    Ok(SelectedArtwork {
        base64: base64::engine::general_purpose::STANDARD.encode(data),
        mime: mime.to_string(),
    })
}

#[tauri::command]
async fn pick_cover_art(app: tauri::AppHandle) -> Result<Option<SelectedArtwork>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Select Cover Art")
        .add_filter("Images", image_cache::SUPPORTED_ARTWORK_EXTENSIONS)
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|error| format!("Selected image path is invalid: {error}"))?;

    tauri::async_runtime::spawn_blocking(move || read_selected_artwork(&path))
        .await
        .map_err(|error| format!("Failed to read selected image: {error}"))?
        .map(Some)
}

#[tauri::command]
fn reveal_playlists_data_folder(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate playlists data folder: {error}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Failed to create playlists data folder: {error}"))?;

    tauri_plugin_opener::open_path(&data_dir, None::<&str>)
        .map_err(|error| format!("Failed to open playlists data folder: {error}"))
}

fn parse_cover_art_request(uri: &http::Uri) -> Option<(&str, &str)> {
    let host = uri.host().unwrap_or_default();
    let mut parts = uri.path().split('/').filter(|part| !part.is_empty());
    if !host.is_empty() && host != "localhost" {
        return Some((host, parts.next().unwrap_or("medium")));
    }
    Some((parts.next()?, parts.next().unwrap_or("medium")))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared_image_cache: SharedImageCache = create_image_cache();

    let builder = tauri::Builder::default()
        .register_uri_scheme_protocol("cover-art", {
            let cache = shared_image_cache.clone();
            move |_ctx, request| {
                let (hash, size) = parse_cover_art_request(request.uri()).unwrap_or_default();

                let empty_response = |status: http::StatusCode| -> http::Response<Vec<u8>> {
                    http::Response::builder()
                        .status(status)
                        .header(http::header::CONTENT_LENGTH, "0")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(Vec::new())
                        .unwrap_or_else(|_| http::Response::new(Vec::new()))
                };

                if !is_valid_thumbnail_hash(hash) || !is_valid_thumbnail_size(size) {
                    return empty_response(http::StatusCode::BAD_REQUEST);
                }

                match cache.get_thumbnail_bytes(hash, size) {
                    Ok(Some(bytes)) => {
                        let content_length = bytes.len().to_string();
                        http::Response::builder()
                            .header(http::header::CONTENT_TYPE, "image/webp")
                            .header(http::header::CONTENT_LENGTH, content_length)
                            .header("Access-Control-Allow-Origin", "*")
                            .header(
                                http::header::CACHE_CONTROL,
                                "public, max-age=31536000, immutable",
                            )
                            .header(http::header::ETAG, format!("\"{}\"", hash))
                            .body(bytes)
                            .unwrap_or_else(|_| http::Response::new(Vec::new()))
                    }
                    Ok(None) => empty_response(http::StatusCode::NOT_FOUND),
                    Err(_e) => empty_response(http::StatusCode::INTERNAL_SERVER_ERROR),
                }
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            // Login launches must not surface an already-running hidden instance.
            if !launch_intents::should_start_minimized(&argv) {
                if let Some(window) = app.get_webview_window(desktop_integration::MAIN_WINDOW_LABEL)
                {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            if let Some(intents) = app.try_state::<launch_intents::SharedLaunchIntents>() {
                launch_intents::queue_cli_arguments(app, intents.inner(), &argv, Path::new(&cwd));
            }

            let _ = app.emit_to(
                desktop_integration::MAIN_WINDOW_LABEL,
                "app://second-instance",
                serde_json::json!({ "argumentCount": argv.len() }),
            );
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&[desktop_integration::MINI_WINDOW_LABEL])
                .build(),
        )
        .plugin(create_log_builder().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_media::init())
        .plugin(tauri_plugin_liquid_glass::init());

    let app_command_handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
        // Audio commands
        audio::play_track,
        audio::crossfade_to_track,
        audio::pause_playback,
        audio::resume_playback,
        audio::stop_playback,
        audio::seek_playback,
        audio::get_playback_position,
        audio::get_duration,
        audio::set_volume,
        audio::set_volume_ramp,
        audio::set_playback_speed,
        audio::set_crossfade_duration,
        audio::set_audio_booster,
        // Library commands
        library::scan_library,
        library::scan_library_parallel,
        library::cancel_library_scan,
        library::finish_library_scan,
        fixed_store::fixed_store_get,
        fixed_store::fixed_store_set,
        fixed_store::fixed_store_remove,
        // Metadata commands
        metadata::get_track_metadata,
        metadata::get_cover_art,
        metadata::get_cover_art_with_blurhash,
        metadata::resolve_cover_art,
        metadata::get_cover_art_palette,
        metadata::get_batch_metadata,
        metadata::get_batch_metadata_with_art,
        metadata::get_batch_cover_art,
        metadata::generate_cover_art_hashes,
        metadata::get_cover_art_data,
        // Lyrics commands
        lyrics::get_lyrics_for_track,
        lyrics::fetch_lrclib_lyrics,
        lyrics::write_lyrics_for_track,
        lyrics::search_lyrics,
        lyrics::sync_lyrics_index,
        // Playlist commands
        playlist::get_playlists,
        playlist::get_playlist_detail,
        playlist::create_playlist,
        playlist::update_playlist,
        playlist::delete_playlist,
        playlist::set_playlist_pinned,
        playlist::add_tracks_to_playlist,
        playlist::remove_tracks_from_playlist,
        playlist::relink_playlist_track,
        playlist::reorder_playlist_tracks,
        playlist::sync_playlist,
        playlist::remove_missing_from_playlist,
        playlist::reset_playlists_data,
        reveal_playlists_data_folder,
        // Tag editor commands
        tageditor::read_full_tags,
        tageditor::write_tags,
        tageditor::write_tags_batch,
        tageditor::remove_cover_art,
        // Database commands
        database::db_get_all_tracks,
        database::db_get_all_track_ids,
        database::db_get_tracks_by_ids,
        database::db_get_track_by_public_id,
        database::db_get_tracks_by_album_artist,
        database::db_get_tracks_by_artist,
        database::db_get_album_aggregates,
        database::db_get_artist_aggregates,
        database::db_get_tracks_paginated,
        database::db_get_tracks_cursor_page,
        database::db_search_tracks,
        database::db_get_existing_paths,
        database::db_upsert_tracks,
        database::db_reconcile_folder_scan,
        database::db_get_track_count,
        database::db_update_play_stats,
        database::db_set_track_rating,
        database::db_get_recently_added,
        database::db_get_most_played,
        database::get_smart_shuffle_queue,
        database::db_get_library_stats,
        database::db_delete_tracks,
        database::db_rename_track_path,
        database::db_delete_tracks_by_folder,
        // Image cache commands
        image_cache::cache_generate_thumbnail,
        image_cache::cache_get_thumbnail,
        image_cache::cache_get_thumbnail_bytes,
        image_cache::cache_has_thumbnail,
        image_cache::cache_get_stats,
        image_cache::cache_clear,
        image_cache::cache_enforce_limit,
        // Waveform commands
        waveform::waveform_generate,
        waveform::waveform_cancel,
        waveform::waveform_has,
        waveform::waveform_get_stats,
        waveform::waveform_clear_cache,
        // File operations
        file_ops::rename_file,
        file_ops::move_file,
        file_ops::trash_files,
        file_ops::list_recoverable_trash_entries,
        file_ops::restore_trashed_files,
        file_ops::purge_trashed_files,
        file_ops::delete_files,
        file_ops::reveal_in_file_manager,
        file_ops::list_library_grants,
        file_ops::get_library_health,
        file_ops::select_library_folder,
        file_ops::reauthorize_library_grant,
        file_ops::remove_library_source,
        launch_intents::list_launch_file_intents,
        launch_intents::resolve_launch_file_intent,
        launch_intents::revoke_launch_file_authority,
        // File dialogs
        pick_cover_art,
        get_initial_deep_links,
        // Session
        session::load_playback_session,
        session::save_playback_session,
        audio::list_audio_output_devices,
        audio::set_audio_output_device,
        audio::preload_next_track,
        audio::cancel_gapless_preload,
        // Desktop integration commands
        desktop_integration::desktop_open_mini_window,
        desktop_integration::desktop_close_mini_window,
        desktop_integration::desktop_toggle_mini_window,
        desktop_integration::desktop_focus_main_window,
        desktop_integration::desktop_quit_application,
        desktop_integration::desktop_mark_renderer_ready,
        desktop_integration::desktop_mini_control,
        desktop_integration::desktop_mini_seek,
        desktop_integration::desktop_mini_request_snapshot,
        desktop_integration::desktop_set_native_ui_state,
        desktop_integration::desktop_sync_media_session,
        library_watcher::watch_library_paths,
        #[cfg(target_os = "windows")]
        taskbar::update_progress,
        #[cfg(target_os = "windows")]
        taskbar::clear_progress,
    ];

    let app = builder
        .setup(move |app| {
            let setup_start = Instant::now();
            let startup_arguments: Vec<String> = std::env::args().collect();
            let startup_cwd = std::env::current_dir().unwrap_or_default();
            let start_minimized = launch_intents::should_start_minimized(&startup_arguments);
            if let Some(window) = app.get_webview_window(desktop_integration::MAIN_WINDOW_LABEL) {
                if start_minimized {
                    let _ = window.hide();
                } else if let Err(error) = window.show() {
                    eprintln!("Failed to show the main window during startup: {}", error);
                }
            }
            // Create audio manager with app handle for events
            let audio_manager: SharedAudioManager = create_audio_manager(app.handle().clone());
            app.manage(audio_manager);

            // Create database
            let db_start = Instant::now();
            let database = match create_database() {
                Ok(database) => database,
                Err(err) => {
                    let message = format!("Failed to initialize library database: {}", err);
                    eprintln!("{}", message);
                    return Err(message.into());
                }
            };
            let playlist_bootstrap_db = database.clone();
            let file_recovery_db = database.clone();
            app.manage(database);
            eprintln!(
                "[startup] db_init_ms={:.1}",
                db_start.elapsed().as_secs_f64() * 1000.0
            );

            // Create image cache
            app.manage(shared_image_cache.clone());

            // Create waveform generator
            let waveform_gen: SharedWaveformGenerator = create_waveform_generator();
            app.manage(waveform_gen);

            // Manage allowlisted library roots for filesystem operations
            let library_roots: SharedLibraryRoots = match load_library_roots_state(app.handle()) {
                Ok(state) => state,
                Err(err) => {
                    eprintln!(
                        "Failed to load library grants; file access remains blocked: {}",
                        err
                    );
                    file_ops::create_library_roots_state()
                }
            };
            if let Err(err) = file_ops::recover_interrupted_file_operations(
                app.handle(),
                &file_recovery_db,
                &library_roots,
            ) {
                eprintln!("File operation startup reconciliation needs attention: {err}");
            }
            app.manage(library_roots);

            let launch_intents = launch_intents::create_launch_intent_state();
            launch_intents::queue_cli_arguments(
                app.handle(),
                &launch_intents,
                &startup_arguments,
                &startup_cwd,
            );
            app.manage(launch_intents);

            app.manage(fixed_store::create_fixed_store());
            app.manage(library::create_library_scan_control());

            // Playlist write guard to serialize read-modify-write operations
            let playlist_guard = playlist::create_playlist_guard();
            app.manage(playlist_guard);

            let playlist_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let start = Instant::now();
                if let Err(err) =
                    playlist::bootstrap_playlist_storage(playlist_handle, playlist_bootstrap_db)
                {
                    eprintln!("Playlist migration bootstrap failed: {}", err);
                } else {
                    eprintln!(
                        "[startup] playlist_bootstrap_ms={:.1}",
                        start.elapsed().as_secs_f64() * 1000.0
                    );
                }
            });

            let desktop_start = Instant::now();
            if let Err(err) = desktop_integration::setup(app) {
                eprintln!("Desktop integration setup failed: {}", err);
            }
            eprintln!(
                "[startup] desktop_integration_ms={:.1}",
                desktop_start.elapsed().as_secs_f64() * 1000.0
            );

            // Watcher state
            app.manage(std::sync::Mutex::new(None::<library_watcher::WatcherTask>));

            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window(desktop_integration::MAIN_WINDOW_LABEL) {
                let _ = window.set_decorations(false);
            }

            #[cfg(target_os = "macos")]
            if let Err(err) = macos_menu::build_menu(app) {
                eprintln!("macOS menu setup failed: {}", err);
            }

            eprintln!(
                "[startup] setup_total_ms={:.1}",
                setup_start.elapsed().as_secs_f64() * 1000.0
            );

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == desktop_integration::MINI_WINDOW_LABEL {
                    api.prevent_close();
                    let _ = window.hide();
                    return;
                }
                if window.label() == desktop_integration::MAIN_WINDOW_LABEL {
                    api.prevent_close();
                    if desktop_integration::should_hide_main_window_on_close(window.app_handle()) {
                        let _ = window.hide();
                    } else {
                        desktop_integration::request_desktop_control_action(
                            window.app_handle(),
                            desktop_integration::DesktopControlAction::Quit,
                        );
                    }
                }
            }
        })
        .invoke_handler(move |invoke| {
            let command = invoke.message.command().to_string();
            let window_label = invoke.message.webview_ref().window().label().to_string();
            if !custom_command_allowed(&window_label, &command) {
                invoke.resolver.reject(format!(
                    "Command `{command}` is not available to window `{window_label}`"
                ));
                true
            } else {
                app_command_handler(invoke)
            }
        })
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(|_app_handle, _event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &_event {
                if code.is_none() {
                    api.prevent_exit();
                    desktop_integration::request_desktop_control_action(
                        _app_handle,
                        desktop_integration::DesktopControlAction::Quit,
                    );
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                if let Some(intents) =
                    _app_handle.try_state::<launch_intents::SharedLaunchIntents>()
                {
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            if let Err(error) =
                                launch_intents::queue_file_path(_app_handle, intents.inner(), &path)
                            {
                                eprintln!("Ignored macOS file-open request: {}", error);
                            }
                        }
                    }
                }
            }
        }),
        Err(error) => eprintln!("error while building Tauri application: {}", error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Cursor;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tarab-lib-{}-{}", name, nonce));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn log_file_preflight_accepts_a_writable_path() {
        let root = temp_dir("log-preflight");
        let path = root.join("Tarab.log");

        assert!(ensure_log_file_access(&path).is_ok());
        assert!(path.is_file());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cover_art_protocol_parses_hash_from_host_or_path() {
        let hash = "a".repeat(64);
        let host_uri: http::Uri = format!("cover-art://{}/large", hash)
            .parse()
            .expect("host URI");
        let path_uri: http::Uri = format!("cover-art://localhost/{}/small", hash)
            .parse()
            .expect("path URI");

        assert_eq!(
            parse_cover_art_request(&host_uri),
            Some((hash.as_str(), "large"))
        );
        assert_eq!(
            parse_cover_art_request(&path_uri),
            Some((hash.as_str(), "small"))
        );
    }

    #[test]
    fn selected_artwork_sniffs_webp_and_roundtrips_its_bytes() {
        use base64::Engine;
        use image::{DynamicImage, ImageFormat};

        let root = temp_dir("webp-roundtrip");
        let file = root.join("misleading-name.jpg");
        let mut encoded = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(2, 2)
            .write_to(&mut encoded, ImageFormat::WebP)
            .expect("encode WebP");
        let original = encoded.into_inner();
        fs::write(&file, &original).expect("write image");

        let selected = read_selected_artwork(&file).expect("read selected artwork");

        assert_eq!(selected.mime, "image/webp");
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(selected.base64)
                .expect("decode selected artwork"),
            original
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn selected_artwork_rejects_an_unsupported_image_format() {
        let root = temp_dir("unsupported-image");
        let file = root.join("cover.jpg");
        fs::write(
            &file,
            b"GIF89a\x01\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00",
        )
        .expect("write image");

        let error = read_selected_artwork(&file).expect_err("reject unsupported image");

        assert!(error.contains("JPEG, PNG, or WebP"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn selected_artwork_rejects_oversized_file() {
        let root = temp_dir("oversized");
        let file = root.join("cover.png");
        let handle = fs::File::create(&file).expect("create file");
        handle
            .set_len(image_cache::MAX_ENCODED_IMAGE_BYTES as u64 + 1)
            .expect("set oversized length");

        let result = read_selected_artwork(&file);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too large"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn custom_command_routing_only_grants_the_mini_bridge_to_the_mini_window() {
        assert!(custom_command_allowed(
            desktop_integration::MAIN_WINDOW_LABEL,
            "play_track"
        ));
        assert!(custom_command_allowed(
            desktop_integration::MAIN_WINDOW_LABEL,
            "pick_cover_art"
        ));
        for command in MINI_PLAYER_COMMANDS {
            assert!(custom_command_allowed(
                desktop_integration::MINI_WINDOW_LABEL,
                command
            ));
            assert!(!custom_command_allowed(
                desktop_integration::MAIN_WINDOW_LABEL,
                command
            ));
        }

        for command in [
            "desktop_quit_application",
            "desktop_mark_renderer_ready",
            "play_track",
            "pick_cover_art",
            "revoke_launch_file_authority",
            "reveal_playlists_data_folder",
            "desktop_mini_control_spoof",
        ] {
            assert!(!custom_command_allowed(
                desktop_integration::MINI_WINDOW_LABEL,
                command
            ));
        }
        assert!(!custom_command_allowed(
            "unknown-window",
            "desktop_mini_control"
        ));
    }
}
