//! Makes a failed launch visible. A GUI launch has no console, so a setup error that only reached
//! stderr looked like the app doing nothing.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static EARLY_DIAGNOSTICS: OnceLock<Mutex<Vec<(log::Level, String)>>> = OnceLock::new();

fn early_diagnostics() -> &'static Mutex<Vec<(log::Level, String)>> {
    EARLY_DIAGNOSTICS.get_or_init(|| Mutex::new(Vec::new()))
}

pub(crate) fn queue_early_diagnostic(level: log::Level, message: impl Into<String>) {
    early_diagnostics()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .push((level, message.into()));
}

fn take_early_diagnostics() -> Vec<(log::Level, String)> {
    std::mem::take(
        &mut *early_diagnostics()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
    )
}

pub(crate) fn flush_early_diagnostics() {
    for (level, message) in take_early_diagnostics() {
        log::log!(level, "{message}");
    }
}

fn startup_diagnostics_text(
    mut early: Vec<(log::Level, String)>,
    primary: (log::Level, String),
) -> String {
    early.push(primary);
    early
        .into_iter()
        .map(|(level, message)| format!("{level:?}: {message}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Whether this process is the first running copy of Tarab. Taken before the library is opened,
/// so a second launch (which the single-instance plugin hands off) never runs migrations or the
/// database-failure dialog against a library the first copy is using.
pub enum InstanceLock {
    /// Holds the locked file; the OS lock lasts as long as the handle.
    Primary(#[allow(dead_code)] Option<fs::File>),
    Secondary,
}

impl InstanceLock {
    pub fn is_primary(&self) -> bool {
        matches!(self, InstanceLock::Primary(_))
    }
}

pub fn acquire_instance_lock() -> InstanceLock {
    let Ok(dir) = crate::database::app_data_dir_for_instance_lock() else {
        return InstanceLock::Primary(None);
    };
    let instance = acquire_lock_file(&dir.join("instance.lock"));
    if instance.is_primary() {
        if let Err(error) = crate::database::get_app_data_dir() {
            queue_early_diagnostic(
                log::Level::Error,
                format!("Failed to prepare Tarab data directory before startup: {error}"),
            );
        }
    }
    instance
}

fn acquire_lock_file(path: &Path) -> InstanceLock {
    let Ok(file) = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)
    else {
        // Without a lock file, behave as before rather than refuse to start.
        return InstanceLock::Primary(None);
    };
    match file.try_lock() {
        Ok(()) => InstanceLock::Primary(Some(file)),
        Err(fs::TryLockError::WouldBlock) => InstanceLock::Secondary,
        Err(fs::TryLockError::Error(_)) => InstanceLock::Primary(None),
    }
}

/// Renames the database and its WAL/SHM side files to `*.unusable-<stamp>`, keeping them for
/// recovery, and returns the new database file name. Side files move first and every rename is
/// rolled back on failure: a WAL left next to a new, empty database would be replayed into it.
pub(crate) fn move_database_aside(database: &Path, stamp: u64) -> Result<PathBuf, String> {
    let file_name = database
        .file_name()
        .ok_or_else(|| "The database path has no file name".to_string())?
        .to_string_lossy()
        .into_owned();
    let moved = database.with_file_name(format!("{file_name}.unusable-{stamp}"));
    let mut renames = Vec::new();
    for suffix in ["-wal", "-shm"] {
        renames.push((
            database.with_file_name(format!("{file_name}{suffix}")),
            database.with_file_name(format!("{file_name}.unusable-{stamp}{suffix}")),
        ));
    }
    renames.push((database.to_path_buf(), moved.clone()));

    let mut done: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (from, to) in renames {
        if !from.exists() {
            continue;
        }
        if to.exists() {
            return roll_back(done, format!("{} already exists", to.display()));
        }
        if let Err(error) = fs::rename(&from, &to) {
            return roll_back(
                done,
                format!("Could not rename {}: {error}", from.display()),
            );
        }
        done.push((from, to));
    }
    Ok(moved)
}

fn roll_back(done: Vec<(PathBuf, PathBuf)>, error: String) -> Result<PathBuf, String> {
    for (from, to) in done.into_iter().rev() {
        let _ = fs::rename(&to, &from);
    }
    Err(error)
}

fn write_error_log(message: &str) -> Option<PathBuf> {
    let log = crate::database::get_app_data_dir()
        .ok()?
        .join("startup-error.log");
    fs::write(&log, format!("{message}\n")).ok()?;
    Some(log)
}

/// Starts Tarab again. This runs before Tauri started, so this process holds no single-instance
/// lock that would make the new one hand over and exit. The user just chose to continue, so an
/// autostart `--minimized` flag is not passed on.
fn relaunch() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    std::process::Command::new(exe)
        .args(
            std::env::args_os()
                .skip(1)
                .filter(|arg| arg != "--minimized"),
        )
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn log_note(message: &str) -> String {
    write_error_log(message)
        .map(|path| format!("\n\nDetails were saved to {}.", path.display()))
        .unwrap_or_default()
}

/// Shows why the Tauri application could not be built.
pub fn report_build_failure(error: &str) {
    log::error!("error while building Tauri application: {error}");
    let details = startup_diagnostics_text(
        take_early_diagnostics(),
        (log::Level::Error, format!("error while building Tauri application: {error}")),
    );
    let _ = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("Tarab could not start")
        .set_description(format!("{error}{}", log_note(&details)))
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

/// Shows that the library database could not be opened (before Tauri starts) and offers to move
/// it aside (renamed, not deleted) and start again with an empty library.
pub fn report_database_failure(database_error: &str, instance: InstanceLock) {
    log::error!("{database_error}");
    let details = startup_diagnostics_text(
        take_early_diagnostics(),
        (log::Level::Error, database_error.to_string()),
    );
    let log_note = log_note(&details);

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
    let failure = match crate::database::get_database_path()
        .and_then(|database| move_database_aside(&database, stamp))
    {
        Err(error) => Some(format!("Tarab could not move the database aside: {error}")),
        Ok(_) => {
            // The new process must be able to take the instance lock.
            drop(instance);
            relaunch()
                .err()
                .map(|error| format!("The database was moved aside, but Tarab could not restart: {error}. Open Tarab again."))
        }
    };
    if let Some(message) = failure {
        let _ = rfd::MessageDialog::new()
            .set_level(rfd::MessageLevel::Error)
            .set_title("Tarab could not start")
            .set_description(message)
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_copy_sees_the_instance_lock_held() {
        // Review regression for LD-06: a second launch must not open or offer to move the
        // library the first copy is using.
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path = std::env::temp_dir().join(format!("tarab-instance-{nonce}.lock"));

        let first = acquire_lock_file(&path);
        assert!(first.is_primary());
        assert!(!acquire_lock_file(&path).is_primary());
        drop(first);
        assert!(acquire_lock_file(&path).is_primary());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn a_failed_move_restores_the_files_already_moved() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let dir = std::env::temp_dir().join(format!("tarab-startup-rollback-{nonce}"));
        fs::create_dir_all(&dir).expect("create dir");
        let database = dir.join("library.db");
        fs::write(&database, b"db").expect("write db");
        fs::write(dir.join("library.db-wal"), b"wal").expect("write wal");
        // The target name for the database is taken, so its rename must not happen.
        fs::write(dir.join("library.db.unusable-7"), b"older").expect("write older");

        assert!(move_database_aside(&database, 7).is_err());
        assert_eq!(fs::read(&database).expect("db kept"), b"db");
        assert_eq!(
            fs::read(dir.join("library.db-wal")).expect("wal kept"),
            b"wal"
        );
        let _ = fs::remove_dir_all(dir);
    }

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
