use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::fs;
use std::io::{self, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::{SystemTime, UNIX_EPOCH};
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
const TRASH_RESTORE_PENDING_FILE: &str = "restore-pending";
const MAX_TRASH_RECORD_BYTES: u64 = 64 * 1024;
const MAX_TRASH_ENTRIES: usize = 256;
const FILE_MUTATIONS_DIR: &str = "file-mutations";
const MAX_FILE_MUTATION_BYTES: u64 = 64 * 1024;
const MAX_FILE_MUTATIONS: usize = 1024;
const DESTINATION_OWNERSHIP_SUFFIX: &str = ".destination.json";

static FILE_OPERATION_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[cfg(unix)]
fn sync_parent_directory(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
    }
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrashRecord {
    version: u8,
    token: String,
    original_path: String,
    stored_file_name: String,
    track: Option<DbTrack>,
    #[serde(default)]
    source_identity: Option<FileIdentity>,
    #[serde(default)]
    created_at_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileIdentity {
    identity_a: u64,
    identity_b: u64,
    length: u64,
    modified_a: i64,
    modified_b: i64,
    permissions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DurableMutationRecord {
    version: u8,
    id: String,
    created_at_ms: u64,
    action: DurableMutationAction,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DestinationOwnershipRecord {
    version: u8,
    operation_id: String,
    target_path: String,
    target_identity: FileIdentity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
enum DurableMutationAction {
    MoveFile {
        source_path: String,
        source_track_id: String,
        target_path: String,
        source_identity: FileIdentity,
    },
    DeleteFile {
        source_path: String,
        source_track_id: String,
        source_identity: FileIdentity,
    },
    RemoveLibrarySource {
        grant_id: String,
        folder_path: String,
    },
    ReauthorizeLibrarySource {
        grant_id: String,
        old_path: String,
        new_path: String,
    },
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySourceRemovalResult {
    pub grant_id: String,
    pub path: String,
    pub removed_track_count: usize,
    pub database_cleanup_completed: bool,
    pub cleanup_pending: bool,
    pub cleanup_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverableTrashEntry {
    pub undo_token: String,
    pub original_path: String,
    pub display_name: String,
    pub size_bytes: u64,
    pub created_at_ms: u64,
    pub status: &'static str,
}

#[derive(Clone, Default)]
pub struct LibraryRootsState {
    pub roots: Vec<PathBuf>,
    grants: Vec<LibraryGrantRecord>,
    transient_files: Vec<TransientFileAuthority>,
}

#[derive(Clone)]
struct TransientFileAuthority {
    id: String,
    path: PathBuf,
    identity: FileIdentity,
    metadata_available: bool,
}

pub(crate) struct AuthorizedFileAccess {
    pub(crate) canonical_path: PathBuf,
    pub(crate) expected_identity: Option<FileIdentity>,
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

fn now_millis_u64() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

fn ensure_app_storage_directory(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App data directory not available: {e}"))?;
    fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;
    let directory = app_dir.join(name);
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata_is_link(&metadata) || !metadata.is_dir() => {
            return Err(format!("{name} storage is not a regular directory"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(&directory)
                .map_err(|e| format!("Failed to create {name} storage: {e}"))?;
            sync_parent_directory(&directory);
        }
        Err(error) => return Err(format!("Failed to inspect {name} storage: {error}")),
    }
    fs::canonicalize(&directory).map_err(|error| format!("Failed to resolve {name}: {error}"))
}

fn recoverable_trash_path(app: &AppHandle) -> Result<PathBuf, String> {
    ensure_app_storage_directory(app, RECOVERABLE_TRASH_DIR)
}

fn file_mutations_path(app: &AppHandle) -> Result<PathBuf, String> {
    ensure_app_storage_directory(app, FILE_MUTATIONS_DIR)
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
    let result = file
        .write_all(&bytes)
        .map_err(|e| format!("Failed to write Trash record: {e}"))
        .and_then(|_| {
            file.sync_all()
                .map_err(|e| format!("Failed to sync Trash record: {e}"))
        });
    drop(file);
    if result.is_err() {
        let _ = fs::remove_file(path);
    } else {
        sync_parent_directory(path);
    }
    result
}

fn read_trash_record(path: &Path) -> Result<TrashRecord, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|e| format!("Failed to inspect Trash record: {e}"))?;
    if metadata_is_link(&metadata) || !metadata.is_file() || metadata.len() > MAX_TRASH_RECORD_BYTES
    {
        return Err("Trash record is invalid".to_string());
    }
    let bytes = fs::read(path).map_err(|e| format!("Failed to read Trash record: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Failed to decode Trash record: {e}"))
}

fn restore_marker_exists(path: &Path, token: &str) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("Failed to inspect restore marker: {error}")),
    };
    if metadata_is_link(&metadata) || !metadata.is_file() || metadata.len() > 64 {
        return Err("Restore marker is invalid".to_string());
    }
    let stored_token = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read restore marker: {error}"))?;
    if stored_token != token {
        return Err("Restore marker does not match the recovery token".to_string());
    }
    Ok(true)
}

fn create_restore_marker(path: &Path, token: &str) -> Result<(), String> {
    let mut marker = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("Failed to create restore marker: {error}"))?;
    let result = marker
        .write_all(token.as_bytes())
        .map_err(|error| format!("Failed to write restore marker: {error}"))
        .and_then(|_| {
            marker
                .sync_all()
                .map_err(|error| format!("Failed to sync restore marker: {error}"))
        });
    drop(marker);
    if result.is_err() {
        let _ = fs::remove_file(path);
    } else {
        sync_parent_directory(path);
    }
    result
}

fn files_have_same_contents(left: &Path, right: &Path) -> Result<bool, String> {
    let left_metadata =
        fs::metadata(left).map_err(|error| format!("Failed to inspect restored file: {error}"))?;
    let right_metadata =
        fs::metadata(right).map_err(|error| format!("Failed to inspect Trash file: {error}"))?;
    if left_metadata.len() != right_metadata.len() {
        return Ok(false);
    }

    let mut left_reader = BufReader::new(
        fs::File::open(left).map_err(|error| format!("Failed to open restored file: {error}"))?,
    );
    let mut right_reader = BufReader::new(
        fs::File::open(right).map_err(|error| format!("Failed to open Trash file: {error}"))?,
    );
    let mut left_buffer = [0_u8; 64 * 1024];
    let mut right_buffer = [0_u8; 64 * 1024];
    loop {
        let left_count = left_reader
            .read(&mut left_buffer)
            .map_err(|error| format!("Failed to read restored file: {error}"))?;
        let right_count = right_reader
            .read(&mut right_buffer)
            .map_err(|error| format!("Failed to read Trash file: {error}"))?;
        if left_count != right_count || left_buffer[..left_count] != right_buffer[..right_count] {
            return Ok(false);
        }
        if left_count == 0 {
            return Ok(true);
        }
    }
}

fn write_grants_atomic(path: &Path, grant_file: &LibraryGrantFile) -> Result<(), String> {
    validate_grant_file(grant_file)?;
    let data = serde_json::to_vec_pretty(grant_file)
        .map_err(|e| format!("Failed to serialize library grants: {}", e))?;
    let temp_path = path.with_extension(format!("json.{:032x}.tmp", rand::random::<u128>()));
    let backup_path = path.with_extension("json.bak");

    let mut temp = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .map_err(|e| format!("Failed to create temporary library grants file: {}", e))?;
    let write_result = temp
        .write_all(&data)
        .map_err(|e| format!("Failed to write library grants: {}", e))
        .and_then(|_| {
            temp.sync_all()
                .map_err(|e| format!("Failed to sync library grants: {}", e))
        });
    drop(temp);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    let had_existing = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata_is_link(&metadata) || !metadata.is_file() => {
            let _ = fs::remove_file(&temp_path);
            return Err("Library grants storage is not a regular file".to_string());
        }
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("Failed to inspect library grants: {error}"));
        }
    };
    let existing_is_valid = had_existing && read_grants_file(path).is_ok();
    let mut staged_existing = false;
    if had_existing {
        if existing_is_valid {
            let _ = fs::remove_file(&backup_path);
            if let Err(error) = fs::rename(path, &backup_path) {
                let _ = fs::remove_file(&temp_path);
                return Err(format!("Failed to stage existing library grants: {error}"));
            }
            staged_existing = true;
            sync_parent_directory(&backup_path);
        } else if let Err(error) = fs::remove_file(path) {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("Failed to remove invalid library grants: {error}"));
        }
    }

    if let Err(err) = fs::rename(&temp_path, path) {
        if staged_existing {
            let _ = fs::rename(&backup_path, path);
        }
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Failed to replace library grants: {}", err));
    }
    sync_parent_directory(path);

    if had_existing {
        let _ = fs::remove_file(&backup_path);
        sync_parent_directory(&backup_path);
    }
    Ok(())
}

fn validate_grant_file(file: &LibraryGrantFile) -> Result<(), String> {
    if file.version != LIBRARY_GRANTS_VERSION {
        return Err(format!(
            "Unsupported library grants version: {}",
            file.version
        ));
    }
    let mut ids = std::collections::HashSet::with_capacity(file.grants.len());
    for grant in &file.grants {
        if grant.id.trim().is_empty() || grant.id.len() > 128 || !ids.insert(grant.id.as_str()) {
            return Err("Library grants contain an invalid or duplicate identifier".to_string());
        }
        let path = Path::new(&grant.path);
        if grant.path.trim().is_empty() || !path.is_absolute() {
            return Err("Library grants contain an invalid path".to_string());
        }
    }
    Ok(())
}

fn read_grants_file(path: &Path) -> Result<LibraryGrantFile, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|e| format!("Failed to inspect library grants: {e}"))?;
    if metadata_is_link(&metadata) || !metadata.is_file() {
        return Err("Library grants storage is not a regular file".to_string());
    }
    if metadata.len() > MAX_LIBRARY_GRANTS_BYTES {
        return Err("Library grants storage exceeds the size limit".to_string());
    }
    let data = fs::read(path).map_err(|e| format!("Failed to read library grants: {e}"))?;
    let file: LibraryGrantFile = serde_json::from_slice(&data)
        .map_err(|e| format!("Failed to parse library grants: {e}"))?;
    validate_grant_file(&file)?;
    Ok(file)
}

fn is_grant_temp_path(path: &Path, candidate: &Path) -> bool {
    let Some(base_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(candidate_name) = candidate.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(suffix) = candidate_name
        .strip_prefix(&format!("{base_name}."))
        .and_then(|name| name.strip_suffix(".tmp"))
    else {
        return false;
    };
    valid_undo_token(suffix)
}

fn discover_grant_temp_paths(path: &Path) -> Result<Vec<PathBuf>, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Library grants path has no parent directory".to_string())?;
    let mut paths = Vec::new();
    for entry in fs::read_dir(parent)
        .map_err(|error| format!("Failed to inspect temporary library grants: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to inspect temporary library grants: {error}"))?;
        let candidate = entry.path();
        if is_grant_temp_path(path, &candidate) {
            paths.push(candidate);
        }
    }
    Ok(paths)
}

fn remove_regular_recovery_file(path: &Path) {
    if fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && !metadata_is_link(&metadata))
        && fs::remove_file(path).is_ok()
    {
        sync_parent_directory(path);
    }
}

fn promote_grant_recovery_file(candidate: &Path, path: &Path) -> Result<LibraryGrantFile, String> {
    let file = read_grants_file(candidate)?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata_is_link(&metadata) || !metadata.is_file() => {
            return Err("Library grants storage is not a regular file".to_string());
        }
        Ok(_) => fs::remove_file(path)
            .map_err(|error| format!("Failed to replace invalid library grants: {error}"))?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Failed to inspect library grants: {error}")),
    }
    fs::rename(candidate, path)
        .map_err(|error| format!("Failed to promote recovered library grants: {error}"))?;
    sync_parent_directory(path);
    Ok(file)
}

fn read_grants_with_recovery(path: &Path) -> Result<Vec<LibraryGrantRecord>, String> {
    let backup_path = path.with_extension("json.bak");
    let primary_missing = matches!(
        fs::symlink_metadata(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound
    );
    let backup_missing = matches!(
        fs::symlink_metadata(&backup_path),
        Err(error) if error.kind() == io::ErrorKind::NotFound
    );
    let temp_paths = discover_grant_temp_paths(path)?;

    match read_grants_file(path) {
        Ok(file) => {
            for temp_path in temp_paths {
                remove_regular_recovery_file(&temp_path);
            }
            remove_regular_recovery_file(&backup_path);
            sync_parent_directory(path);
            Ok(file.grants)
        }
        Err(primary_error) => {
            let mut valid_temps = Vec::new();
            for temp_path in temp_paths {
                match read_grants_file(&temp_path) {
                    Ok(_) => {
                        let modified = fs::metadata(&temp_path)
                            .and_then(|metadata| metadata.modified())
                            .unwrap_or(UNIX_EPOCH);
                        valid_temps.push((modified, temp_path));
                    }
                    Err(_) => remove_regular_recovery_file(&temp_path),
                }
            }
            valid_temps
                .sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
            if let Some((_, selected)) = valid_temps.pop() {
                let recovered = promote_grant_recovery_file(&selected, path)?;
                for (_, stale) in valid_temps {
                    remove_regular_recovery_file(&stale);
                }
                remove_regular_recovery_file(&backup_path);
                sync_parent_directory(path);
                return Ok(recovered.grants);
            }

            match read_grants_file(&backup_path) {
                Ok(_) => {
                    let recovered = promote_grant_recovery_file(&backup_path, path)?;
                    Ok(recovered.grants)
                }
                Err(_) if primary_missing && backup_missing => Ok(Vec::new()),
                Err(backup_error) if primary_missing => Err(backup_error),
                Err(_) => Err(primary_error),
            }
        }
    }
}

#[cfg(windows)]
fn metadata_is_link(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_type().is_symlink()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn metadata_is_link(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(unix)]
fn file_identity(file: &fs::File) -> io::Result<FileIdentity> {
    use std::os::unix::fs::MetadataExt;

    let metadata = file.metadata()?;
    Ok(FileIdentity {
        identity_a: metadata.dev(),
        identity_b: metadata.ino(),
        length: metadata.len(),
        modified_a: metadata.mtime(),
        modified_b: metadata.mtime_nsec(),
        permissions: metadata.mode(),
    })
}

#[cfg(windows)]
fn file_identity(file: &fs::File) -> io::Result<FileIdentity> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    unsafe {
        GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut information)
            .map_err(|_| io::Error::last_os_error())?;
    }
    Ok(FileIdentity {
        identity_a: u64::from(information.dwVolumeSerialNumber),
        identity_b: (u64::from(information.nFileIndexHigh) << 32)
            | u64::from(information.nFileIndexLow),
        length: (u64::from(information.nFileSizeHigh) << 32) | u64::from(information.nFileSizeLow),
        modified_a: i64::from(information.ftLastWriteTime.dwHighDateTime),
        modified_b: i64::from(information.ftLastWriteTime.dwLowDateTime),
        permissions: information.dwFileAttributes,
    })
}

