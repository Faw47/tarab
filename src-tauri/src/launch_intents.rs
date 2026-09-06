use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use crate::file_ops::{
    authorize_transient_file, grant_library_path, revoke_transient_file_authority,
    LibraryGrantSummary, SharedLibraryRoots,
};
use crate::library::is_supported_audio_path;

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
    pub authority_id: Option<String>,
}

#[derive(Default)]
pub struct LaunchIntentState {
    pending_files: Mutex<HashMap<String, PendingFileIntent>>,
    resolving_files: Mutex<HashSet<String>>,
}

pub type SharedLaunchIntents = Arc<LaunchIntentState>;

pub fn create_launch_intent_state() -> SharedLaunchIntents {
    Arc::new(LaunchIntentState::default())
}

pub fn should_start_minimized(arguments: &[String]) -> bool {
    arguments
        .iter()
        .skip(1)
        .any(|argument| argument == "--minimized")
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
    Ok(is_supported_audio_path(&canonical).then_some(canonical))
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

fn resolve_cli_argument(argument: &str, cwd: &Path) -> PathBuf {
    let candidate = Path::new(argument);
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        cwd.join(candidate)
    }
}

pub fn queue_cli_arguments(
    app: &AppHandle,
    state: &SharedLaunchIntents,
    arguments: &[String],
    cwd: &Path,
) {
    for argument in arguments.iter().skip(1) {
        if argument.contains("://") || argument.starts_with('-') {
            continue;
        }
        let candidate = resolve_cli_argument(argument, cwd);
        if let Err(error) = queue_file_path(app, state, &candidate) {
            eprintln!("Ignored file-open argument: {}", error);
        }
    }
}

fn claim_file_intent(state: &LaunchIntentState, intent_id: &str) -> Option<PendingFileIntent> {
    if !state.resolving_files.lock().insert(intent_id.to_string()) {
        return None;
    }
    let intent = state.pending_files.lock().get(intent_id).cloned();
    if intent.is_none() {
        state.resolving_files.lock().remove(intent_id);
    }
    intent
}

fn release_file_intent(app: &AppHandle, state: &LaunchIntentState, intent: &PendingFileIntent) {
    let summary = summarize(intent);
    state.resolving_files.lock().remove(&intent.id);
    let _ = app.emit(FILE_INTENT_EVENT, &summary);
}

fn finish_file_intent(state: &LaunchIntentState, intent_id: &str) {
    state.pending_files.lock().remove(intent_id);
    state.resolving_files.lock().remove(intent_id);
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
    let intent = claim_file_intent(state.inner(), &intent_id)
        .ok_or_else(|| "The file-open request is no longer available".to_string())?;
    if matches!(action, FileIntentAction::Cancel) {
        finish_file_intent(state.inner(), &intent_id);
        return Ok(None);
    }

    let resolution = (|| {
        if matches!(action, FileIntentAction::ImportFolder) {
            let parent = intent
                .path
                .parent()
                .ok_or_else(|| "The launch file has no parent folder".to_string())?;
            grant_library_path(&app, roots_state.inner(), parent.to_path_buf())
                .map(|grant| (Some(grant), None))
        } else {
            let authority_id = authorize_transient_file(roots_state.inner(), &intent.path)?;
            Ok((None, Some(authority_id)))
        }
    })();
    let (library_grant, authority_id) = match resolution {
        Ok(resolved) => resolved,
        Err(error) => {
            release_file_intent(&app, state.inner(), &intent);
            return Err(error);
        }
    };

    finish_file_intent(state.inner(), &intent_id);

    #[cfg(windows)]
    let file_path = intent.path.to_string_lossy().replace('\\', "/");
    #[cfg(not(windows))]
    let file_path = intent.path.to_string_lossy().into_owned();

    Ok(Some(ResolvedFileIntent {
        file_path,
        library_grant,
        authority_id,
    }))
}

#[tauri::command]
pub fn revoke_launch_file_authority(
    authority_id: String,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<(), String> {
    revoke_transient_file_authority(roots_state.inner(), &authority_id)
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
        assert!(is_supported_audio_path(Path::new("Track.FLAC")));
        assert!(!is_supported_audio_path(Path::new("cover.png")));
    }

    #[test]
    fn minimized_argument_is_consumed_only_when_explicitly_requested() {
        assert!(should_start_minimized(&[
            "tarab".to_string(),
            "--minimized".to_string(),
        ]));
        assert!(!should_start_minimized(&[
            "tarab".to_string(),
            "music--minimized.mp3".to_string(),
        ]));
    }

    #[test]
    fn relative_cli_argument_uses_launching_instance_working_directory() {
        let cwd = Path::new("secondary-working-directory");
        assert_eq!(
            resolve_cli_argument("music/song.mp3", cwd),
            cwd.join("music/song.mp3")
        );
    }

    #[test]
    fn claiming_an_intent_prevents_a_concurrent_resolution() {
        let state = LaunchIntentState::default();
        let intent = PendingFileIntent {
            id: "intent-id".to_string(),
            path: PathBuf::from("song.mp3"),
        };
        state.pending_files.lock().insert(intent.id.clone(), intent);

        assert!(claim_file_intent(&state, "intent-id").is_some());
        assert!(claim_file_intent(&state, "intent-id").is_none());
        state.resolving_files.lock().remove("intent-id");
        assert!(claim_file_intent(&state, "intent-id").is_some());
    }

    #[test]
    fn resolved_play_once_intent_serializes_opaque_authority_id() {
        let value = serde_json::to_value(ResolvedFileIntent {
            file_path: "/outside/song.mp3".to_string(),
            library_grant: None,
            authority_id: Some("0123456789abcdef0123456789abcdef".to_string()),
        })
        .expect("serialize resolved intent");

        assert_eq!(
            value,
            serde_json::json!({
                "filePath": "/outside/song.mp3",
                "libraryGrant": null,
                "authorityId": "0123456789abcdef0123456789abcdef"
            })
        );
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
