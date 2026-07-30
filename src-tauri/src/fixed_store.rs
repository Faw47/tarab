use parking_lot::Mutex;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::async_runtime::spawn_blocking;

use crate::database::get_app_data_dir;

pub type SharedFixedStore = Arc<Mutex<()>>;

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

fn read_store(path: &Path) -> Result<Map<String, Value>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<Map<String, Value>>(&bytes)
            .map_err(|error| format!("Failed to parse store: {}", error)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(error) => Err(format!("Failed to read store: {}", error)),
    }
}

fn write_store(path: &Path, values: &Map<String, Value>) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Store path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create store folder: {}", error))?;
    let temporary = path.with_extension("tmp");
    let bytes =
        serde_json::to_vec(values).map_err(|error| format!("Failed to encode store: {}", error))?;
    fs::write(&temporary, bytes).map_err(|error| format!("Failed to write store: {}", error))?;
    #[cfg(not(windows))]
    {
        fs::rename(&temporary, path).map_err(|error| format!("Failed to replace store: {}", error))
    }
    #[cfg(windows)]
    {
        let backup = path.with_extension("bak");
        if path.exists() {
            let _ = fs::remove_file(&backup);
            fs::rename(path, &backup)
                .map_err(|error| format!("Failed to prepare store replacement: {}", error))?;
        }
        match fs::rename(&temporary, path) {
            Ok(()) => {
                let _ = fs::remove_file(backup);
                Ok(())
            }
            Err(error) => {
                let _ = fs::rename(&backup, path);
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
}
