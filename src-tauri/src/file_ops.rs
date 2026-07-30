use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::audio::SharedAudioManager;
use crate::database::{DbTrack, SharedDatabase};
use crate::tageditor::FileMutationResult;

const LIBRARY_GRANTS_VERSION: u8 = 1;
const LIBRARY_GRANTS_FILE: &str = "library-grants.json";
const MAX_LIBRARY_GRANTS_BYTES: u64 = 1024 * 1024;
const RECOVERABLE_TRASH_DIR: &str = "recoverable-trash";
const TRASH_RECORD_FILE: &str = "record.json";
const MAX_TRASH_RECORD_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrashRecord {
    version: u8,
    token: String,
    original_path: String,
    stored_file_name: String,
    track: Option<DbTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryGrantRecord {
    id: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LibraryGrantFile {
    version: u8,
    grants: Vec<LibraryGrantRecord>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryGrantSummary {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub status: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCachedSourceHealth {
    pub grant_id: String,
    pub path: String,
    pub indexed_track_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryHealthState {
    pub native_grants: Vec<LibraryGrantSummary>,
    pub cached_sources: Vec<LibraryCachedSourceHealth>,
    pub unavailable_sources: Vec<LibraryGrantSummary>,
    pub watcher_state: &'static str,
    pub repair_actions: Vec<&'static str>,
}

#[derive(Clone, Default)]
pub struct LibraryRootsState {
    pub roots: Vec<PathBuf>,
    grants: Vec<LibraryGrantRecord>,
    transient_files: Vec<PathBuf>,
}

pub type SharedLibraryRoots = Arc<RwLock<LibraryRootsState>>;

pub fn create_library_roots_state() -> SharedLibraryRoots {
    Arc::new(RwLock::new(LibraryRootsState::default()))
}

fn grants_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App data directory not available: {}", e))?;
    fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    Ok(app_dir.join(LIBRARY_GRANTS_FILE))
}

fn recoverable_trash_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App data directory not available: {e}"))?;
    let trash_dir = app_dir.join(RECOVERABLE_TRASH_DIR);
    fs::create_dir_all(&trash_dir)
        .map_err(|e| format!("Failed to create recoverable Trash directory: {e}"))?;
    Ok(trash_dir)
}

fn valid_undo_token(token: &str) -> bool {
    token.len() == 32 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn write_trash_record(path: &Path, record: &TrashRecord) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(record).map_err(|e| format!("Failed to encode Trash record: {e}"))?;
    if bytes.len() as u64 > MAX_TRASH_RECORD_BYTES {
        return Err("Trash record exceeds the allowed size".to_string());
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("Failed to create Trash record: {e}"))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write Trash record: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync Trash record: {e}"))
}

fn read_trash_record(path: &Path) -> Result<TrashRecord, String> {
    let metadata =
        fs::metadata(path).map_err(|e| format!("Failed to inspect Trash record: {e}"))?;
    if !metadata.is_file() || metadata.len() > MAX_TRASH_RECORD_BYTES {
        return Err("Trash record is invalid".to_string());
    }
    let bytes = fs::read(path).map_err(|e| format!("Failed to read Trash record: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Failed to decode Trash record: {e}"))
}

fn write_grants_atomic(path: &Path, grant_file: &LibraryGrantFile) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(grant_file)
        .map_err(|e| format!("Failed to serialize library grants: {}", e))?;
    let temp_path = path.with_extension(format!("json.{:032x}.tmp", rand::random::<u128>()));
    let backup_path = path.with_extension("json.bak");

    let mut temp = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .map_err(|e| format!("Failed to create temporary library grants file: {}", e))?;
    temp.write_all(&data)
        .map_err(|e| format!("Failed to write library grants: {}", e))?;
    temp.sync_all()
        .map_err(|e| format!("Failed to sync library grants: {}", e))?;
    drop(temp);

    let had_existing = path.exists();
    if had_existing {
        let _ = fs::remove_file(&backup_path);
        fs::rename(path, &backup_path)
            .map_err(|e| format!("Failed to stage existing library grants: {}", e))?;
    }

    if let Err(err) = fs::rename(&temp_path, path) {
        if had_existing {
            let _ = fs::rename(&backup_path, path);
        }
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Failed to replace library grants: {}", err));
    }

    if had_existing {
        let _ = fs::remove_file(&backup_path);
    }
    Ok(())
}

fn active_roots(grants: &[LibraryGrantRecord]) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for grant in grants {
        let path = PathBuf::from(&grant.path);
        let is_symlink = fs::symlink_metadata(&path)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(true);
        if path.is_dir() && !is_symlink {
            if let Ok(canonical) = fs::canonicalize(&path) {
                roots.push(canonical);
            }
            roots.push(path);
        }
    }
    normalize_library_roots(roots)
}

fn grant_summary(grant: &LibraryGrantRecord) -> LibraryGrantSummary {
    let path = PathBuf::from(&grant.path);
    let is_symlink = fs::symlink_metadata(&path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(true);
    let available = path.is_dir() && !is_symlink && fs::canonicalize(&path).is_ok();
    let display_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(&grant.path)
        .to_string();
    LibraryGrantSummary {
        id: grant.id.clone(),
        path: grant.path.clone(),
        display_name,
        status: if available { "available" } else { "missing" },
    }
}

pub fn load_library_roots_state(app: &AppHandle) -> Result<SharedLibraryRoots, String> {
    let path = grants_path(app)?;
    let grants = if path.exists() {
        let metadata = fs::symlink_metadata(&path)
            .map_err(|e| format!("Failed to inspect library grants: {}", e))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Library grants storage is not a regular file".to_string());
        }
        if metadata.len() > MAX_LIBRARY_GRANTS_BYTES {
            return Err("Library grants storage exceeds the size limit".to_string());
        }
        let data = fs::read(&path).map_err(|e| format!("Failed to read library grants: {}", e))?;
        let file: LibraryGrantFile = serde_json::from_slice(&data)
            .map_err(|e| format!("Failed to parse library grants: {}", e))?;
        if file.version != LIBRARY_GRANTS_VERSION {
            return Err(format!(
                "Unsupported library grants version: {}",
                file.version
            ));
        }
        file.grants
    } else {
        Vec::new()
    };
    let roots = active_roots(&grants);
    Ok(Arc::new(RwLock::new(LibraryRootsState {
        roots,
        grants,
        transient_files: Vec::new(),
    })))
}

fn persist_grants(app: &AppHandle, grants: &[LibraryGrantRecord]) -> Result<(), String> {
    write_grants_atomic(
        &grants_path(app)?,
        &LibraryGrantFile {
            version: LIBRARY_GRANTS_VERSION,
            grants: grants.to_vec(),
        },
    )
}

#[tauri::command]
pub fn list_library_grants(
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Vec<LibraryGrantSummary> {
    let mut state = roots_state.write();
    state.roots = active_roots(&state.grants);
    state.grants.iter().map(grant_summary).collect()
}

#[tauri::command]
pub fn get_library_health(
    roots_state: tauri::State<'_, SharedLibraryRoots>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<LibraryHealthState, String> {
    let mut state = roots_state.write();
    state.roots = active_roots(&state.grants);
    let native_grants = state.grants.iter().map(grant_summary).collect::<Vec<_>>();
    let cached_sources = state
        .grants
        .iter()
        .map(|grant| {
            Ok(LibraryCachedSourceHealth {
                grant_id: grant.id.clone(),
                path: grant.path.clone(),
                indexed_track_count: db
                    .count_tracks_by_folder(&grant.path)
                    .map_err(|e| e.to_string())?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let unavailable_sources = native_grants
        .iter()
        .filter(|grant| grant.status == "missing")
        .cloned()
        .collect::<Vec<_>>();
    let watcher_state = if state.roots.is_empty() {
        "inactive"
    } else {
        "ready"
    };
    let repair_actions = if native_grants.is_empty() {
        vec!["addFolder"]
    } else if unavailable_sources.is_empty() {
        vec!["addFolder", "rescan"]
    } else {
        vec!["reauthorize", "addFolder", "viewDetails"]
    };
    Ok(LibraryHealthState {
        native_grants,
        cached_sources,
        unavailable_sources,
        watcher_state,
        repair_actions,
    })
}

#[tauri::command]
pub async fn select_library_folder(
    app: AppHandle,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Option<LibraryGrantSummary>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Select Music Folder")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|e| format!("Selected folder path is invalid: {}", e))?;
    if !selected.is_dir() {
        return Err("Selected library path is not a folder".to_string());
    }
    let canonical = fs::canonicalize(&selected)
        .map_err(|e| format!("Failed to resolve selected library folder: {}", e))?;
    grant_library_path(&app, roots_state.inner(), canonical).map(Some)
}

#[tauri::command]
pub async fn reauthorize_library_grant(
    app: AppHandle,
    grant_id: String,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Option<LibraryGrantSummary>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title("Reconnect Music Folder")
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let selected = selected
        .into_path()
        .map_err(|e| format!("Selected folder path is invalid: {}", e))?;
    let canonical = fs::canonicalize(&selected)
        .map_err(|e| format!("Failed to resolve selected library folder: {}", e))?;
    if !canonical.is_dir() {
        return Err("Selected library path is not a folder".to_string());
    }

    #[cfg(windows)]
    let canonical_string = canonical.to_string_lossy().replace('\\', "/");
    #[cfg(not(windows))]
    let canonical_string = canonical.to_string_lossy().into_owned();

    let current = roots_state.read().grants.clone();
    let grant = current
        .iter()
        .find(|grant| grant.id == grant_id)
        .cloned()
        .ok_or_else(|| "The library source no longer exists".to_string())?;
    if current.iter().any(|candidate| {
        candidate.id != grant_id
            && (canonical.starts_with(Path::new(&candidate.path))
                || Path::new(&candidate.path).starts_with(&canonical))
    }) {
        return Err("The selected folder overlaps another library source".to_string());
    }

    db.rebase_track_paths(&grant.path, &canonical_string)
        .map_err(|e| format!("Failed to reconnect indexed tracks: {}", e))?;

    let mut next = current;
    if let Some(entry) = next.iter_mut().find(|entry| entry.id == grant_id) {
        entry.path = canonical_string;
    }
    if let Err(error) = persist_grants(&app, &next) {
        let _ = db.rebase_track_paths(
            next.iter()
                .find(|entry| entry.id == grant_id)
                .map(|entry| entry.path.as_str())
                .unwrap_or_default(),
            &grant.path,
        );
        return Err(error);
    }

    let updated = next
        .iter()
        .find(|entry| entry.id == grant_id)
        .cloned()
        .ok_or_else(|| "The reconnected library source was lost".to_string())?;
    let mut state = roots_state.write();
    state.grants = next;
    state.roots = active_roots(&state.grants);
    Ok(Some(grant_summary(&updated)))
}

pub(crate) fn grant_library_path(
    app: &AppHandle,
    roots_state: &SharedLibraryRoots,
    canonical: PathBuf,
) -> Result<LibraryGrantSummary, String> {
    if !canonical.is_dir() {
        return Err("Selected library path is not a folder".to_string());
    }
    #[cfg(windows)]
    let canonical_string = canonical.to_string_lossy().replace('\\', "/");
    #[cfg(not(windows))]
    let canonical_string = canonical.to_string_lossy().into_owned();
    let current = roots_state.read().grants.clone();
    if let Some(existing) = current.iter().find(|grant| {
        let existing_path = PathBuf::from(&grant.path);
        canonical == existing_path || canonical.starts_with(existing_path)
    }) {
        return Ok(grant_summary(existing));
    }

    let mut next = current;
    next.retain(|grant| !PathBuf::from(&grant.path).starts_with(&canonical));
    let grant = LibraryGrantRecord {
        id: format!("{:032x}", rand::random::<u128>()),
        path: canonical_string,
    };
    next.push(grant.clone());
    next.sort_by(|a, b| a.path.cmp(&b.path));
    persist_grants(app, &next)?;

    let mut state = roots_state.write();
    state.grants = next;
    state.roots = active_roots(&state.grants);
    Ok(grant_summary(&grant))
}

pub(crate) fn authorize_transient_file(
    roots_state: &SharedLibraryRoots,
    path: &Path,
) -> Result<PathBuf, String> {
    let canonical = canonicalize_existing_path(path)?;
    if !canonical.is_file() {
        return Err("Launch file is not a regular file".to_string());
    }
    let mut state = roots_state.write();
    if !state.transient_files.contains(&canonical) {
        state.transient_files.push(canonical.clone());
    }
    Ok(canonical)
}

pub(crate) fn ensure_path_allowed_by_state(
    path: &Path,
    state: &LibraryRootsState,
    action: &str,
) -> Result<PathBuf, String> {
    let canonical = canonicalize_existing_path(path)?;
    if state.transient_files.contains(&canonical) {
        return Ok(canonical);
    }
    ensure_path_allowed(&canonical, &state.roots, action)?;
    Ok(canonical)
}

pub(crate) fn consume_transient_file(roots_state: &SharedLibraryRoots, path: &Path) {
    if let Ok(canonical) = canonicalize_existing_path(path) {
        roots_state
            .write()
            .transient_files
            .retain(|candidate| candidate != &canonical);
    }
}

#[tauri::command]
pub fn revoke_library_grant(
    app: AppHandle,
    grant_id: String,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<bool, String> {
    let current = roots_state.read().grants.clone();
    let mut next = current.clone();
    next.retain(|grant| grant.id != grant_id);
    if next.len() == current.len() {
        return Ok(false);
    }
    persist_grants(&app, &next)?;
    let mut state = roots_state.write();
    state.grants = next;
    state.roots = active_roots(&state.grants);
    Ok(true)
}

fn normalize_library_roots(mut roots: Vec<PathBuf>) -> Vec<PathBuf> {
    roots.sort_by(|a, b| {
        a.components()
            .count()
            .cmp(&b.components().count())
            .then_with(|| a.cmp(b))
    });
    roots.dedup();

    let mut normalized = Vec::with_capacity(roots.len());
    for root in roots {
        if !is_path_allowed(&root, &normalized) {
            normalized.push(root);
        }
    }
    normalized
}

fn ensure_filename_with_extension(base: &str, source: &Path) -> Result<String, String> {
    if base.trim().is_empty() {
        return Err("Rename target must not be empty".to_string());
    }

    let candidate = if base.contains('.') {
        base.to_string()
    } else if let Some(ext) = source.extension().and_then(|e| e.to_str()) {
        format!("{}.{}", base, ext)
    } else {
        base.to_string()
    };

    let mut components = Path::new(&candidate).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(candidate),
        _ => Err("Rename target must be a filename, not a path".to_string()),
    }
}

pub(crate) fn canonicalize_existing_path(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|e| format!("Failed to resolve path {}: {}", path.display(), e))
}

pub(crate) fn canonicalize_target_path(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return canonicalize_existing_path(path);
    }

    let mut missing_components: Vec<OsString> = Vec::new();
    let mut cursor = path;

    while !cursor.exists() {
        let file_name = cursor
            .file_name()
            .ok_or_else(|| format!("Target path has no existing parent: {}", path.display()))?;

        if !matches!(
            Path::new(file_name).components().next(),
            Some(Component::Normal(_))
        ) {
            return Err(format!(
                "Target path contains an invalid component: {}",
                path.display()
            ));
        }

        missing_components.push(file_name.to_os_string());
        cursor = cursor
            .parent()
            .ok_or_else(|| format!("Target path has no existing parent: {}", path.display()))?;
    }

    let mut canonical = fs::canonicalize(cursor).map_err(|e| {
        format!(
            "Failed to resolve target ancestor {}: {}",
            cursor.display(),
            e
        )
    })?;

    for component in missing_components.iter().rev() {
        canonical.push(component);
    }

    Ok(canonical)
}

pub(crate) fn is_path_allowed(path: &Path, roots: &[PathBuf]) -> bool {
    roots
        .iter()
        .any(|root| path == root || path.starts_with(root))
}

pub(crate) fn ensure_path_allowed(
    path: &Path,
    roots: &[PathBuf],
    action: &str,
) -> Result<(), String> {
    if roots.is_empty() {
        return Err(
            "File operations are blocked: no library roots configured. Add a library folder first."
                .to_string(),
        );
    }
    if is_path_allowed(path, roots) {
        Ok(())
    } else {
        Err(format!(
            "Blocked {} outside configured library roots: {}",
            action,
            path.display()
        ))
    }
}

pub(crate) fn ensure_existing_path_allowed(
    path: &Path,
    roots: &[PathBuf],
    action: &str,
) -> Result<PathBuf, String> {
    let canonical = canonicalize_existing_path(path)?;
    ensure_path_allowed(&canonical, roots, action)?;
    Ok(canonical)
}

fn ensure_mutation_source_allowed(
    path: &Path,
    roots: &[PathBuf],
    action: &str,
) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to inspect path {}: {}", path.display(), e))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("Blocked {action} through a symbolic link"));
    }
    ensure_existing_path_allowed(path, roots, action)
}

pub(crate) fn ensure_target_path_allowed(
    path: &Path,
    roots: &[PathBuf],
    action: &str,
) -> Result<PathBuf, String> {
    let canonical = canonicalize_target_path(path)?;
    ensure_path_allowed(&canonical, roots, action)?;
    Ok(canonical)
}

#[cfg(test)]
pub(crate) fn collect_deletable_paths(
    file_paths: &[String],
    roots: &[PathBuf],
) -> Result<Vec<(String, PathBuf)>, String> {
    let mut deletable_paths = Vec::new();
    for path in file_paths {
        let p = Path::new(path);
        if p.exists() {
            let canonical = ensure_existing_path_allowed(p, roots, "delete file")?;
            deletable_paths.push((path.clone(), canonical));
        }
    }
    Ok(deletable_paths)
}

fn create_destination_parent_dir(target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create destination directory {}: {}",
                parent.display(),
                e
            )
        })?;
    }
    Ok(())
}

