use rayon::prelude::*;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

use crate::file_ops::{ensure_existing_path_allowed, SharedLibraryRoots};

pub const SUPPORTED_EXTENSIONS: [&str; 9] = [
    "mp3", "flac", "wav", "ogg", "m4a", "aac", "aiff", "alac", "wma",
];
const MAX_SCAN_DEPTH: usize = 64;
const MAX_SCAN_ENTRIES: usize = 1_000_000;
const MAX_SCAN_AUDIO_BYTES: u64 = 10 * 1024 * 1024 * 1024 * 1024;
const SCAN_PATH_CHUNK_SIZE: usize = 500;
const SCAN_PATH_CHUNK_EVENT: &str = "library-scan-path-chunk";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryScanPathChunk {
    scan_id: String,
    paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScanStreamSummary {
    scan_id: String,
    path_count: usize,
}

pub type SharedLibraryScanControl = Arc<AtomicBool>;

pub fn create_library_scan_control() -> SharedLibraryScanControl {
    Arc::new(AtomicBool::new(false))
}

#[cfg(windows)]
fn normalize_library_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(not(windows))]
fn normalize_library_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn ensure_scan_folder_allowed(folder_path: &str, roots: &[PathBuf]) -> Result<(), String> {
    let path = Path::new(folder_path);

    if !path.exists() {
        return Err(format!("Folder does not exist: {}", folder_path));
    }

    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", folder_path));
    }

    ensure_existing_path_allowed(path, roots, "scan library folder")?;
    Ok(())
}

fn is_supported_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn is_allowed_scan_file(path: &Path, roots: &[PathBuf]) -> bool {
    match ensure_existing_path_allowed(path, roots, "scan library file") {
        Ok(_) => true,
        Err(err) => {
            eprintln!("Skipped library file during scan: {}", err);
            false
        }
    }
}

fn collect_audio_files(
    folder_path: &str,
    follow_links: bool,
    roots: &[PathBuf],
    force_parallel: bool,
    cancelled: &AtomicBool,
) -> Result<Vec<String>, String> {
    ensure_scan_folder_allowed(folder_path, roots)?;
    let path = Path::new(folder_path);

    let mut entries = Vec::new();
    let mut visited_entries = 0_usize;
    let mut audio_bytes = 0_u64;
    for entry in WalkDir::new(path)
        .max_depth(MAX_SCAN_DEPTH)
        .follow_links(follow_links)
        .into_iter()
    {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Library scan cancelled before traversal completed".to_string());
        }
        let entry = entry.map_err(|error| format!("Library traversal is incomplete: {}", error))?;
        visited_entries += 1;
        if visited_entries > MAX_SCAN_ENTRIES {
            return Err(format!(
                "Library scan exceeded the {} entry limit",
                MAX_SCAN_ENTRIES
            ));
        }
        if entry.file_type().is_dir() && entry.depth() == MAX_SCAN_DEPTH {
            return Err(format!(
                "Library scan exceeded the {} level depth limit",
                MAX_SCAN_DEPTH
            ));
        }
        if !entry.file_type().is_file() {
            continue;
        }
        if is_supported_audio_path(entry.path()) {
            let bytes = entry
                .metadata()
                .map_err(|error| format!("Failed to inspect audio file: {}", error))?
                .len();
            audio_bytes = audio_bytes.saturating_add(bytes);
            if audio_bytes > MAX_SCAN_AUDIO_BYTES {
                return Err("Library scan exceeded the total audio byte limit".to_string());
            }
        }
        entries.push(entry);
    }

    let include_entry = |entry: &walkdir::DirEntry| {
        is_supported_audio_path(entry.path()) && is_allowed_scan_file(entry.path(), roots)
    };

    let files = if force_parallel || entries.len() >= 1_500 {
        entries
            .par_iter()
            .filter(|entry| include_entry(entry))
            .map(|entry| normalize_library_path(entry.path()))
            .collect()
    } else {
        entries
            .iter()
            .filter(|entry| include_entry(entry))
            .map(|entry| normalize_library_path(entry.path()))
            .collect()
    };

    Ok(files)
}

fn validate_scan_id(scan_id: &str) -> Result<(), String> {
    if scan_id.is_empty()
        || scan_id.len() > 64
        || !scan_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("scanId must contain 1 to 64 safe characters".to_string());
    }
    Ok(())
}