#[cfg(not(any(unix, windows)))]
fn file_identity(file: &fs::File) -> io::Result<FileIdentity> {
    let metadata = file.metadata()?;
    let modified = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    Ok(FileIdentity {
        identity_a: 0,
        identity_b: 0,
        length: metadata.len(),
        modified_a: i64::try_from(modified.as_secs()).unwrap_or(i64::MAX),
        modified_b: i64::from(modified.subsec_nanos()),
        permissions: u32::from(metadata.permissions().readonly()),
    })
}

fn file_identity_at_path(path: &Path) -> io::Result<FileIdentity> {
    file_identity(&fs::File::open(path)?)
}

pub(crate) fn open_file_with_identity(
    path: &Path,
    expected: Option<&FileIdentity>,
) -> Result<fs::File, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("Failed to open file {}: {error}", path.display()))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("Failed to inspect file {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err("The authorized path is not a regular file".to_string());
    }
    if let Some(expected) = expected {
        let current = file_identity(&file)
            .map_err(|error| format!("Failed to identify file {}: {error}", path.display()))?;
        if current != *expected {
            return Err("The authorized file has been replaced or modified".to_string());
        }
    }
    Ok(file)
}

fn ensure_file_identity(path: &Path, expected: &FileIdentity) -> io::Result<()> {
    let current = file_identity_at_path(path)?;
    if current == *expected {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "source identity or metadata changed during the operation",
        ))
    }
}

fn remove_file_if_unchanged(path: &Path, expected: &FileIdentity) -> io::Result<()> {
    ensure_file_identity(path, expected)?;
    remove_copied_source(path)
}

#[cfg(windows)]
pub(crate) fn path_to_public_string(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    if let Some(network_path) = normalized.strip_prefix("//?/UNC/") {
        format!("//{network_path}")
    } else {
        normalized
            .strip_prefix("//?/")
            .unwrap_or(&normalized)
            .to_string()
    }
}

#[cfg(not(windows))]
pub(crate) fn path_to_public_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn normalized_grant_path(path: &Path) -> String {
    let mut normalized = path_to_public_string(path).replace('\\', "/");
    while normalized.ends_with('/')
        && normalized != "/"
        && !(normalized.len() == 3 && normalized.as_bytes().get(1) == Some(&b':'))
    {
        normalized.pop();
    }
    #[cfg(windows)]
    {
        normalized.make_ascii_lowercase();
    }
    normalized
}

fn grant_path_contains(parent: &Path, child: &Path) -> bool {
    let parent = normalized_grant_path(parent);
    let child = normalized_grant_path(child);
    child == parent
        || if parent.ends_with('/') {
            child.starts_with(&parent)
        } else {
            child
                .strip_prefix(&parent)
                .is_some_and(|suffix| suffix.starts_with('/'))
        }
}

fn grant_paths_overlap(left: &Path, right: &Path) -> bool {
    grant_path_contains(left, right) || grant_path_contains(right, left)
}

fn durable_mutation_file_name(id: &str) -> String {
    format!("{id}.json")
}

fn destination_ownership_file_name(id: &str) -> String {
    format!("{id}{DESTINATION_OWNERSHIP_SUFFIX}")
}

fn mutation_id_from_path(path: &Path) -> Option<&str> {
    let name = path.file_name()?.to_str()?;
    let id = name.strip_suffix(".json")?;
    valid_undo_token(id).then_some(id)
}

fn destination_ownership_id_from_path(path: &Path) -> Option<&str> {
    let name = path.file_name()?.to_str()?;
    let id = name.strip_suffix(DESTINATION_OWNERSHIP_SUFFIX)?;
    valid_undo_token(id).then_some(id)
}

fn write_durable_mutation_at(
    mutation_root: &Path,
    action: DurableMutationAction,
) -> Result<DurableMutationRecord, String> {
    let existing_count = fs::read_dir(mutation_root)
        .map_err(|error| format!("Failed to inspect file mutation journal: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| mutation_id_from_path(&entry.path()).is_some())
        .take(MAX_FILE_MUTATIONS)
        .count();
    if existing_count >= MAX_FILE_MUTATIONS {
        return Err("The file mutation journal is full; restart Tarab to reconcile it".to_string());
    }

    let record = DurableMutationRecord {
        version: 1,
        id: format!("{:032x}", rand::random::<u128>()),
        created_at_ms: now_millis_u64(),
        action,
    };
    let bytes = serde_json::to_vec(&record)
        .map_err(|error| format!("Failed to encode file mutation intent: {error}"))?;
    if bytes.len() as u64 > MAX_FILE_MUTATION_BYTES {
        return Err("File mutation intent exceeds the allowed size".to_string());
    }
    let path = mutation_root.join(durable_mutation_file_name(&record.id));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| format!("Failed to create file mutation intent: {error}"))?;
    let result = file
        .write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Failed to persist file mutation intent: {error}"));
    drop(file);
    if result.is_err() {
        let _ = fs::remove_file(&path);
    } else {
        sync_parent_directory(&path);
    }
    result.map(|_| record)
}

fn read_durable_mutation(path: &Path) -> Result<DurableMutationRecord, String> {
    let expected_id = mutation_id_from_path(path)
        .ok_or_else(|| "File mutation journal name is invalid".to_string())?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect file mutation intent: {error}"))?;
    if metadata_is_link(&metadata)
        || !metadata.is_file()
        || metadata.len() > MAX_FILE_MUTATION_BYTES
    {
        return Err("File mutation intent is invalid".to_string());
    }
    let bytes =
        fs::read(path).map_err(|error| format!("Failed to read file mutation intent: {error}"))?;
    let record: DurableMutationRecord = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Failed to decode file mutation intent: {error}"))?;
    if record.version != 1 || record.id != expected_id || !valid_undo_token(&record.id) {
        return Err("File mutation intent identity is invalid".to_string());
    }
    Ok(record)
}

fn read_destination_ownership(path: &Path) -> Result<DestinationOwnershipRecord, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect move destination ownership: {error}"))?;
    if metadata_is_link(&metadata)
        || !metadata.is_file()
        || metadata.len() > MAX_FILE_MUTATION_BYTES
    {
        return Err("Move destination ownership record is invalid".to_string());
    }
    let bytes = fs::read(path)
        .map_err(|error| format!("Failed to read move destination ownership: {error}"))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Failed to decode move destination ownership: {error}"))
}

fn write_destination_ownership_at(
    mutation_root: &Path,
    operation_id: &str,
    target: &Path,
    target_identity: FileIdentity,
) -> Result<(), String> {
    if !valid_undo_token(operation_id) {
        return Err("Move destination ownership identity is invalid".to_string());
    }
    let target_path = path_to_public_string(target);
    let mutation =
        read_durable_mutation(&mutation_root.join(durable_mutation_file_name(operation_id)))?;
    if !matches!(
        mutation.action,
        DurableMutationAction::MoveFile {
            ref target_path,
            ..
        } if *target_path == path_to_public_string(target)
    ) {
        return Err("Move destination does not match its durable intent".to_string());
    }

    let record = DestinationOwnershipRecord {
        version: 1,
        operation_id: operation_id.to_string(),
        target_path,
        target_identity,
    };
    let path = mutation_root.join(destination_ownership_file_name(operation_id));
    let bytes = serde_json::to_vec(&record)
        .map_err(|error| format!("Failed to encode move destination ownership: {error}"))?;
    if bytes.len() as u64 > MAX_FILE_MUTATION_BYTES {
        return Err("Move destination ownership record exceeds the allowed size".to_string());
    }
    let mut file = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            return if read_destination_ownership(&path)? == record {
                Ok(())
            } else {
                Err("Move destination ownership record conflicts with its intent".to_string())
            };
        }
        Err(error) => {
            return Err(format!(
                "Failed to create move destination ownership record: {error}"
            ))
        }
    };
    let result = file
        .write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Failed to persist move destination ownership: {error}"));
    drop(file);
    if result.is_err() {
        let _ = fs::remove_file(&path);
    } else {
        sync_parent_directory(&path);
    }
    result
}

fn destination_is_owned_by_move(
    mutation_root: &Path,
    record: &DurableMutationRecord,
    target_path: &str,
    source_identity: &FileIdentity,
    target_identity: &FileIdentity,
) -> Result<bool, String> {
    if target_identity == source_identity {
        return Ok(true);
    }

    let ownership_path = mutation_root.join(destination_ownership_file_name(&record.id));
    let ownership = match read_destination_ownership(&ownership_path) {
        Ok(ownership) => ownership,
        Err(_error)
            if fs::symlink_metadata(&ownership_path)
                .is_err_and(|metadata_error| metadata_error.kind() == io::ErrorKind::NotFound) =>
        {
            return Ok(false)
        }
        Err(error) => return Err(error),
    };
    Ok(ownership.version == 1
        && ownership.operation_id == record.id
        && ownership.target_path == target_path
        && ownership.target_identity == *target_identity)
}

fn remove_durable_mutation(mutation_root: &Path, id: &str) -> Result<(), String> {
    if !valid_undo_token(id) {
        return Err("File mutation intent identity is invalid".to_string());
    }
    let path = mutation_root.join(durable_mutation_file_name(id));
    match fs::remove_file(&path) {
        Ok(()) => {
            sync_parent_directory(&path);
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Failed to clear file mutation intent: {error}")),
    }
    let ownership_path = mutation_root.join(destination_ownership_file_name(id));
    match fs::remove_file(&ownership_path) {
        Ok(()) => sync_parent_directory(&ownership_path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Failed to clear move destination ownership: {error}"
            ))
        }
    }
    Ok(())
}

fn path_has_link_component(path: &Path) -> bool {
    path.ancestors().any(|ancestor| {
        fs::symlink_metadata(ancestor)
            .map(|metadata| metadata_is_link(&metadata))
            .unwrap_or(true)
    })
}

fn validate_trash_entry_dir(trash_root: &Path, entry_dir: &Path) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(entry_dir)
        .map_err(|error| format!("Failed to inspect recoverable Trash entry: {error}"))?;
    if metadata_is_link(&metadata) || !metadata.is_dir() {
        return Err("Recoverable Trash entry is not a regular directory".to_string());
    }
    let canonical = fs::canonicalize(entry_dir)
        .map_err(|error| format!("Failed to resolve recoverable Trash entry: {error}"))?;
    if canonical.parent() != Some(trash_root) {
        return Err("Recoverable Trash entry escaped app storage".to_string());
    }
    Ok(canonical)
}

fn recoverable_trash_record_count(trash_root: &Path) -> Result<usize, String> {
    let mut count = 0;
    for entry in fs::read_dir(trash_root)
        .map_err(|error| format!("Failed to inspect recoverable Trash: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to inspect recoverable Trash: {error}"))?;
        let Some(token) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !valid_undo_token(&token) {
            continue;
        }
        let entry_dir = match validate_trash_entry_dir(trash_root, &entry.path()) {
            Ok(path) => path,
            Err(_) => continue,
        };
        if read_trash_record(&entry_dir.join(TRASH_RECORD_FILE))
            .is_ok_and(|record| record.version == 1 && record.token == token)
        {
            count += 1;
        }
    }
    Ok(count)
}

