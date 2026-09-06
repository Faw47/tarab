use crate::database::{LyricsIndexEntry, LyricsIndexSyncApply, SharedDatabase, TrackPathRow};
use crate::file_ops::{ensure_existing_path_allowed, SharedLibraryRoots};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions, Permissions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::UNIX_EPOCH;
use tauri::async_runtime::spawn_blocking;
use tauri::State;

#[derive(Debug, Deserialize)]
struct LrclibRecord {
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
}

const MAX_LYRICS_SIDECAR_BYTES: usize = 1024 * 1024;
const MAX_LRCLIB_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_LRCLIB_FIELD_CHARS: usize = 512;
const LYRICS_SIZE_LIMIT_ERROR: &str = "Lyrics must be 1 MiB (1,048,576 UTF-8 bytes) or smaller";

static LYRICS_SIDECAR_WRITE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileVersion {
    identity_a: u64,
    identity_b: u64,
    length: u64,
    modified_a: i64,
    modified_b: i64,
    permissions: u32,
}

impl FileVersion {
    fn same_file(self, other: Self) -> bool {
        self.identity_a == other.identity_a && self.identity_b == other.identity_b
    }
}

#[cfg(unix)]
fn file_version(file: &File) -> io::Result<FileVersion> {
    use std::os::unix::fs::MetadataExt;

    let metadata = file.metadata()?;
    Ok(FileVersion {
        identity_a: metadata.dev(),
        identity_b: metadata.ino(),
        length: metadata.len(),
        modified_a: metadata.mtime(),
        modified_b: metadata.mtime_nsec(),
        permissions: metadata.mode(),
    })
}

#[cfg(windows)]
fn file_version(file: &File) -> io::Result<FileVersion> {
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
    Ok(FileVersion {
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
fn file_version(file: &File) -> io::Result<FileVersion> {
    let metadata = file.metadata()?;
    let modified = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    Ok(FileVersion {
        identity_a: 0,
        identity_b: 0,
        length: metadata.len(),
        modified_a: i64::try_from(modified.as_secs()).unwrap_or(i64::MAX),
        modified_b: i64::from(modified.subsec_nanos()),
        permissions: u32::from(metadata.permissions().readonly()),
    })
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn open_file_nofollow(path: &Path) -> io::Result<File> {
    use rustix::fs::{open, Mode, OFlags};

    open(
        path,
        OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NOFOLLOW,
        Mode::empty(),
    )
    .map(File::from)
    .map_err(io::Error::from)
}

#[cfg(windows)]
fn open_file_nofollow(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::{
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0 | FILE_SHARE_DELETE.0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
        .open(path)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn open_file_nofollow(path: &Path) -> io::Result<File> {
    let link_metadata = fs::symlink_metadata(path)?;
    if link_metadata.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "symbolic links are not allowed",
        ));
    }
    OpenOptions::new().read(true).open(path)
}

fn is_regular_file_handle(file: &File) -> io::Result<bool> {
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Ok(false);
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;

        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 {
            return Ok(false);
        }
    }

    Ok(true)
}

fn open_regular_file_nofollow(path: &Path) -> io::Result<File> {
    let file = open_file_nofollow(path)?;
    if !is_regular_file_handle(&file)? {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "lyrics sidecar is not a regular file",
        ));
    }
    Ok(file)
}

fn version_at_path_nofollow(path: &Path) -> io::Result<FileVersion> {
    file_version(&open_regular_file_nofollow(path)?)
}

