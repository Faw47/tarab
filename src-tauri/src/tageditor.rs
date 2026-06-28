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
    pub genre: Option<String>,
    pub composer: Option<String>,
    pub comment: Option<String>,
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
) -> Result<(), String> {
    let roots = roots_state.read().roots.clone();
    spawn_blocking(move || write_tags_checked(&file_path, updates, &roots))
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
) -> Result<Vec<String>, String> {
    let roots = roots_state.read().roots.clone();

    spawn_blocking(move || {
        let mut errors = Vec::new();
        for path in file_paths {
            if let Err(e) = write_tags_checked(&path, updates.clone(), &roots) {
                errors.push(format!("{}: {}", path, e));
            }
        }
        Ok(errors)
    })
    .await
    .map_err(|e| e.to_string())?
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
                genre: None,
                composer: None,
                comment: None,
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