fn active_roots(grants: &[LibraryGrantRecord]) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for grant in grants {
        let path = PathBuf::from(&grant.path);
        if path.is_dir() && !path_has_link_component(&path) {
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
    let available =
        path.is_dir() && !path_has_link_component(&path) && fs::canonicalize(&path).is_ok();
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
    let grants = read_grants_with_recovery(&path)?;
    let (grants, migrated) = normalize_legacy_grants(grants);
    if migrated {
        persist_grants(app, &grants)?;
    }
    let roots = active_roots(&grants);
    Ok(Arc::new(RwLock::new(LibraryRootsState {
        roots,
        grants,
        transient_files: Vec::new(),
    })))
}

fn normalize_legacy_grants(grants: Vec<LibraryGrantRecord>) -> (Vec<LibraryGrantRecord>, bool) {
    let mut migrated = false;
    let mut seen = std::collections::HashSet::with_capacity(grants.len());
    let grants: Vec<LibraryGrantRecord> = grants
        .into_iter()
        .filter_map(|mut grant| {
            let public = path_to_public_string(Path::new(&grant.path));
            let cleaned = if public.ends_with('/')
                && public != "/"
                && !(public.len() == 3 && public.as_bytes().get(1) == Some(&b':'))
            {
                public.trim_end_matches('/').to_string()
            } else {
                public
            };
            if cleaned != grant.path {
                migrated = true;
                grant.path = cleaned;
            }
            if seen.insert(grant.path.clone()) {
                Some(grant)
            } else {
                migrated = true;
                None
            }
        })
        .collect();
    (grants, migrated)
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

    let canonical_string = path_to_public_string(&canonical);
    let mutation_root = file_mutations_path(&app)?;
    let _operation_lock = FILE_OPERATION_LOCK.lock();

    let mut state = roots_state.write();
    let current = state.grants.clone();
    let grant = current
        .iter()
        .find(|grant| grant.id == grant_id)
        .cloned()
        .ok_or_else(|| "The library source no longer exists".to_string())?;
    if current.iter().any(|candidate| {
        candidate.id != grant_id && grant_paths_overlap(&canonical, Path::new(&candidate.path))
    }) {
        return Err("The selected folder overlaps another library source".to_string());
    }

    let mut next = current.clone();
    if let Some(entry) = next.iter_mut().find(|entry| entry.id == grant_id) {
        entry.path = canonical_string.clone();
    }
    let intent = write_durable_mutation_at(
        &mutation_root,
        DurableMutationAction::ReauthorizeLibrarySource {
            grant_id: grant_id.clone(),
            old_path: grant.path.clone(),
            new_path: canonical_string.clone(),
        },
    )?;
    if let Err(error) = persist_grants(&app, &next) {
        let _ = remove_durable_mutation(&mutation_root, &intent.id);
        return Err(error);
    }

    state.grants = next.clone();
    state.roots = active_roots(&state.grants);
    if let Err(error) = db.rebase_track_paths(&grant.path, &canonical_string) {
        match persist_grants(&app, &current) {
            Ok(()) => {
                state.grants = current;
                state.roots = active_roots(&state.grants);
                let _ = remove_durable_mutation(&mutation_root, &intent.id);
                return Err(format!("Failed to reconnect indexed tracks: {error}"));
            }
            Err(rollback_error) => {
                return Err(format!(
                    "The library grant was reauthorized, but indexed paths could not be rebased ({error}) and the grant rollback failed ({rollback_error}); Tarab will retry reconciliation at startup"
                ));
            }
        }
    }
    let _ = remove_durable_mutation(&mutation_root, &intent.id);

    let updated = next
        .iter()
        .find(|entry| entry.id == grant_id)
        .cloned()
        .ok_or_else(|| "The reconnected library source was lost".to_string())?;
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
    let canonical_string = path_to_public_string(&canonical);
    let mut state = roots_state.write();
    let current = state.grants.clone();
    if let Some(existing) = current
        .iter()
        .find(|grant| grant_path_contains(Path::new(&grant.path), &canonical))
    {
        return Ok(grant_summary(existing));
    }

    let mut next = current;
    next.retain(|grant| !grant_path_contains(&canonical, Path::new(&grant.path)));
    let grant = LibraryGrantRecord {
        id: format!("{:032x}", rand::random::<u128>()),
        path: canonical_string,
    };
    next.push(grant.clone());
    next.sort_by(|a, b| a.path.cmp(&b.path));
    persist_grants(app, &next)?;

    state.grants = next;
    state.roots = active_roots(&state.grants);
    Ok(grant_summary(&grant))
}

pub(crate) fn authorize_transient_file(
    roots_state: &SharedLibraryRoots,
    path: &Path,
) -> Result<String, String> {
    let canonical = canonicalize_existing_path(path)?;
    if !canonical.is_file() {
        return Err("Launch file is not a regular file".to_string());
    }
    let identity = file_identity_at_path(&canonical)
        .map_err(|error| format!("Failed to identify launch file: {error}"))?;
    let id = format!("{:032x}", rand::random::<u128>());
    let mut state = roots_state.write();
    state.transient_files.push(TransientFileAuthority {
        id: id.clone(),
        path: canonical,
        identity,
        metadata_available: true,
    });
    Ok(id)
}

pub(crate) fn claim_metadata_file_access(
    roots_state: &SharedLibraryRoots,
    path: &Path,
    authority_id: Option<&str>,
    action: &str,
) -> Result<AuthorizedFileAccess, String> {
    let canonical = canonicalize_existing_path(path)?;
    let authority = {
        let mut state = roots_state.write();
        if is_path_allowed(&canonical, &state.roots) {
            return Ok(AuthorizedFileAccess {
                canonical_path: canonical,
                expected_identity: None,
            });
        }

        let authority_id = authority_id.ok_or_else(|| {
            format!(
                "Blocked {} outside configured library roots: {}",
                action,
                canonical.display()
            )
        })?;
        let Some(index) = state
            .transient_files
            .iter()
            .position(|authority| authority.id == authority_id)
        else {
            return Err("The Play Once authority is no longer available".to_string());
        };
        if !state.transient_files[index].metadata_available {
            return Err("The Play Once metadata authority has already been used".to_string());
        }
        state.transient_files[index].metadata_available = false;
        state.transient_files[index].clone()
    };

    if authority.path != canonical || ensure_file_identity(&canonical, &authority.identity).is_err()
    {
        let _ = revoke_transient_file_authority(roots_state, &authority.id);
        return Err("The Play Once authority does not match this file".to_string());
    }

    Ok(AuthorizedFileAccess {
        canonical_path: canonical,
        expected_identity: Some(authority.identity),
    })
}

pub(crate) fn consume_play_once_file_access(
    roots_state: &SharedLibraryRoots,
    path: &Path,
    authority_id: Option<&str>,
    action: &str,
) -> Result<AuthorizedFileAccess, String> {
    let canonical = canonicalize_existing_path(path)?;
    let authority = {
        let mut state = roots_state.write();
        if is_path_allowed(&canonical, &state.roots) {
            if let Some(authority_id) = authority_id {
                state.transient_files.retain(|authority| {
                    authority.id != authority_id || authority.path != canonical
                });
            }
            return Ok(AuthorizedFileAccess {
                canonical_path: canonical,
                expected_identity: None,
            });
        }

        let authority_id = authority_id.ok_or_else(|| {
            format!(
                "Blocked {} outside configured library roots: {}",
                action,
                canonical.display()
            )
        })?;
        let index = state
            .transient_files
            .iter()
            .position(|authority| authority.id == authority_id)
            .ok_or_else(|| "The Play Once authority is no longer available".to_string())?;
        state.transient_files.remove(index)
    };

    if authority.path != canonical || ensure_file_identity(&canonical, &authority.identity).is_err()
    {
        return Err("The Play Once authority does not match this file".to_string());
    }

    Ok(AuthorizedFileAccess {
        canonical_path: canonical,
        expected_identity: Some(authority.identity),
    })
}

pub(crate) fn revoke_transient_file_authority(
    roots_state: &SharedLibraryRoots,
    authority_id: &str,
) -> Result<(), String> {
    if !valid_undo_token(authority_id) {
        return Err("The Play Once authority identifier is invalid".to_string());
    }
    roots_state
        .write()
        .transient_files
        .retain(|authority| authority.id != authority_id);
    Ok(())
}

#[tauri::command]
pub fn remove_library_source(
    app: AppHandle,
    grant_id: String,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<LibrarySourceRemovalResult, String> {
    let _operation_lock = FILE_OPERATION_LOCK.lock();
    let mutation_root = file_mutations_path(&app)?;
    let mut state = roots_state.write();
    let current = state.grants.clone();
    let grant = current
        .iter()
        .find(|grant| grant.id == grant_id)
        .cloned()
        .ok_or_else(|| "The library source no longer exists".to_string())?;
    let mut next = current.clone();
    next.retain(|grant| grant.id != grant_id);
    let intent = write_durable_mutation_at(
        &mutation_root,
        DurableMutationAction::RemoveLibrarySource {
            grant_id: grant_id.clone(),
            folder_path: grant.path.clone(),
        },
    )?;
    if let Err(error) = persist_grants(&app, &next) {
        let _ = remove_durable_mutation(&mutation_root, &intent.id);
        return Err(error);
    }
    state.grants = next;
    state.roots = active_roots(&state.grants);

    match db.delete_tracks_for_library_source(&grant.path) {
        Ok(removed_track_count) => {
            let cleanup_error = remove_durable_mutation(&mutation_root, &intent.id).err();
            Ok(LibrarySourceRemovalResult {
                grant_id,
                path: grant.path,
                removed_track_count,
                database_cleanup_completed: true,
                cleanup_pending: cleanup_error.is_some(),
                cleanup_error,
            })
        }
        Err(error) => Ok(LibrarySourceRemovalResult {
            grant_id,
            path: grant.path,
            removed_track_count: 0,
            database_cleanup_completed: false,
            cleanup_pending: true,
            cleanup_error: Some(format!(
                "The source grant was revoked, but indexed-track cleanup will be retried at startup: {error}"
            )),
        }),
    }
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
    if metadata_is_link(&metadata) {
        return Err(format!("Blocked {action} through a symbolic link"));
    }
    if !metadata.is_file() {
        return Err(format!("Blocked {action}: target is not a regular file"));
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

fn target_entry_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Failed to inspect destination {}: {error}",
            path.display()
        )),
    }
}

fn staged_move_path(target: &Path, operation_id: &str) -> Result<PathBuf, String> {
    if !valid_undo_token(operation_id) {
        return Err("File move identity is invalid".to_string());
    }
    let target_parent = target
        .parent()
        .ok_or_else(|| "Destination has no parent directory".to_string())?;
    Ok(target_parent.join(format!(".tarab-move-{operation_id}.tmp")))
}

fn copy_regular_file_no_replace_checked(
    source: &Path,
    target: &Path,
    expected_identity: &FileIdentity,
    operation_id: &str,
    ownership_root: Option<&Path>,
) -> Result<(), String> {
    let mut input = fs::File::open(source)
        .map_err(|error| format!("Failed to open source {}: {error}", source.display()))?;
    if file_identity(&input)
        .map_err(|error| format!("Failed to identify source {}: {error}", source.display()))?
        != *expected_identity
    {
        return Err("Source identity or metadata changed before it could be copied".to_string());
    }
    let staged_path = staged_move_path(target, operation_id)?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staged_path)
        .map_err(|error| {
            format!(
                "Failed to create staged destination {}: {error}",
                staged_path.display()
            )
        })?;

    let copy_result = io::copy(&mut input, &mut output)
        .map(|_| ())
        .and_then(|_| output.sync_all())
        .map_err(|error| format!("Failed to stage file at {}: {error}", staged_path.display()));
    drop(output);
    if let Err(error) = copy_result {
        let _ = fs::remove_file(&staged_path);
        return Err(error);
    }

    let source_permissions = input.metadata().ok().map(|metadata| metadata.permissions());
    if let Some(permissions) = source_permissions {
        let _ = fs::set_permissions(&staged_path, permissions);
    }
    if file_identity(&input).map_err(|error| format!("Failed to recheck copied source: {error}"))?
        != *expected_identity
        || ensure_file_identity(source, expected_identity).is_err()
    {
        let _ = fs::remove_file(&staged_path);
        return Err("Source identity or metadata changed while it was being copied".to_string());
    }
    let staged_identity = match file_identity_at_path(&staged_path) {
        Ok(identity) => identity,
        Err(error) => {
            let _ = fs::remove_file(&staged_path);
            return Err(format!("Failed to identify staged destination: {error}"));
        }
    };
    if let Err(error) = claim_staged_file(&staged_path, target) {
        let _ = fs::remove_file(&staged_path);
        return Err(
            if error.kind() == io::ErrorKind::AlreadyExists || target_entry_exists(target)? {
                "Target file already exists".to_string()
            } else {
                format!("Failed to claim destination {}: {error}", target.display())
            },
        );
    }
    sync_parent_directory(target);

    let target_identity = match file_identity_at_path(target) {
        Ok(identity) => identity,
        Err(error) => {
            return Err(format!("Failed to identify claimed destination: {error}"));
        }
    };
    if target_identity != staged_identity {
        return Err(
            "Claimed destination changed before Tarab could establish ownership; the source was retained"
                .to_string(),
        );
    }
    if let Some(mutation_root) = ownership_root {
        if let Err(error) =
            write_destination_ownership_at(mutation_root, operation_id, target, target_identity)
        {
            let cleanup = remove_file_if_unchanged(target, &target_identity);
            return Err(match cleanup {
                Ok(()) => format!(
                    "Failed to prove ownership of the copied destination; the source was retained: {error}"
                ),
                Err(cleanup_error) => format!(
                    "Failed to prove ownership of the copied destination ({error}) and could not remove it ({cleanup_error}); the source was retained"
                ),
            });
        }
    }

    ensure_file_identity(target, &target_identity)
        .map_err(|error| format!("Claimed destination changed before source removal: {error}"))?;
    if let Err(error) = remove_file_if_unchanged(source, expected_identity) {
        let cleanup_error = remove_file_if_unchanged(target, &target_identity).err();
        return Err(match cleanup_error {
            Some(cleanup) => format!(
                "Copied the file but could not remove the source ({error}) or destination ({cleanup})"
            ),
            None => format!("Copied the file but could not remove the source: {error}"),
        });
    }
    Ok(())
}

#[cfg(test)]
fn copy_regular_file_no_replace(source: &Path, target: &Path) -> Result<(), String> {
    let identity = file_identity_at_path(source)
        .map_err(|error| format!("Failed to identify source {}: {error}", source.display()))?;
    let operation_id = format!("{:032x}", rand::random::<u128>());
    copy_regular_file_no_replace_checked(source, target, &identity, &operation_id, None)
}

#[cfg(windows)]
#[allow(clippy::permissions_set_readonly_false)]
fn remove_copied_source(source: &Path) -> io::Result<()> {
    let permissions = fs::metadata(source)?.permissions();
    if !permissions.readonly() {
        return fs::remove_file(source);
    }
    let mut writable = permissions.clone();
    writable.set_readonly(false);
    fs::set_permissions(source, writable)?;
    match fs::remove_file(source) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::set_permissions(source, permissions);
            Err(error)
        }
    }
}

#[cfg(not(windows))]
fn remove_copied_source(source: &Path) -> io::Result<()> {
    fs::remove_file(source)
}

#[cfg(windows)]
fn claim_staged_file(staged_path: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::MoveFileW;

    let staged_wide = staged_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target_wide = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe { MoveFileW(PCWSTR(staged_wide.as_ptr()), PCWSTR(target_wide.as_ptr())) }
        .map_err(|_| io::Error::last_os_error())
}

#[cfg(not(windows))]
fn claim_staged_file(staged_path: &Path, target: &Path) -> io::Result<()> {
    fs::hard_link(staged_path, target)?;
    fs::remove_file(staged_path)
}

#[cfg(windows)]
fn move_regular_file_no_replace_checked(
    source: &Path,
    target: &Path,
    expected_identity: &FileIdentity,
    operation_id: &str,
    ownership_root: Option<&Path>,
) -> Result<(), String> {
    if source == target {
        return Ok(());
    }
    ensure_file_identity(source, expected_identity)
        .map_err(|error| format!("Source changed before move: {error}"))?;
    match claim_staged_file(source, target) {
        Ok(()) => {
            sync_parent_directory(target);
            Ok(())
        }
        Err(move_error) => {
            if target_entry_exists(target)? {
                return Err("Target file already exists".to_string());
            }
            copy_regular_file_no_replace_checked(
                source,
                target,
                expected_identity,
                operation_id,
                ownership_root,
            )
            .map_err(|copy_error| {
                format!(
                    "Failed to move file without replacing another file (move: {move_error}; copy: {copy_error})"
                )
            })
        }
    }
}

#[cfg(not(windows))]
fn move_regular_file_no_replace_checked(
    source: &Path,
    target: &Path,
    expected_identity: &FileIdentity,
    operation_id: &str,
    ownership_root: Option<&Path>,
) -> Result<(), String> {
    if source == target {
        return Ok(());
    }
    ensure_file_identity(source, expected_identity)
        .map_err(|error| format!("Source changed before move: {error}"))?;
    match fs::hard_link(source, target) {
        Ok(()) => {
            sync_parent_directory(target);
            if let Err(error) = remove_file_if_unchanged(source, expected_identity) {
                let cleanup_error = remove_file_if_unchanged(target, expected_identity).err();
                return Err(match cleanup_error {
                    Some(cleanup) => format!(
                        "Claimed the destination but could not remove the source ({error}) or destination ({cleanup})"
                    ),
                    None => format!("Claimed the destination but could not remove the source: {error}"),
                });
            }
            Ok(())
        }
        Err(link_error) => {
            if target_entry_exists(target)? {
                return Err("Target file already exists".to_string());
            }
            copy_regular_file_no_replace_checked(
                source,
                target,
                expected_identity,
                operation_id,
                ownership_root,
            )
            .map_err(|copy_error| {
                format!(
                    "Failed to move file without replacing another file (link: {link_error}; copy: {copy_error})"
                )
            })
        }
    }
}

#[cfg(test)]
fn move_regular_file_no_replace(source: &Path, target: &Path) -> Result<(), String> {
    let identity = file_identity_at_path(source)
        .map_err(|error| format!("Failed to identify source {}: {error}", source.display()))?;
    let operation_id = format!("{:032x}", rand::random::<u128>());
    move_regular_file_no_replace_checked(source, target, &identity, &operation_id, None)
}