fn file_mtime_millis(file: &File) -> i64 {
    file.metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

struct OpenedSidecar {
    path: PathBuf,
    content: String,
    mtime: i64,
}

fn trim_nonempty(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// Opens, validates, and reads a sidecar through one handle. Returns `None` for
/// missing, unsafe, oversized, invalid UTF-8, blank, or concurrently changed files.
fn read_allowed_sidecar(path: &Path, roots: &[PathBuf]) -> Option<OpenedSidecar> {
    let mut file = open_regular_file_nofollow(path).ok()?;
    let initial_version = file_version(&file).ok()?;
    if initial_version.length > MAX_LYRICS_SIDECAR_BYTES as u64 {
        return None;
    }

    let canonical = ensure_existing_path_allowed(path, roots, "read lyrics sidecar").ok()?;
    let validated_file = open_regular_file_nofollow(&canonical).ok()?;
    if !file_version(&validated_file)
        .ok()?
        .same_file(initial_version)
    {
        return None;
    }

    let mut bytes = Vec::with_capacity(initial_version.length as usize);
    (&mut file)
        .take(MAX_LYRICS_SIDECAR_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > MAX_LYRICS_SIDECAR_BYTES {
        return None;
    }

    let final_version = file_version(&file).ok()?;
    if final_version != initial_version {
        return None;
    }
    let content = String::from_utf8(bytes).ok()?;
    if content.trim().is_empty() {
        return None;
    }

    Some(OpenedSidecar {
        path: canonical,
        content,
        mtime: file_mtime_millis(&file),
    })
}

fn load_local_lyrics_for_track(track_path: &str, roots: &[PathBuf]) -> Option<String> {
    let path = Path::new(track_path);
    let canonical = ensure_existing_path_allowed(path, roots, "read lyrics for track").ok()?;

    let lrc_path = canonical.with_extension("lrc");
    if let Some(sidecar) = read_allowed_sidecar(&lrc_path, roots) {
        return trim_nonempty(&sidecar.content);
    }

    let txt_path = canonical.with_extension("txt");
    if let Some(sidecar) = read_allowed_sidecar(&txt_path, roots) {
        if sidecar.content.contains('[') && sidecar.content.contains(']') {
            return trim_nonempty(&sidecar.content);
        }
    }

    None
}

/// LRCLIB fallback. Call only after local lyrics are confirmed empty.
pub async fn fetch_lrclib(
    artist: &str,
    title: &str,
    album: &str,
    duration_secs: f64,
) -> Result<Option<String>, String> {
    if [artist, title, album]
        .iter()
        .any(|value| value.chars().count() > MAX_LRCLIB_FIELD_CHARS)
    {
        return Err("Lyrics request metadata is too long".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Tarab/1.0.0")
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Failed to create lyrics client: {}", e))?;

    let duration_str = if duration_secs.is_finite() && duration_secs > 0.0 {
        Some(((duration_secs.round() as i64).max(1)).to_string())
    } else {
        None
    };

    let mut req = client.get("https://lrclib.net/api/get").query(&[
        ("artist_name", artist),
        ("track_name", title),
        ("album_name", album),
    ]);

    if let Some(ref d) = duration_str {
        req = req.query(&[("duration", d.as_str())]);
    }

    let mut resp = req
        .send()
        .await
        .map_err(|e| format!("Lyrics request failed: {}", e))?;
    let response_url = resp.url();
    if response_url.scheme() != "https"
        || response_url.host_str() != Some("lrclib.net")
        || response_url.port_or_known_default() != Some(443)
    {
        return Err("Lyrics response came from an unexpected endpoint".to_string());
    }
    if !resp.status().is_success() {
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        return Err(format!(
            "Lyrics request failed with status {}",
            resp.status()
        ));
    }

    if resp
        .content_length()
        .is_some_and(|length| length > MAX_LRCLIB_RESPONSE_BYTES as u64)
    {
        return Err("Lyrics response is too large".to_string());
    }

    let mut body = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Failed to read lyrics response: {}", e))?
    {
        let next_len = body
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| "Lyrics response is too large".to_string())?;
        if next_len > MAX_LRCLIB_RESPONSE_BYTES {
            return Err("Lyrics response is too large".to_string());
        }
        body.extend_from_slice(&chunk);
    }

    let data: LrclibRecord = serde_json::from_slice(&body)
        .map_err(|e| format!("Failed to parse lyrics response: {}", e))?;

    if let Some(ref s) = data.synced_lyrics {
        if let Some(out) = trim_nonempty(s) {
            return Ok(Some(out));
        }
    }
    if let Some(ref s) = data.plain_lyrics {
        if let Some(out) = trim_nonempty(s) {
            return Ok(Some(out));
        }
    }
    Ok(None)
}

/// Result from lyrics search including the matched line
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsSearchResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub file_path: String,
    pub cover_art_hash: Option<String>,
    pub matched_line: String,      // The line containing the match
    pub matched_line_index: usize, // Line number (0-indexed)
}

/// Resolves lyrics: **local sidecars first**; LRCLIB only when local is empty and `auto_lyrics` is true.
#[tauri::command]
pub async fn get_lyrics_for_track(
    track_path: String,
    auto_lyrics: bool,
    artist: String,
    title: String,
    album: String,
    duration: f64,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Option<String>, String> {
    let path = std::path::Path::new(&track_path);
    let roots = roots_state.read().roots.clone();
    if crate::file_ops::ensure_existing_path_allowed(path, &roots, "read lyrics for track").is_err()
    {
        return Ok(None);
    }
    if let Some(local) = load_local_lyrics_for_track(&track_path, &roots) {
        return Ok(Some(local));
    }
    if auto_lyrics {
        return fetch_lrclib(&artist, &title, &album, duration).await;
    }
    Ok(None)
}

#[tauri::command]
pub async fn fetch_lrclib_lyrics(
    file_path: String,
    artist: String,
    title: String,
    album: String,
    duration: f64,
) -> Result<Option<String>, String> {
    let _ = file_path;
    fetch_lrclib(&artist, &title, &album, duration).await
}

#[tauri::command]
pub fn write_lyrics_for_track(
    track_path: String,
    content: String,
    roots_state: State<'_, SharedLibraryRoots>,
) -> Result<(), String> {
    let roots = roots_state.read().roots.clone();
    write_lyrics_for_track_checked(&track_path, content, &roots)
}

struct ExistingSidecar {
    _file: File,
    version: FileVersion,
    permissions: Permissions,
}

fn unique_sibling_name(target: &Path, role: &str) -> OsString {
    let mut name = OsString::from(format!(
        ".tarab-lyrics-{role}-{:032x}",
        rand::random::<u128>()
    ));
    if let Some(extension) = target.extension() {
        name.push(".");
        name.push(extension);
    }
    name
}

fn create_staged_sidecar(target: &Path) -> Result<(PathBuf, File), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Lyrics destination has no parent directory".to_string())?;
    for _ in 0..32 {
        let staged_path = parent.join(unique_sibling_name(target, "stage"));
        match OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&staged_path)
        {
            Ok(file) => return Ok((staged_path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to create temporary lyrics file: {error}")),
        }
    }
    Err("Failed to allocate a unique temporary lyrics file".to_string())
}

fn remove_file_if_same(path: &Path, expected: FileVersion) -> io::Result<bool> {
    let current = match version_at_path_nofollow(path) {
        Ok(current) => current,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(true),
        Err(error) => return Err(error),
    };
    if !current.same_file(expected) {
        return Ok(false);
    }
    fs::remove_file(path)?;
    Ok(true)
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
    File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn claim_staged_sidecar_no_replace(staged_path: &Path, target: &Path) -> io::Result<()> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};

    renameat_with(CWD, staged_path, CWD, target, RenameFlags::NOREPLACE).map_err(io::Error::from)
}

#[cfg(windows)]
fn claim_staged_sidecar_no_replace(staged_path: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH};

    let staged_path = staged_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();

    unsafe {
        MoveFileExW(
            PCWSTR(staged_path.as_ptr()),
            PCWSTR(target.as_ptr()),
            MOVEFILE_WRITE_THROUGH,
        )
        .map_err(|_| io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn claim_staged_sidecar_no_replace(staged_path: &Path, target: &Path) -> io::Result<()> {
    fs::hard_link(staged_path, target)?;
    fs::remove_file(staged_path)
}

fn install_new_sidecar(
    staged_path: &Path,
    target: &Path,
    replacement: FileVersion,
) -> Result<(), String> {
    claim_staged_sidecar_no_replace(staged_path, target).map_err(|error| {
        format!("Failed to install lyrics without replacing another file: {error}")
    })?;

    let installed = version_at_path_nofollow(target)
        .map_err(|error| format!("Failed to verify installed lyrics: {error}"))?;
    if !installed.same_file(replacement) {
        return Err(format!(
            "Lyrics destination changed during creation; recovery file retained at {}",
            staged_path.display()
        ));
    }
    sync_parent_directory(target)
        .map_err(|error| format!("Failed to sync lyrics directory: {error}"))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn exchange_sidecar_paths(left: &Path, right: &Path) -> io::Result<()> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};

    renameat_with(CWD, left, CWD, right, RenameFlags::EXCHANGE).map_err(io::Error::from)
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn replace_staged_sidecar(
    staged_path: &Path,
    target: &Path,
    expected: FileVersion,
    replacement: FileVersion,
) -> Result<(), String> {
    if version_at_path_nofollow(target).ok() != Some(expected) {
        return Err("Lyrics file changed before it could be replaced".to_string());
    }

    exchange_sidecar_paths(staged_path, target)
        .map_err(|error| format!("Failed to atomically replace lyrics: {error}"))?;

    let displaced = version_at_path_nofollow(staged_path).ok();
    let installed = version_at_path_nofollow(target).ok();
    if displaced == Some(expected)
        && installed.is_some_and(|version| version.same_file(replacement))
    {
        sync_parent_directory(target)
            .map_err(|error| format!("Failed to sync replaced lyrics: {error}"))?;
        if !remove_file_if_same(staged_path, expected)
            .map_err(|error| format!("Failed to remove old lyrics: {error}"))?
        {
            return Err(format!(
                "Lyrics were replaced, but the old-file recovery path changed: {}",
                staged_path.display()
            ));
        }
        sync_parent_directory(target)
            .map_err(|error| format!("Failed to sync lyrics cleanup: {error}"))?;
        return Ok(());
    }

    let rollback_is_safe = installed.is_some_and(|version| version.same_file(replacement))
        || displaced == Some(expected);
    if rollback_is_safe && exchange_sidecar_paths(staged_path, target).is_ok() {
        let restored = version_at_path_nofollow(target).ok();
        let returned_stage = version_at_path_nofollow(staged_path).ok();
        if restored == displaced && returned_stage == installed {
            if returned_stage.is_some_and(|version| version.same_file(replacement)) {
                let _ = remove_file_if_same(staged_path, replacement);
            }
            let _ = sync_parent_directory(target);
            return Err("Lyrics file changed while it was being replaced".to_string());
        }
    }

    Err(format!(
        "Lyrics changed during replacement; recovery file retained at {}",
        staged_path.display()
    ))
}

#[cfg(windows)]
fn replace_file_windows(target: &Path, replacement: &Path, backup: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        ReplaceFileW, REPLACEFILE_IGNORE_MERGE_ERRORS, REPLACEFILE_WRITE_THROUGH,
    };

    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replacement = replacement
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let backup = backup
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();

    unsafe {
        ReplaceFileW(
            PCWSTR(target.as_ptr()),
            PCWSTR(replacement.as_ptr()),
            PCWSTR(backup.as_ptr()),
            REPLACEFILE_IGNORE_MERGE_ERRORS | REPLACEFILE_WRITE_THROUGH,
            None,
            None,
        )
        .map_err(|_| io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn create_sidecar_backup_directory(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Lyrics destination has no parent directory".to_string())?;
    for _ in 0..32 {
        let path = parent.join(unique_sibling_name(target, "backup"));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to create lyrics backup directory: {error}")),
        }
    }
    Err("Failed to allocate a lyrics backup directory".to_string())
}

#[cfg(windows)]
fn replace_staged_sidecar(
    staged_path: &Path,
    target: &Path,
    expected: FileVersion,
    replacement: FileVersion,
) -> Result<(), String> {
    if version_at_path_nofollow(target).ok() != Some(expected) {
        return Err("Lyrics file changed before it could be replaced".to_string());
    }

    let backup_directory = create_sidecar_backup_directory(target)?;
    let backup_path = backup_directory.join("original");

    if let Err(error) = replace_file_windows(target, staged_path, &backup_path) {
        if fs::symlink_metadata(&backup_path).is_err() {
            let _ = fs::remove_dir(&backup_directory);
        }
        return Err(format!("Failed to atomically replace lyrics: {error}"));
    }

    let displaced = version_at_path_nofollow(&backup_path).ok();
    let installed = version_at_path_nofollow(target).ok();
    if displaced == Some(expected)
        && installed.is_some_and(|version| version.same_file(replacement))
    {
        if !remove_file_if_same(&backup_path, expected)
            .map_err(|error| format!("Failed to remove old lyrics backup: {error}"))?
        {
            return Err(format!(
                "Lyrics were replaced, but the backup path changed: {}",
                backup_path.display()
            ));
        }
        let _ = fs::remove_dir(&backup_directory);
        return Ok(());
    }

    if let (Some(displaced), Some(installed)) = (displaced, installed) {
        if installed.same_file(replacement)
            && replace_file_windows(target, &backup_path, staged_path).is_ok()
            && version_at_path_nofollow(target).ok() == Some(displaced)
        {
            let _ = remove_file_if_same(staged_path, installed);
            let _ = fs::remove_dir(&backup_directory);
            return Err("Lyrics file changed while it was being replaced".to_string());
        }
    }

    Err(format!(
        "Lyrics changed during replacement; recovery file retained at {}",
        backup_path.display()
    ))
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn replace_staged_sidecar(
    staged_path: &Path,
    target: &Path,
    expected: FileVersion,
    replacement: FileVersion,
) -> Result<(), String> {
    if version_at_path_nofollow(target).ok() != Some(expected) {
        return Err("Lyrics file changed before it could be replaced".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "Lyrics destination has no parent directory".to_string())?;
    let backup_path = parent.join(unique_sibling_name(target, "backup"));
    fs::hard_link(target, &backup_path)
        .map_err(|error| format!("Failed to preserve old lyrics: {error}"))?;
    if version_at_path_nofollow(&backup_path).ok() != Some(expected) {
        let _ = fs::remove_file(&backup_path);
        return Err("Lyrics file changed before it could be backed up".to_string());
    }
    fs::rename(staged_path, target)
        .map_err(|error| format!("Failed to atomically replace lyrics: {error}"))?;
    if !version_at_path_nofollow(target).is_ok_and(|version| version.same_file(replacement)) {
        let _ = fs::rename(&backup_path, target);
        return Err("Lyrics file changed while it was being replaced".to_string());
    }
    fs::remove_file(&backup_path)
        .map_err(|error| format!("Failed to remove old lyrics backup: {error}"))?;
    sync_parent_directory(target)
        .map_err(|error| format!("Failed to sync lyrics directory: {error}"))
}

fn write_sidecar_atomic_with(
    target: &Path,
    writer: impl FnOnce(&mut File) -> io::Result<()>,
) -> Result<(), String> {
    let existing = match open_regular_file_nofollow(target) {
        Ok(file) => {
            let version = file_version(&file)
                .map_err(|error| format!("Failed to identify existing lyrics: {error}"))?;
            let permissions = file
                .metadata()
                .map_err(|error| format!("Failed to read lyrics permissions: {error}"))?
                .permissions();
            Some(ExistingSidecar {
                _file: file,
                version,
                permissions,
            })
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "Lyrics destination must be a regular file: {error}"
            ))
        }
    };

    let (staged_path, mut staged_file) = create_staged_sidecar(target)?;
    let write_result = writer(&mut staged_file)
        .map_err(|error| format!("Failed to write temporary lyrics: {error}"))
        .and_then(|_| {
            if let Some(existing) = &existing {
                staged_file
                    .set_permissions(existing.permissions.clone())
                    .map_err(|error| format!("Failed to preserve lyrics permissions: {error}"))?;
            }
            staged_file
                .sync_all()
                .map_err(|error| format!("Failed to sync temporary lyrics: {error}"))
        });
    let staged_version = file_version(&staged_file).ok();
    drop(staged_file);

    if let Err(error) = write_result {
        if let Some(version) = staged_version {
            let _ = remove_file_if_same(&staged_path, version);
        }
        return Err(error);
    }
    let staged_version = staged_version.ok_or_else(|| {
        let _ = fs::remove_file(&staged_path);
        "Failed to identify temporary lyrics file".to_string()
    })?;

    let result = if let Some(existing) = &existing {
        replace_staged_sidecar(&staged_path, target, existing.version, staged_version)
    } else {
        install_new_sidecar(&staged_path, target, staged_version)
    };
    if result.is_err() {
        let _ = remove_file_if_same(&staged_path, staged_version);
    }
    result
}

fn write_sidecar_atomic(target: &Path, content: &[u8]) -> Result<(), String> {
    write_sidecar_atomic_with(target, |file| file.write_all(content))
}

fn write_lyrics_for_track_checked(
    track_path: &str,
    content: String,
    roots: &[PathBuf],
) -> Result<(), String> {
    if content.len() > MAX_LYRICS_SIDECAR_BYTES {
        return Err(LYRICS_SIZE_LIMIT_ERROR.to_string());
    }

    let _write_guard = LYRICS_SIDECAR_WRITE_LOCK
        .lock()
        .map_err(|_| "Lyrics writer lock is unavailable".to_string())?;
    let path = Path::new(track_path);
    let canonical = ensure_existing_path_allowed(path, roots, "write lyrics for track")?;
    let lrc_path = canonical.with_extension("lrc");
    let parent = lrc_path
        .parent()
        .ok_or_else(|| "Lyrics destination has no parent directory".to_string())?;
    ensure_existing_path_allowed(parent, roots, "write lyrics sidecar")?;
    write_sidecar_atomic(&lrc_path, content.as_bytes())
}

/// Normalize path separators for the current platform
fn normalize_path_separators(path: &str) -> String {
    #[cfg(windows)]
    {
        path.replace('/', "\\")
    }
    #[cfg(not(windows))]
    {
        path.to_string()
    }
}

/// Finds and reads a lyrics sidecar without handing a path back to be reopened.
fn find_lyrics_file(track_path: &str, roots: &[PathBuf]) -> Option<OpenedSidecar> {
    // Normalize path separators for the current platform
    let normalized_path = normalize_path_separators(track_path);
    let path = Path::new(&normalized_path);

    // Try to get canonical path, but don't fail if it doesn't exist
    let base_path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    // Try .lrc file with the base path
    let lrc_path = base_path.with_extension("lrc");
    if let Some(sidecar) = read_allowed_sidecar(&lrc_path, roots) {
        return Some(sidecar);
    }

    // Also try with the original (non-canonicalized) path
    let lrc_path_original = path.with_extension("lrc");
    if let Some(sidecar) = read_allowed_sidecar(&lrc_path_original, roots) {
        return Some(sidecar);
    }

    // Try .txt file
    let txt_path = base_path.with_extension("txt");
    if let Some(sidecar) = read_allowed_sidecar(&txt_path, roots) {
        if sidecar.content.contains('[') && sidecar.content.contains(']') {
            return Some(sidecar);
        }
    }

    // Try filename.lrc (same name, different extension) with canonicalized path
    if let Some(stem) = base_path.file_stem() {
        if let Some(parent) = base_path.parent() {
            let lrc_path = parent.join(format!("{}.lrc", stem.to_string_lossy()));
            if let Some(sidecar) = read_allowed_sidecar(&lrc_path, roots) {
                return Some(sidecar);
            }
        }
    }

    // Try filename.lrc with original path
    if let Some(stem) = path.file_stem() {
        if let Some(parent) = path.parent() {
            let lrc_path = parent.join(format!("{}.lrc", stem.to_string_lossy()));
            if let Some(sidecar) = read_allowed_sidecar(&lrc_path, roots) {
                return Some(sidecar);
            }
        }
    }

    None
}

/// Extract clean text from an LRC line (removes timestamp)
/// Handles formats: [mm:ss.xxx], [mm:ss.xx], [mm:ss], [m:ss.xxx], [m:ss], and angle-bracket word timestamps.
/// Removes all timestamp patterns (both square and angle brackets) from anywhere in the line
fn clean_lrc_line(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let bytes = trimmed.as_bytes();
    let mut result = String::with_capacity(trimmed.len());
    let mut copy_from = 0;
    let mut cursor = 0;

    while cursor < bytes.len() {
        if let Some(end) = timestamp_end(bytes, cursor) {
            result.push_str(&trimmed[copy_from..cursor]);
            cursor = end;
            copy_from = end;
        } else {
            cursor += 1;
        }
    }
    result.push_str(&trimmed[copy_from..]);
    result.trim().to_string()
}

fn timestamp_end(bytes: &[u8], start: usize) -> Option<usize> {
    let close = match *bytes.get(start)? {
        b'[' => b']',
        b'<' => b'>',
        _ => return None,
    };
    let mut cursor = start + 1;

    let first_minute = *bytes.get(cursor)?;
    if !first_minute.is_ascii_digit() {
        return None;
    }
    cursor += 1;
    if bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
        cursor += 1;
    }
    if *bytes.get(cursor)? != b':' {
        return None;
    }
    cursor += 1;

    if !bytes.get(cursor).is_some_and(u8::is_ascii_digit)
        || !bytes.get(cursor + 1).is_some_and(u8::is_ascii_digit)
    {
        return None;
    }
    cursor += 2;

    if bytes.get(cursor) == Some(&b'.') {
        cursor += 1;
        let fraction_start = cursor;
        while cursor < bytes.len() && cursor - fraction_start < 3 && bytes[cursor].is_ascii_digit()
        {
            cursor += 1;
        }
        if cursor == fraction_start || bytes.get(cursor).is_some_and(u8::is_ascii_digit) {
            return None;
        }
    }

    if bytes.get(cursor) == Some(&close) {
        Some(cursor + 1)
    } else {
        None
    }
}

fn find_first_match_line(content: &str, query_lower: &str) -> Option<(String, usize)> {
    for (line_idx, line) in content.lines().enumerate() {
        let clean_line = clean_lrc_line(line);
        if clean_line.is_empty() {
            continue;
        }
        if clean_line.to_lowercase().contains(query_lower) {
            return Some((clean_line, line_idx));
        }
    }
    None
}

fn is_track_path_allowed_for_lyrics(track_path: &str, roots: Option<&[PathBuf]>) -> bool {
    roots
        .map(|roots| {
            ensure_existing_path_allowed(Path::new(track_path), roots, "sync lyrics for track")
                .is_ok()
        })
        .unwrap_or(true)
}

fn sync_lyrics_index_blocking(
    db: &SharedDatabase,
    roots: Option<&[PathBuf]>,
) -> Result<u32, String> {
    if matches!(roots, Some(roots) if roots.is_empty()) {
        return Ok(0);
    }

    const TRACK_PAGE_SIZE: u32 = 1000;

    const MAX_SNAPSHOT_ATTEMPTS: usize = 3;

    'attempts: for _ in 0..MAX_SNAPSHOT_ATTEMPTS {
        let existing = db
            .get_lyrics_index_meta()
            .map_err(|e| format!("Failed to get existing lyrics index: {}", e))?;
        let existing_by_track: HashMap<String, (String, i64)> = existing
            .iter()
            .map(|entry| {
                (
                    entry.track_id.clone(),
                    (entry.lyrics_path.clone(), entry.lyrics_mtime),
                )
            })
            .collect();

        let mut upserts: Vec<LyricsIndexEntry> = Vec::new();
        let mut deletes: Vec<String> = Vec::new();
        let mut track_ids = HashSet::new();
        let mut cursor = None;
        let mut snapshot_revision = None;

        loop {
            let page = db
                .get_track_paths_cursor_page(cursor.as_ref(), TRACK_PAGE_SIZE)
                .map_err(|e| format!("Failed to get tracks for lyrics sync: {}", e))?;
            if page.restart_required {
                continue 'attempts;
            }
            if snapshot_revision.is_some_and(|revision| revision != page.revision) {
                continue 'attempts;
            }
            if snapshot_revision.is_none() {
                snapshot_revision = Some(page.revision);
            }

            for TrackPathRow { id, file_path } in page.tracks {
                track_ids.insert(id.clone());
                let existing_meta = existing_by_track.get(&id);
                if !is_track_path_allowed_for_lyrics(&file_path, roots) {
                    if existing_meta.is_some() {
                        deletes.push(id.clone());
                    }
                    continue;
                }
                let lyrics_file = find_lyrics_file(&file_path, roots.unwrap_or(&[]));

                match lyrics_file {
                    Some(sidecar) => {
                        let OpenedSidecar {
                            path,
                            content,
                            mtime,
                        } = sidecar;
                        #[cfg(windows)]
                        let normalized_path = path.to_string_lossy().replace('\\', "/");
                        #[cfg(not(windows))]
                        let normalized_path = path.to_string_lossy().into_owned();
                        let unchanged = existing_meta
                            .map(|(p, t)| p == &normalized_path && *t == mtime)
                            .unwrap_or(false);

                        if unchanged {
                            continue;
                        }

                        if content.len() > MAX_LYRICS_SIDECAR_BYTES || content.trim().is_empty() {
                            deletes.push(id.clone());
                        } else {
                            upserts.push(LyricsIndexEntry {
                                track_id: id.clone(),
                                lyrics_path: normalized_path,
                                lyrics_mtime: mtime,
                                content,
                            });
                        }
                    }
                    None => {
                        if existing_meta.is_some() {
                            deletes.push(id.clone());
                        }
                    }
                }
            }

            match page.next_cursor {
                Some(next_cursor) => cursor = Some(next_cursor),
                None => break,
            }
        }

        for orphan in existing_by_track.keys() {
            if !track_ids.contains(orphan) {
                deletes.push(orphan.clone());
            }
        }
        deletes.sort();
        deletes.dedup();

        let snapshot_revision = snapshot_revision
            .ok_or_else(|| "Lyrics sync did not establish a library snapshot".to_string())?;
        match db
            .apply_lyrics_index_sync(snapshot_revision, &upserts, &deletes)
            .map_err(|e| format!("Failed to apply lyrics index sync: {}", e))?
        {
            LyricsIndexSyncApply::Applied(changed) => {
                return u32::try_from(changed)
                    .map_err(|_| "Lyrics sync changed row count overflowed".to_string());
            }
            LyricsIndexSyncApply::RestartRequired => continue,
        }
    }

    Err("Library changed repeatedly while syncing lyrics; retry the sync".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{Database, DbTrack};
    use std::fs;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tarab-lyrics-{}-{}", name, nonce));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn lyrics_recovery_entries(directory: &Path) -> Vec<PathBuf> {
        fs::read_dir(directory)
            .expect("read temporary directory")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(".tarab-lyrics-"))
            })
            .collect()
    }

    #[test]
    fn write_lyrics_rejects_outside_root() {
        let allowed_root = temp_dir("allowed");
        let outside_root = temp_dir("outside");
        let track = outside_root.join("song.mp3");
        fs::write(&track, b"audio").expect("write track");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = write_lyrics_for_track_checked(
            &track.to_string_lossy(),
            "[00:01]Nope".to_string(),
            &roots,
        );

        assert!(result.is_err());
        assert!(!outside_root.join("song.lrc").exists());

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn write_lyrics_writes_lrc_next_to_allowed_track() {
        let allowed_root = temp_dir("allowed-write");
        let track = allowed_root.join("song.mp3");
        fs::write(&track, b"audio").expect("write track");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        write_lyrics_for_track_checked(&track.to_string_lossy(), "[00:01]Line".to_string(), &roots)
            .expect("write lyrics");

        assert_eq!(
            fs::read_to_string(allowed_root.join("song.lrc")).expect("read lrc"),
            "[00:01]Line"
        );

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[test]
    fn write_lyrics_enforces_utf8_byte_boundary_before_replacing() {
        let allowed_root = temp_dir("write-size-boundary");
        let track = allowed_root.join("song.mp3");
        let sidecar = track.with_extension("lrc");
        fs::write(&track, b"audio").expect("write track");
        fs::write(&sidecar, b"original").expect("write original lyrics");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let exact_limit = "é".repeat(MAX_LYRICS_SIDECAR_BYTES / 2);
        assert_eq!(exact_limit.len(), MAX_LYRICS_SIDECAR_BYTES);

        write_lyrics_for_track_checked(&track.to_string_lossy(), exact_limit.clone(), &roots)
            .expect("write exact limit");
        assert_eq!(
            fs::read(&sidecar).expect("read exact lyrics").len(),
            exact_limit.len()
        );

        let oversized = format!("{exact_limit}x");
        let result = write_lyrics_for_track_checked(&track.to_string_lossy(), oversized, &roots);

        assert_eq!(result, Err(LYRICS_SIZE_LIMIT_ERROR.to_string()));
        assert_eq!(
            fs::read(&sidecar).expect("read unchanged lyrics"),
            exact_limit.as_bytes()
        );
        assert!(lyrics_recovery_entries(&allowed_root).is_empty());

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[test]
    fn bounded_sidecar_read_accepts_limit_and_rejects_limit_plus_one() {
        let allowed_root = temp_dir("read-size-boundary");
        let track = allowed_root.join("song.mp3");
        let sidecar = track.with_extension("lrc");
        fs::write(&track, b"audio").expect("write track");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let exact_limit = "a".repeat(MAX_LYRICS_SIDECAR_BYTES);
        fs::write(&sidecar, &exact_limit).expect("write exact-limit sidecar");

        assert_eq!(
            read_allowed_sidecar(&sidecar, &roots).map(|sidecar| sidecar.content.len()),
            Some(MAX_LYRICS_SIDECAR_BYTES)
        );

        fs::write(&sidecar, "a".repeat(MAX_LYRICS_SIDECAR_BYTES + 1))
            .expect("write oversized sidecar");
        assert!(read_allowed_sidecar(&sidecar, &roots).is_none());

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[test]
    fn interrupted_stage_write_leaves_existing_sidecar_unchanged() {
        let directory = temp_dir("interrupted-write");
        let sidecar = directory.join("song.lrc");
        fs::write(&sidecar, b"original").expect("write original lyrics");

        let result = write_sidecar_atomic_with(&sidecar, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::new(
                io::ErrorKind::Interrupted,
                "simulated interruption",
            ))
        });

        assert!(result.is_err());
        assert_eq!(
            fs::read(&sidecar).expect("read original lyrics"),
            b"original"
        );
        assert!(lyrics_recovery_entries(&directory).is_empty());

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn creating_sidecar_does_not_clobber_concurrent_destination() {
        let directory = temp_dir("create-race");
        let sidecar = directory.join("song.lrc");

        let result = write_sidecar_atomic_with(&sidecar, |file| {
            file.write_all(b"ours")?;
            fs::write(&sidecar, b"concurrent")
        });

        assert!(result.is_err());
        assert_eq!(
            fs::read(&sidecar).expect("read concurrent lyrics"),
            b"concurrent"
        );
        assert!(lyrics_recovery_entries(&directory).is_empty());

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn replacing_sidecar_rejects_destination_path_swap() {
        let directory = temp_dir("replace-race");
        let sidecar = directory.join("song.lrc");
        let displaced = directory.join("displaced.lrc");
        fs::write(&sidecar, b"original").expect("write original lyrics");

        let result = write_sidecar_atomic_with(&sidecar, |file| {
            file.write_all(b"ours")?;
            fs::rename(&sidecar, &displaced)?;
            fs::write(&sidecar, b"concurrent")
        });

        assert!(result.is_err());
        assert_eq!(
            fs::read(&sidecar).expect("read concurrent lyrics"),
            b"concurrent"
        );
        assert_eq!(
            fs::read(&displaced).expect("read displaced lyrics"),
            b"original"
        );
        assert!(lyrics_recovery_entries(&directory).is_empty());

        let _ = fs::remove_dir_all(directory);
    }

    #[cfg(unix)]
    #[test]
    fn replacing_sidecar_preserves_existing_permissions() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let allowed_root = temp_dir("preserve-permissions");
        let track = allowed_root.join("song.mp3");
        let sidecar = track.with_extension("lrc");
        fs::write(&track, b"audio").expect("write track");
        fs::write(&sidecar, b"original").expect("write original lyrics");
        fs::set_permissions(&sidecar, fs::Permissions::from_mode(0o640))
            .expect("set original permissions");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        write_lyrics_for_track_checked(&track.to_string_lossy(), "replacement".to_string(), &roots)
            .expect("replace lyrics");

        assert_eq!(
            fs::metadata(&sidecar).expect("lyrics metadata").mode() & 0o777,
            0o640
        );

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[cfg(unix)]
    #[test]
    fn local_lyrics_rejects_sidecar_symlink_outside_root() {
        use std::os::unix::fs::symlink;

        let allowed_root = temp_dir("sidecar-read-allowed");
        let outside_root = temp_dir("sidecar-read-outside");
        let track = allowed_root.join("song.mp3");
        let outside_lyrics = outside_root.join("outside.lrc");
        fs::write(&track, b"audio").expect("write track");
        fs::write(&outside_lyrics, "[00:01]Outside").expect("write outside lyrics");
        symlink(&outside_lyrics, track.with_extension("lrc")).expect("create sidecar symlink");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        assert_eq!(
            load_local_lyrics_for_track(&track.to_string_lossy(), &roots),
            None
        );

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[cfg(unix)]
    #[test]
    fn write_lyrics_rejects_sidecar_symlink_outside_root() {
        use std::os::unix::fs::symlink;

        let allowed_root = temp_dir("sidecar-write-allowed");
        let outside_root = temp_dir("sidecar-write-outside");
        let track = allowed_root.join("song.mp3");
        let outside_lyrics = outside_root.join("outside.lrc");
        fs::write(&track, b"audio").expect("write track");
        fs::write(&outside_lyrics, "original").expect("write outside lyrics");
        symlink(&outside_lyrics, track.with_extension("lrc")).expect("create sidecar symlink");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = write_lyrics_for_track_checked(
            &track.to_string_lossy(),
            "[00:01]Changed".to_string(),
            &roots,
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&outside_lyrics).expect("read outside lyrics"),
            "original"
        );

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[cfg(unix)]
    #[test]
    fn sidecar_symlink_inside_root_is_neither_read_nor_written() {
        use std::os::unix::fs::symlink;

        let allowed_root = temp_dir("sidecar-symlink-inside");
        let track = allowed_root.join("song.mp3");
        let real_lyrics = allowed_root.join("real.lrc");
        fs::write(&track, b"audio").expect("write track");
        fs::write(&real_lyrics, "original").expect("write real lyrics");
        symlink(&real_lyrics, track.with_extension("lrc")).expect("create sidecar symlink");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        assert_eq!(
            load_local_lyrics_for_track(&track.to_string_lossy(), &roots),
            None
        );
        assert!(write_lyrics_for_track_checked(
            &track.to_string_lossy(),
            "changed".to_string(),
            &roots,
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(&real_lyrics).expect("read real lyrics"),
            "original"
        );

        let _ = fs::remove_dir_all(allowed_root);
    }

    fn sample_track(id: &str, file_path: String) -> DbTrack {
        DbTrack {
            id: id.to_string(),
            title: id.to_string(),
            artist: "Artist".to_string(),
            album_artist: None,
            album: "Album".to_string(),
            year: Some(2024),
            duration: 180.0,
            file_path,
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
    fn sync_lyrics_index_paginates_tracks_and_cleans_orphans() {
        let db = Arc::new(Database::in_memory_for_tests().expect("create db"));
        let dir = temp_dir("sync-pages");
        let tracks: Vec<DbTrack> = (0..1001)
            .map(|i| {
                let path = dir.join(format!("track-{i:04}.mp3"));
                fs::write(&path, b"audio").expect("write track");
                fs::write(path.with_extension("lrc"), "[00:01]Line").expect("write lrc");
                sample_track(&format!("track-{i:04}"), path.to_string_lossy().to_string())
            })
            .collect();
        db.upsert_tracks_batch(&tracks).expect("seed tracks");
        db.insert_lyrics_index_orphan_for_tests(&LyricsIndexEntry {
            track_id: "orphan".to_string(),
            lyrics_path: dir.join("orphan.lrc").to_string_lossy().to_string(),
            lyrics_mtime: 1,
            content: "orphan".to_string(),
        })
        .expect("seed orphan");

        let roots = vec![fs::canonicalize(&dir).expect("canonical root")];
        let changed = sync_lyrics_index_blocking(&db, Some(&roots)).expect("sync lyrics");

        assert_eq!(changed, 1002);
        assert_eq!(db.lyrics_index_count().expect("lyrics count"), 1001);

        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn sync_lyrics_index_with_empty_roots_is_noop() {
        let db = Arc::new(Database::in_memory_for_tests().expect("create db"));
        let dir = temp_dir("sync-empty-roots");
        let track = dir.join("song.mp3");
        fs::write(&track, b"audio").expect("write track");
        fs::write(track.with_extension("lrc"), "[00:01]Line").expect("write lrc");
        db.upsert_tracks_batch(&[sample_track("track", track.to_string_lossy().to_string())])
            .expect("seed track");

        let changed = sync_lyrics_index_blocking(&db, Some(&[])).expect("sync lyrics");

        assert_eq!(changed, 0);
        assert_eq!(db.lyrics_index_count().expect("lyrics count"), 0);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn sync_lyrics_index_skips_tracks_outside_library_roots() {
        let db = Arc::new(Database::in_memory_for_tests().expect("create db"));
        let allowed_root = temp_dir("sync-allowed");
        let outside_root = temp_dir("sync-outside");
        let allowed_track = allowed_root.join("allowed.mp3");
        let outside_track = outside_root.join("outside.mp3");
        fs::write(&allowed_track, b"audio").expect("write allowed track");
        fs::write(&outside_track, b"audio").expect("write outside track");
        fs::write(allowed_track.with_extension("lrc"), "[00:01]Allowed")
            .expect("write allowed lrc");
        fs::write(outside_track.with_extension("lrc"), "[00:01]Outside")
            .expect("write outside lrc");
        db.upsert_tracks_batch(&[
            sample_track("allowed", allowed_track.to_string_lossy().to_string()),
            sample_track("outside", outside_track.to_string_lossy().to_string()),
        ])
        .expect("seed tracks");
        db.upsert_lyrics_index_batch(&[LyricsIndexEntry {
            track_id: "outside".to_string(),
            lyrics_path: outside_track
                .with_extension("lrc")
                .to_string_lossy()
                .to_string(),
            lyrics_mtime: 1,
            content: "stale outside".to_string(),
        }])
        .expect("seed outside lyrics index");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        sync_lyrics_index_blocking(&db, Some(&roots)).expect("sync lyrics");

        let entries = db.get_lyrics_index_meta().expect("read lyrics index");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].track_id, "allowed");

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn sync_lyrics_index_removes_oversized_sidecar_content() {
        let db = Arc::new(Database::in_memory_for_tests().expect("create db"));
        let directory = temp_dir("sync-oversized");
        let track = directory.join("song.mp3");
        let sidecar = track.with_extension("lrc");
        fs::write(&track, b"audio").expect("write track");
        fs::write(&sidecar, "a".repeat(MAX_LYRICS_SIDECAR_BYTES + 1))
            .expect("write oversized sidecar");
        db.upsert_tracks_batch(&[sample_track(
            "oversized",
            track.to_string_lossy().to_string(),
        )])
        .expect("seed track");
        db.upsert_lyrics_index_batch(&[LyricsIndexEntry {
            track_id: "oversized".to_string(),
            lyrics_path: sidecar.to_string_lossy().to_string(),
            lyrics_mtime: 1,
            content: "stale".to_string(),
        }])
        .expect("seed stale lyrics");
        let roots = vec![fs::canonicalize(&directory).expect("canonical root")];

        sync_lyrics_index_blocking(&db, Some(&roots)).expect("sync lyrics");

        assert_eq!(db.lyrics_index_count().expect("lyrics count"), 0);

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn database_ingestion_independently_rejects_oversized_lyrics() {
        let db = Database::in_memory_for_tests().expect("create db");
        let error = db
            .upsert_lyrics_index_batch(&[LyricsIndexEntry {
                track_id: "missing".to_string(),
                lyrics_path: "missing.lrc".to_string(),
                lyrics_mtime: 1,
                content: "a".repeat(MAX_LYRICS_SIDECAR_BYTES + 1),
            }])
            .expect_err("reject oversized database content");

        assert!(error.to_string().contains("exceeds 1 MiB"));
        assert_eq!(db.lyrics_index_count().expect("lyrics count"), 0);
    }

    #[test]
    fn clean_lrc_line_removes_millisecond_line_and_word_timestamps() {
        let line = "[00:01.234]<00:01.250>Hello <00:02.000>world";

        assert_eq!(clean_lrc_line(line), "Hello world");
    }

    #[test]
    fn clean_lrc_line_keeps_invalid_tags_and_supports_all_timestamp_widths() {
        let cases = [
            ("[1:02]One", "One"),
            ("[01:02.3]Two", "Two"),
            ("[01:02.34]Three", "Three"),
            ("<01:02.345>Four", "Four"),
            ("[01:02.1234]Keep", "[01:02.1234]Keep"),
            ("[001:02]Keep", "[001:02]Keep"),
            ("[ar:Artist]Keep", "[ar:Artist]Keep"),
            ("[00:01] مرحبا <00:02.00>بكم ", "مرحبا بكم"),
        ];

        for (input, expected) in cases {
            assert_eq!(clean_lrc_line(input), expected, "input: {input:?}");
        }
    }

    #[test]
    fn clean_lrc_line_handles_adversarial_unclosed_brackets_linearly() {
        let input = format!("{}payload", "[".repeat(32 * 1024));

        assert_eq!(clean_lrc_line(&input), input);
    }
}

#[tauri::command]
pub async fn sync_lyrics_index(
    db: State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<u32, String> {
    let db_clone = db.inner().clone();
    let roots = roots_state.inner().read().roots.clone();
    spawn_blocking(move || sync_lyrics_index_blocking(&db_clone, Some(&roots)))
        .await
        .map_err(|e| format!("Lyrics sync task failed: {}", e))?
}

#[tauri::command]
pub async fn search_lyrics(
    query: String,
    limit: u32,
    db: State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<LyricsSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let db_clone = db.inner().clone();
    let roots = roots_state.inner().read().roots.clone();
    let query_lower = query.to_lowercase();
    let query_for_db = query.clone();

    spawn_blocking(move || {
        if db_clone
            .lyrics_index_count()
            .map_err(|e| format!("Failed to read lyrics index count: {}", e))?
            == 0
        {
            let _ = sync_lyrics_index_blocking(&db_clone, Some(&roots));
        }

        let candidates = db_clone
            .search_lyrics_index_candidates(&query_for_db, limit)
            .map_err(|e| format!("Failed to query lyrics index: {}", e))?;

        let mut results: Vec<LyricsSearchResult> = Vec::new();
        for candidate in candidates {
            if let Some((matched_line, matched_line_index)) =
                find_first_match_line(&candidate.content, &query_lower)
            {
                results.push(LyricsSearchResult {
                    id: candidate.id,
                    title: candidate.title,
                    artist: candidate.artist,
                    album: candidate.album,
                    duration: candidate.duration,
                    file_path: candidate.file_path,
                    cover_art_hash: candidate.cover_art_hash,
                    matched_line,
                    matched_line_index,
                });
            }

            if results.len() >= limit as usize {
                break;
            }
        }

        Ok(results)
    })
    .await
    .map_err(|e| format!("Search task failed: {}", e))?
}
