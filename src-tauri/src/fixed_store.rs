use parking_lot::Mutex;
use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::async_runtime::spawn_blocking;

use crate::database::get_app_data_dir;

pub type SharedFixedStore = Arc<Mutex<()>>;
const MAX_FIXED_STORE_BYTES: u64 = 16 * 1024 * 1024;

pub fn create_fixed_store() -> SharedFixedStore {
    Arc::new(Mutex::new(()))
}

fn store_path(store: &str) -> Result<PathBuf, String> {
    let name = match store {
        "settings" => "settings.json",
        "player" => "tarab-player.dat",
        _ => return Err("Unsupported store".to_string()),
    };
    Ok(get_app_data_dir()?.join(name))
}

fn read_store_candidate(path: &Path) -> Result<Map<String, Value>, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("Failed to inspect store: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Store is not a regular file".to_string());
    }
    if metadata.len() > MAX_FIXED_STORE_BYTES {
        return Err("Store exceeds the size limit".to_string());
    }
    let bytes = fs::read(path).map_err(|error| format!("Failed to read store: {error}"))?;
    serde_json::from_slice::<Map<String, Value>>(&bytes)
        .map_err(|error| format!("Failed to parse store: {error}"))
}

fn read_store(path: &Path) -> Result<Map<String, Value>, String> {
    let primary_missing = matches!(
        fs::symlink_metadata(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound
    );
    match read_store_candidate(path) {
        Ok(values) => Ok(values),
        Err(primary_error) => {
            let mut fallback_error = None;
            for fallback in [path.with_extension("bak"), path.with_extension("tmp")] {
                match read_store_candidate(&fallback) {
                    Ok(values) => return Ok(values),
                    Err(error) if fs::symlink_metadata(&fallback).is_ok() => {
                        fallback_error = Some(error);
                    }
                    Err(_) => {}
                }
            }
            if primary_missing {
                fallback_error.map_or_else(|| Ok(Map::new()), Err)
            } else {
                Err(primary_error)
            }
        }
    }
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
    }
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) {}

fn write_store(path: &Path, values: &Map<String, Value>) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Store path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create store folder: {}", error))?;
    let temporary = path.with_extension("tmp");
    let bytes =
        serde_json::to_vec(values).map_err(|error| format!("Failed to encode store: {}", error))?;
    if bytes.len() as u64 > MAX_FIXED_STORE_BYTES {
        return Err("Store exceeds the size limit".to_string());
    }
    if let Ok(metadata) = fs::symlink_metadata(&temporary) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Temporary store is not a regular file".to_string());
        }
    }
    let mut temporary_file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&temporary)
        .map_err(|error| format!("Failed to create temporary store: {error}"))?;
    let write_result = temporary_file
        .write_all(&bytes)
        .map_err(|error| format!("Failed to write store: {error}"))
        .and_then(|_| {
            temporary_file
                .sync_all()
                .map_err(|error| format!("Failed to sync store: {error}"))
        });
    drop(temporary_file);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    #[cfg(not(windows))]
    {
        fs::rename(&temporary, path)
            .map_err(|error| format!("Failed to replace store: {}", error))?;
        let _ = fs::remove_file(path.with_extension("bak"));
        sync_parent_directory(path);
        Ok(())
    }
    #[cfg(windows)]
    {
        let backup = path.with_extension("bak");
        let had_existing = fs::symlink_metadata(path).is_ok();
        let existing_is_valid = had_existing && read_store_candidate(path).is_ok();
        let mut staged_existing = false;
        if existing_is_valid {
            let _ = fs::remove_file(&backup);
            if let Err(error) = fs::rename(path, &backup) {
                let _ = fs::remove_file(&temporary);
                return Err(format!("Failed to prepare store replacement: {error}"));
            }
            staged_existing = true;
        } else if had_existing {
            if let Err(error) = fs::remove_file(path) {
                let _ = fs::remove_file(&temporary);
                return Err(format!("Failed to remove invalid store: {error}"));
            }
        }
        match fs::rename(&temporary, path) {
            Ok(()) => {
                let _ = fs::remove_file(backup);
                sync_parent_directory(path);
                Ok(())
            }
            Err(error) => {
                if staged_existing {
                    let _ = fs::rename(&backup, path);
                }
                Err(format!("Failed to replace store: {}", error))
            }
        }
    }
}

#[tauri::command]
pub async fn fixed_store_get(
    store: String,
    key: String,
    state: tauri::State<'_, SharedFixedStore>,
) -> Result<Option<Value>, String> {
    let state = state.inner().clone();
    spawn_blocking(move || {
        let _guard = state.lock();
        Ok(read_store(&store_path(&store)?)?.remove(&key))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn fixed_store_set(
    store: String,
    key: String,
    value: Value,
    state: tauri::State<'_, SharedFixedStore>,
) -> Result<(), String> {
    let state = state.inner().clone();
    spawn_blocking(move || {
        let _guard = state.lock();
        let path = store_path(&store)?;
        let mut values = read_store(&path)?;
        values.insert(key, value);
        write_store(&path, &values)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn fixed_store_remove(
    store: String,
    key: String,
    state: tauri::State<'_, SharedFixedStore>,
) -> Result<(), String> {
    let state = state.inner().clone();
    spawn_blocking(move || {
        let _guard = state.lock();
        let path = store_path(&store)?;
        let mut values = read_store(&path)?;
        values.remove(&key);
        write_store(&path, &values)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn fixed_store_round_trip_uses_atomic_file() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("tarab-fixed-store-{}", nonce));
        let path = root.join("settings.json");
        let mut values = Map::new();
        values.insert(
            "settings".to_string(),
            serde_json::json!({ "theme": "default" }),
        );

        write_store(&path, &values).expect("write store");
        let restored = read_store(&path).expect("read store");

        assert_eq!(restored, values);
        assert!(!path.with_extension("tmp").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fixed_store_recovers_from_backup_when_primary_is_missing() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("tarab-fixed-store-backup-{nonce}"));
        fs::create_dir_all(&root).expect("create root");
        let path = root.join("settings.json");
        let backup = path.with_extension("bak");
        fs::write(&backup, br#"{"settings":{"theme":"liquid-glass"}}"#).expect("write backup");

        let restored = read_store(&path).expect("read backup");

        assert_eq!(restored["settings"]["theme"], "liquid-glass");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fixed_store_reports_a_corrupt_backup_instead_of_resetting_state() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("tarab-fixed-store-corrupt-{nonce}"));
        fs::create_dir_all(&root).expect("create root");
        let path = root.join("settings.json");
        fs::write(path.with_extension("bak"), b"not json").expect("write corrupt backup");

        let error = read_store(&path).expect_err("reject corrupt recovery data");

        assert!(error.contains("Failed to parse store"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fixed_store_replaces_a_corrupt_primary_using_recovered_state() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("tarab-fixed-store-rewrite-{nonce}"));
        fs::create_dir_all(&root).expect("create root");
        let path = root.join("settings.json");
        fs::write(&path, b"not json").expect("write corrupt primary");
        fs::write(
            path.with_extension("bak"),
            br#"{"settings":{"theme":"default"}}"#,
        )
        .expect("write backup");
        let mut recovered = read_store(&path).expect("recover state");
        recovered.insert("language".to_string(), serde_json::json!("en"));

        write_store(&path, &recovered).expect("rewrite recovered state");

        assert_eq!(read_store(&path).expect("read rewritten store"), recovered);
        assert!(!path.with_extension("bak").exists());
        let _ = fs::remove_dir_all(root);
    }
}
