use parking_lot::Mutex;
use serde_json::{Map, Value};
use std::fs;
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::async_runtime::spawn_blocking;

use crate::database::get_app_data_dir;
use crate::file_ops::replace_file_atomically;

// Large enough for long-path queues, while bounding disk reads and encoded writes.
const MAX_FIXED_STORE_BYTES: u64 = 64 * 1024 * 1024;

pub type SharedFixedStore = Arc<Mutex<()>>;

pub fn create_fixed_store() -> SharedFixedStore {
    Arc::new(Mutex::new(()))
}

fn store_path(store: &str) -> Result<PathBuf, String> {
    let name = match store {
        "settings" => "settings.json",
        "player" => "tarab-player.dat",
        // The queue has its own file so frequent position saves do not rewrite it.
        "player-queue" => "tarab-player-queue.dat",
        _ => return Err("Unsupported store".to_string()),
    };
    Ok(get_app_data_dir()?.join(name))
}

fn read_store_file(path: &Path) -> Result<Option<Map<String, Value>>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to read store: {}", error)),
    };
    let metadata = file
        .metadata()
        .map_err(|error| format!("Failed to inspect store: {}", error))?;
    if !metadata.is_file() || metadata.len() > MAX_FIXED_STORE_BYTES {
        return Err("Store is not a regular file or exceeds the size limit".to_string());
    }
    let mut bytes = Vec::new();
    // Bound the actual read as well: the file can grow after metadata was checked.
    file.take(MAX_FIXED_STORE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Failed to read store: {}", error))?;
    if bytes.len() as u64 > MAX_FIXED_STORE_BYTES {
        return Err("Store exceeds the size limit".to_string());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| format!("Failed to parse store: {}", error))
}

fn read_store(path: &Path) -> Result<Map<String, Value>, String> {
    if let Some(values) = read_store_file(path)? {
        return Ok(values);
    }
    // Older Windows builds moved the primary to .bak before replacement. A crash in
    // that gap must not turn a recoverable session into an empty store.
    Ok(read_store_file(&path.with_extension("bak"))?.unwrap_or_default())
}

