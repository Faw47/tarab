use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, Tag};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::async_runtime::spawn_blocking;
use tauri::State;

use crate::file_ops::{ensure_existing_path_allowed, SharedLibraryRoots};

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
    pub cover_art_mime: Option<String>,   // e.g., "image/jpeg", "image/png"
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

    let tagged_file = Probe::open(&target_path)
        .map_err(|e| format!("Failed to open file: {}", e))?
        .read()
        .map_err(|e| format!("Failed to read file: {}", e))?;

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
        has_cover_art: false,
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

        // Get cover art
        let pictures = tag.pictures();
        if !pictures.is_empty() {
            tag_info.has_cover_art = true;
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

    let mut tagged_file = Probe::open(&target_path)
        .map_err(|e| format!("Failed to open file: {}", e))?
        .read()
        .map_err(|e| format!("Failed to read file: {}", e))?;

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
    if let (Some(art_base64), Some(mime_str)) = (updates.cover_art_base64, updates.cover_art_mime) {
        let data = base64_decode(&art_base64).map_err(|e| format!("Invalid base64: {}", e))?;

        let mime_type = match mime_str.as_str() {
            "image/jpeg" | "image/jpg" => MimeType::Jpeg,
            "image/png" => MimeType::Png,
            "image/gif" => MimeType::Gif,
            "image/bmp" => MimeType::Bmp,
            "image/tiff" => MimeType::Tiff,
            _ => MimeType::Jpeg, // Default to JPEG
        };

        // Remove existing pictures
        tag.remove_picture_type(PictureType::CoverFront);
        tag.remove_picture_type(PictureType::Other);

        // Add new picture
        let picture = Picture::new_unchecked(PictureType::CoverFront, Some(mime_type), None, data);
        tag.push_picture(picture);
    }

    // Write changes to file
    tagged_file
        .save_to_path(&target_path, WriteOptions::default())
        .map_err(|e| format!("Failed to save tags: {}", e))?;

    Ok(())
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

    let mut tagged_file = Probe::open(&target_path)
        .map_err(|e| format!("Failed to open file: {}", e))?
        .read()
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let tag_type = tagged_file.primary_tag_type();
    if let Some(tag) = tagged_file.tag_mut(tag_type) {
        // Remove all pictures
        while !tag.pictures().is_empty() {
            tag.remove_picture(0);
        }
    }

    tagged_file
        .save_to_path(&target_path, WriteOptions::default())
        .map_err(|e| format!("Failed to save: {}", e))?;

    Ok(())
}

fn base64_decode(encoded: &str) -> Result<Vec<u8>, base64::DecodeError> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(encoded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
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