fn emit_scan_paths(
    app: &AppHandle,
    scan_id: String,
    paths: Vec<String>,
) -> Result<LibraryScanStreamSummary, String> {
    let path_count = paths.len();
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is not available for scan results".to_string())?;
    for chunk in paths.chunks(SCAN_PATH_CHUNK_SIZE) {
        main.emit(
            SCAN_PATH_CHUNK_EVENT,
            LibraryScanPathChunk {
                scan_id: scan_id.clone(),
                paths: chunk.to_vec(),
            },
        )
        .map_err(|error| format!("Failed to stream library scan results: {error}"))?;
    }
    Ok(LibraryScanStreamSummary {
        scan_id,
        path_count,
    })
}

#[tauri::command]
pub async fn scan_library(
    app: AppHandle,
    scan_id: String,
    folder_path: String,
    follow_links: Option<bool>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
    scan_control: tauri::State<'_, SharedLibraryScanControl>,
) -> Result<LibraryScanStreamSummary, String> {
    validate_scan_id(&scan_id)?;
    let roots = roots_state.inner().read().roots.clone();
    let scan_control = scan_control.inner().clone();
    scan_control.store(false, Ordering::Relaxed);
    let paths = spawn_blocking(move || {
        collect_audio_files(
            &folder_path,
            follow_links.unwrap_or(false),
            &roots,
            false,
            &scan_control,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    emit_scan_paths(&app, scan_id, paths)
}

#[tauri::command]
pub async fn scan_library_parallel(
    app: AppHandle,
    scan_id: String,
    folder_path: String,
    follow_links: Option<bool>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
    scan_control: tauri::State<'_, SharedLibraryScanControl>,
) -> Result<LibraryScanStreamSummary, String> {
    validate_scan_id(&scan_id)?;
    let roots = roots_state.inner().read().roots.clone();
    let scan_control = scan_control.inner().clone();
    scan_control.store(false, Ordering::Relaxed);
    let paths = spawn_blocking(move || {
        collect_audio_files(
            &folder_path,
            follow_links.unwrap_or(false),
            &roots,
            true,
            &scan_control,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    emit_scan_paths(&app, scan_id, paths)
}

#[tauri::command]
pub fn cancel_library_scan(scan_control: tauri::State<'_, SharedLibraryScanControl>) {
    scan_control.store(true, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tarab-library-{}-{}", name, nonce));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn scan_rejects_folders_outside_library_roots() {
        let allowed_root = temp_dir("allowed");
        let outside_root = temp_dir("outside");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = collect_audio_files(
            &outside_root.to_string_lossy(),
            false,
            &roots,
            false,
            &AtomicBool::new(false),
        );

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("outside configured library roots"));

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn scan_stream_ids_reject_event_name_injection() {
        assert!(validate_scan_id("scan-0123_abcd").is_ok());
        assert!(validate_scan_id("").is_err());
        assert!(validate_scan_id("../scan").is_err());
        assert!(validate_scan_id("scan:event").is_err());
        assert!(validate_scan_id(&"a".repeat(65)).is_err());
        assert_eq!(SCAN_PATH_CHUNK_SIZE, 500);
    }

    #[test]
    fn scan_returns_supported_files_inside_library_roots() {
        let allowed_root = temp_dir("allowed");
        let track = allowed_root.join("track.mp3");
        let ignored = allowed_root.join("cover.jpg");
        fs::write(&track, b"not audio").expect("write track");
        fs::write(&ignored, b"not audio").expect("write ignored");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let files = collect_audio_files(
            &allowed_root.to_string_lossy(),
            false,
            &roots,
            false,
            &AtomicBool::new(false),
        )
        .expect("scan allowed root");

        assert_eq!(files, vec![track.to_string_lossy().replace('\\', "/")]);

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[test]
    fn cancelled_scan_returns_before_reconciliation_input_is_created() {
        let allowed_root = temp_dir("cancelled");
        fs::write(allowed_root.join("track.mp3"), b"not audio").expect("write track");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let cancelled = AtomicBool::new(true);

        let result = collect_audio_files(
            &allowed_root.to_string_lossy(),
            false,
            &roots,
            false,
            &cancelled,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cancelled"));
        let _ = fs::remove_dir_all(allowed_root);
    }
}