fn read_auto_lyrics_setting(path: &Path) -> Result<bool, String> {
    // Recovery data must never resurrect stale permission to transmit track metadata.
    let values = read_store_file(path)?.unwrap_or_default();
    Ok(values
        .get("tarab-settings")
        .and_then(|value| value.get("state"))
        .and_then(|value| value.get("autoLyrics"))
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

/// Read native persisted consent under the same lock as settings writes.
pub(crate) async fn auto_lyrics_enabled(state: &SharedFixedStore) -> Result<bool, String> {
    let state = state.clone();
    spawn_blocking(move || {
        let _guard = state.lock();
        read_auto_lyrics_setting(&store_path("settings")?)
    })
    .await
    .map_err(|error| error.to_string())?
}

struct StoreWriter {
    file: fs::File,
    written: u64,
}

impl Write for StoreWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() as u64 > MAX_FIXED_STORE_BYTES - self.written {
            return Err(std::io::Error::other("Store exceeds the size limit"));
        }
        let written = self.file.write(bytes)?;
        self.written += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}

fn write_store(path: &Path, values: &Map<String, Value>) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Store path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create store folder: {}", error))?;
    replace_file_atomically(path, false, |temporary| {
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(temporary)
            .map_err(|error| format!("Failed to stage store: {}", error))?;
        let mut writer = BufWriter::new(StoreWriter { file, written: 0 });
        serde_json::to_writer(&mut writer, values)
            .map_err(|error| format!("Failed to encode store: {}", error))?;
        writer
            .flush()
            .map_err(|error| format!("Failed to write store: {}", error))?;
        // The shared replacement helper syncs this staged file before renaming over the
        // original on every platform. The original never moves out of the way first.
        Ok(())
    })
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

    fn temp_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("tarab-store-{}-{}", name, nonce));
        fs::create_dir_all(&root).expect("create directory");
        root
    }

    #[test]
    fn missing_primary_settings_does_not_restore_backup_consent() {
        let root = temp_root("stale-lyrics-consent");
        let path = root.join("settings.json");
        let settings = Map::from_iter([(
            "tarab-settings".into(),
            serde_json::json!({"state": {"autoLyrics": true}}),
        )]);
        write_store(&path.with_extension("bak"), &settings).expect("stale enabled backup");
        assert!(!read_auto_lyrics_setting(&path).expect("missing primary fails closed"));
        assert_eq!(
            read_store(&path).expect("ordinary recovery remains"),
            settings
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn online_lyrics_requires_a_persisted_boolean_opt_in() {
        let root = temp_root("lyrics-consent");
        let path = root.join("settings.json");
        assert!(!read_auto_lyrics_setting(&path).expect("missing settings"));
        for (value, enabled) in [
            (serde_json::json!({}), false),
            (serde_json::json!({"autoLyrics": true}), false),
            (serde_json::json!({"state": {"autoLyrics": true}}), true),
            (serde_json::json!({"state": {"autoLyrics": false}}), false),
            (serde_json::json!({"state": {"autoLyrics": "true"}}), false),
            (serde_json::json!({"state": {"autoLyrics": 1}}), false),
            (serde_json::json!({"state": {"autoLyrics": null}}), false),
        ] {
            write_store(&path, &Map::from_iter([("tarab-settings".into(), value)]))
                .expect("settings fixture");
            assert_eq!(
                read_auto_lyrics_setting(&path).expect("read consent"),
                enabled
            );
        }
        fs::write(&path, b"broken").expect("corrupt settings");
        assert!(read_auto_lyrics_setting(&path).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn oversized_read_is_rejected_before_parsing() {
        let root = temp_root("oversize-read");
        let path = root.join("settings.json");
        // Whitespace is valid after JSON, so the old unbounded reader accepts this file.
        let mut bytes = b"{}".to_vec();
        bytes.resize(64 * 1024 * 1024 + 1, b' ');
        fs::write(&path, bytes).expect("write oversized store");
        assert!(read_store(&path).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn oversized_write_keeps_the_previous_store() {
        let root = temp_root("oversize-write");
        let path = root.join("settings.json");
        let original = Map::from_iter([("theme".to_string(), Value::from("dark"))]);
        write_store(&path, &original).expect("write original");
        let too_large = Map::from_iter([(
            "large".to_string(),
            Value::from("x".repeat(64 * 1024 * 1024)),
        )]);
        assert!(write_store(&path, &too_large).is_err());
        assert_eq!(read_store(&path).expect("read previous"), original);
        assert_eq!(fs::read_dir(&root).expect("list directory").count(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_primary_recovers_the_legacy_windows_backup() {
        let root = temp_root("backup");
        let path = root.join("tarab-player.dat");
        fs::write(path.with_extension("bak"), br#"{"position":42}"#).expect("write backup");
        assert_eq!(read_store(&path).expect("recover backup")["position"], 42);
        assert!(!path.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn replacement_failure_preserves_the_target_and_cleans_staging() {
        let root = temp_root("replace-failure");
        let path = root.join("settings.json");
        fs::create_dir(&path).expect("create conflicting directory");
        fs::write(path.join("keep"), b"original").expect("write original");
        assert!(write_store(&path, &Map::new()).is_err());
        assert_eq!(
            fs::read(path.join("keep")).expect("read original"),
            b"original"
        );
        assert_eq!(fs::read_dir(&root).expect("list directory").count(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn overwrite_replaces_an_existing_regular_store() {
        let root = temp_root("overwrite");
        let path = root.join("settings.json");
        let original = Map::from_iter([("theme".to_string(), Value::from("dark"))]);
        let updated = Map::from_iter([("theme".to_string(), Value::from("light"))]);
        write_store(&path, &original).expect("write original");
        write_store(&path, &updated).expect("replace original");
        assert_eq!(read_store(&path).expect("read replacement"), updated);
        assert_eq!(fs::read_dir(&root).expect("list directory").count(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn encoded_size_limit_counts_json_escaping() {
        let root = temp_root("escaped-size");
        let path = root.join("settings.json");
        let original = Map::from_iter([("theme".to_string(), Value::from("dark"))]);
        write_store(&path, &original).expect("write original");
        // Each NUL requires six encoded bytes, so a smaller raw value exceeds the limit.
        let values = Map::from_iter([(
            "large".to_string(),
            Value::from("\0".repeat((MAX_FIXED_STORE_BYTES / 6 + 1) as usize)),
        )]);
        assert!(write_store(&path, &values).is_err());
        assert_eq!(read_store(&path).expect("read original"), original);
        assert_eq!(fs::read_dir(&root).expect("list directory").count(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn primary_precedes_backup_and_corruption_is_reported() {
        let root = temp_root("primary");
        let path = root.join("settings.json");
        fs::write(path.with_extension("bak"), br#"{"theme":"old"}"#).expect("backup");
        fs::write(&path, br#"{"theme":"new"}"#).expect("primary");
        assert_eq!(read_store(&path).expect("prefer primary")["theme"], "new");
        fs::write(&path, b"broken").expect("corrupt primary");
        assert!(read_store(&path).is_err());
        fs::remove_file(&path).expect("remove primary");
        fs::write(path.with_extension("bak"), b"broken").expect("corrupt backup");
        assert!(read_store(&path).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn locked_regular_store_survives_replacement_failure() {
        use std::os::windows::fs::OpenOptionsExt;

        let root = temp_root("locked");
        let path = root.join("settings.json");
        let original = Map::from_iter([("theme".to_string(), Value::from("dark"))]);
        write_store(&path, &original).expect("write original");
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .expect("lock original");
        assert!(write_store(&path, &Map::new()).is_err());
        drop(lock);
        assert_eq!(read_store(&path).expect("read original"), original);
        assert_eq!(fs::read_dir(&root).expect("list directory").count(), 1);
        let _ = fs::remove_dir_all(root);
    }

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