#[tauri::command]
pub async fn rename_file(
    app: AppHandle,
    old_path: String,
    new_name: String,
    db: tauri::State<'_, SharedDatabase>,
    audio: tauri::State<'_, SharedAudioManager>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<String, String> {
    let mutation_root = file_mutations_path(&app)?;
    let db = db.inner().clone();
    let audio = audio.inner().clone();
    let roots_state = roots_state.inner().clone();
    spawn_blocking(move || {
        let _operation_lock = FILE_OPERATION_LOCK.lock();
        let source = PathBuf::from(&old_path);
        if !source.exists() {
            return Err(format!("File does not exist: {}", old_path));
        }
        let roots_guard = roots_state.read();
        let roots = &roots_guard.roots;
        let source_canonical =
            ensure_mutation_source_allowed(&source, roots, "rename source file")?;
        let parent = source_canonical
            .parent()
            .ok_or_else(|| "Source has no parent directory".to_string())?;
        let final_name = ensure_filename_with_extension(&new_name, &source_canonical)?;
        let target = parent.join(final_name);
        let target = ensure_target_path_allowed(&target, roots, "rename destination file")?;
        if source_canonical == target {
            return Ok(path_to_public_string(&target));
        }
        if target_entry_exists(&target)? {
            return Err("Target file already exists".to_string());
        }
        let source_identity = file_identity_at_path(&source_canonical)
            .map_err(|error| format!("Failed to identify rename source: {error}"))?;
        let source_path = path_to_public_string(&source_canonical);
        let target_str = path_to_public_string(&target);
        let intent = write_durable_mutation_at(
            &mutation_root,
            DurableMutationAction::MoveFile {
                source_path,
                source_track_id: old_path.clone(),
                target_path: target_str.clone(),
                source_identity,
            },
        )?;
        if let Err(error) = move_regular_file_no_replace_checked(
            &source_canonical,
            &target,
            &source_identity,
            &intent.id,
            Some(&mutation_root),
        ) {
            if !target_entry_exists(&target).unwrap_or(true) {
                let _ = remove_durable_mutation(&mutation_root, &intent.id);
            }
            return Err(error);
        }
        if let Err(err) = db.rename_track_path(&old_path, &target_str) {
            let rollback_result = file_identity_at_path(&target)
                .map_err(|error| format!("Failed to identify rollback source: {error}"))
                .and_then(|target_identity| {
                    move_regular_file_no_replace_checked(
                        &target,
                        &source_canonical,
                        &target_identity,
                        &intent.id,
                        None,
                    )
                });
            return match rollback_result {
                Ok(()) => {
                    let _ = remove_durable_mutation(&mutation_root, &intent.id);
                    Err(format!(
                        "Failed to update database after rename, operation rolled back: {}",
                        err
                    ))
                }
                Err(rollback_err) => Err(format!(
                    "Failed to update database after rename and rollback failed; Tarab will reconcile the durable mutation at startup. DB error: {}. Rollback error: {}",
                    err, rollback_err
                )),
            };
        }
        let _ = remove_durable_mutation(&mutation_root, &intent.id);
        let _ = audio.source_renamed(
            old_path,
            target_str.clone(),
            target.to_string_lossy().into_owned(),
        );
        Ok(target_str)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn move_file(
    app: AppHandle,
    old_path: String,
    new_path: String,
    db: tauri::State<'_, SharedDatabase>,
    audio: tauri::State<'_, SharedAudioManager>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<String, String> {
    let mutation_root = file_mutations_path(&app)?;
    let db = db.inner().clone();
    let audio = audio.inner().clone();
    let roots_state = roots_state.inner().clone();
    spawn_blocking(move || {
        let _operation_lock = FILE_OPERATION_LOCK.lock();
        let source = PathBuf::from(&old_path);
        if !source.exists() {
            return Err(format!("File does not exist: {}", old_path));
        }
        let roots_guard = roots_state.read();
        let roots = &roots_guard.roots;
        let source_canonical = ensure_mutation_source_allowed(&source, roots, "move source file")?;
        let mut target = PathBuf::from(&new_path);
        if target.is_dir() || new_path.ends_with(std::path::MAIN_SEPARATOR) {
            let file_name = source_canonical
                .file_name()
                .ok_or_else(|| "Could not determine file name".to_string())?;
            target = target.join(file_name);
        }
        let mut target = ensure_target_path_allowed(&target, roots, "move destination file")?;
        create_destination_parent_dir(&target)?;
        target = ensure_target_path_allowed(&target, roots, "move destination file")?;
        if source_canonical == target {
            return Ok(path_to_public_string(&target));
        }
        if target_entry_exists(&target)? {
            return Err("Target file already exists".to_string());
        }
        let source_identity = file_identity_at_path(&source_canonical)
            .map_err(|error| format!("Failed to identify move source: {error}"))?;
        let source_path = path_to_public_string(&source_canonical);
        let target_str = path_to_public_string(&target);
        let intent = write_durable_mutation_at(
            &mutation_root,
            DurableMutationAction::MoveFile {
                source_path,
                source_track_id: old_path.clone(),
                target_path: target_str.clone(),
                source_identity,
            },
        )?;
        if let Err(error) = move_regular_file_no_replace_checked(
            &source_canonical,
            &target,
            &source_identity,
            &intent.id,
            Some(&mutation_root),
        ) {
            if !target_entry_exists(&target).unwrap_or(true) {
                let _ = remove_durable_mutation(&mutation_root, &intent.id);
            }
            return Err(error);
        }
        if let Err(err) = db.rename_track_path(&old_path, &target_str) {
            let rollback_result = file_identity_at_path(&target)
                .map_err(|error| format!("Failed to identify rollback source: {error}"))
                .and_then(|target_identity| {
                    move_regular_file_no_replace_checked(
                        &target,
                        &source_canonical,
                        &target_identity,
                        &intent.id,
                        None,
                    )
                });
            return match rollback_result {
                Ok(()) => {
                    let _ = remove_durable_mutation(&mutation_root, &intent.id);
                    Err(format!(
                        "Failed to update database after move, operation rolled back: {}",
                        err
                    ))
                }
                Err(rollback_err) => Err(format!(
                    "Failed to update database after move and rollback failed; Tarab will reconcile the durable mutation at startup. DB error: {}. Rollback error: {}",
                    err, rollback_err
                )),
            };
        }
        let _ = remove_durable_mutation(&mutation_root, &intent.id);
        let _ = audio.source_renamed(
            old_path,
            target_str.clone(),
            target.to_string_lossy().into_owned(),
        );
        Ok(target_str)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read_trash_track_snapshot(
    db: &SharedDatabase,
    original_path: &str,
) -> Result<Option<DbTrack>, String> {
    db.get_tracks_by_ids(&[original_path.to_string()])
        .map(|mut tracks| tracks.pop())
        .map_err(|error| {
            format!(
                "Failed to read the database snapshot before moving {} to Trash: {}",
                original_path, error
            )
        })
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
        let _operation_lock = FILE_OPERATION_LOCK.lock();
        let roots_guard = roots_state.read();
        let roots = &roots_guard.roots;
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
                ensure_mutation_source_allowed(&source, roots, "move file to Trash")
            };
            let track = if validation.is_ok() {
                read_trash_track_snapshot(&db, original_path)?
            } else {
                None
            };
            planned.push((original_path.clone(), validation, track));
        }

        let mut results = Vec::with_capacity(planned.len());
        let mut trash_entry_count = recoverable_trash_record_count(&trash_root)?;
        for (original_path, validation, track) in planned {
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
            if trash_entry_count >= MAX_TRASH_ENTRIES {
                results.push(FileMutationResult {
                    path: original_path,
                    status: "failed".to_string(),
                    operation: "trash".to_string(),
                    error_code: Some("trashLimitReached".to_string()),
                    recoverable: true,
                    error_message: Some(format!(
                        "Tarab Trash is limited to {MAX_TRASH_ENTRIES} entries; restore or purge an entry in Settings"
                    )),
                    undo_token: None,
                });
                continue;
            }
            let source_identity = match file_identity_at_path(&canonical_path) {
                Ok(identity) => identity,
                Err(error) => {
                    results.push(FileMutationResult {
                        path: original_path,
                        status: "failed".to_string(),
                        operation: "trash".to_string(),
                        error_code: Some("preflightFailed".to_string()),
                        recoverable: true,
                        error_message: Some(format!("Failed to identify Trash source: {error}")),
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
            let record = TrashRecord {
                version: 1,
                token: token.clone(),
                original_path: original_path.clone(),
                stored_file_name,
                track,
                source_identity: Some(source_identity),
                created_at_ms: now_millis_u64(),
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
            trash_entry_count += 1;
            if let Err(error) = move_regular_file_no_replace_checked(
                &canonical_path,
                &stored_path,
                &source_identity,
                &token,
                None,
            ) {
                let retained = target_entry_exists(&stored_path).unwrap_or(true);
                if !retained {
                    let _ = fs::remove_file(entry_dir.join(TRASH_RECORD_FILE));
                    let _ = fs::remove_dir(&entry_dir);
                    trash_entry_count = trash_entry_count.saturating_sub(1);
                }
                results.push(FileMutationResult {
                    path: original_path,
                    status: "failed".to_string(),
                    operation: "trash".to_string(),
                    error_code: Some("fileTrashFailed".to_string()),
                    recoverable: true,
                    error_message: Some(error.to_string()),
                    undo_token: retained.then_some(token),
                });
                continue;
            }
            if let Err(error) = db.delete_tracks(std::slice::from_ref(&original_path)) {
                let rollback = file_identity_at_path(&stored_path)
                    .map_err(|error| format!("Failed to identify Trash rollback source: {error}"))
                    .and_then(|stored_identity| {
                        move_regular_file_no_replace_checked(
                            &stored_path,
                            &canonical_path,
                            &stored_identity,
                            &token,
                            None,
                        )
                    });
                if rollback.is_ok() {
                    let _ = fs::remove_file(entry_dir.join(TRASH_RECORD_FILE));
                    let _ = fs::remove_dir(&entry_dir);
                    trash_entry_count = trash_entry_count.saturating_sub(1);
                }
                results.push(FileMutationResult {
                    path: original_path,
                    status: "failed".to_string(),
                    operation: "trash".to_string(),
                    error_code: Some("databaseSyncFailed".to_string()),
                    recoverable: rollback.is_err(),
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

fn stored_trash_path(entry_dir: &Path, record: &TrashRecord) -> Result<PathBuf, String> {
    let is_safe = matches!(
        Path::new(&record.stored_file_name)
            .components()
            .collect::<Vec<_>>()
            .as_slice(),
        [Component::Normal(_)]
    );
    if !is_safe {
        return Err("The Trash record contains an invalid file name".to_string());
    }
    Ok(entry_dir.join(&record.stored_file_name))
}

fn trash_record_created_at(record_path: &Path, record: &TrashRecord) -> u64 {
    if record.created_at_ms != 0 {
        return record.created_at_ms;
    }
    fs::metadata(record_path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

fn list_recoverable_trash_entries_at(
    trash_root: &Path,
) -> Result<Vec<RecoverableTrashEntry>, String> {
    let mut entries = Vec::new();
    for directory in fs::read_dir(trash_root)
        .map_err(|error| format!("Failed to inspect recoverable Trash: {error}"))?
    {
        let directory =
            directory.map_err(|error| format!("Failed to inspect recoverable Trash: {error}"))?;
        let Some(token) = directory.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !valid_undo_token(&token) {
            continue;
        }
        let entry_dir = match validate_trash_entry_dir(trash_root, &directory.path()) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let record_path = entry_dir.join(TRASH_RECORD_FILE);
        let record = match read_trash_record(&record_path) {
            Ok(record) if record.version == 1 && record.token == token => record,
            _ => continue,
        };
        let stored_path = match stored_trash_path(&entry_dir, &record) {
            Ok(path) => path,
            Err(_) => continue,
        };
        let stored_metadata = fs::symlink_metadata(&stored_path).ok();
        let stored_available = stored_metadata
            .as_ref()
            .is_some_and(|metadata| metadata.is_file() && !metadata_is_link(metadata));
        let restore_pending =
            restore_marker_exists(&entry_dir.join(TRASH_RESTORE_PENDING_FILE), &token)
                .unwrap_or(false);
        let display_name = Path::new(&record.original_path)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or(&record.stored_file_name)
            .to_string();
        let created_at_ms = trash_record_created_at(&record_path, &record);
        entries.push(RecoverableTrashEntry {
            undo_token: token,
            original_path: record.original_path,
            display_name,
            size_bytes: stored_metadata.map_or(0, |metadata| metadata.len()),
            created_at_ms,
            status: if restore_pending {
                "restorePending"
            } else if stored_available {
                "available"
            } else {
                "missing"
            },
        });
    }
    entries.sort_by(|left, right| {
        right
            .created_at_ms
            .cmp(&left.created_at_ms)
            .then_with(|| left.undo_token.cmp(&right.undo_token))
    });
    entries.truncate(MAX_TRASH_ENTRIES);
    Ok(entries)
}

#[tauri::command]
pub async fn list_recoverable_trash_entries(
    app: AppHandle,
) -> Result<Vec<RecoverableTrashEntry>, String> {
    let trash_root = recoverable_trash_path(&app)?;
    spawn_blocking(move || {
        let _operation_lock = FILE_OPERATION_LOCK.lock();
        list_recoverable_trash_entries_at(&trash_root)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn purge_trashed_files(
    app: AppHandle,
    undo_tokens: Vec<String>,
) -> Result<Vec<FileMutationResult>, String> {
    let trash_root = recoverable_trash_path(&app)?;
    spawn_blocking(move || {
        let _operation_lock = FILE_OPERATION_LOCK.lock();
        let mut results = Vec::with_capacity(undo_tokens.len());
        let mut seen = std::collections::HashSet::new();
        for token in undo_tokens {
            let failure =
                |path: String, code: &str, message: String, recoverable: bool| FileMutationResult {
                    path,
                    status: "failed".to_string(),
                    operation: "purge".to_string(),
                    error_code: Some(code.to_string()),
                    recoverable,
                    error_message: Some(message),
                    undo_token: recoverable.then_some(token.clone()),
                };
            if !valid_undo_token(&token) || !seen.insert(token.clone()) {
                results.push(failure(
                    String::new(),
                    "invalidUndoToken",
                    "The Trash token is invalid or duplicated".to_string(),
                    false,
                ));
                continue;
            }
            let entry_dir = match validate_trash_entry_dir(&trash_root, &trash_root.join(&token)) {
                Ok(path) => path,
                Err(error) => {
                    results.push(failure(String::new(), "invalidUndoToken", error, false));
                    continue;
                }
            };
            let record_path = entry_dir.join(TRASH_RECORD_FILE);
            let record = match read_trash_record(&record_path) {
                Ok(record) if record.version == 1 && record.token == token => record,
                Ok(_) => {
                    results.push(failure(
                        String::new(),
                        "invalidUndoToken",
                        "The Trash record does not match the token".to_string(),
                        false,
                    ));
                    continue;
                }
                Err(error) => {
                    results.push(failure(String::new(), "trashRecordMissing", error, false));
                    continue;
                }
            };
            let marker_path = entry_dir.join(TRASH_RESTORE_PENDING_FILE);
            if restore_marker_exists(&marker_path, &token).unwrap_or(true) {
                results.push(failure(
                    record.original_path,
                    "restorePending",
                    "Finish or retry the pending restore before purging this entry".to_string(),
                    true,
                ));
                continue;
            }
            let stored_path = match stored_trash_path(&entry_dir, &record) {
                Ok(path) => path,
                Err(error) => {
                    results.push(failure(
                        record.original_path,
                        "invalidTrashRecord",
                        error,
                        false,
                    ));
                    continue;
                }
            };
            match fs::symlink_metadata(&stored_path) {
                Ok(metadata) if metadata.is_file() && !metadata_is_link(&metadata) => {
                    let identity = match file_identity_at_path(&stored_path) {
                        Ok(identity) => identity,
                        Err(error) => {
                            results.push(failure(
                                record.original_path,
                                "filePurgeFailed",
                                error.to_string(),
                                true,
                            ));
                            continue;
                        }
                    };
                    if let Err(error) = remove_file_if_unchanged(&stored_path, &identity) {
                        results.push(failure(
                            record.original_path,
                            "filePurgeFailed",
                            error.to_string(),
                            true,
                        ));
                        continue;
                    }
                }
                Ok(_) => {
                    results.push(failure(
                        record.original_path,
                        "filePurgeFailed",
                        "The recoverable Trash payload is not a regular file".to_string(),
                        true,
                    ));
                    continue;
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => {
                    results.push(failure(
                        record.original_path,
                        "filePurgeFailed",
                        error.to_string(),
                        true,
                    ));
                    continue;
                }
            }
            if let Err(error) = fs::remove_file(&record_path) {
                results.push(failure(
                    record.original_path,
                    "trashStorageFailed",
                    error.to_string(),
                    true,
                ));
                continue;
            }
            sync_parent_directory(&record_path);
            if let Err(error) = fs::remove_dir(&entry_dir) {
                results.push(failure(
                    record.original_path,
                    "trashStorageFailed",
                    error.to_string(),
                    false,
                ));
                continue;
            }
            results.push(FileMutationResult {
                path: record.original_path,
                status: "success".to_string(),
                operation: "purge".to_string(),
                error_code: None,
                recoverable: false,
                error_message: None,
                undo_token: None,
            });
        }
        Ok(results)
    })
    .await
    .map_err(|error| error.to_string())?
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
        let _operation_lock = FILE_OPERATION_LOCK.lock();
        let roots_guard = roots_state.read();
        let roots = &roots_guard.roots;
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
            let entry_dir = match validate_trash_entry_dir(&trash_root, &entry_dir) {
                Ok(path) => path,
                Err(error) => {
                    results.push(FileMutationResult {
                        path: String::new(),
                        status: "failed".to_string(),
                        operation: "restore".to_string(),
                        error_code: Some("invalidUndoToken".to_string()),
                        recoverable: false,
                        error_message: Some(error),
                        undo_token: None,
                    });
                    continue;
                }
            };
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
            let marker_path = entry_dir.join(TRASH_RESTORE_PENDING_FILE);
            let restore_pending = match restore_marker_exists(&marker_path, &token) {
                Ok(pending) => pending,
                Err(error) => {
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
            };
            let stored_available = fs::symlink_metadata(&stored_path)
                .is_ok_and(|metadata| metadata.is_file() && !metadata_is_link(&metadata));
            let original_metadata = fs::symlink_metadata(&original_path).ok();
            let original_exists = original_metadata.is_some();

            if !restore_pending && original_exists {
                results.push(FileMutationResult {
                    path: record.original_path,
                    status: "failed".to_string(),
                    operation: "restore".to_string(),
                    error_code: Some("restorePreflightFailed".to_string()),
                    recoverable: true,
                    error_message: Some("A file already exists at the original path".to_string()),
                    undo_token: Some(token),
                });
                continue;
            }

            let mut needs_move = true;
            let restore_path = if restore_pending && original_exists {
                let original_is_regular = original_metadata
                    .as_ref()
                    .is_some_and(|metadata| metadata.is_file() && !metadata_is_link(metadata));
                if !original_is_regular {
                    results.push(FileMutationResult {
                        path: record.original_path,
                        status: "failed".to_string(),
                        operation: "restore".to_string(),
                        error_code: Some("restorePreflightFailed".to_string()),
                        recoverable: true,
                        error_message: Some(
                            "The pending restore target is not a regular file".to_string(),
                        ),
                        undo_token: Some(token),
                    });
                    continue;
                }
                let canonical = match ensure_mutation_source_allowed(
                    &original_path,
                    roots,
                    "resume file restore",
                ) {
                    Ok(path) => path,
                    Err(error) => {
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
                };
                if stored_available {
                    let stored_identity = match file_identity_at_path(&stored_path) {
                        Ok(identity) => identity,
                        Err(error) => {
                            results.push(FileMutationResult {
                                path: record.original_path,
                                status: "failed".to_string(),
                                operation: "restore".to_string(),
                                error_code: Some("fileRestoreFailed".to_string()),
                                recoverable: true,
                                error_message: Some(format!(
                                    "Failed to identify the Trash source: {error}"
                                )),
                                undo_token: Some(token),
                            });
                            continue;
                        }
                    };
                    match files_have_same_contents(&canonical, &stored_path) {
                        Ok(true) => {
                            if let Err(error) =
                                remove_file_if_unchanged(&stored_path, &stored_identity)
                            {
                                results.push(FileMutationResult {
                                    path: record.original_path,
                                    status: "failed".to_string(),
                                    operation: "restore".to_string(),
                                    error_code: Some("fileRestoreFailed".to_string()),
                                    recoverable: true,
                                    error_message: Some(format!(
                                        "Failed to finish an interrupted restore: {error}"
                                    )),
                                    undo_token: Some(token),
                                });
                                continue;
                            }
                        }
                        Ok(false) => {
                            results.push(FileMutationResult {
                                path: record.original_path,
                                status: "failed".to_string(),
                                operation: "restore".to_string(),
                                error_code: Some("restorePreflightFailed".to_string()),
                                recoverable: true,
                                error_message: Some(
                                    "The interrupted restore conflicts with a different destination file"
                                        .to_string(),
                                ),
                                undo_token: Some(token),
                            });
                            continue;
                        }
                        Err(error) => {
                            results.push(FileMutationResult {
                                path: record.original_path,
                                status: "failed".to_string(),
                                operation: "restore".to_string(),
                                error_code: Some("fileRestoreFailed".to_string()),
                                recoverable: true,
                                error_message: Some(error),
                                undo_token: Some(token),
                            });
                            continue;
                        }
                    }
                }
                needs_move = false;
                canonical
            } else {
                if !stored_available {
                    results.push(FileMutationResult {
                        path: record.original_path,
                        status: "failed".to_string(),
                        operation: "restore".to_string(),
                        error_code: Some("restorePreflightFailed".to_string()),
                        recoverable: true,
                        error_message: Some("The recoverable Trash file is missing".to_string()),
                        undo_token: Some(token),
                    });
                    continue;
                }
                let mut target = match ensure_target_path_allowed(
                    &original_path,
                    roots,
                    "restore file from Trash",
                ) {
                    Ok(path) => path,
                    Err(error) => {
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
                };
                if let Err(error) = create_destination_parent_dir(&target) {
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
                target = match ensure_target_path_allowed(
                    &target,
                    roots,
                    "restore file from Trash",
                ) {
                    Ok(path) => path,
                    Err(error) => {
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
                };
                if !restore_pending {
                    if let Err(error) = create_restore_marker(&marker_path, &token) {
                        results.push(FileMutationResult {
                            path: record.original_path,
                            status: "failed".to_string(),
                            operation: "restore".to_string(),
                            error_code: Some("trashStorageFailed".to_string()),
                            recoverable: true,
                            error_message: Some(error),
                            undo_token: Some(token),
                        });
                        continue;
                    }
                }
                target
            };
            if needs_move {
                let stored_identity = match file_identity_at_path(&stored_path) {
                    Ok(identity) => identity,
                    Err(error) => {
                        results.push(FileMutationResult {
                            path: record.original_path,
                            status: "failed".to_string(),
                            operation: "restore".to_string(),
                            error_code: Some("fileRestoreFailed".to_string()),
                            recoverable: true,
                            error_message: Some(format!(
                                "Failed to identify the Trash source: {error}"
                            )),
                            undo_token: Some(token),
                        });
                        continue;
                    }
                };
                if let Err(error) = move_regular_file_no_replace_checked(
                    &stored_path,
                    &restore_path,
                    &stored_identity,
                    &token,
                    None,
                ) {
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
            }
            if let Some(track) = &record.track {
                if let Err(error) = db.upsert_tracks_batch(std::slice::from_ref(track)) {
                    let rollback = file_identity_at_path(&restore_path)
                        .map_err(|error| {
                            format!("Failed to identify restore rollback source: {error}")
                        })
                        .and_then(|restore_identity| {
                            move_regular_file_no_replace_checked(
                                &restore_path,
                                &stored_path,
                                &restore_identity,
                                &token,
                                None,
                            )
                        });
                    if rollback.is_ok() {
                        let _ = fs::remove_file(&marker_path);
                    }
                    results.push(FileMutationResult {
                        path: record.original_path,
                        status: "failed".to_string(),
                        operation: "restore".to_string(),
                        error_code: Some("databaseSyncFailed".to_string()),
                        recoverable: true,
                        error_message: Some(format!(
                            "Tarab restored the file but could not restore its library record: {error}.{}",
                            if rollback.is_ok() {
                                " The file remains in Tarab Trash"
                            } else {
                                " The file remains at its original location; rescan the library"
                            }
                        )),
                        undo_token: Some(token),
                    });
                    continue;
                }
            }
            if let Err(error) = cleanup_trash_entry(&entry_dir) {
                if entry_dir.join(TRASH_RECORD_FILE).exists() {
                    results.push(FileMutationResult {
                        path: record.original_path,
                        status: "failed".to_string(),
                        operation: "restore".to_string(),
                        error_code: Some("trashStorageFailed".to_string()),
                        recoverable: true,
                        error_message: Some(format!(
                            "The file and library record were restored, but recovery metadata cleanup failed: {error}"
                        )),
                        undo_token: Some(token),
                    });
                    continue;
                }
                eprintln!("Completed Trash restore left harmless storage metadata: {error}");
            }
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
    app: AppHandle,
    file_paths: Vec<String>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<FileMutationResult>, String> {
    let mutation_root = file_mutations_path(&app)?;
    let db = db.inner().clone();
    let roots_state = roots_state.inner().clone();
    spawn_blocking(move || {
        let _operation_lock = FILE_OPERATION_LOCK.lock();
        let roots_guard = roots_state.read();
        let roots = &roots_guard.roots;
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
                ensure_mutation_source_allowed(&source, roots, "delete file")
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

            let source_identity = match file_identity_at_path(&canonical_path) {
                Ok(identity) => identity,
                Err(error) => {
                    results.push(FileMutationResult {
                        path: original_path,
                        status: "failed".to_string(),
                        operation: "delete".to_string(),
                        error_code: Some("preflightFailed".to_string()),
                        recoverable: true,
                        error_message: Some(format!("Failed to identify delete source: {error}")),
                        undo_token: None,
                    });
                    continue;
                }
            };
            let intent = match write_durable_mutation_at(
                &mutation_root,
                DurableMutationAction::DeleteFile {
                    source_path: path_to_public_string(&canonical_path),
                    source_track_id: original_path.clone(),
                    source_identity,
                },
            ) {
                Ok(intent) => intent,
                Err(error) => {
                    results.push(FileMutationResult {
                        path: original_path,
                        status: "failed".to_string(),
                        operation: "delete".to_string(),
                        error_code: Some("journalWriteFailed".to_string()),
                        recoverable: true,
                        error_message: Some(error),
                        undo_token: None,
                    });
                    continue;
                }
            };

            if let Err(error) = remove_file_if_unchanged(&canonical_path, &source_identity) {
                if canonical_path.exists() {
                    let _ = remove_durable_mutation(&mutation_root, &intent.id);
                }
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
                Ok(_) => {
                    let _ = remove_durable_mutation(&mutation_root, &intent.id);
                    results.push(FileMutationResult {
                        path: original_path,
                        status: "success".to_string(),
                        operation: "delete".to_string(),
                        error_code: None,
                        recoverable: false,
                        error_message: None,
                        undo_token: None,
                    })
                }
                Err(error) => results.push(FileMutationResult {
                    path: original_path,
                    status: "failed".to_string(),
                    operation: "delete".to_string(),
                    error_code: Some("databaseSyncFailed".to_string()),
                    recoverable: true,
                    error_message: Some(format!(
                        "The file was deleted, but the database update failed. Tarab will retry the durable cleanup at startup. {error}"
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

fn regular_file_identity(path: &Path) -> Result<Option<FileIdentity>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata_is_link(&metadata) => {
            file_identity_at_path(path)
                .map(Some)
                .map_err(|error| format!("Failed to identify {}: {error}", path.display()))
        }
        Ok(_) => Err(format!("{} is not a regular file", path.display())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Failed to inspect {}: {error}", path.display())),
    }
}

fn cleanup_staged_move(target: &Path, operation_id: &str, roots: &[PathBuf]) -> Result<(), String> {
    ensure_target_path_allowed(target, roots, "clean interrupted file move")?;
    cleanup_staged_move_file(target, operation_id)
}

fn cleanup_staged_move_file(target: &Path, operation_id: &str) -> Result<(), String> {
    let staged_path = staged_move_path(target, operation_id)?;
    let metadata = match fs::symlink_metadata(&staged_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Failed to inspect staged move: {error}")),
    };
    if metadata_is_link(&metadata) || !metadata.is_file() {
        return Err("Interrupted move staging path is not a regular file".to_string());
    }
    let identity = file_identity_at_path(&staged_path)
        .map_err(|error| format!("Failed to identify staged move: {error}"))?;
    remove_file_if_unchanged(&staged_path, &identity)
        .map_err(|error| format!("Failed to clean staged move: {error}"))
}

fn reconcile_durable_mutation(
    mutation_root: &Path,
    record: &DurableMutationRecord,
    db: &SharedDatabase,
    state: &LibraryRootsState,
) -> Result<(), String> {
    match &record.action {
        DurableMutationAction::MoveFile {
            source_path,
            source_track_id,
            target_path,
            source_identity,
        } => {
            let source = Path::new(source_path);
            let target = Path::new(target_path);
            let source_state = regular_file_identity(source)?;
            let target_state = regular_file_identity(target)?;
            match (source_state, target_state) {
                (None, Some(target_identity)) => {
                    if !destination_is_owned_by_move(
                        mutation_root,
                        record,
                        target_path,
                        source_identity,
                        &target_identity,
                    )? {
                        return Err(format!(
                            "Interrupted move {} did not adopt an unowned destination",
                            record.id
                        ));
                    }
                    if let Err(error) = cleanup_staged_move(source, &record.id, &state.roots) {
                        eprintln!(
                            "Could not clean rollback stage for completed move {}: {error}",
                            record.id
                        );
                    }
                    ensure_file_identity(target, &target_identity).map_err(|error| {
                        format!("Move destination changed before database reconciliation: {error}")
                    })?;
                    db.rename_track_path(source_track_id, target_path)
                        .map_err(|error| format!("Failed to reconcile moved track: {error}"))?;
                }
                (Some(current_source), None) => {
                    cleanup_staged_move(target, &record.id, &state.roots)?;
                    if current_source != *source_identity {
                        eprintln!(
                            "Discarding untouched move intent {} after the source changed",
                            record.id
                        );
                    }
                }
                (Some(current_source), Some(target_identity)) => {
                    if current_source != *source_identity {
                        return Err(format!(
                            "Interrupted move {} retained both paths because the source identity changed",
                            record.id
                        ));
                    }
                    if !destination_is_owned_by_move(
                        mutation_root,
                        record,
                        target_path,
                        source_identity,
                        &target_identity,
                    )? {
                        return Err(format!(
                            "Interrupted move {} retained both paths because the destination is not proven to be Tarab-owned",
                            record.id
                        ));
                    }
                    let canonical_source =
                        ensure_mutation_source_allowed(source, &state.roots, "resume file move")?;
                    ensure_existing_path_allowed(target, &state.roots, "resume file move")?;
                    if !files_have_same_contents(&canonical_source, target)? {
                        return Err(format!(
                            "Interrupted move {} retained both paths because their contents differ",
                            record.id
                        ));
                    }
                    ensure_file_identity(target, &target_identity).map_err(|error| {
                        format!("Move destination changed before source reconciliation: {error}")
                    })?;
                    remove_file_if_unchanged(&canonical_source, source_identity).map_err(
                        |error| format!("Failed to finish interrupted source removal: {error}"),
                    )?;
                    if let Err(error) = cleanup_staged_move(source, &record.id, &state.roots) {
                        eprintln!(
                            "Could not clean rollback stage for completed move {}: {error}",
                            record.id
                        );
                    }
                    db.rename_track_path(source_track_id, target_path)
                        .map_err(|error| format!("Failed to reconcile moved track: {error}"))?;
                }
                (None, None) => {
                    return Err(format!(
                        "Interrupted move {} is missing both source and destination",
                        record.id
                    ));
                }
            }
        }
        DurableMutationAction::DeleteFile {
            source_path,
            source_track_id,
            source_identity,
        } => match regular_file_identity(Path::new(source_path)) {
            Ok(None) => {
                db.delete_tracks(std::slice::from_ref(source_track_id))
                    .map_err(|error| format!("Failed to reconcile deleted track: {error}"))?;
            }
            Ok(Some(current)) => {
                if current != *source_identity {
                    eprintln!(
                        "Discarding untouched delete intent {} after the source changed",
                        record.id
                    );
                }
            }
            Err(_) => {
                // The delete never committed; leave the existing non-file path untouched.
            }
        },
        DurableMutationAction::RemoveLibrarySource {
            grant_id,
            folder_path,
        } => {
            if state.grants.iter().any(|grant| grant.id == *grant_id) {
                return remove_durable_mutation(mutation_root, &record.id);
            }
            if state
                .grants
                .iter()
                .any(|grant| grant_paths_overlap(Path::new(&grant.path), Path::new(folder_path)))
            {
                return remove_durable_mutation(mutation_root, &record.id);
            }
            db.delete_tracks_for_library_source(folder_path)
                .map_err(|error| format!("Failed to finish revoked-source cleanup: {error}"))?;
        }
        DurableMutationAction::ReauthorizeLibrarySource {
            grant_id,
            old_path,
            new_path,
        } => {
            if state.grants.iter().any(|grant| {
                grant.id == *grant_id
                    && normalized_grant_path(Path::new(&grant.path))
                        == normalized_grant_path(Path::new(new_path))
            }) {
                db.rebase_track_paths(old_path, new_path)
                    .map_err(|error| format!("Failed to finish source reauthorization: {error}"))?;
            }
        }
    }
    remove_durable_mutation(mutation_root, &record.id)
}

fn reconcile_durable_mutations_at(
    mutation_root: &Path,
    db: &SharedDatabase,
    state: &LibraryRootsState,
) -> Result<(), String> {
    let mut records = Vec::new();
    for entry in fs::read_dir(mutation_root)
        .map_err(|error| format!("Failed to inspect file mutation journal: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Failed to inspect file mutation journal: {error}"))?;
        let path = entry.path();
        if mutation_id_from_path(&path).is_none() {
            if let Some(id) = destination_ownership_id_from_path(&path) {
                let mutation_path = mutation_root.join(durable_mutation_file_name(id));
                if !mutation_path.exists() {
                    remove_regular_recovery_file(&path);
                }
            }
            continue;
        }
        match read_durable_mutation(&path) {
            Ok(record) => records.push(record),
            Err(error) => {
                eprintln!(
                    "Removing invalid file mutation intent {}: {error}",
                    path.display()
                );
                if let Some(id) = mutation_id_from_path(&path) {
                    let _ = remove_durable_mutation(mutation_root, id);
                } else {
                    remove_regular_recovery_file(&path);
                }
            }
        }
    }
    records.sort_by(|left, right| {
        left.created_at_ms
            .cmp(&right.created_at_ms)
            .then_with(|| left.id.cmp(&right.id))
    });
    let mut errors = Vec::new();
    for record in records {
        if let Err(error) = reconcile_durable_mutation(mutation_root, &record, db, state) {
            errors.push(error);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn cleanup_trash_entry(entry_dir: &Path) -> Result<(), String> {
    let record_path = entry_dir.join(TRASH_RECORD_FILE);
    match fs::remove_file(&record_path) {
        Ok(()) => sync_parent_directory(&record_path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Failed to remove completed Trash record: {error}")),
    }
    let marker_path = entry_dir.join(TRASH_RESTORE_PENDING_FILE);
    match fs::remove_file(&marker_path) {
        Ok(()) => sync_parent_directory(&marker_path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Failed to remove completed restore marker: {error}"
            ))
        }
    }
    match fs::remove_dir(entry_dir) {
        Ok(()) => {
            sync_parent_directory(entry_dir);
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove completed Trash directory: {error}"
        )),
    }
}

fn reconcile_trash_entries_at(
    trash_root: &Path,
    db: &SharedDatabase,
    state: &LibraryRootsState,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for directory in fs::read_dir(trash_root)
        .map_err(|error| format!("Failed to inspect recoverable Trash: {error}"))?
    {
        let directory = match directory {
            Ok(directory) => directory,
            Err(error) => {
                errors.push(format!(
                    "Failed to inspect recoverable Trash entry: {error}"
                ));
                continue;
            }
        };
        let Some(token) = directory.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !valid_undo_token(&token) {
            continue;
        }
        let entry_dir = match validate_trash_entry_dir(trash_root, &directory.path()) {
            Ok(path) => path,
            Err(error) => {
                errors.push(error);
                continue;
            }
        };
        let record = match read_trash_record(&entry_dir.join(TRASH_RECORD_FILE)) {
            Ok(record) if record.version == 1 && record.token == token => record,
            Ok(_) => {
                errors.push(format!("Trash record {token} has a mismatched identity"));
                continue;
            }
            Err(error) => {
                errors.push(error);
                continue;
            }
        };
        let stored_path = match stored_trash_path(&entry_dir, &record) {
            Ok(path) => path,
            Err(error) => {
                errors.push(error);
                continue;
            }
        };
        let original_path = Path::new(&record.original_path);
        let original_state = regular_file_identity(original_path);
        let stored_state = regular_file_identity(&stored_path);
        let restore_pending =
            match restore_marker_exists(&entry_dir.join(TRASH_RESTORE_PENDING_FILE), &token) {
                Ok(value) => value,
                Err(error) => {
                    errors.push(error);
                    continue;
                }
            };

        let result = if restore_pending {
            match (original_state, stored_state) {
                (Ok(Some(_)), Ok(None)) => {
                    if let Some(track) = &record.track {
                        db.upsert_tracks_batch(std::slice::from_ref(track))
                            .map_err(|error| format!("Failed to finish Trash restore: {error}"))?;
                    }
                    cleanup_trash_entry(&entry_dir)
                }
                (Ok(Some(_)), Ok(Some(stored_identity))) => {
                    if !files_have_same_contents(original_path, &stored_path)? {
                        Err("Pending Trash restore retained conflicting copies".to_string())
                    } else {
                        remove_file_if_unchanged(&stored_path, &stored_identity).map_err(
                            |error| format!("Failed to finish pending Trash restore: {error}"),
                        )?;
                        if let Some(track) = &record.track {
                            db.upsert_tracks_batch(std::slice::from_ref(track))
                                .map_err(|error| {
                                    format!("Failed to finish Trash restore: {error}")
                                })?;
                        }
                        cleanup_trash_entry(&entry_dir)
                    }
                }
                (Ok(None), Ok(Some(_))) => cleanup_staged_move(original_path, &token, &state.roots),
                (Ok(None), Ok(None)) => {
                    Err("Pending Trash restore is missing both file copies".to_string())
                }
                (Err(error), _) | (_, Err(error)) => Err(error),
            }
        } else {
            match (original_state, stored_state) {
                (Ok(None), Ok(Some(_))) => db
                    .delete_tracks(std::slice::from_ref(&record.original_path))
                    .map(|_| ())
                    .map_err(|error| format!("Failed to finish Trash database cleanup: {error}")),
                (Ok(Some(current)), Ok(None)) => {
                    if record.source_identity == Some(current) {
                        cleanup_staged_move_file(&stored_path, &token)?;
                        cleanup_trash_entry(&entry_dir)
                    } else {
                        Ok(())
                    }
                }
                (Ok(Some(current)), Ok(Some(_))) => {
                    let Some(expected) = record.source_identity else {
                        errors.push(format!(
                            "Trash entry {token} retained duplicate files because its legacy record has no source identity"
                        ));
                        continue;
                    };
                    if current != expected {
                        errors.push(format!(
                            "Trash entry {token} retained duplicate files because the original path changed"
                        ));
                        continue;
                    }
                    let canonical = match ensure_mutation_source_allowed(
                        original_path,
                        &state.roots,
                        "finish interrupted Trash move",
                    ) {
                        Ok(path) => path,
                        Err(error) => {
                            errors.push(error);
                            continue;
                        }
                    };
                    if !files_have_same_contents(&canonical, &stored_path)? {
                        errors.push(format!(
                            "Trash entry {token} retained duplicate files because their contents differ"
                        ));
                        continue;
                    }
                    remove_file_if_unchanged(&canonical, &expected).map_err(|error| {
                        format!("Failed to finish interrupted Trash source removal: {error}")
                    })?;
                    db.delete_tracks(std::slice::from_ref(&record.original_path))
                        .map(|_| ())
                        .map_err(|error| {
                            format!("Failed to finish Trash database cleanup: {error}")
                        })
                }
                (Ok(None), Ok(None)) => Ok(()),
                (Err(error), _) | (_, Err(error)) => Err(error),
            }
        };
        if let Err(error) = result {
            errors.push(format!("Trash entry {token}: {error}"));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

pub fn recover_interrupted_file_operations(
    app: &AppHandle,
    db: &SharedDatabase,
    roots_state: &SharedLibraryRoots,
) -> Result<(), String> {
    let _operation_lock = FILE_OPERATION_LOCK.lock();
    let mutation_root = file_mutations_path(app)?;
    let trash_root = recoverable_trash_path(app)?;
    let state = roots_state.read();
    let journal_result = reconcile_durable_mutations_at(&mutation_root, db, &state);
    let trash_result = reconcile_trash_entries_at(&trash_root, db, &state);
    match (journal_result, trash_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(left), Ok(())) | (Ok(()), Err(left)) => Err(left),
        (Err(left), Err(right)) => Err(format!("{left}; {right}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
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

    fn test_grant_file(root: &Path, id: &str) -> LibraryGrantFile {
        LibraryGrantFile {
            version: LIBRARY_GRANTS_VERSION,
            grants: vec![LibraryGrantRecord {
                id: id.to_string(),
                path: root.to_string_lossy().to_string(),
            }],
        }
    }

    fn write_grant_candidate(path: &Path, root: &Path, id: &str) {
        fs::write(
            path,
            serde_json::to_vec(&test_grant_file(root, id)).expect("encode grant candidate"),
        )
        .expect("write grant candidate");
    }

    fn sample_db_track(path: &str) -> DbTrack {
        DbTrack {
            id: path.to_string(),
            title: "Track".to_string(),
            artist: "Artist".to_string(),
            album_artist: None,
            album: "Album".to_string(),
            year: None,
            duration: 1.0,
            file_path: path.to_string(),
            has_cover_art: false,
            cover_art_hash: None,
            blurhash: None,
            date_added: 1,
            play_count: 0,
            last_played: None,
            rating: None,
            track_number: None,
            disc_number: None,
            file_format: Some("MP3".to_string()),
            bitrate: None,
            sample_rate: None,
            file_size: None,
            genre: None,
        }
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
    fn grant_file_reader_accepts_a_valid_interrupted_write_backup() {
        let temp = temp_dir("grant-backup");
        let path = temp.join(LIBRARY_GRANTS_FILE);
        let backup_path = path.with_extension("json.bak");
        let grant = LibraryGrantRecord {
            id: "grant-backup".to_string(),
            path: temp.to_string_lossy().to_string(),
        };
        fs::write(
            &backup_path,
            serde_json::to_vec(&LibraryGrantFile {
                version: LIBRARY_GRANTS_VERSION,
                grants: vec![grant],
            })
            .expect("encode grant file"),
        )
        .expect("write backup");

        let restored = read_grants_with_recovery(&path).expect("recover backup");

        assert_eq!(restored[0].id, "grant-backup");
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn grant_recovery_promotes_the_unique_temp_written_before_first_commit() {
        let temp = temp_dir("grant-temp-first-commit");
        let path = temp.join(LIBRARY_GRANTS_FILE);
        let temp_path = path.with_extension("json.0123456789abcdef0123456789abcdef.tmp");
        write_grant_candidate(&temp_path, &temp, "new-authority");

        let restored = read_grants_with_recovery(&path).expect("promote valid temp");

        assert_eq!(restored[0].id, "new-authority");
        assert_eq!(
            read_grants_file(&path).expect("promoted primary").grants[0].id,
            "new-authority"
        );
        assert!(!temp_path.exists());
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn grant_recovery_prefers_staged_new_temp_over_old_backup() {
        let temp = temp_dir("grant-temp-after-stage");
        let path = temp.join(LIBRARY_GRANTS_FILE);
        let backup_path = path.with_extension("json.bak");
        let temp_path = path.with_extension("json.11111111111111111111111111111111.tmp");
        write_grant_candidate(&backup_path, &temp, "old-authority");
        write_grant_candidate(&temp_path, &temp, "new-authority");

        let restored = read_grants_with_recovery(&path).expect("finish staged replacement");

        assert_eq!(restored[0].id, "new-authority");
        assert!(!backup_path.exists());
        assert!(!temp_path.exists());
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn grant_recovery_keeps_committed_primary_and_cleans_unstaged_temp() {
        let temp = temp_dir("grant-temp-before-stage");
        let path = temp.join(LIBRARY_GRANTS_FILE);
        let temp_path = path.with_extension("json.22222222222222222222222222222222.tmp");
        write_grant_candidate(&path, &temp, "committed-authority");
        write_grant_candidate(&temp_path, &temp, "uncommitted-authority");

        let restored = read_grants_with_recovery(&path).expect("keep committed primary");

        assert_eq!(restored[0].id, "committed-authority");
        assert!(!temp_path.exists());
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn grant_recovery_cleans_invalid_temp_and_promotes_valid_backup() {
        let temp = temp_dir("grant-invalid-temp");
        let path = temp.join(LIBRARY_GRANTS_FILE);
        let backup_path = path.with_extension("json.bak");
        let invalid_temp = path.with_extension("json.33333333333333333333333333333333.tmp");
        write_grant_candidate(&backup_path, &temp, "backup-authority");
        fs::write(&invalid_temp, b"partial json").expect("write invalid temp");

        let restored = read_grants_with_recovery(&path).expect("promote backup");

        assert_eq!(restored[0].id, "backup-authority");
        assert!(!backup_path.exists());
        assert!(!invalid_temp.exists());
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn corrupt_grant_backup_does_not_reset_authority_to_empty() {
        let temp = temp_dir("grant-corrupt-backup");
        let path = temp.join(LIBRARY_GRANTS_FILE);
        fs::write(path.with_extension("json.bak"), b"not json").expect("write corrupt backup");

        let error = read_grants_with_recovery(&path).expect_err("reject corrupt backup");

        assert!(error.contains("Failed to parse library grants"));
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn grant_writer_replaces_a_corrupt_primary_from_recovered_authority() {
        let temp = temp_dir("grant-rewrite");
        let path = temp.join(LIBRARY_GRANTS_FILE);
        let backup_path = path.with_extension("json.bak");
        fs::write(&path, b"not json").expect("write corrupt primary");
        fs::write(
            &backup_path,
            serde_json::to_vec(&LibraryGrantFile {
                version: LIBRARY_GRANTS_VERSION,
                grants: vec![LibraryGrantRecord {
                    id: "recovered".to_string(),
                    path: temp.to_string_lossy().to_string(),
                }],
            })
            .expect("encode backup"),
        )
        .expect("write backup");
        let grants = read_grants_with_recovery(&path).expect("recover grants");

        write_grants_atomic(
            &path,
            &LibraryGrantFile {
                version: LIBRARY_GRANTS_VERSION,
                grants,
            },
        )
        .expect("rewrite grants");

        assert_eq!(
            read_grants_file(&path).expect("read grants").grants[0].id,
            "recovered"
        );
        assert!(!backup_path.exists());
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
            source_identity: None,
            created_at_ms: 1,
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
    fn trash_snapshot_database_error_is_not_downgraded_to_a_missing_track() {
        let root = temp_dir("trash-snapshot-failure");
        let source = root.join("song.mp3");
        fs::write(&source, b"audio").expect("write source");
        let source_path = path_to_public_string(&source);
        let db: SharedDatabase = Arc::new(Database::in_memory_for_tests().expect("database"));
        db.execute_batch_for_tests("DROP TABLE tracks")
            .expect("make snapshot query fail");

        let error = read_trash_track_snapshot(&db, &source_path)
            .expect_err("surface database snapshot failure");

        assert!(error.contains("database snapshot"));
        assert!(source.exists());
        assert_eq!(
            fs::read_dir(&root).expect("read source directory").count(),
            1
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restore_marker_round_trip_preserves_the_recovery_token() {
        let temp = temp_dir("restore-marker");
        let path = temp.join(TRASH_RESTORE_PENDING_FILE);
        let token = "0123456789abcdef0123456789abcdef";

        create_restore_marker(&path, token).expect("create marker");

        assert!(restore_marker_exists(&path, token).expect("read marker"));
        assert!(restore_marker_exists(&path, "fedcba9876543210fedcba9876543210").is_err());
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn interrupted_restore_comparison_detects_conflicting_files() {
        let temp = temp_dir("restore-compare");
        let restored = temp.join("restored.mp3");
        let stored = temp.join("stored.mp3");
        fs::write(&restored, b"same audio").expect("write restored");
        fs::write(&stored, b"same audio").expect("write stored");

        assert!(files_have_same_contents(&restored, &stored).expect("compare equal files"));
        fs::write(&stored, b"other audio").expect("replace stored");
        assert!(!files_have_same_contents(&restored, &stored).expect("compare different files"));
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

    #[test]
    fn startup_reconciliation_finishes_database_move_after_filesystem_commit() {
        let library_root = temp_dir("journal-move-library");
        let mutation_root = temp_dir("journal-move-records");
        let source = library_root.join("source.mp3");
        let target = library_root.join("target.mp3");
        fs::write(&source, b"audio").expect("write source");
        let source_path = path_to_public_string(&source);
        let target_path = path_to_public_string(&target);
        let source_identity = file_identity_at_path(&source).expect("source identity");
        let db: SharedDatabase = Arc::new(Database::in_memory_for_tests().expect("database"));
        db.upsert_tracks_batch(&[sample_db_track(&source_path)])
            .expect("seed track");
        let intent = write_durable_mutation_at(
            &mutation_root,
            DurableMutationAction::MoveFile {
                source_path: source_path.clone(),
                source_track_id: source_path.clone(),
                target_path: target_path.clone(),
                source_identity,
            },
        )
        .expect("write move intent");
        fs::rename(&source, &target).expect("commit filesystem move");
        let state = LibraryRootsState {
            roots: vec![fs::canonicalize(&library_root).expect("canonical root")],
            grants: Vec::new(),
            transient_files: Vec::new(),
        };

        reconcile_durable_mutations_at(&mutation_root, &db, &state).expect("reconcile move");

        assert_eq!(
            db.get_tracks_by_ids(std::slice::from_ref(&target_path))
                .expect("target track")
                .len(),
            1
        );
        assert!(!mutation_root
            .join(durable_mutation_file_name(&intent.id))
            .exists());
        let _ = fs::remove_dir_all(library_root);
        let _ = fs::remove_dir_all(mutation_root);
    }

    #[test]
    fn startup_reconciliation_never_adopts_an_identical_unowned_destination() {
        let library_root = temp_dir("journal-unowned-library");
        let mutation_root = temp_dir("journal-unowned-records");
        let source = library_root.join("source.mp3");
        let target = library_root.join("target.mp3");
        fs::write(&source, b"identical audio").expect("write source");
        fs::write(&target, b"identical audio").expect("write independent target");
        let source_path = path_to_public_string(&source);
        let target_path = path_to_public_string(&target);
        let source_identity = file_identity_at_path(&source).expect("source identity");
        assert_ne!(
            source_identity,
            file_identity_at_path(&target).expect("target identity")
        );
        let db: SharedDatabase = Arc::new(Database::in_memory_for_tests().expect("database"));
        db.upsert_tracks_batch(&[sample_db_track(&source_path)])
            .expect("seed track");
        let intent = write_durable_mutation_at(
            &mutation_root,
            DurableMutationAction::MoveFile {
                source_path: source_path.clone(),
                source_track_id: source_path.clone(),
                target_path: target_path.clone(),
                source_identity,
            },
        )
        .expect("write move intent");
        let state = LibraryRootsState {
            roots: vec![fs::canonicalize(&library_root).expect("canonical root")],
            grants: Vec::new(),
            transient_files: Vec::new(),
        };

        let error = reconcile_durable_mutations_at(&mutation_root, &db, &state)
            .expect_err("reject unowned target");

        assert!(error.contains("not proven to be Tarab-owned"));
        assert_eq!(
            fs::read(&source).expect("source retained"),
            b"identical audio"
        );
        assert_eq!(
            fs::read(&target).expect("target retained"),
            b"identical audio"
        );
        assert_eq!(
            db.get_tracks_by_ids(&[source_path])
                .expect("source track")
                .len(),
            1
        );
        assert!(mutation_root
            .join(durable_mutation_file_name(&intent.id))
            .exists());
        let _ = fs::remove_dir_all(library_root);
        let _ = fs::remove_dir_all(mutation_root);
    }

    #[test]
    fn startup_reconciliation_does_not_repoint_to_an_unowned_target_after_source_loss() {
        let library_root = temp_dir("journal-unowned-source-loss-library");
        let mutation_root = temp_dir("journal-unowned-source-loss-records");
        let source = library_root.join("source.mp3");
        let target = library_root.join("target.mp3");
        fs::write(&source, b"identical audio").expect("write source");
        fs::write(&target, b"identical audio").expect("write independent target");
        let source_path = path_to_public_string(&source);
        let target_path = path_to_public_string(&target);
        let source_identity = file_identity_at_path(&source).expect("source identity");
        let db: SharedDatabase = Arc::new(Database::in_memory_for_tests().expect("database"));
        db.upsert_tracks_batch(&[sample_db_track(&source_path)])
            .expect("seed track");
        let intent = write_durable_mutation_at(
            &mutation_root,
            DurableMutationAction::MoveFile {
                source_path: source_path.clone(),
                source_track_id: source_path.clone(),
                target_path: target_path.clone(),
                source_identity,
            },
        )
        .expect("write move intent");
        fs::remove_file(&source).expect("simulate independent source loss");
        let state = LibraryRootsState {
            roots: vec![fs::canonicalize(&library_root).expect("canonical root")],
            grants: Vec::new(),
            transient_files: Vec::new(),
        };

        let error = reconcile_durable_mutations_at(&mutation_root, &db, &state)
            .expect_err("reject unowned target after source loss");

        assert!(error.contains("unowned destination"));
        assert!(db
            .get_tracks_by_ids(&[target_path])
            .expect("target track")
            .is_empty());
        assert_eq!(
            db.get_tracks_by_ids(&[source_path])
                .expect("source track")
                .len(),
            1
        );
        assert!(mutation_root
            .join(durable_mutation_file_name(&intent.id))
            .exists());
        let _ = fs::remove_dir_all(library_root);
        let _ = fs::remove_dir_all(mutation_root);
    }

    #[test]
    fn startup_reconciliation_finishes_a_proven_copied_destination() {
        let library_root = temp_dir("journal-owned-copy-library");
        let mutation_root = temp_dir("journal-owned-copy-records");
        let source = library_root.join("source.mp3");
        let target = library_root.join("target.mp3");
        fs::write(&source, b"copied audio").expect("write source");
        fs::write(&target, b"copied audio").expect("write copied target");
        let source_path = path_to_public_string(&source);
        let target_path = path_to_public_string(&target);
        let source_identity = file_identity_at_path(&source).expect("source identity");
        let target_identity = file_identity_at_path(&target).expect("target identity");
        let db: SharedDatabase = Arc::new(Database::in_memory_for_tests().expect("database"));
        db.upsert_tracks_batch(&[sample_db_track(&source_path)])
            .expect("seed track");
        let intent = write_durable_mutation_at(
            &mutation_root,
            DurableMutationAction::MoveFile {
                source_path: source_path.clone(),
                source_track_id: source_path,
                target_path: target_path.clone(),
                source_identity,
            },
        )
        .expect("write move intent");
        write_destination_ownership_at(&mutation_root, &intent.id, &target, target_identity)
            .expect("persist destination ownership");
        let state = LibraryRootsState {
            roots: vec![fs::canonicalize(&library_root).expect("canonical root")],
            grants: Vec::new(),
            transient_files: Vec::new(),
        };

        reconcile_durable_mutations_at(&mutation_root, &db, &state)
            .expect("finish proven copied move");

        assert!(!source.exists());
        assert!(target.exists());
        assert_eq!(
            db.get_tracks_by_ids(&[target_path])
                .expect("target track")
                .len(),
            1
        );
        assert!(!mutation_root
            .join(durable_mutation_file_name(&intent.id))
            .exists());
        assert!(!mutation_root
            .join(destination_ownership_file_name(&intent.id))
            .exists());
        let _ = fs::remove_dir_all(library_root);
        let _ = fs::remove_dir_all(mutation_root);
    }

    #[test]
    fn startup_reconciliation_rejects_a_replaced_owned_destination() {
        let library_root = temp_dir("journal-replaced-owned-library");
        let mutation_root = temp_dir("journal-replaced-owned-records");
        let source = library_root.join("source.mp3");
        let target = library_root.join("target.mp3");
        let replacement = library_root.join("replacement.mp3");
        fs::write(&source, b"same audio").expect("write source");
        fs::write(&target, b"same audio").expect("write copied target");
        fs::write(&replacement, b"same audio").expect("write independent replacement");
        let source_path = path_to_public_string(&source);
        let target_path = path_to_public_string(&target);
        let source_identity = file_identity_at_path(&source).expect("source identity");
        let target_identity = file_identity_at_path(&target).expect("target identity");
        let db: SharedDatabase = Arc::new(Database::in_memory_for_tests().expect("database"));
        db.upsert_tracks_batch(&[sample_db_track(&source_path)])
            .expect("seed track");
        let intent = write_durable_mutation_at(
            &mutation_root,
            DurableMutationAction::MoveFile {
                source_path: source_path.clone(),
                source_track_id: source_path.clone(),
                target_path: target_path.clone(),
                source_identity,
            },
        )
        .expect("write move intent");
        write_destination_ownership_at(&mutation_root, &intent.id, &target, target_identity)
            .expect("persist destination ownership");
        fs::remove_file(&target).expect("remove owned target");
        fs::rename(&replacement, &target).expect("install independent replacement");
        let state = LibraryRootsState {
            roots: vec![fs::canonicalize(&library_root).expect("canonical root")],
            grants: Vec::new(),
            transient_files: Vec::new(),
        };

        let error = reconcile_durable_mutations_at(&mutation_root, &db, &state)
            .expect_err("reject replaced destination");

        assert!(error.contains("not proven to be Tarab-owned"));
        assert!(source.exists());
        assert!(target.exists());
        assert_eq!(
            db.get_tracks_by_ids(&[source_path])
                .expect("source track")
                .len(),
            1
        );
        assert!(db
            .get_tracks_by_ids(&[target_path])
            .expect("target track")
            .is_empty());
        assert!(mutation_root
            .join(durable_mutation_file_name(&intent.id))
            .exists());
        let _ = fs::remove_dir_all(library_root);
        let _ = fs::remove_dir_all(mutation_root);
    }

    #[test]
    fn startup_reconciliation_cleans_unclaimed_cross_volume_stage() {
        let library_root = temp_dir("journal-stage-library");
        let mutation_root = temp_dir("journal-stage-records");
        let source = library_root.join("source.mp3");
        let target = library_root.join("target.mp3");
        fs::write(&source, b"audio").expect("write source");
        let source_path = path_to_public_string(&source);
        let target_path = path_to_public_string(&target);
        let source_identity = file_identity_at_path(&source).expect("source identity");
        let db: SharedDatabase = Arc::new(Database::in_memory_for_tests().expect("database"));
        db.upsert_tracks_batch(&[sample_db_track(&source_path)])
            .expect("seed track");
        let intent = write_durable_mutation_at(
            &mutation_root,
            DurableMutationAction::MoveFile {
                source_path: source_path.clone(),
                source_track_id: source_path.clone(),
                target_path,
                source_identity,
            },
        )
        .expect("write move intent");
        let staged = staged_move_path(&target, &intent.id).expect("staged path");
        fs::write(&staged, b"audio").expect("write staged copy");
        let state = LibraryRootsState {
            roots: vec![fs::canonicalize(&library_root).expect("canonical root")],
            grants: Vec::new(),
            transient_files: Vec::new(),
        };

        reconcile_durable_mutations_at(&mutation_root, &db, &state)
            .expect("discard untouched move");

        assert!(source.exists());
        assert!(!target.exists());
        assert!(!staged.exists());
        assert_eq!(
            db.get_tracks_by_ids(&[source_path])
                .expect("original track")
                .len(),
            1
        );
        assert_eq!(fs::read_dir(&mutation_root).expect("journal").count(), 0);
        let _ = fs::remove_dir_all(library_root);
        let _ = fs::remove_dir_all(mutation_root);
    }

    #[test]
    fn startup_reconciliation_refuses_changed_cross_volume_source_identity() {
        let library_root = temp_dir("journal-identity-library");
        let mutation_root = temp_dir("journal-identity-records");
        let source = library_root.join("source.mp3");
        let target = library_root.join("target.mp3");
        fs::write(&source, b"original").expect("write source");
        fs::write(&target, b"original").expect("write copied target");
        let expected = file_identity_at_path(&source).expect("source identity");
        let source_path = path_to_public_string(&source);
        let target_path = path_to_public_string(&target);
        let db: SharedDatabase = Arc::new(Database::in_memory_for_tests().expect("database"));
        db.upsert_tracks_batch(&[sample_db_track(&source_path)])
            .expect("seed track");
        let intent = write_durable_mutation_at(
            &mutation_root,
            DurableMutationAction::MoveFile {
                source_path,
                source_track_id: path_to_public_string(&source),
                target_path,
                source_identity: expected,
            },
        )
        .expect("write move intent");
        fs::write(&source, b"replacement with changed metadata").expect("replace source");
        let state = LibraryRootsState {
            roots: vec![fs::canonicalize(&library_root).expect("canonical root")],
            grants: Vec::new(),
            transient_files: Vec::new(),
        };

        let error = reconcile_durable_mutations_at(&mutation_root, &db, &state)
            .expect_err("retain identity conflict");

        assert!(error.contains("source identity changed"));
        assert!(source.exists());
        assert!(target.exists());
        assert!(mutation_root
            .join(durable_mutation_file_name(&intent.id))
            .exists());
        let _ = fs::remove_dir_all(library_root);
        let _ = fs::remove_dir_all(mutation_root);
    }

    #[test]
    fn startup_reconciliation_finishes_database_delete_after_file_disappears() {
        let library_root = temp_dir("journal-delete-library");
        let mutation_root = temp_dir("journal-delete-records");
        let source = library_root.join("source.mp3");
        fs::write(&source, b"audio").expect("write source");
        let source_path = path_to_public_string(&source);
        let source_identity = file_identity_at_path(&source).expect("source identity");
        let db: SharedDatabase = Arc::new(Database::in_memory_for_tests().expect("database"));
        db.upsert_tracks_batch(&[sample_db_track(&source_path)])
            .expect("seed track");
        write_durable_mutation_at(
            &mutation_root,
            DurableMutationAction::DeleteFile {
                source_path: source_path.clone(),
                source_track_id: source_path,
                source_identity,
            },
        )
        .expect("write delete intent");
        fs::remove_file(&source).expect("delete source");
        let state = LibraryRootsState {
            roots: vec![fs::canonicalize(&library_root).expect("canonical root")],
            grants: Vec::new(),
            transient_files: Vec::new(),
        };

        reconcile_durable_mutations_at(&mutation_root, &db, &state).expect("reconcile delete");

        assert_eq!(db.get_track_count().expect("track count"), 0);
        assert_eq!(fs::read_dir(&mutation_root).expect("journal").count(), 0);
        let _ = fs::remove_dir_all(library_root);
        let _ = fs::remove_dir_all(mutation_root);
    }

    #[test]
    fn startup_reconciliation_finishes_root_source_cleanup_after_revocation_commit() {
        let mutation_root = temp_dir("journal-root-revocation");
        let db: SharedDatabase = Arc::new(Database::in_memory_for_tests().expect("database"));
        db.upsert_tracks_batch(&[
            sample_db_track("/music/a.mp3"),
            sample_db_track("/other/b.mp3"),
        ])
        .expect("seed root tracks");
        write_durable_mutation_at(
            &mutation_root,
            DurableMutationAction::RemoveLibrarySource {
                grant_id: "removed-root".to_string(),
                folder_path: "/".to_string(),
            },
        )
        .expect("write source-removal intent");
        let state = LibraryRootsState::default();

        reconcile_durable_mutations_at(&mutation_root, &db, &state)
            .expect("reconcile root source cleanup");

        assert_eq!(db.get_track_count().expect("track count"), 0);
        assert_eq!(fs::read_dir(&mutation_root).expect("journal").count(), 0);
        let _ = fs::remove_dir_all(mutation_root);
    }

    #[test]
    fn startup_reconciliation_finishes_reauthorization_after_grant_commit() {
        let mutation_root = temp_dir("journal-reauthorization");
        let db: SharedDatabase = Arc::new(Database::in_memory_for_tests().expect("database"));
        let old_path = "/missing/music/song.mp3";
        let new_path = "/restored/music/song.mp3";
        db.upsert_tracks_batch(&[sample_db_track(old_path)])
            .expect("seed moved source track");
        write_durable_mutation_at(
            &mutation_root,
            DurableMutationAction::ReauthorizeLibrarySource {
                grant_id: "moved-grant".to_string(),
                old_path: "/missing/music".to_string(),
                new_path: "/restored/music".to_string(),
            },
        )
        .expect("write reauthorization intent");
        let state = LibraryRootsState {
            roots: Vec::new(),
            grants: vec![LibraryGrantRecord {
                id: "moved-grant".to_string(),
                path: "/restored/music".to_string(),
            }],
            transient_files: Vec::new(),
        };

        reconcile_durable_mutations_at(&mutation_root, &db, &state)
            .expect("reconcile reauthorization");

        assert_eq!(
            db.get_tracks_by_ids(&[new_path.to_string()])
                .expect("rebased track")
                .len(),
            1
        );
        assert_eq!(fs::read_dir(&mutation_root).expect("journal").count(), 0);
        let _ = fs::remove_dir_all(mutation_root);
    }

    #[test]
    fn recoverable_trash_inventory_survives_database_reconciliation() {
        let library_root = temp_dir("trash-inventory-library");
        let trash_root =
            fs::canonicalize(temp_dir("trash-inventory-records")).expect("canonical Trash root");
        let original = library_root.join("song.mp3");
        fs::write(&original, b"audio").expect("write source");
        let original_path = path_to_public_string(&original);
        let identity = file_identity_at_path(&original).expect("source identity");
        let token = "abcdefabcdefabcdefabcdefabcdefab";
        let entry_dir = trash_root.join(token);
        fs::create_dir(&entry_dir).expect("create Trash entry");
        let stored_path = entry_dir.join("song.mp3");
        let track = sample_db_track(&original_path);
        write_trash_record(
            &entry_dir.join(TRASH_RECORD_FILE),
            &TrashRecord {
                version: 1,
                token: token.to_string(),
                original_path: original_path.clone(),
                stored_file_name: "song.mp3".to_string(),
                track: Some(track.clone()),
                source_identity: Some(identity),
                created_at_ms: 42,
            },
        )
        .expect("write Trash record");
        fs::rename(&original, &stored_path).expect("move into Trash");
        let db: SharedDatabase = Arc::new(Database::in_memory_for_tests().expect("database"));
        db.upsert_tracks_batch(&[track]).expect("seed track");
        let state = LibraryRootsState {
            roots: vec![fs::canonicalize(&library_root).expect("canonical root")],
            grants: Vec::new(),
            transient_files: Vec::new(),
        };

        reconcile_trash_entries_at(&trash_root, &db, &state).expect("reconcile Trash");
        let entries = list_recoverable_trash_entries_at(&trash_root).expect("list Trash");

        assert_eq!(db.get_track_count().expect("track count"), 0);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].undo_token, token);
        assert_eq!(entries[0].created_at_ms, 42);
        assert_eq!(entries[0].status, "available");
        let _ = fs::remove_dir_all(library_root);
        let _ = fs::remove_dir_all(trash_root);
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

    #[cfg(unix)]
    #[test]
    fn active_roots_rejects_a_grant_with_a_retargeted_ancestor() {
        use std::os::unix::fs::symlink;

        let container = temp_dir("grant-ancestor-symlink");
        let parent = container.join("Collection");
        let granted = parent.join("Music");
        let outside = temp_dir("grant-ancestor-outside");
        fs::create_dir_all(&granted).expect("create granted folder");
        let stored_path = fs::canonicalize(&granted).expect("canonical grant");
        fs::remove_dir_all(&parent).expect("remove granted ancestor");
        symlink(&outside, &parent).expect("replace ancestor with symlink");
        fs::create_dir_all(outside.join("Music")).expect("create replacement folder");
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
    fn transient_authority_allows_one_metadata_and_one_playback_claim() {
        let root = temp_dir("transient");
        let allowed = root.join("allowed.mp3");
        let sibling = root.join("sibling.mp3");
        fs::write(&allowed, b"audio").expect("write allowed");
        fs::write(&sibling, b"audio").expect("write sibling");
        let state = create_library_roots_state();

        let authority_id =
            authorize_transient_file(&state, &allowed).expect("authorize exact file");
        assert_eq!(authority_id.len(), 32);
        assert!(authority_id.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert!(claim_metadata_file_access(&state, &sibling, None, "test").is_err());
        assert!(claim_metadata_file_access(&state, &allowed, Some(&authority_id), "test").is_ok());
        assert!(claim_metadata_file_access(&state, &allowed, Some(&authority_id), "test").is_err());

        assert!(
            consume_play_once_file_access(&state, &allowed, Some(&authority_id), "test").is_ok()
        );
        assert!(
            consume_play_once_file_access(&state, &allowed, Some(&authority_id), "test").is_err()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn replacement_at_the_same_path_does_not_inherit_transient_authority() {
        let root = temp_dir("transient-replacement");
        let path = root.join("song.mp3");
        fs::write(&path, b"original audio").expect("write original");
        let state = create_library_roots_state();
        let authority_id = authorize_transient_file(&state, &path).expect("authorize file");

        fs::remove_file(&path).expect("remove original");
        fs::write(&path, b"replacement audio").expect("write replacement");

        assert!(consume_play_once_file_access(&state, &path, Some(&authority_id), "test").is_err());
        assert!(state.read().transient_files.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_playback_claims_cannot_share_one_authority() {
        let root = temp_dir("transient-concurrent");
        let path = root.join("song.mp3");
        fs::write(&path, b"audio").expect("write audio");
        let state = create_library_roots_state();
        let authority_id = authorize_transient_file(&state, &path).expect("authorize file");
        let barrier = Arc::new(std::sync::Barrier::new(3));
        let mut workers = Vec::new();

        for _ in 0..2 {
            let state = Arc::clone(&state);
            let path = path.clone();
            let authority_id = authority_id.clone();
            let barrier = Arc::clone(&barrier);
            workers.push(std::thread::spawn(move || {
                barrier.wait();
                consume_play_once_file_access(&state, &path, Some(&authority_id), "test").is_ok()
            }));
        }
        barrier.wait();

        let successes = workers
            .into_iter()
            .map(|worker| worker.join().expect("join authority claimant"))
            .filter(|succeeded| *succeeded)
            .count();
        assert_eq!(successes, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persistent_roots_stay_unrestricted_and_clear_redundant_authority() {
        let root = temp_dir("persistent-access");
        let path = root.join("song.mp3");
        fs::write(&path, b"audio").expect("write audio");
        let state = create_library_roots_state();
        state
            .write()
            .roots
            .push(fs::canonicalize(&root).expect("canonical root"));
        let redundant_authority =
            authorize_transient_file(&state, &path).expect("authorize persistent file");

        let access =
            consume_play_once_file_access(&state, &path, Some(&redundant_authority), "test")
                .expect("persistent access with redundant authority");
        assert!(access.expected_identity.is_none());
        assert!(state.read().transient_files.is_empty());

        for _ in 0..2 {
            let access = consume_play_once_file_access(&state, &path, None, "test")
                .expect("persistent access");
            assert!(access.expected_identity.is_none());
        }
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
    fn rename_and_move_source_validation_rejects_directories() {
        let root = temp_dir("directory-source");
        let directory = root.join("album");
        fs::create_dir(&directory).expect("create directory source");
        let roots = vec![fs::canonicalize(&root).expect("canonical root")];

        let error = ensure_mutation_source_allowed(&directory, &roots, "move source file")
            .expect_err("reject directory source");

        assert!(error.contains("not a regular file"));
        assert!(directory.is_dir());
        let _ = fs::remove_dir_all(root);
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

    #[test]
    fn no_replace_move_never_clobbers_an_existing_destination() {
        let root = temp_dir("move-no-replace");
        let source = root.join("source.mp3");
        let target = root.join("target.mp3");
        fs::write(&source, b"source").expect("write source");
        fs::write(&target, b"target").expect("write target");

        let error = move_regular_file_no_replace(&source, &target).expect_err("reject collision");

        assert!(error.contains("already exists"));
        assert_eq!(fs::read(&source).expect("source remains"), b"source");
        assert_eq!(fs::read(&target).expect("target remains"), b"target");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copy_fallback_moves_a_file_without_replacing() {
        let root = temp_dir("move-copy-fallback");
        let source = root.join("source.flac");
        let target = root.join("target.flac");
        fs::write(&source, b"audio payload").expect("write source");

        copy_regular_file_no_replace(&source, &target).expect("copy move");

        assert!(!source.exists());
        assert_eq!(fs::read(&target).expect("target payload"), b"audio payload");
        assert_eq!(fs::read_dir(&root).expect("read root").count(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn public_windows_paths_strip_verbatim_prefixes() {
        assert_eq!(
            path_to_public_string(Path::new(r"\\?\C:\Music\track.flac")),
            "C:/Music/track.flac"
        );
        assert_eq!(
            path_to_public_string(Path::new(r"\\?\UNC\server\Music\track.flac")),
            "//server/Music/track.flac"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_grant_overlap_normalizes_verbatim_public_and_case_forms() {
        assert!(grant_paths_overlap(
            Path::new(r"\\?\C:\Music"),
            Path::new("c:/music/Album")
        ));
        assert!(grant_paths_overlap(
            Path::new(r"\\?\UNC\server\Music"),
            Path::new("//SERVER/music/Album")
        ));
        assert!(!grant_paths_overlap(
            Path::new(r"C:\Music"),
            Path::new(r"C:\Musical")
        ));
    }

    #[cfg(windows)]
    #[test]
    fn legacy_grants_migrate_verbatim_prefixes_and_dedupe() {
        let (grants, migrated) = normalize_legacy_grants(vec![
            LibraryGrantRecord {
                id: "one".to_string(),
                path: "//?/C:/Users/fawaz/Documents/Music".to_string(),
            },
            LibraryGrantRecord {
                id: "two".to_string(),
                path: "C:/Users/fawaz/Documents/Music".to_string(),
            },
            LibraryGrantRecord {
                id: "three".to_string(),
                path: "//?/UNC/server/Music".to_string(),
            },
        ]);

        assert!(migrated);
        assert_eq!(grants.len(), 2);
        assert_eq!(grants[0].id, "one");
        assert_eq!(grants[0].path, "C:/Users/fawaz/Documents/Music");
        assert_eq!(grants[1].id, "three");
        assert_eq!(grants[1].path, "//server/Music");
    }

    #[test]
    fn clean_grants_are_unchanged() {
        let (grants, migrated) = normalize_legacy_grants(vec![LibraryGrantRecord {
            id: "one".to_string(),
            path: "/music/library".to_string(),
        }]);
        assert!(!migrated);
        assert_eq!(grants.len(), 1);
        assert_eq!(grants[0].path, "/music/library");
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
                .arg(&canonical)
                .status()
                .map_err(|e| format!("Failed to reveal: {}", e))?;
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .arg("/select,")
                .arg(&canonical)
                .status()
                .map_err(|e| format!("Failed to reveal: {}", e))?;
        }
        #[cfg(target_os = "linux")]
        {
            let dir = canonical
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
