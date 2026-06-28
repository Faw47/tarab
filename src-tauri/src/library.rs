use rayon::prelude::*;
use std::path::Path;
use tauri::async_runtime::spawn_blocking;
use walkdir::WalkDir;

pub const SUPPORTED_EXTENSIONS: [&str; 9] = [
    "mp3", "flac", "wav", "ogg", "m4a", "aac", "aiff", "alac", "wma",
];

#[tauri::command]
pub async fn scan_library(
    folder_path: String,
    follow_links: Option<bool>,
) -> Result<Vec<String>, String> {
    spawn_blocking(move || {
        let path = Path::new(&folder_path);
        let follow_links = follow_links.unwrap_or(false);

        if !path.exists() {
            return Err(format!("Folder does not exist: {}", folder_path));
        }

        if !path.is_dir() {
            return Err(format!("Path is not a directory: {}", folder_path));
        }

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

        let files: Vec<String> = if entries.len() >= 1_500 {
            entries
                .par_iter()
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
                        .unwrap_or(false)
                })
                .map(|entry| entry.path().to_string_lossy().replace('\\', "/"))
                .collect()
        } else {
            entries
                .iter()
                .filter(|entry| {
                    entry
                        .path()
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
                        .unwrap_or(false)
                })
                .map(|entry| entry.path().to_string_lossy().replace('\\', "/"))
                .collect()
        };

        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scan_library_parallel(
    folder_path: String,
    follow_links: Option<bool>,
) -> Result<Vec<String>, String> {
    spawn_blocking(move || {
        let path = Path::new(&folder_path);
        let follow_links = follow_links.unwrap_or(false);

        if !path.exists() {
            return Err(format!("Folder does not exist: {}", folder_path));
        }

        if !path.is_dir() {
            return Err(format!("Path is not a directory: {}", folder_path));
        }

        let entries: Vec<_> = WalkDir::new(path)
            .follow_links(follow_links)
            .into_iter()
            .filter_map(|entry| match entry {
                Ok(entry) => Some(entry),
                Err(err) => {
                    eprintln!("Skipped library entry during parallel scan: {}", err);
                    None
                }
            })
            .filter(|entry| entry.file_type().is_file())
            .collect();

        let files: Vec<String> = entries
            .par_iter()
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
                    .unwrap_or(false)
            })
            .map(|entry| entry.path().to_string_lossy().replace('\\', "/"))
            .collect();

        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}
