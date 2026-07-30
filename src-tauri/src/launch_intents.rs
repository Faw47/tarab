use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::file_ops::{
    authorize_transient_file, grant_library_path, LibraryGrantSummary, SharedLibraryRoots,
};
use crate::library::SUPPORTED_EXTENSIONS;

const MAX_PENDING_FILE_INTENTS: usize = 20;
const FILE_INTENT_EVENT: &str = "launch-file-intent";

#[derive(Debug, Clone)]
struct PendingFileIntent {
    id: String,
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileIntentSummary {
    pub id: String,
    pub display_name: String,
    pub folder_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileIntentAction {
    PlayOnce,
    ImportFolder,
    Cancel,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedFileIntent {
    pub file_path: String,
    pub library_grant: Option<LibraryGrantSummary>,
}

#[derive(Default)]
pub struct LaunchIntentState {
    pending_files: Mutex<HashMap<String, PendingFileIntent>>,
}

pub type SharedLaunchIntents = Arc<LaunchIntentState>;

pub fn create_launch_intent_state() -> SharedLaunchIntents {
    Arc::new(LaunchIntentState::default())
}

fn is_supported_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            SUPPORTED_EXTENSIONS
                .iter()
                .any(|supported| supported.eq_ignore_ascii_case(extension))
        })
        .unwrap_or(false)
}

fn resolve_file_candidate(candidate: &Path) -> Result<Option<PathBuf>, String> {
    let link_metadata = match fs::symlink_metadata(candidate) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to inspect launch file: {}", error)),
    };
    if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
        return Ok(None);
    }
    let canonical = fs::canonicalize(candidate)
        .map_err(|error| format!("Failed to resolve launch file: {}", error))?;
    Ok(is_supported_audio_file(&canonical).then_some(canonical))
}

fn summarize(intent: &PendingFileIntent) -> FileIntentSummary {
    let display_name = intent
        .path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Audio file")
        .to_string();
    let folder_name = intent
        .path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .unwrap_or("Folder")
        .to_string();
    FileIntentSummary {
        id: intent.id.clone(),
        display_name,
        folder_name,
    }
}

pub fn queue_file_path(
    app: &AppHandle,
    state: &SharedLaunchIntents,
    candidate: &Path,
) -> Result<Option<FileIntentSummary>, String> {
    let Some(canonical) = resolve_file_candidate(candidate)? else {
        return Ok(None);
    };

    let mut pending = state.pending_files.lock();
    if let Some(existing) = pending.values().find(|intent| intent.path == canonical) {
        return Ok(Some(summarize(existing)));
    }
    if pending.len() >= MAX_PENDING_FILE_INTENTS {
        return Err("Too many pending file-open requests".to_string());
    }
    let intent = PendingFileIntent {
        id: format!("{:032x}", rand::random::<u128>()),
        path: canonical,
    };
    let summary = summarize(&intent);
    pending.insert(intent.id.clone(), intent);
    drop(pending);
    let _ = app.emit(FILE_INTENT_EVENT, &summary);
    Ok(Some(summary))
}

pub fn queue_cli_arguments(app: &AppHandle, state: &SharedLaunchIntents, arguments: &[String]) {
    for argument in arguments.iter().skip(1) {
        if argument.contains("://") || argument.starts_with('-') {
            continue;
        }
        if let Err(error) = queue_file_path(app, state, Path::new(argument)) {
            eprintln!("Ignored file-open argument: {}", error);
        }
    }
}

#[tauri::command]
pub fn list_launch_file_intents(
    state: tauri::State<'_, SharedLaunchIntents>,
) -> Vec<FileIntentSummary> {
    state.pending_files.lock().values().map(summarize).collect()
}

#[tauri::command]
pub fn resolve_launch_file_intent(
    app: AppHandle,
    intent_id: String,
    action: FileIntentAction,
    state: tauri::State<'_, SharedLaunchIntents>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Option<ResolvedFileIntent>, String> {
    let intent = state
        .pending_files
        .lock()
        .get(&intent_id)
        .cloned()
        .ok_or_else(|| "The file-open request is no longer available".to_string())?;
    if matches!(action, FileIntentAction::Cancel) {
        state.pending_files.lock().remove(&intent_id);
        return Ok(None);
    }

    let library_grant = if matches!(action, FileIntentAction::ImportFolder) {
        let parent = intent
            .path
            .parent()
            .ok_or_else(|| "The launch file has no parent folder".to_string())?;
        Some(grant_library_path(
            &app,
            roots_state.inner(),
            parent.to_path_buf(),
        )?)
    } else {
        authorize_transient_file(roots_state.inner(), &intent.path)?;
        None
    };

    state.pending_files.lock().remove(&intent_id);
    #[cfg(windows)]
    let file_path = intent.path.to_string_lossy().replace('\\', "/");
    #[cfg(not(windows))]
    let file_path = intent.path.to_string_lossy().into_owned();

    Ok(Some(ResolvedFileIntent {
        file_path,
        library_grant,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(unix)]
    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let directory =
            std::env::temp_dir().join(format!("tarab-launch-intent-{}-{}", name, nonce));
        fs::create_dir_all(&directory).expect("create temp directory");
        directory
    }

    #[test]
    fn supported_audio_check_is_case_insensitive() {
        assert!(is_supported_audio_file(Path::new("Track.FLAC")));
        assert!(!is_supported_audio_file(Path::new("cover.png")));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_file_is_not_a_valid_launch_target() {
        use std::os::unix::fs::symlink;

        let directory = temp_dir("symlink");
        let target = directory.join("target.mp3");
        let link = directory.join("link.mp3");
        fs::write(&target, b"audio").expect("write target");
        symlink(&target, &link).expect("create link");
        assert!(resolve_file_candidate(&link)
            .expect("validate launch target")
            .is_none());
        let _ = fs::remove_dir_all(directory);
    }
}