#[tauri::command]
pub async fn rename_file(
    old_path: String,
    new_name: String,
    db: tauri::State<'_, SharedDatabase>,
    audio: tauri::State<'_, SharedAudioManager>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<String, String> {
    let db = db.inner().clone();
    let audio = audio.inner().clone();
    let roots_state = roots_state.inner().clone();
    spawn_blocking(move || {
        let source = PathBuf::from(&old_path);
        if !source.exists() {
            return Err(format!("File does not exist: {}", old_path));
        }
        let roots = roots_state.read().roots.clone();
        let source_canonical =
            ensure_mutation_source_allowed(&source, &roots, "rename source file")?;
        let parent = source_canonical
            .parent()
            .ok_or_else(|| "Source has no parent directory".to_string())?;
        let final_name = ensure_filename_with_extension(&new_name, &source_canonical)?;
        let target = parent.join(final_name);
        if source == target {
            return Ok(target.to_string_lossy().to_string());
        }
        if target.exists() {
            return Err("Target file already exists".into());
        }
        let _target_canonical =
            ensure_target_path_allowed(&target, &roots, "rename destination file")?;
        fs::rename(&source_canonical, &target).map_err(|e| format!("Failed to rename: {}", e))?;
        let target_str = target.to_string_lossy().to_string();
        if let Err(err) = db.rename_track_path(&old_path, &target_str) {
            // Try to restore original file path if DB update fails.
            let rollback_result = fs::rename(&target, &source_canonical);
            return match rollback_result {
                Ok(()) => Err(format!(
                    "Failed to update database after rename, operation rolled back: {}",
                    err
                )),
                Err(rollback_err) => Err(format!(
                    "Failed to update database after rename and rollback failed (manual rescan needed). DB error: {}. Rollback error: {}",
                    err, rollback_err
                )),
            };
        }
        let _ = audio.source_renamed(old_path, target_str.clone());
        Ok(target_str)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn move_file(
    old_path: String,
    new_path: String,
    db: tauri::State<'_, SharedDatabase>,
    audio: tauri::State<'_, SharedAudioManager>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<String, String> {
    let db = db.inner().clone();
    let audio = audio.inner().clone();
    let roots_state = roots_state.inner().clone();
    spawn_blocking(move || {
        let source = PathBuf::from(&old_path);
        if !source.exists() {
            return Err(format!("File does not exist: {}", old_path));
        }
        let roots = roots_state.read().roots.clone();
        let source_canonical = ensure_mutation_source_allowed(&source, &roots, "move source file")?;
        let mut target = PathBuf::from(&new_path);
        if target.is_dir() || new_path.ends_with(std::path::MAIN_SEPARATOR) {
            let file_name = source_canonical
                .file_name()
                .ok_or_else(|| "Could not determine file name".to_string())?;
            target = target.join(file_name);
        }
        if target.exists() {
            return Err("Target file already exists".into());
        }
        let _target_canonical = ensure_target_path_allowed(&target, &roots, "move destination file")?;
        create_destination_parent_dir(&target)?;
        fs::rename(&source_canonical, &target).map_err(|e| format!("Failed to move file: {}", e))?;
        let target_str = target.to_string_lossy().to_string();
        if let Err(err) = db.rename_track_path(&old_path, &target_str) {
            // Try to restore original file path if DB update fails.
            let rollback_result = fs::rename(&target, &source_canonical);
            return match rollback_result {
                Ok(()) => Err(format!(
                    "Failed to update database after move, operation rolled back: {}",
                    err
                )),
                Err(rollback_err) => Err(format!(
                    "Failed to update database after move and rollback failed (manual rescan needed). DB error: {}. Rollback error: {}",
                    err, rollback_err
                )),
            };
        }
        let _ = audio.source_renamed(old_path, target_str.clone());
        Ok(target_str)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn trash_files(
    app: AppHandle,
    file_paths: Vec<String>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<FileMutationResult>, String> {
    let db = db.inner().clone();
    let roots_state = roots_state.inner().clone();
    let trash_root = recoverable_trash_path(&app)?;
    spawn_blocking(move || {
        let roots = roots_state.read().roots.clone();
        let mut seen = std::collections::HashSet::new();
        let mut planned = Vec::with_capacity(file_paths.len());
        for original_path in &file_paths {
            let source = PathBuf::from(original_path);
            let validation = if !seen.insert(original_path.clone()) {
                Err("The request contains the same file more than once".to_string())
            } else if !source.exists() {
                Err("File does not exist".to_string())
            } else if !source.is_file() {
                Err("Target is not a regular file".to_string())
            } else {
                ensure_mutation_source_allowed(&source, &roots, "move file to Trash")
            };
            planned.push((original_path.clone(), validation));
        }

        let mut results = Vec::with_capacity(planned.len());
        for (original_path, validation) in planned {
            let canonical_path = match validation {
                Ok(path) => path,
                Err(error) => {
                    results.push(FileMutationResult {
                        path: original_path,
                        status: "failed".to_string(),
                        operation: "trash".to_string(),
                        error_code: Some("preflightFailed".to_string()),
                        recoverable: true,
                        error_message: Some(error),
                        undo_token: None,
                    });
                    continue;
                }
            };
            let token = format!("{:032x}", rand::random::<u128>());
            let entry_dir = trash_root.join(&token);
            let stored_file_name = canonical_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("audio-file")
                .to_string();
            let stored_path = entry_dir.join(&stored_file_name);
            if let Err(error) = fs::create_dir(&entry_dir) {
                results.push(FileMutationResult {
                    path: original_path,
                    status: "failed".to_string(),
                    operation: "trash".to_string(),
                    error_code: Some("trashStorageFailed".to_string()),
                    recoverable: true,
                    error_message: Some(error.to_string()),
                    undo_token: None,
                });
                continue;
            }
            let track = db
                .get_tracks_by_ids(std::slice::from_ref(&original_path))
                .ok()
                .and_then(|mut tracks| tracks.pop());
            let record = TrashRecord {
                version: 1,
                token: token.clone(),
                original_path: original_path.clone(),
                stored_file_name,
                track,
            };
            if let Err(error) = write_trash_record(&entry_dir.join(TRASH_RECORD_FILE), &record) {
                let _ = fs::remove_dir(&entry_dir);
                results.push(FileMutationResult {
                    path: original_path,
                    status: "failed".to_string(),
                    operation: "trash".to_string(),
                    error_code: Some("trashStorageFailed".to_string()),
                    recoverable: true,
                    error_message: Some(error),
                    undo_token: None,
                });
                continue;
            }
            if let Err(error) = fs::rename(&canonical_path, &stored_path) {
                let _ = fs::remove_file(entry_dir.join(TRASH_RECORD_FILE));
                let _ = fs::remove_dir(&entry_dir);
                results.push(FileMutationResult {
                    path: original_path,
                    status: "failed".to_string(),
                    operation: "trash".to_string(),
                    error_code: Some("fileTrashFailed".to_string()),
                    recoverable: true,
                    error_message: Some(error.to_string()),
                    undo_token: None,
                });
                continue;
            }
            if let Err(error) = db.delete_tracks(std::slice::from_ref(&original_path)) {
                let rollback = fs::rename(&stored_path, &canonical_path);
                if rollback.is_ok() {
                    let _ = fs::remove_file(entry_dir.join(TRASH_RECORD_FILE));
                    let _ = fs::remove_dir(&entry_dir);
                }
                results.push(FileMutationResult {
                    path: original_path,
                    status: "failed".to_string(),
                    operation: "trash".to_string(),
                    error_code: Some("databaseSyncFailed".to_string()),
                    recoverable: rollback.is_ok(),
                    error_message: Some(format!(
                        "Tarab could not update the library after moving the file to Trash: {error}"
                    )),
                    undo_token: rollback.is_err().then_some(token),
                });
                continue;
            }
            results.push(FileMutationResult {
                path: original_path,
                status: "success".to_string(),
                operation: "trash".to_string(),
                error_code: None,
                recoverable: true,
                error_message: None,
                undo_token: Some(token),
            });
        }
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn restore_trashed_files(
    app: AppHandle,
    undo_tokens: Vec<String>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<FileMutationResult>, String> {
    let db = db.inner().clone();
    let roots_state = roots_state.inner().clone();
    let trash_root = recoverable_trash_path(&app)?;
    spawn_blocking(move || {
        let roots = roots_state.read().roots.clone();
        let mut results = Vec::with_capacity(undo_tokens.len());
        for token in undo_tokens {
            if !valid_undo_token(&token) {
                results.push(FileMutationResult {
                    path: String::new(),
                    status: "failed".to_string(),
                    operation: "restore".to_string(),
                    error_code: Some("invalidUndoToken".to_string()),
                    recoverable: false,
                    error_message: Some("The undo token is invalid".to_string()),
                    undo_token: None,
                });
                continue;
            }
            let entry_dir = trash_root.join(&token);
            let record = match read_trash_record(&entry_dir.join(TRASH_RECORD_FILE)) {
                Ok(record) if record.version == 1 && record.token == token => record,
                Ok(_) => {
                    results.push(FileMutationResult {
                        path: String::new(),
                        status: "failed".to_string(),
                        operation: "restore".to_string(),
                        error_code: Some("invalidUndoToken".to_string()),
                        recoverable: false,
                        error_message: Some("The Trash record does not match the undo token".to_string()),
                        undo_token: None,
                    });
                    continue;
                }
                Err(error) => {
                    results.push(FileMutationResult {
                        path: String::new(),
                        status: "failed".to_string(),
                        operation: "restore".to_string(),
                        error_code: Some("trashRecordMissing".to_string()),
                        recoverable: false,
                        error_message: Some(error),
                        undo_token: None,
                    });
                    continue;
                }
            };
            let original_path = PathBuf::from(&record.original_path);
            let stored_name_is_safe = matches!(
                Path::new(&record.stored_file_name)
                    .components()
                    .collect::<Vec<_>>()
                    .as_slice(),
                [Component::Normal(_)]
            );
            if !stored_name_is_safe {
                results.push(FileMutationResult {
                    path: record.original_path,
                    status: "failed".to_string(),
                    operation: "restore".to_string(),
                    error_code: Some("invalidTrashRecord".to_string()),
                    recoverable: false,
                    error_message: Some("The Trash record contains an invalid file name".to_string()),
                    undo_token: None,
                });
                continue;
            }
            let stored_path = entry_dir.join(&record.stored_file_name);
            let validation = if original_path.exists() {
                Err("A file already exists at the original path".to_string())
            } else if !stored_path.is_file() {
                Err("The recoverable Trash file is missing".to_string())
            } else {
                ensure_target_path_allowed(&original_path, &roots, "restore file from Trash")
                    .map(|_| ())
            };
            if let Err(error) = validation {
                results.push(FileMutationResult {
                    path: record.original_path,
                    status: "failed".to_string(),
                    operation: "restore".to_string(),
                    error_code: Some("restorePreflightFailed".to_string()),
                    recoverable: true,
                    error_message: Some(error),
                    undo_token: Some(token),
                });
                continue;
            }
            if let Err(error) = fs::rename(&stored_path, &original_path) {
                results.push(FileMutationResult {
                    path: record.original_path,
                    status: "failed".to_string(),
                    operation: "restore".to_string(),
                    error_code: Some("fileRestoreFailed".to_string()),
                    recoverable: true,
                    error_message: Some(error.to_string()),
                    undo_token: Some(token),
                });
                continue;
            }
            if let Some(track) = &record.track {
                if let Err(error) = db.upsert_tracks_batch(std::slice::from_ref(track)) {
                    let rollback = fs::rename(&original_path, &stored_path);
                    results.push(FileMutationResult {
                        path: record.original_path,
                        status: "failed".to_string(),
                        operation: "restore".to_string(),
                        error_code: Some("databaseSyncFailed".to_string()),
                        recoverable: rollback.is_ok(),
                        error_message: Some(format!(
                            "Tarab restored the file but could not restore its library record: {error}"
                        )),
                        undo_token: rollback.is_ok().then_some(token),
                    });
                    continue;
                }
            }
            let _ = fs::remove_file(entry_dir.join(TRASH_RECORD_FILE));
            let _ = fs::remove_dir(&entry_dir);
            results.push(FileMutationResult {
                path: record.original_path,
                status: "success".to_string(),
                operation: "restore".to_string(),
                error_code: None,
                recoverable: false,
                error_message: None,
                undo_token: None,
            });
        }
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_files(
    file_paths: Vec<String>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<FileMutationResult>, String> {
    let db = db.inner().clone();
    let roots_state = roots_state.inner().clone();
    spawn_blocking(move || {
        let roots = roots_state.read().roots.clone();
        let mut seen = std::collections::HashSet::new();
        let mut planned = Vec::with_capacity(file_paths.len());
        for original_path in &file_paths {
            let source = PathBuf::from(original_path);
            let validation = if !seen.insert(original_path.clone()) {
                Err("The request contains the same file more than once".to_string())
            } else if !source.exists() {
                Err("File does not exist".to_string())
            } else if !source.is_file() {
                Err("Target is not a regular file".to_string())
            } else {
                ensure_mutation_source_allowed(&source, &roots, "delete file")
            };
            planned.push((original_path.clone(), validation));
        }

        let mut results = Vec::with_capacity(planned.len());
        for (original_path, validation) in planned {
            let canonical_path = match validation {
                Ok(path) => path,
                Err(error) => {
                    results.push(FileMutationResult {
                        path: original_path,
                        status: "failed".to_string(),
                        operation: "delete".to_string(),
                        error_code: Some("preflightFailed".to_string()),
                        recoverable: true,
                        error_message: Some(error),
                        undo_token: None,
                    });
                    continue;
                }
            };

            if let Err(error) = fs::remove_file(&canonical_path) {
                results.push(FileMutationResult {
                    path: original_path,
                    status: "failed".to_string(),
                    operation: "delete".to_string(),
                    error_code: Some("fileDeleteFailed".to_string()),
                    recoverable: true,
                    error_message: Some(error.to_string()),
                    undo_token: None,
                });
                continue;
            }

            match db.delete_tracks(std::slice::from_ref(&original_path)) {
                Ok(_) => results.push(FileMutationResult {
                    path: original_path,
                    status: "success".to_string(),
                    operation: "delete".to_string(),
                    error_code: None,
                    recoverable: false,
                    error_message: None,
                    undo_token: None,
                }),
                Err(error) => results.push(FileMutationResult {
                    path: original_path,
                    status: "failed".to_string(),
                    operation: "delete".to_string(),
                    error_code: Some("databaseSyncFailed".to_string()),
                    recoverable: false,
                    error_message: Some(format!(
                        "The file was deleted, but the database update failed. Rescan the library. {error}"
                    )),
                    undo_token: None,
                }),
            }
        }
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tarab-file-ops-{}-{}", name, nonce));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn grant_file_is_written_with_version_and_records() {
        let temp = temp_dir("grant-file");
        let path = temp.join(LIBRARY_GRANTS_FILE);
        let grant = LibraryGrantRecord {
            id: "grant-1".to_string(),
            path: temp.to_string_lossy().to_string(),
        };

        write_grants_atomic(
            &path,
            &LibraryGrantFile {
                version: LIBRARY_GRANTS_VERSION,
                grants: vec![grant],
            },
        )
        .expect("write grant file");

        let stored: LibraryGrantFile =
            serde_json::from_slice(&fs::read(&path).expect("read grant file"))
                .expect("parse grant file");
        assert_eq!(stored.version, LIBRARY_GRANTS_VERSION);
        assert_eq!(stored.grants.len(), 1);
        assert_eq!(stored.grants[0].id, "grant-1");
        assert!(!path.with_extension("json.tmp").exists());
        assert!(!path.with_extension("json.bak").exists());

        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn trash_record_round_trip_preserves_restore_identity() {
        let temp = temp_dir("trash-record");
        let path = temp.join(TRASH_RECORD_FILE);
        let record = TrashRecord {
            version: 1,
            token: "0123456789abcdef0123456789abcdef".to_string(),
            original_path: "/Music/Album/Track.flac".to_string(),
            stored_file_name: "Track.flac".to_string(),
            track: None,
        };

        write_trash_record(&path, &record).expect("write Trash record");
        let loaded = read_trash_record(&path).expect("read Trash record");

        assert_eq!(loaded.token, record.token);
        assert_eq!(loaded.original_path, record.original_path);
        assert_eq!(loaded.stored_file_name, record.stored_file_name);
        assert!(valid_undo_token(&loaded.token));
        assert!(!valid_undo_token("../restore"));

        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn trash_record_reader_rejects_oversized_records() {
        let temp = temp_dir("trash-record-limit");
        let path = temp.join(TRASH_RECORD_FILE);
        fs::write(&path, vec![b'x'; MAX_TRASH_RECORD_BYTES as usize + 1])
            .expect("write oversized record");

        assert!(read_trash_record(&path).is_err());

        let _ = fs::remove_dir_all(temp);
    }

    #[cfg(unix)]
    #[test]
    fn active_roots_rejects_a_grant_replaced_by_symlink() {
        use std::os::unix::fs::symlink;

        let container = temp_dir("grant-symlink");
        let granted = container.join("Music");
        let outside = temp_dir("grant-outside");
        fs::create_dir_all(&granted).expect("create granted folder");
        let stored_path = fs::canonicalize(&granted).expect("canonical grant");
        fs::remove_dir(&granted).expect("remove granted folder");
        symlink(&outside, &granted).expect("replace grant with symlink");
        let grant = LibraryGrantRecord {
            id: "grant-1".to_string(),
            path: stored_path.to_string_lossy().to_string(),
        };

        assert!(active_roots(std::slice::from_ref(&grant)).is_empty());
        assert_eq!(grant_summary(&grant).status, "missing");

        let _ = fs::remove_dir_all(container);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn transient_authority_allows_only_the_exact_file_and_can_be_consumed() {
        let root = temp_dir("transient");
        let allowed = root.join("allowed.mp3");
        let sibling = root.join("sibling.mp3");
        fs::write(&allowed, b"audio").expect("write allowed");
        fs::write(&sibling, b"audio").expect("write sibling");
        let state = create_library_roots_state();

        authorize_transient_file(&state, &allowed).expect("authorize exact file");
        assert!(ensure_path_allowed_by_state(&allowed, &state.read(), "test").is_ok());
        assert!(ensure_path_allowed_by_state(&sibling, &state.read(), "test").is_err());

        consume_transient_file(&state, &allowed);
        assert!(ensure_path_allowed_by_state(&allowed, &state.read(), "test").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_filename_validation_rejects_paths() {
        let source = PathBuf::from("song.mp3");

        assert_eq!(
            ensure_filename_with_extension("renamed", &source).expect("plain filename"),
            "renamed.mp3"
        );
        assert!(ensure_filename_with_extension("nested/song", &source).is_err());
        assert!(ensure_filename_with_extension("../escape", &source).is_err());
        assert!(ensure_filename_with_extension("", &source).is_err());
    }

    #[test]
    fn delete_prevalidation_rejects_mixed_outside_root_before_delete() {
        let allowed_root = temp_dir("allowed");
        let outside_root = temp_dir("outside");
        let allowed_file = allowed_root.join("track.mp3");
        let outside_file = outside_root.join("escape.mp3");
        fs::write(&allowed_file, b"allowed").expect("write allowed");
        fs::write(&outside_file, b"outside").expect("write outside");

        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let paths = vec![
            allowed_file.to_string_lossy().to_string(),
            outside_file.to_string_lossy().to_string(),
        ];

        let result = collect_deletable_paths(&paths, &roots);

        assert!(result.is_err());
        assert!(allowed_file.exists());
        assert!(outside_file.exists());

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn delete_prevalidation_collects_multiple_allowed_files() {
        let allowed_root = temp_dir("multi");
        let first = allowed_root.join("a.mp3");
        let second = allowed_root.join("b.flac");
        fs::write(&first, b"a").expect("write first");
        fs::write(&second, b"b").expect("write second");

        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let paths = vec![
            first.to_string_lossy().to_string(),
            second.to_string_lossy().to_string(),
        ];

        let result = collect_deletable_paths(&paths, &roots).expect("collect allowed");
        assert_eq!(result.len(), 2);

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[cfg(unix)]
    #[test]
    fn mutation_preflight_rejects_symbolic_link_sources() {
        use std::os::unix::fs::symlink;

        let root = temp_dir("mutation-symlink");
        let target = root.join("target.mp3");
        let link = root.join("link.mp3");
        fs::write(&target, b"audio").expect("write target");
        symlink(&target, &link).expect("create symlink");
        let roots = vec![fs::canonicalize(&root).expect("canonical root")];

        assert!(ensure_mutation_source_allowed(&link, &roots, "mutate file").is_err());
        assert!(target.exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn library_roots_drop_duplicates_and_nested_children() {
        let temp = temp_dir("roots");
        let music = temp.join("Music");
        let jazz = music.join("Jazz");
        let other = temp.join("Other");
        fs::create_dir_all(&jazz).expect("create nested music");
        fs::create_dir_all(&other).expect("create other root");

        let music = fs::canonicalize(&music).expect("canonical music");
        let jazz = fs::canonicalize(&jazz).expect("canonical jazz");
        let other = fs::canonicalize(&other).expect("canonical other");

        let normalized = normalize_library_roots(vec![
            jazz.clone(),
            other.clone(),
            music.clone(),
            music.clone(),
        ]);

        assert!(normalized.contains(&music));
        assert!(normalized.contains(&other));
        assert!(!normalized.contains(&jazz));
        assert_eq!(normalized.len(), 2);

        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn target_validation_allows_new_subdirectories_inside_root() {
        let allowed_root = temp_dir("new-subdir");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let target = allowed_root.join("nested").join("album").join("song.mp3");

        let canonical = ensure_target_path_allowed(&target, &roots, "move destination file")
            .expect("target under library root");

        assert_eq!(
            canonical,
            fs::canonicalize(&allowed_root)
                .expect("canonical root")
                .join("nested")
                .join("album")
                .join("song.mp3")
        );

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[test]
    fn target_validation_rejects_parent_dir_traversal() {
        let allowed_root = temp_dir("traversal-allowed");
        let outside_root = temp_dir("traversal-outside");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let target = allowed_root
            .join("nested")
            .join("..")
            .join("..")
            .join(outside_root.file_name().expect("outside name"))
            .join("song.mp3");

        let result = ensure_target_path_allowed(&target, &roots, "move destination file");

        assert!(result.is_err());

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn destination_parent_creation_reports_directory_error() {
        let allowed_root = temp_dir("parent-error");
        let file_parent = allowed_root.join("not-a-dir");
        fs::write(&file_parent, b"file").expect("write file parent");
        let target = file_parent.join("song.mp3");

        let result = create_destination_parent_dir(&target);

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Failed to create destination directory"));

        let _ = fs::remove_dir_all(allowed_root);
    }
}

#[tauri::command]
pub async fn reveal_in_file_manager(
    path: String,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<(), String> {
    let roots_state = roots_state.inner().clone();
    spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if !p.exists() {
            return Err("Path does not exist".to_string());
        }
        let roots = roots_state.read().roots.clone();
        let canonical = canonicalize_existing_path(&p)?;
        ensure_path_allowed(&canonical, &roots, "reveal file path")?;
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg("-R")
                .arg(&p)
                .status()
                .map_err(|e| format!("Failed to reveal: {}", e))?;
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .arg("/select,")
                .arg(&p)
                .status()
                .map_err(|e| format!("Failed to reveal: {}", e))?;
        }
        #[cfg(target_os = "linux")]
        {
            let dir = p
                .parent()
                .ok_or_else(|| "No parent directory".to_string())?;
            std::process::Command::new("xdg-open")
                .arg(dir)
                .status()
                .map_err(|e| format!("Failed to reveal: {}", e))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
