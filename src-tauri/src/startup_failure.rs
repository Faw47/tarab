//! Makes a failed launch visible. A GUI launch has no console, so a setup error that only reached
//! stderr looked like the app doing nothing.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// The database error from setup, so the failure dialog can offer a fresh library.
static DATABASE_FAILURE: OnceLock<String> = OnceLock::new();

pub fn record_database_failure(message: &str) {
    let _ = DATABASE_FAILURE.set(message.to_string());
}

/// Renames the database and its WAL/SHM side files to `*.unusable-<stamp>`, keeping them for
/// recovery, and returns the new database file name.
fn move_database_aside(database: &Path, stamp: u64) -> Result<PathBuf, String> {
    let file_name = database
        .file_name()
        .ok_or_else(|| "The database path has no file name".to_string())?
        .to_string_lossy()
        .into_owned();
    let moved = database.with_file_name(format!("{file_name}.unusable-{stamp}"));
    if database.exists() {
        fs::rename(database, &moved)
            .map_err(|error| format!("Could not rename {}: {error}", database.display()))?;
    }
    for suffix in ["-wal", "-shm"] {
        let side = database.with_file_name(format!("{file_name}{suffix}"));
        if side.exists() {
            let target = database.with_file_name(format!("{file_name}.unusable-{stamp}{suffix}"));
            fs::rename(&side, &target)
                .map_err(|error| format!("Could not rename {}: {error}", side.display()))?;
        }
    }
    Ok(moved)
}

fn write_error_log(message: &str) -> Option<PathBuf> {
    let log = crate::database::get_app_data_dir()
        .ok()?
        .join("startup-error.log");
    fs::write(&log, format!("{message}\n")).ok()?;
    Some(log)
}

fn relaunch() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    std::process::Command::new(exe)
        .args(std::env::args_os().skip(1))
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Shows why Tarab could not start. For a database failure it offers to move the database aside
/// (renamed, not deleted) and start again with an empty library.
pub fn report_build_failure(error: &str) {
    eprintln!("error while building Tauri application: {error}");
    let log = write_error_log(error);
    let log_note = log
        .map(|path| format!("\n\nDetails were saved to {}.", path.display()))
        .unwrap_or_default();

    let Some(database_error) = DATABASE_FAILURE.get() else {
        let _ = rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("Tarab could not start")
            .set_description(format!("{error}{log_note}"))
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
        return;
    };

    let start_fresh = "Start with an empty library";
    let choice = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("Tarab could not open its library")
        .set_description(format!(
            "{database_error}\n\nThe library database may be damaged, locked by another copy of \
             Tarab, or on a full or read-only disk. Tarab can rename the current database (it is \
             kept, not deleted) and start with an empty library. Your music files are not \
             changed.{log_note}"
        ))
        .set_buttons(rfd::MessageButtons::OkCancelCustom(
            start_fresh.to_string(),
            "Quit".to_string(),
        ))
        .show();
    if choice != rfd::MessageDialogResult::Custom(start_fresh.to_string()) {
        return;
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default();
    let outcome = crate::database::get_database_path()
        .and_then(|database| move_database_aside(&database, stamp))
        .and_then(|_| relaunch());
    if let Err(error) = outcome {
        let _ = rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("Tarab could not start")
            .set_description(format!("Tarab could not move the database aside: {error}"))
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moving_the_database_aside_keeps_every_file() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let dir = std::env::temp_dir().join(format!("tarab-startup-{nonce}"));
        fs::create_dir_all(&dir).expect("create dir");
        let database = dir.join("library.db");
        fs::write(&database, b"db").expect("write db");
        fs::write(dir.join("library.db-wal"), b"wal").expect("write wal");

        let moved = move_database_aside(&database, 42).expect("move aside");

        assert_eq!(moved, dir.join("library.db.unusable-42"));
        assert!(!database.exists());
        assert_eq!(fs::read(&moved).expect("moved db"), b"db");
        assert_eq!(
            fs::read(dir.join("library.db.unusable-42-wal")).expect("moved wal"),
            b"wal"
        );
        let _ = fs::remove_dir_all(dir);
    }
}
