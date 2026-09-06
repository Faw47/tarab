use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::{Accessor, ItemKey, Tag};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use tauri::async_runtime::spawn_blocking;
use tauri::State;

use crate::embedded_art::read_tagged_file_from_path;
use crate::file_ops::{ensure_existing_path_allowed, SharedLibraryRoots};
use crate::image_cache::{decode_bounded_base64_image, validated_artwork_mime};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileVersion {
    identity_a: u64,
    identity_b: u64,
    length: u64,
    modified_a: u64,
    modified_b: u64,
    permissions: u32,
}

#[cfg(unix)]
fn file_version(file: &fs::File) -> io::Result<FileVersion> {
    use std::os::unix::fs::MetadataExt;

    let metadata = file.metadata()?;
    Ok(FileVersion {
        identity_a: metadata.dev(),
        identity_b: metadata.ino(),
        length: metadata.len(),
        modified_a: metadata.mtime() as u64,
        modified_b: metadata.mtime_nsec() as u64,
        permissions: metadata.mode(),
    })
}

#[cfg(windows)]
fn file_version(file: &fs::File) -> io::Result<FileVersion> {
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
        modified_a: u64::from(information.ftLastWriteTime.dwHighDateTime),
        modified_b: u64::from(information.ftLastWriteTime.dwLowDateTime),
        permissions: information.dwFileAttributes,
    })
}

#[cfg(not(any(unix, windows)))]
fn file_version(file: &fs::File) -> io::Result<FileVersion> {
    use std::time::UNIX_EPOCH;

    let metadata = file.metadata()?;
    let modified = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    Ok(FileVersion {
        identity_a: 0,
        identity_b: 0,
        length: metadata.len(),
        modified_a: modified.as_secs(),
        modified_b: u64::from(modified.subsec_nanos()),
        permissions: u32::from(metadata.permissions().readonly()),
    })
}

fn version_at_path(path: &Path) -> io::Result<FileVersion> {
    file_version(&fs::File::open(path)?)
}

fn unique_sibling_name(target: &Path, role: &str) -> OsString {
    let mut name = OsString::from(format!(".tarab-{role}-{:032x}", rand::random::<u128>()));
    if let Some(extension) = target.extension() {
        name.push(".");
        name.push(extension);
    }
    name
}

fn create_staged_copy(target: &Path) -> Result<(PathBuf, fs::File), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Media path has no parent directory".to_string())?;
    for _ in 0..32 {
        let path = parent.join(unique_sibling_name(target, "stage"));
        match fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to create temporary media copy: {error}")),
        }
    }
    Err("Failed to allocate a unique temporary media path".to_string())
}

#[cfg(windows)]
fn create_backup_directory(target: &Path) -> Result<PathBuf, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Media path has no parent directory".to_string())?;
    for _ in 0..32 {
        let path = parent.join(unique_sibling_name(target, "backup"));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to create media backup directory: {error}")),
        }
    }
    Err("Failed to allocate a unique media backup path".to_string())
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
    }
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) {}

#[cfg(not(windows))]
fn replace_staged_file_fallback(
    staged_path: &Path,
    target: &Path,
    expected: FileVersion,
) -> Result<(), String> {
    if version_at_path(target).ok() != Some(expected) {
        let _ = fs::remove_file(staged_path);
        return Err("Media file changed while tags were being updated".to_string());
    }

    if let Err(error) = fs::rename(staged_path, target) {
        let _ = fs::remove_file(staged_path);
        return Err(format!("Failed to atomically replace media file: {error}"));
    }

    sync_parent_directory(target);
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn replace_staged_file(
    staged_path: &Path,
    target: &Path,
    expected: FileVersion,
) -> Result<(), String> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};

    if let Err(error) = renameat_with(CWD, staged_path, CWD, target, RenameFlags::EXCHANGE) {
        return replace_staged_file_fallback(staged_path, target, expected)
            .map_err(|fallback| format!("Atomic media exchange failed ({error}); {fallback}"));
    }

    if version_at_path(staged_path).ok() != Some(expected) {
        if let Err(rollback_error) =
            renameat_with(CWD, staged_path, CWD, target, RenameFlags::EXCHANGE)
        {
            return Err(format!(
                "Media file changed during replacement and rollback failed ({rollback_error}); the displaced file was retained at {}",
                staged_path.display()
            ));
        }
        let _ = fs::remove_file(staged_path);
        return Err("Media file changed while tags were being updated".to_string());
    }

    let _ = fs::remove_file(staged_path);
    sync_parent_directory(target);
    Ok(())
}

