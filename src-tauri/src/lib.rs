mod audio;
mod database;
mod desktop_integration;
mod file_ops;
mod fixed_store;
mod image_cache;
mod launch_intents;
mod library;
mod library_watcher;
mod lyrics;
#[cfg(target_os = "macos")]
mod macos_menu;
mod media_controls;
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
use file_ops::{ensure_existing_path_allowed, load_library_roots_state, SharedLibraryRoots};
use image_cache::{
    create_image_cache, is_valid_thumbnail_hash, is_valid_thumbnail_size, SharedImageCache,
};
use std::path::Path;
use std::time::Instant;
use tauri::http;
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use waveform::{create_waveform_generator, SharedWaveformGenerator};

const MAX_IMAGE_READ_BYTES: u64 = 25 * 1024 * 1024;

fn custom_command_allowed(window_label: &str) -> bool {
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

#[tauri::command]
fn read_image_as_base64(
    file_path: String,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<(String, String), String> {
    let roots = roots_state.read().roots.clone();
    read_image_as_base64_checked(&file_path, &roots)
}

fn read_image_as_base64_checked(
    file_path: &str,
    roots: &[std::path::PathBuf],
) -> Result<(String, String), String> {
    use std::fs;

    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("Image file does not exist: {}", file_path));
    }

    let canonical = ensure_existing_path_allowed(path, roots, "read image file")?;

    let metadata =
        fs::metadata(&canonical).map_err(|e| format!("Failed to read image metadata: {}", e))?;
    if metadata.len() > MAX_IMAGE_READ_BYTES {
        return Err(format!(
            "Image file is too large: {} bytes exceeds {} byte limit",
            metadata.len(),
            MAX_IMAGE_READ_BYTES
        ));
    }

    let mime = match canonical
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("webp") => "image/webp",
        Some(other) => return Err(format!("Unsupported image extension: {}", other)),
        None => return Err("Image file has no extension".to_string()),
    };

    let data = fs::read(&canonical).map_err(|e| format!("Failed to read file: {}", e))?;

    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&data);

    Ok((encoded, mime.to_string()))
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
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // When a second instance is launched, focus the existing main window
            if let Some(window) = app.get_webview_window(desktop_integration::MAIN_WINDOW_LABEL) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            if let Some(intents) = app.try_state::<launch_intents::SharedLaunchIntents>() {
                launch_intents::queue_cli_arguments(app, intents.inner(), &argv);
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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_log::Builder::default().build())
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
        playlist::get_playlists_data_path,
        // Tag editor commands
        tageditor::read_full_tags,
        tageditor::write_tags,
        tageditor::write_tags_batch,
        tageditor::remove_cover_art,
        // Database commands
        database::db_get_all_tracks,
        database::db_get_tracks_by_ids,
        database::db_get_track_by_public_id,
        database::db_get_tracks_by_album_artist,
        database::db_get_tracks_by_artist,
        database::db_get_album_aggregates,
        database::db_get_artist_aggregates,
        database::db_get_tracks_paginated,
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
        file_ops::restore_trashed_files,
        file_ops::delete_files,
        file_ops::reveal_in_file_manager,
        file_ops::list_library_grants,
        file_ops::get_library_health,
        file_ops::select_library_folder,
        file_ops::reauthorize_library_grant,
        file_ops::revoke_library_grant,
        launch_intents::list_launch_file_intents,
        launch_intents::resolve_launch_file_intent,
        // File dialogs
        read_image_as_base64,
        get_initial_deep_links,
        // Session
        session::load_playback_session,
        session::save_playback_session,
        audio::list_audio_output_devices,
        audio::set_audio_output_device,
        audio::preload_next_track,
        // Desktop integration commands
        desktop_integration::desktop_open_mini_window,
        desktop_integration::desktop_close_mini_window,
        desktop_integration::desktop_toggle_mini_window,
        desktop_integration::desktop_focus_main_window,
        desktop_integration::desktop_quit_application,
        desktop_integration::desktop_set_native_ui_state,
        desktop_integration::desktop_sync_media_session,
        media_controls::update_media_metadata,
        library_watcher::watch_library_paths,
        #[cfg(target_os = "windows")]
        taskbar::update_progress,
        #[cfg(target_os = "windows")]
        taskbar::clear_progress,
    ];

    let app = builder
        .setup(move |app| {
            let setup_start = Instant::now();
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
            app.manage(library_roots);

            let launch_intents = launch_intents::create_launch_intent_state();
            let startup_arguments: Vec<String> = std::env::args().collect();
            launch_intents::queue_cli_arguments(app.handle(), &launch_intents, &startup_arguments);
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

            {
                let media_start = Instant::now();
                if let Ok(smtc_state) = media_controls::init_souvlaki(app.handle()) {
                    app.manage(smtc_state);
                }
                eprintln!(
                    "[startup] media_controls_init_ms={:.1}",
                    media_start.elapsed().as_secs_f64() * 1000.0
                );
            }

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
            if window.label() != desktop_integration::MAIN_WINDOW_LABEL {
                return;
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if desktop_integration::should_hide_main_window_on_close(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(move |invoke| {
            let command = invoke.message.command().to_string();
            let window_label = invoke.message.webview_ref().window().label().to_string();
            if !custom_command_allowed(&window_label) {
                invoke.resolver.reject(format!(
                    "Command `{command}` is only available to the main window"
                ));
                true
            } else {
                app_command_handler(invoke)
            }
        })
        .build(tauri::generate_context!());

    match app {
        Ok(app) => app.run(|_app_handle, _event| {
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
    fn image_read_rejects_outside_root() {
        let allowed_root = temp_dir("allowed");
        let outside_root = temp_dir("outside");
        let outside_file = outside_root.join("cover.png");
        fs::write(&outside_file, b"png").expect("write outside");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = read_image_as_base64_checked(&outside_file.to_string_lossy(), &roots);

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("outside configured library roots"));

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn image_read_rejects_unsupported_extension() {
        let allowed_root = temp_dir("unsupported");
        let file = allowed_root.join("cover.txt");
        fs::write(&file, b"not image").expect("write file");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = read_image_as_base64_checked(&file.to_string_lossy(), &roots);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported image extension"));

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[test]
    fn image_read_rejects_oversized_file() {
        let allowed_root = temp_dir("oversized");
        let file = allowed_root.join("cover.png");
        let handle = fs::File::create(&file).expect("create file");
        handle
            .set_len(MAX_IMAGE_READ_BYTES + 1)
            .expect("set oversized length");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = read_image_as_base64_checked(&file.to_string_lossy(), &roots);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too large"));

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[test]
    fn custom_commands_are_restricted_to_the_main_window() {
        assert!(custom_command_allowed(
            desktop_integration::MAIN_WINDOW_LABEL
        ));
        assert!(!custom_command_allowed(
            desktop_integration::MINI_WINDOW_LABEL
        ));
        assert!(!custom_command_allowed("unknown-window"));
    }
}
