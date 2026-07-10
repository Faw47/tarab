use rayon::prelude::*;
use std::path::{Path, PathBuf};
use tauri::async_runtime::spawn_blocking;
use walkdir::WalkDir;

use crate::file_ops::{ensure_existing_path_allowed, SharedLibraryRoots};

pub const SUPPORTED_EXTENSIONS: [&str; 9] = [
    "mp3", "flac", "wav", "ogg", "m4a", "aac", "aiff", "alac", "wma",
];

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
) -> Result<Vec<String>, String> {
    ensure_scan_folder_allowed(folder_path, roots)?;
    let path = Path::new(folder_path);

    let entries: Vec<_> = WalkDir::new(path)
        .follow_links(follow_links)
        .into_iter()
        .filter_map(|entry| match entry {
            Ok(entry) => Some(entry),
            Err(err) => {
                eprintln!("Skipped library entry during scan: {}", err);
                None
            }
        })
        .filter(|entry| entry.file_type().is_file())
        .collect();

    let include_entry = |entry: &walkdir::DirEntry| {
        is_supported_audio_path(entry.path()) && is_allowed_scan_file(entry.path(), roots)
    };

    let files = if force_parallel || entries.len() >= 1_500 {
        entries
            .par_iter()
            .filter(|entry| include_entry(entry))
            .map(|entry| entry.path().to_string_lossy().replace('\\', "/"))
            .collect()
    } else {
        entries
            .iter()
            .filter(|entry| include_entry(entry))
            .map(|entry| entry.path().to_string_lossy().replace('\\', "/"))
            .collect()
    };

    Ok(files)
}

#[tauri::command]
pub async fn scan_library(
    folder_path: String,
    follow_links: Option<bool>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<String>, String> {
    let roots = roots_state.inner().read().roots.clone();
    spawn_blocking(move || {
        collect_audio_files(&folder_path, follow_links.unwrap_or(false), &roots, false)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scan_library_parallel(
    folder_path: String,
    follow_links: Option<bool>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<String>, String> {
    let roots = roots_state.inner().read().roots.clone();
    spawn_blocking(move || {
        collect_audio_files(&folder_path, follow_links.unwrap_or(false), &roots, true)
    })
    .await
    .map_err(|e| e.to_string())?
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

        let result = collect_audio_files(&outside_root.to_string_lossy(), false, &roots, false);

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("outside configured library roots"));

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn scan_returns_supported_files_inside_library_roots() {
        let allowed_root = temp_dir("allowed");
        let track = allowed_root.join("track.mp3");
        let ignored = allowed_root.join("cover.jpg");
        fs::write(&track, b"not audio").expect("write track");
        fs::write(&ignored, b"not audio").expect("write ignored");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let files = collect_audio_files(&allowed_root.to_string_lossy(), false, &roots, false)
            .expect("scan allowed root");

        assert_eq!(files, vec![track.to_string_lossy().replace('\\', "/")]);

        let _ = fs::remove_dir_all(allowed_root);
    }
}