#[cfg(all(not(windows), not(any(target_os = "linux", target_os = "macos"))))]
fn replace_staged_file(
    staged_path: &Path,
    target: &Path,
    expected: FileVersion,
) -> Result<(), String> {
    replace_staged_file_fallback(staged_path, target, expected)
}

#[cfg(windows)]
fn replace_file_windows(
    target: &Path,
    replacement: &Path,
    backup: Option<&Path>,
) -> io::Result<()> {
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
    let backup = backup.map(|path| {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>()
    });
    let backup_ptr = backup
        .as_ref()
        .map_or(PCWSTR::null(), |path| PCWSTR(path.as_ptr()));

    unsafe {
        ReplaceFileW(
            PCWSTR(target.as_ptr()),
            PCWSTR(replacement.as_ptr()),
            backup_ptr,
            REPLACEFILE_IGNORE_MERGE_ERRORS | REPLACEFILE_WRITE_THROUGH,
            None,
            None,
        )
        .map_err(|_| io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn replace_staged_file(
    staged_path: &Path,
    target: &Path,
    expected: FileVersion,
) -> Result<(), String> {
    let backup_directory = create_backup_directory(target).inspect_err(|_| {
        let _ = fs::remove_file(staged_path);
    })?;
    let backup_path = backup_directory.join("original");

    if let Err(error) = replace_file_windows(target, staged_path, Some(&backup_path)) {
        if version_at_path(target).ok() == Some(expected) {
            let _ = fs::remove_file(staged_path);
            let _ = fs::remove_file(&backup_path);
            let _ = fs::remove_dir(&backup_directory);
            return Err(format!("Failed to replace media file: {error}"));
        }
        if version_at_path(&backup_path).ok() == Some(expected) {
            let _ = fs::remove_file(staged_path);
            let rollback = if target.exists() {
                replace_file_windows(target, &backup_path, Some(staged_path))
            } else {
                fs::rename(&backup_path, target)
            };
            if rollback.is_ok() {
                let _ = fs::remove_file(staged_path);
                let _ = fs::remove_dir(&backup_directory);
                return Err(format!("Failed to replace media file: {error}"));
            }
        }
        return Err(format!(
            "Failed to replace media file ({error}); recovery files were retained in {}",
            backup_directory.display()
        ));
    }

    if version_at_path(&backup_path).ok() != Some(expected) {
        if replace_file_windows(target, &backup_path, Some(staged_path)).is_ok() {
            let _ = fs::remove_file(staged_path);
            let _ = fs::remove_dir(&backup_directory);
            return Err("Media file changed while tags were being updated".to_string());
        }
        return Err(format!(
            "Media file changed during replacement and rollback failed; recovery files were retained in {}",
            backup_directory.display()
        ));
    }

    let _ = fs::remove_file(&backup_path);
    let _ = fs::remove_dir(&backup_directory);
    sync_parent_directory(target);
    Ok(())
}

fn rewrite_media_file(
    target: &Path,
    mutate: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let entry_metadata = fs::symlink_metadata(target)
        .map_err(|error| format!("Failed to inspect media file: {error}"))?;
    if entry_metadata.file_type().is_symlink() || !entry_metadata.is_file() {
        return Err("Media path is not a regular file".to_string());
    }
    if entry_metadata.permissions().readonly() {
        return Err("Media file is read-only".to_string());
    }

    let mut source = fs::File::open(target)
        .map_err(|error| format!("Failed to open media file for staging: {error}"))?;
    let source_version =
        file_version(&source).map_err(|error| format!("Failed to identify media file: {error}"))?;
    let permissions = source
        .metadata()
        .map_err(|error| format!("Failed to read media permissions: {error}"))?
        .permissions();
    if version_at_path(target).ok() != Some(source_version) {
        return Err("Media file changed before it could be staged".to_string());
    }

    let (staged_path, mut staged_file) = create_staged_copy(target)?;
    let mut replacement_started = false;
    let result = (|| {
        let copied = io::copy(&mut source, &mut staged_file)
            .map_err(|error| format!("Failed to copy media file for tag update: {error}"))?;
        if copied != source_version.length {
            return Err(
                "Media file changed while its temporary copy was being written".to_string(),
            );
        }
        drop(staged_file);

        mutate(&staged_path)?;
        let staged_file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&staged_path)
            .map_err(|error| format!("Failed to reopen updated media file: {error}"))?;
        fs::set_permissions(&staged_path, permissions)
            .map_err(|error| format!("Failed to retain media permissions: {error}"))?;
        staged_file
            .sync_all()
            .map_err(|error| format!("Failed to sync updated media file: {error}"))?;
        drop(staged_file);

        if version_at_path(target).ok() != Some(source_version) {
            return Err("Media file changed while tags were being updated".to_string());
        }

        // Windows ReplaceFileW requires all ordinary read handles to allow delete sharing.
        drop(source);
        replacement_started = true;
        replace_staged_file(&staged_path, target, source_version)
    })();

    if result.is_err() && !replacement_started {
        let _ = fs::remove_file(&staged_path);
    }
    result
}

fn is_standard_key(key: &ItemKey) -> bool {
    matches!(
        key,
        ItemKey::TrackTitle
            | ItemKey::TrackArtist
            | ItemKey::AlbumTitle
            | ItemKey::AlbumArtist
            | ItemKey::Year
            | ItemKey::TrackNumber
            | ItemKey::TrackTotal
            | ItemKey::DiscNumber
            | ItemKey::DiscTotal
            | ItemKey::Genre
            | ItemKey::Composer
            | ItemKey::Comment
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagUpdate {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub total_tracks: Option<u32>,
    pub disc_number: Option<u32>,
    pub total_discs: Option<u32>,
    pub genre: Option<String>,
    pub composer: Option<String>,
    pub comment: Option<String>,
    pub clear_fields: Option<Vec<String>>,
    pub cover_art_base64: Option<String>, // Base64 encoded image
    pub cover_art_mime: Option<String>,   // Advisory only; bytes are sniffed before writing.
    pub extra_tags: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub total_tracks: Option<u32>,
    pub disc_number: Option<u32>,
    pub total_discs: Option<u32>,
    pub genre: Option<String>,
    pub composer: Option<String>,
    pub comment: Option<String>,
    pub has_cover_art: bool,
    pub file_path: String,
    pub file_format: String,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
    pub duration_secs: f64,
    pub extra_tags: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMutationResult {
    pub path: String,
    pub status: String,
    pub operation: String,
    pub error_code: Option<String>,
    pub recoverable: bool,
    pub error_message: Option<String>,
    pub undo_token: Option<String>,
}

#[tauri::command]
pub async fn read_full_tags(
    file_path: String,
    roots_state: State<'_, SharedLibraryRoots>,
) -> Result<TagInfo, String> {
    let roots = roots_state.read().roots.clone();
    spawn_blocking(move || read_full_tags_checked(file_path, roots))
        .await
        .map_err(|e| e.to_string())?
}

fn clear_tag_field(tag: &mut Tag, field: &str) {
    match field {
        "title" => tag.remove_key(&ItemKey::TrackTitle),
        "artist" => tag.remove_key(&ItemKey::TrackArtist),
        "album" => tag.remove_key(&ItemKey::AlbumTitle),
        "albumArtist" => tag.remove_key(&ItemKey::AlbumArtist),
        "year" => tag.remove_year(),
        "trackNumber" => tag.remove_track(),
        "totalTracks" => tag.remove_track_total(),
        "discNumber" => tag.remove_disk(),
        "totalDiscs" => tag.remove_disk_total(),
        "genre" => tag.remove_key(&ItemKey::Genre),
        "composer" => tag.remove_key(&ItemKey::Composer),
        "comment" => tag.remove_key(&ItemKey::Comment),
        _ => {}
    }
}

fn read_full_tags_checked(file_path: String, roots: Vec<PathBuf>) -> Result<TagInfo, String> {
    let path = Path::new(&file_path);
    let target_path = ensure_existing_path_allowed(path, &roots, "read tags")?;

    let bounded_file = read_tagged_file_from_path(&target_path, false)?;
    let has_cover_art = bounded_file.has_art;
    let tagged_file = bounded_file.tagged_file;

    let properties = tagged_file.properties();
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let file_format = path
        .extension()
        .map(|e| e.to_string_lossy().to_uppercase())
        .unwrap_or_else(|| "Unknown".to_string());

    let mut tag_info = TagInfo {
        title: None,
        artist: None,
        album: None,
        album_artist: None,
        year: None,
        track_number: None,
        total_tracks: None,
        disc_number: None,
        total_discs: None,
        genre: None,
        composer: None,
        comment: None,
        has_cover_art,
        file_path: file_path.clone(),
        file_format,
        bitrate: properties.audio_bitrate(),
        sample_rate: properties.sample_rate(),
        channels: properties.channels(),
        duration_secs: properties.duration().as_secs_f64(),
        extra_tags: None,
    };

    if let Some(tag) = tag {
        tag_info.title = tag.title().map(|s| s.to_string());
        tag_info.artist = tag.artist().map(|s| s.to_string());
        tag_info.album = tag.album().map(|s| s.to_string());
        tag_info.year = tag.year();
        tag_info.track_number = tag.track();
        tag_info.total_tracks = tag.track_total();
        tag_info.disc_number = tag.disk();
        tag_info.total_discs = tag.disk_total();
        tag_info.genre = tag.genre().map(|s| s.to_string());

        // Get album artist
        if let Some(item) = tag.get(&ItemKey::AlbumArtist) {
            tag_info.album_artist = item.value().text().map(|s| s.to_string());
        }

        // Get composer
        if let Some(item) = tag.get(&ItemKey::Composer) {
            tag_info.composer = item.value().text().map(|s| s.to_string());
        }

        // Get comment
        if let Some(item) = tag.get(&ItemKey::Comment) {
            tag_info.comment = item.value().text().map(|s| s.to_string());
        }

        // Capture extended tags not represented by standard fields
        let mut extra_tags = HashMap::new();
        for item in tag.items() {
            let key = item.key();
            if is_standard_key(key) {
                continue;
            }
            let key_str = key
                .map_key(tag.tag_type(), true)
                .map(|s| s.to_string())
                .unwrap_or_else(|| match key {
                    ItemKey::Unknown(value) => value.clone(),
                    _ => String::new(),
                });
            if key_str.is_empty() {
                continue;
            }
            if let Some(value) = item.value().text() {
                extra_tags.insert(key_str, value.to_string());
            }
        }
        if !extra_tags.is_empty() {
            tag_info.extra_tags = Some(extra_tags);
        }
    }

    Ok(tag_info)
}

#[tauri::command]
pub async fn write_tags(
    file_path: String,
    updates: TagUpdate,
    roots_state: State<'_, SharedLibraryRoots>,
) -> Result<FileMutationResult, String> {
    let roots = roots_state.read().roots.clone();
    spawn_blocking(move || {
        write_tags_batch_checked(vec![file_path], updates, &roots)
            .into_iter()
            .next()
            .ok_or_else(|| "Tag write did not produce a result".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn write_tags_checked(
    file_path: &str,
    updates: TagUpdate,
    roots: &[PathBuf],
) -> Result<(), String> {
    let path = Path::new(&file_path);
    let target_path = ensure_existing_path_allowed(path, roots, "write tags")?;

    rewrite_media_file(&target_path, move |staged_path| {
        let mut tagged_file = read_tagged_file_from_path(staged_path, true)?.tagged_file;

        // Get or create primary tag
        let tag_type = tagged_file.primary_tag_type();

        // Check if tag exists, if not insert one
        if tagged_file.tag(tag_type).is_none() {
            tagged_file.insert_tag(Tag::new(tag_type));
        }

        let tag = tagged_file.tag_mut(tag_type).ok_or("Failed to get tag")?;

        if let Some(clear_fields) = updates.clear_fields.as_ref() {
            for field in clear_fields {
                clear_tag_field(tag, field);
            }
        }

        // Apply updates
        if let Some(title) = updates.title {
            tag.set_title(title);
        }
        if let Some(artist) = updates.artist {
            tag.set_artist(artist);
        }
        if let Some(album) = updates.album {
            tag.set_album(album);
        }
        if let Some(album_artist) = updates.album_artist {
            tag.insert_text(ItemKey::AlbumArtist, album_artist);
        }
        if let Some(year) = updates.year {
            tag.set_year(year);
        }
        if let Some(track) = updates.track_number {
            tag.set_track(track);
        }
        if let Some(total) = updates.total_tracks {
            tag.set_track_total(total);
        }
        if let Some(disc) = updates.disc_number {
            tag.set_disk(disc);
        }
        if let Some(total) = updates.total_discs {
            tag.set_disk_total(total);
        }
        if let Some(genre) = updates.genre {
            tag.set_genre(genre);
        }
        if let Some(composer) = updates.composer {
            tag.insert_text(ItemKey::Composer, composer);
        }
        if let Some(comment) = updates.comment {
            tag.insert_text(ItemKey::Comment, comment);
        }
        if let Some(extra_tags) = updates.extra_tags {
            for (key, value) in extra_tags {
                let item_key = ItemKey::from_key(tag.tag_type(), &key);
                if is_standard_key(&item_key) {
                    continue;
                }
                if value.trim().is_empty() {
                    tag.remove_key(&item_key);
                } else {
                    tag.insert_text(item_key, value);
                }
            }
        }

        // Handle cover art
        if let Some(art_base64) = updates.cover_art_base64 {
            let data = decode_bounded_base64_image(&art_base64)
                .map_err(|e| format!("Invalid cover art: {e}"))?;
            let mime =
                validated_artwork_mime(&data).map_err(|e| format!("Invalid cover art: {e}"))?;
            let mime_type = MimeType::from_str(mime);

            // Remove existing pictures
            tag.remove_picture_type(PictureType::CoverFront);
            tag.remove_picture_type(PictureType::Other);

            // Add new picture
            let picture =
                Picture::new_unchecked(PictureType::CoverFront, Some(mime_type), None, data);
            tag.push_picture(picture);
        }

        tagged_file
            .save_to_path(staged_path, WriteOptions::default())
            .map_err(|e| format!("Failed to save tags: {}", e))
    })
}

#[tauri::command]
pub async fn write_tags_batch(
    file_paths: Vec<String>,
    updates: TagUpdate,
    roots_state: State<'_, SharedLibraryRoots>,
) -> Result<Vec<FileMutationResult>, String> {
    let roots = roots_state.read().roots.clone();

    spawn_blocking(move || Ok(write_tags_batch_checked(file_paths, updates, &roots)))
        .await
        .map_err(|e| e.to_string())?
}

fn write_tags_batch_checked(
    file_paths: Vec<String>,
    updates: TagUpdate,
    roots: &[PathBuf],
) -> Vec<FileMutationResult> {
    let mut results = Vec::with_capacity(file_paths.len());
    for path in file_paths {
        match write_tags_checked(&path, updates.clone(), roots) {
            Ok(()) => results.push(FileMutationResult {
                path,
                status: "success".to_string(),
                operation: "writeTags".to_string(),
                error_code: None,
                recoverable: false,
                error_message: None,
                undo_token: None,
            }),
            Err(error) => results.push(FileMutationResult {
                path,
                status: "failed".to_string(),
                operation: "writeTags".to_string(),
                error_code: Some(if error.contains("outside configured library roots") {
                    "sourceAccessDenied".to_string()
                } else if error.contains("Failed to save tags") {
                    "writeFailed".to_string()
                } else {
                    "metadataUpdateFailed".to_string()
                }),
                recoverable: true,
                error_message: Some(error),
                undo_token: None,
            }),
        }
    }
    results
}

#[tauri::command]
pub async fn remove_cover_art(
    file_path: String,
    roots_state: State<'_, SharedLibraryRoots>,
) -> Result<(), String> {
    let roots = roots_state.read().roots.clone();
    spawn_blocking(move || remove_cover_art_checked(&file_path, &roots))
        .await
        .map_err(|e| e.to_string())?
}

fn remove_cover_art_checked(file_path: &str, roots: &[PathBuf]) -> Result<(), String> {
    let path = Path::new(file_path);
    let target_path = ensure_existing_path_allowed(path, roots, "remove cover art")?;

    rewrite_media_file(&target_path, |staged_path| {
        let mut tagged_file = read_tagged_file_from_path(staged_path, true)?.tagged_file;

        let tag_type = tagged_file.primary_tag_type();
        if let Some(tag) = tagged_file.tag_mut(tag_type) {
            // Remove all pictures
            while !tag.pictures().is_empty() {
                tag.remove_picture(0);
            }
        }

        tagged_file
            .save_to_path(staged_path, WriteOptions::default())
            .map_err(|e| format!("Failed to save: {}", e))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(not(windows))]
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tarab-tags-{}-{}", name, nonce));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn minimal_wav() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&38_u32.to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&8_000_u32.to_le_bytes());
        bytes.extend_from_slice(&16_000_u32.to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&2_u32.to_le_bytes());
        bytes.extend_from_slice(&0_i16.to_le_bytes());
        bytes
    }

    fn tarab_work_entries(path: &Path) -> Vec<PathBuf> {
        fs::read_dir(path)
            .expect("read test directory")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.contains(".tarab-"))
            })
            .collect()
    }

    #[test]
    fn tag_update_accepts_total_discs_from_camel_case_payload() {
        let update: TagUpdate = serde_json::from_str(r#"{"totalDiscs":2}"#).expect("tag update");
        assert_eq!(update.total_discs, Some(2));
    }

    #[test]
    fn tag_update_accepts_clear_fields_from_camel_case_payload() {
        let update: TagUpdate =
            serde_json::from_str(r#"{"clearFields":["year","totalDiscs"]}"#).expect("tag update");
        assert_eq!(
            update.clear_fields,
            Some(vec!["year".to_string(), "totalDiscs".to_string()])
        );
    }

    #[test]
    fn clear_tag_field_removes_standard_tag_values() {
        let mut tag = Tag::new(lofty::tag::TagType::Id3v2);
        tag.set_title("Title".to_string());
        tag.set_year(2024);
        tag.set_disk_total(2);

        clear_tag_field(&mut tag, "title");
        clear_tag_field(&mut tag, "year");
        clear_tag_field(&mut tag, "totalDiscs");

        assert!(tag.title().is_none());
        assert_eq!(tag.year(), None);
        assert_eq!(tag.disk_total(), None);
    }

    #[test]
    fn staged_media_fault_preserves_original_and_cleans_temporary_path() {
        let root = temp_dir("staged-fault");
        let track = root.join("song.wav");
        let original = minimal_wav();
        fs::write(&track, &original).expect("write track");

        let result = rewrite_media_file(&track, |staged_path| {
            assert_eq!(staged_path.parent(), track.parent());
            assert_eq!(staged_path.extension(), track.extension());
            fs::write(staged_path, b"damaged temporary copy").map_err(|error| error.to_string())?;
            Err("injected tag writer failure".to_string())
        });

        assert!(result.is_err());
        assert_eq!(fs::read(&track).expect("read original"), original);
        assert!(tarab_work_entries(&root).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(not(windows))]
    #[test]
    fn rename_over_fallback_keeps_the_media_path_continuously_installed() {
        let root = temp_dir("rename-over-fallback");
        let track = root.join("song.wav");
        let original = minimal_wav();
        fs::write(&track, &original).expect("write original");
        let expected = version_at_path(&track).expect("identify original");
        let (staged_path, mut staged_file) = create_staged_copy(&track).expect("create stage");
        staged_file
            .write_all(b"updated media")
            .expect("write replacement");
        staged_file.sync_all().expect("sync replacement");
        drop(staged_file);

        replace_staged_file_fallback(&staged_path, &track, expected)
            .expect("atomically replace media");

        assert_eq!(
            fs::read(&track).expect("read replacement"),
            b"updated media"
        );
        assert!(!staged_path.exists());
        assert!(tarab_work_entries(&root).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(not(windows))]
    #[test]
    fn rename_over_fallback_never_displaces_a_concurrent_replacement() {
        let root = temp_dir("rename-over-race");
        let track = root.join("song.wav");
        fs::write(&track, minimal_wav()).expect("write original");
        let expected = version_at_path(&track).expect("identify original");
        let (staged_path, mut staged_file) = create_staged_copy(&track).expect("create stage");
        staged_file
            .write_all(b"tag writer output")
            .expect("write staged update");
        drop(staged_file);
        fs::write(&track, b"concurrent replacement with a different size")
            .expect("replace target concurrently");

        let error = replace_staged_file_fallback(&staged_path, &track, expected)
            .expect_err("reject concurrent replacement");

        assert!(error.contains("changed"));
        assert_eq!(
            fs::read(&track).expect("read concurrent replacement"),
            b"concurrent replacement with a different size"
        );
        assert!(tarab_work_entries(&root).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn staged_media_write_does_not_modify_other_hard_links_in_place() {
        let root = temp_dir("staged-hard-link");
        let track = root.join("song.wav");
        let linked = root.join("linked.wav");
        let original = minimal_wav();
        fs::write(&track, &original).expect("write track");
        fs::hard_link(&track, &linked).expect("create hard link");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&track, fs::Permissions::from_mode(0o640))
                .expect("set source mode");
        }
        let original_permissions = fs::metadata(&track).expect("track metadata").permissions();

        rewrite_media_file(&track, |staged_path| {
            fs::write(staged_path, b"updated media copy").map_err(|error| error.to_string())
        })
        .expect("replace staged media");

        assert_eq!(
            fs::read(&track).expect("read updated track"),
            b"updated media copy"
        );
        assert_eq!(fs::read(&linked).expect("read hard link"), original);
        assert_eq!(
            fs::metadata(&track)
                .expect("updated metadata")
                .permissions()
                .readonly(),
            original_permissions.readonly()
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&track)
                    .expect("updated metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o640
            );
        }
        assert!(tarab_work_entries(&root).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn webp_cover_art_roundtrips_with_its_sniffed_mime() {
        use base64::Engine;
        use image::{DynamicImage, ImageFormat};
        use std::io::Cursor;

        let root = temp_dir("webp-cover-roundtrip");
        let track = root.join("song.wav");
        fs::write(&track, minimal_wav()).expect("write track");
        let roots = vec![fs::canonicalize(&root).expect("canonical root")];

        let mut encoded_image = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(2, 2)
            .write_to(&mut encoded_image, ImageFormat::WebP)
            .expect("encode WebP");
        let image_bytes = encoded_image.into_inner();
        let update: TagUpdate = serde_json::from_value(serde_json::json!({
            "coverArtBase64": base64::engine::general_purpose::STANDARD.encode(&image_bytes),
            "coverArtMime": "image/jpeg"
        }))
        .expect("cover update");

        write_tags_checked(&track.to_string_lossy(), update, &roots).expect("write cover art");

        let tagged_file = read_tagged_file_from_path(&track, true)
            .expect("read tagged track")
            .tagged_file;
        let picture = tagged_file
            .primary_tag()
            .or_else(|| tagged_file.first_tag())
            .and_then(|tag| tag.pictures().first())
            .expect("roundtripped cover art");
        assert_eq!(
            picture.mime_type().map(MimeType::as_str),
            Some("image/webp")
        );
        assert_eq!(picture.data(), image_bytes);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn non_art_tag_edit_preserves_existing_tags_and_bounded_cover() {
        use base64::Engine;
        use image::{DynamicImage, ImageFormat};
        use std::io::Cursor;

        let root = temp_dir("preserve-bounded-cover");
        let track = root.join("song.wav");
        fs::write(&track, minimal_wav()).expect("write track");
        let roots = vec![fs::canonicalize(&root).expect("canonical root")];

        let mut encoded_image = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(3, 3)
            .write_to(&mut encoded_image, ImageFormat::Png)
            .expect("encode PNG");
        let image_bytes = encoded_image.into_inner();
        let initial: TagUpdate = serde_json::from_value(serde_json::json!({
            "title": "Original title",
            "artist": "Preserved artist",
            "composer": "Preserved composer",
            "comment": "Preserved comment",
            "coverArtBase64": base64::engine::general_purpose::STANDARD.encode(&image_bytes)
        }))
        .expect("initial tag update");
        write_tags_checked(&track.to_string_lossy(), initial, &roots)
            .expect("write initial tags and cover");

        let title_only: TagUpdate =
            serde_json::from_value(serde_json::json!({ "title": "Updated title" }))
                .expect("title update");
        write_tags_checked(&track.to_string_lossy(), title_only, &roots)
            .expect("update non-art tag");

        let full_tags = read_full_tags_checked(track.to_string_lossy().into_owned(), roots.clone())
            .expect("read tags without materializing art");
        assert!(full_tags.has_cover_art);
        assert_eq!(full_tags.title.as_deref(), Some("Updated title"));
        assert_eq!(full_tags.artist.as_deref(), Some("Preserved artist"));
        assert_eq!(full_tags.composer.as_deref(), Some("Preserved composer"));
        assert_eq!(full_tags.comment.as_deref(), Some("Preserved comment"));

        let tagged_file = read_tagged_file_from_path(&track, true)
            .expect("materialize bounded cover")
            .tagged_file;
        let picture = tagged_file
            .primary_tag()
            .or_else(|| tagged_file.first_tag())
            .and_then(|tag| tag.pictures().first())
            .expect("preserved cover art");
        assert_eq!(picture.data(), image_bytes);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn staged_media_write_rejects_a_concurrent_source_change() {
        let root = temp_dir("staged-race");
        let track = root.join("song.wav");
        fs::write(&track, minimal_wav()).expect("write track");

        let result = rewrite_media_file(&track, |staged_path| {
            fs::write(staged_path, b"tag writer output").map_err(|error| error.to_string())?;
            fs::write(&track, b"concurrent source update").map_err(|error| error.to_string())
        });

        assert!(result
            .expect_err("concurrent update must fail")
            .contains("changed"));
        assert_eq!(
            fs::read(&track).expect("read concurrent update"),
            b"concurrent source update"
        );
        assert!(tarab_work_entries(&root).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn write_tags_rejects_outside_root_before_opening_file() {
        let allowed_root = temp_dir("allowed");
        let outside_root = temp_dir("outside");
        let track = outside_root.join("song.mp3");
        fs::write(&track, b"not a real mp3").expect("write track");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = write_tags_checked(
            &track.to_string_lossy(),
            TagUpdate {
                title: Some("Blocked".to_string()),
                artist: None,
                album: None,
                album_artist: None,
                year: None,
                track_number: None,
                total_tracks: None,
                disc_number: None,
                total_discs: None,
                genre: None,
                composer: None,
                comment: None,
                clear_fields: None,
                cover_art_base64: None,
                cover_art_mime: None,
                extra_tags: None,
            },
            &roots,
        );

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("outside configured library roots"));

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn batch_tag_write_returns_one_result_for_success_and_failure() {
        let allowed_root = temp_dir("batch-allowed");
        let outside_root = temp_dir("batch-outside");
        let valid_track = allowed_root.join("valid.wav");
        let blocked_track = outside_root.join("blocked.wav");
        fs::write(&valid_track, minimal_wav()).expect("write valid wave");
        fs::write(&blocked_track, minimal_wav()).expect("write blocked wave");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let update: TagUpdate = serde_json::from_str(r#"{"title":"Updated"}"#).expect("tag update");

        let results = write_tags_batch_checked(
            vec![
                valid_track.to_string_lossy().to_string(),
                blocked_track.to_string_lossy().to_string(),
            ],
            update,
            &roots,
        );

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].status, "success");
        assert_eq!(results[0].operation, "writeTags");
        assert_eq!(results[1].status, "failed");
        assert_eq!(results[1].error_code.as_deref(), Some("sourceAccessDenied"));
        assert!(results[1].recoverable);

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn remove_cover_art_rejects_outside_root_before_opening_file() {
        let allowed_root = temp_dir("allowed-remove");
        let outside_root = temp_dir("outside-remove");
        let track = outside_root.join("song.mp3");
        fs::write(&track, b"not a real mp3").expect("write track");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = remove_cover_art_checked(&track.to_string_lossy(), &roots);

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("outside configured library roots"));

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }
}
