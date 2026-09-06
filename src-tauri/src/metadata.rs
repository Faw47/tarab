use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::file::{TaggedFile, TaggedFileExt};
use lofty::picture::Picture;
use lofty::prelude::*;
use rayon::{prelude::*, ThreadPool, ThreadPoolBuilder};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::async_runtime::spawn_blocking;

use crate::database::SharedDatabase;
use crate::embedded_art::{read_tagged_file_from_file, read_tagged_file_from_path};
use crate::file_ops::{
    claim_metadata_file_access, ensure_existing_path_allowed, open_file_with_identity,
    revoke_transient_file_authority, FileIdentity, SharedLibraryRoots,
};
use crate::image_cache::{
    decode_bounded_image, ensure_bounded_image_bytes, is_valid_thumbnail_size,
    validated_artwork_mime, SharedImageCache,
};

#[derive(Debug, Serialize, Clone)]
pub struct TrackMetadata {
    pub title: String,
    pub artist: String,
    pub album_artist: Option<String>,
    pub album: String,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub duration_secs: f64,
    pub file_path: String,
    pub has_cover_art: bool,
    pub cover_art_hash: Option<String>,
    pub blurhash: Option<String>,
    pub file_format: String,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub file_size: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct TrackMetadataWithArt {
    pub title: String,
    pub artist: String,
    pub album_artist: Option<String>,
    pub album: String,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub duration_secs: f64,
    pub file_path: String,
    pub cover_art: Option<String>,
    pub blurhash: Option<String>,
    pub file_format: String,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub file_size: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct CoverArtPalette {
    pub primary: String,
    pub secondary: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoverArtResolution {
    pub status: String,
    pub hash: Option<String>,
    pub size: String,
    pub cache_available: bool,
    pub regenerated: bool,
    pub failure_reason: Option<String>,
}

const MAX_METADATA_THREADS: usize = 4;

#[cfg(windows)]
fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

#[cfg(not(windows))]
fn normalize_path(path: &str) -> String {
    path.to_string()
}
const MAX_ART_THREADS: usize = 2;
type CoverArtHashResult = (String, Option<(String, Option<String>)>);

fn capped_threads(limit: usize) -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get().min(limit).max(1))
        .unwrap_or(limit.max(1))
}

fn build_pool(limit: usize, name_prefix: &'static str) -> Option<ThreadPool> {
    ThreadPoolBuilder::new()
        .num_threads(capped_threads(limit))
        .thread_name(move |idx| format!("{}-{}", name_prefix, idx))
        .build()
        .ok()
        .or_else(|| ThreadPoolBuilder::new().num_threads(1).build().ok())
}

fn metadata_pool() -> Option<&'static ThreadPool> {
    static POOL: OnceLock<Option<ThreadPool>> = OnceLock::new();
    POOL.get_or_init(|| build_pool(MAX_METADATA_THREADS, "tarab-metadata"))
        .as_ref()
}

fn art_pool() -> Option<&'static ThreadPool> {
    static POOL: OnceLock<Option<ThreadPool>> = OnceLock::new();
    POOL.get_or_init(|| build_pool(MAX_ART_THREADS, "tarab-art"))
        .as_ref()
}

fn run_with_pool<T: Send>(pool: Option<&ThreadPool>, job: impl FnOnce() -> T + Send) -> T {
    if let Some(pool) = pool {
        pool.install(job)
    } else {
        job()
    }
}

// Fast metadata extraction - no cover art loading
fn first_picture(file: &TaggedFile) -> Option<&Picture> {
    // Prefer primary tag pictures, else any picture from any tag
    if let Some(tag) = file.primary_tag().or_else(|| file.first_tag()) {
        if let Some(pic) = tag.pictures().first() {
            return Some(pic);
        }
    }
    file.tags().iter().flat_map(|t| t.pictures().iter()).next()
}

fn bounded_picture_data(file: &TaggedFile) -> Result<Option<&[u8]>, String> {
    let Some(picture) = first_picture(file) else {
        return Ok(None);
    };
    let data = picture.data();
    ensure_bounded_image_bytes(data)?;
    Ok(Some(data))
}

fn read_tagged_file(
    open_path: &Path,
    expected_identity: Option<&FileIdentity>,
) -> Option<TaggedFile> {
    let file = open_file_with_identity(open_path, expected_identity).ok()?;
    read_tagged_file_from_file(file, open_path, true)
        .ok()
        .map(|bounded| bounded.tagged_file)
}

fn extract_metadata_fast_with_identity(
    file_path: &str,
    open_path: &Path,
    expected_identity: Option<&FileIdentity>,
) -> Option<TrackMetadata> {
    let path = open_path;

    let tagged_file = read_tagged_file(path, expected_identity)?;

    let properties = tagged_file.properties();
    let duration_secs = properties.duration().as_secs_f64();
    let bitrate = properties.audio_bitrate();
    let sample_rate = properties.sample_rate();

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let (title, artist, album_artist, album, genre, year, track_number, disc_number) =
        if let Some(tag) = tag {
            let title = tag.title().map(|s| s.to_string()).unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string()
            });

            let artist = tag
                .artist()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown Artist".to_string());
            let album_artist = tag
                .get_string(&lofty::tag::ItemKey::AlbumArtist)
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty());

            let album = tag
                .album()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown Album".to_string());

            let genre = tag
                .genre()
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty());
            let year = tag.year().map(|y| y as i32);

            (
                title,
                artist,
                album_artist,
                album,
                genre,
                year,
                tag.track(),
                tag.disk(),
            )
        } else {
            let title = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string();

            (
                title,
                "Unknown Artist".to_string(),
                None,
                "Unknown Album".to_string(),
                None,
                None,
                None,
                None,
            )
        };
    let picture = first_picture(&tagged_file);
    let has_cover_art = picture.is_some();
    let blurhash = bounded_picture_data(&tagged_file)
        .ok()
        .flatten()
        .and_then(generate_blurhash_from_bytes);

    let file_format = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_uppercase())
        .unwrap_or_else(|| "UNKNOWN".to_string());
    let file_size = std::fs::metadata(path).ok().map(|m| m.len());

    Some(TrackMetadata {
        title,
        artist,
        album_artist,
        album,
        genre,
        year,
        track_number,
        disc_number,
        duration_secs,
        file_path: file_path.to_string(),
        has_cover_art,
        cover_art_hash: None,
        blurhash,
        file_format,
        bitrate,
        sample_rate,
        file_size,
    })
}

fn extract_metadata_fast(file_path: &str, open_path: &Path) -> Option<TrackMetadata> {
    extract_metadata_fast_with_identity(file_path, open_path, None)
}

// Full metadata extraction with cover art
fn extract_metadata_with_art(file_path: &str, open_path: &Path) -> Option<TrackMetadataWithArt> {
    let path = open_path;

    let tagged_file = read_tagged_file_from_path(path, true).ok()?.tagged_file;

    let properties = tagged_file.properties();
    let duration_secs = properties.duration().as_secs_f64();
    let bitrate = properties.audio_bitrate();
    let sample_rate = properties.sample_rate();

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let (title, artist, album_artist, album, genre, year, track_number, disc_number) =
        if let Some(tag) = tag {
            let title = tag.title().map(|s| s.to_string()).unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string()
            });

            let artist = tag
                .artist()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown Artist".to_string());
            let album_artist = tag
                .get_string(&lofty::tag::ItemKey::AlbumArtist)
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty());

            let album = tag
                .album()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Unknown Album".to_string());

            let genre = tag
                .genre()
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty());
            let year = tag.year().map(|y| y as i32);

            (
                title,
                artist,
                album_artist,
                album,
                genre,
                year,
                tag.track(),
                tag.disk(),
            )
        } else {
            let title = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string();

            (
                title,
                "Unknown Artist".to_string(),
                None,
                "Unknown Album".to_string(),
                None,
                None,
                None,
                None,
            )
        };
    let picture_data = bounded_picture_data(&tagged_file).ok().flatten();
    let blurhash = picture_data.and_then(generate_blurhash_from_bytes);
    let cover_art = picture_data.map(|bytes| STANDARD.encode(bytes));

    let file_format = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_uppercase())
        .unwrap_or_else(|| "UNKNOWN".to_string());
    let file_size = std::fs::metadata(path).ok().map(|m| m.len());

    Some(TrackMetadataWithArt {
        title,
        artist,
        album_artist,
        album,
        genre,
        year,
        track_number,
        disc_number,
        duration_secs,
        file_path: file_path.to_string(),
        cover_art,
        blurhash,
        file_format,
        bitrate,
        sample_rate,
        file_size,
    })
}

fn extract_palette_from_bytes(bytes: &[u8]) -> Option<CoverArtPalette> {
    let thumb = decode_bounded_image(bytes)
        .ok()?
        .thumbnail(12, 12)
        .to_rgba8();
    let (width, height) = thumb.dimensions();

    let mut sum_primary = [0u64; 3];
    let mut sum_secondary = [0u64; 3];
    let mut sum_all = [0u64; 3];
    let mut count_primary = 0u64;
    let mut count_secondary = 0u64;
    let mut count_all = 0u64;

    for y in 0..height {
        for x in 0..width {
            let pixel = thumb.get_pixel(x, y).0;
            if pixel[3] < 10 {
                continue;
            }
            sum_all[0] += pixel[0] as u64;
            sum_all[1] += pixel[1] as u64;
            sum_all[2] += pixel[2] as u64;
            count_all += 1;

            if x < width / 2 && y < height / 2 {
                sum_primary[0] += pixel[0] as u64;
                sum_primary[1] += pixel[1] as u64;
                sum_primary[2] += pixel[2] as u64;
                count_primary += 1;
            } else if x >= width / 2 && y >= height / 2 {
                sum_secondary[0] += pixel[0] as u64;
                sum_secondary[1] += pixel[1] as u64;
                sum_secondary[2] += pixel[2] as u64;
                count_secondary += 1;
            }
        }
    }

    if count_all == 0 {
        return None;
    }

    let average = |sum: [u64; 3], count: u64| -> (u8, u8, u8) {
        (
            (sum[0] / count) as u8,
            (sum[1] / count) as u8,
            (sum[2] / count) as u8,
        )
    };

    let primary = if count_primary > 0 {
        average(sum_primary, count_primary)
    } else {
        average(sum_all, count_all)
    };
    let secondary = if count_secondary > 0 {
        average(sum_secondary, count_secondary)
    } else {
        average(sum_all, count_all)
    };

    let to_hex = |(r, g, b): (u8, u8, u8)| format!("#{:02X}{:02X}{:02X}", r, g, b);

    Some(CoverArtPalette {
        primary: to_hex(primary),
        secondary: to_hex(secondary),
    })
}

fn generate_blurhash_from_bytes(bytes: &[u8]) -> Option<String> {
    let img = decode_bounded_image(bytes).ok()?;
    // Resize for faster processing
    let thumb = img.thumbnail(64, 64).to_rgba8();
    let (tw, th) = thumb.dimensions();

    blurhash::encode(4, 3, tw, th, &thumb.into_raw()).ok()
}

fn ensure_metadata_path_allowed(
    file_path: &str,
    roots: &[PathBuf],
    action: &str,
) -> Result<PathBuf, String> {
    ensure_existing_path_allowed(Path::new(file_path), roots, action)
}

fn allowed_metadata_paths(
    file_paths: Vec<String>,
    roots: &[PathBuf],
    action: &str,
) -> Vec<(String, PathBuf)> {
    file_paths
        .into_iter()
        .filter_map(
            |path| match ensure_metadata_path_allowed(&path, roots, action) {
                Ok(open_path) => Some((path, open_path)),
                Err(err) => {
                    eprintln!("Skipped metadata path: {err}");
                    None
                }
            },
        )
        .collect()
}

fn read_track_metadata_with_authority(
    file_path: String,
    authority_id: Option<String>,
    roots_state: SharedLibraryRoots,
) -> Result<TrackMetadata, String> {
    let access = claim_metadata_file_access(
        &roots_state,
        Path::new(&file_path),
        authority_id.as_deref(),
        "read track metadata",
    )?;
    let result = extract_metadata_fast_with_identity(
        &file_path,
        &access.canonical_path,
        access.expected_identity.as_ref(),
    )
    .ok_or_else(|| format!("Failed to read metadata from: {}", file_path));
    if result.is_err() {
        if let Some(authority_id) = authority_id.as_deref() {
            let _ = revoke_transient_file_authority(&roots_state, authority_id);
        }
    }
    result
}

#[tauri::command]
pub async fn get_track_metadata(
    file_path: String,
    authority_id: Option<String>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<TrackMetadata, String> {
    let roots_state = roots_state.inner().clone();
    spawn_blocking(move || read_track_metadata_with_authority(file_path, authority_id, roots_state))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_cover_art_with_blurhash(
    file_path: String,
    cache: tauri::State<'_, SharedImageCache>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Option<(String, Option<String>)>, String> {
    let cache = cache.inner().clone();
    let db = db.inner().clone();
    let roots = roots_state.inner().read().roots.clone();

    spawn_blocking(move || {
        let open_path = ensure_metadata_path_allowed(&file_path, &roots, "read cover art")?;
        let normalized_path = normalize_path(&file_path);

        if let Some(hash) = db.get_cover_art_hash(&normalized_path).unwrap_or(None) {
            if cache.has_thumbnail(&hash) {
                // Should also try to get blurhash from DB if we added it to tracks
                // For now just return the hash.
                return Ok(Some((hash, None)));
            }
        }

        let tagged_file = read_tagged_file_from_path(&open_path, true)?.tagged_file;

        if let Some(data) = bounded_picture_data(&tagged_file)? {
            let hash = cache.generate_thumbnails(data)?;
            let blurhash = generate_blurhash_from_bytes(data);

            let _ = db.set_cover_art_hash(&normalized_path, &hash);
            // We might need a db.set_blurhash too, but usually it's part of track metadata scan

            return Ok(Some((hash, blurhash)));
        }

        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn resolve_cover_art(
    file_path: String,
    preferred_hash: Option<String>,
    size: String,
    cache: tauri::State<'_, SharedImageCache>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<CoverArtResolution, String> {
    if !is_valid_thumbnail_size(&size) {
        return Ok(CoverArtResolution {
            status: "invalidRequest".to_string(),
            hash: None,
            size,
            cache_available: false,
            regenerated: false,
            failure_reason: Some("unsupportedSize".to_string()),
        });
    }

    let cache = cache.inner().clone();
    let db = db.inner().clone();
    let roots = roots_state.inner().read().roots.clone();

    spawn_blocking(move || {
        if let Some(hash) = preferred_hash.as_deref() {
            if cache.has_valid_thumbnail(hash, &size) {
                return Ok(CoverArtResolution {
                    status: "ready".to_string(),
                    hash: Some(hash.to_string()),
                    size,
                    cache_available: true,
                    regenerated: false,
                    failure_reason: None,
                });
            }
        }

        let normalized_path = normalize_path(&file_path);
        if let Some(hash) = db.get_cover_art_hash(&normalized_path).unwrap_or(None) {
            if cache.has_valid_thumbnail(&hash, &size) {
                return Ok(CoverArtResolution {
                    status: "ready".to_string(),
                    hash: Some(hash),
                    size,
                    cache_available: true,
                    regenerated: false,
                    failure_reason: None,
                });
            }
        }

        let open_path = match ensure_metadata_path_allowed(&file_path, &roots, "repair cover art") {
            Ok(path) => path,
            Err(error) => {
                return Ok(CoverArtResolution {
                    status: "sourceUnavailable".to_string(),
                    hash: preferred_hash,
                    size,
                    cache_available: false,
                    regenerated: false,
                    failure_reason: Some(if error.contains("no library roots") {
                        "missingLibraryGrant".to_string()
                    } else {
                        "sourceAccessDenied".to_string()
                    }),
                });
            }
        };

        let tagged_file = read_tagged_file_from_path(&open_path, true)?.tagged_file;
        let Some(picture_data) = bounded_picture_data(&tagged_file)? else {
            return Ok(CoverArtResolution {
                status: "noArt".to_string(),
                hash: None,
                size,
                cache_available: false,
                regenerated: false,
                failure_reason: None,
            });
        };

        let hash = cache.generate_thumbnails(picture_data)?;
        db.set_cover_art_hash(&normalized_path, &hash)
            .map_err(|error| format!("Failed to persist repaired cover art hash: {}", error))?;

        Ok(CoverArtResolution {
            status: "ready".to_string(),
            hash: Some(hash),
            size,
            cache_available: true,
            regenerated: true,
            failure_reason: None,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

// Batch metadata loading - fast, no cover art
#[tauri::command]
pub async fn get_batch_metadata(
    file_paths: Vec<String>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<TrackMetadata>, String> {
    let roots = roots_state.inner().read().roots.clone();
    spawn_blocking(move || {
        let file_paths = allowed_metadata_paths(file_paths, &roots, "read track metadata");
        run_with_pool(metadata_pool(), || {
            file_paths
                .par_iter()
                .filter_map(|(path, open_path)| extract_metadata_fast(path, open_path))
                .collect()
        })
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_cover_art_data(
    file_path: String,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Option<(String, String)>, String> {
    let roots = roots_state.inner().read().roots.clone();
    spawn_blocking(move || {
        let open_path = ensure_metadata_path_allowed(&file_path, &roots, "read cover art data")?;
        let tagged_file = read_tagged_file_from_path(&open_path, true)?.tagged_file;

        if let Some(picture) = first_picture(&tagged_file) {
            ensure_bounded_image_bytes(picture.data())?;
            let mime = validated_artwork_mime(picture.data())?.to_string();
            let encoded = STANDARD.encode(picture.data());
            return Ok(Some((mime, encoded)));
        }

        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?
}

// Batch metadata loading with cover art - for visible items only
#[tauri::command]
pub async fn get_batch_metadata_with_art(
    file_paths: Vec<String>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<TrackMetadataWithArt>, String> {
    let roots = roots_state.inner().read().roots.clone();
    spawn_blocking(move || {
        let file_paths = allowed_metadata_paths(file_paths, &roots, "read track metadata with art");
        run_with_pool(art_pool(), || {
            file_paths
                .par_iter()
                .filter_map(|(path, open_path)| extract_metadata_with_art(path, open_path))
                .collect()
        })
    })
    .await
    .map_err(|e| e.to_string())
}

// Get cover art for multiple files in batch
#[tauri::command]
pub async fn get_batch_cover_art(
    file_paths: Vec<String>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<(String, Option<String>)>, String> {
    let roots = roots_state.inner().read().roots.clone();
    spawn_blocking(move || {
        let file_paths = allowed_metadata_paths(file_paths, &roots, "read batch cover art");
        run_with_pool(art_pool(), || {
            file_paths
                .par_iter()
                .map(|(path, open_path)| {
                    let art = read_tagged_file_from_path(open_path, true)
                        .ok()
                        .map(|bounded| bounded.tagged_file)
                        .and_then(|file| {
                            bounded_picture_data(&file)
                                .ok()
                                .flatten()
                                .map(|data| STANDARD.encode(data))
                        });
                    (path.clone(), art)
                })
                .collect()
        })
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_cover_art_palette(
    file_path: String,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Option<CoverArtPalette>, String> {
    let roots = roots_state.inner().read().roots.clone();
    spawn_blocking(move || {
        let open_path = ensure_metadata_path_allowed(&file_path, &roots, "read cover art palette")?;
        let tagged_file = read_tagged_file_from_path(&open_path, true)?.tagged_file;

        if let Some(data) = bounded_picture_data(&tagged_file)? {
            return Ok(extract_palette_from_bytes(data));
        }

        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Precompute cover art hashes and thumbnails for a batch of files.
/// Returns (file_path, hash) so the frontend can cache without re-decoding.
#[tauri::command]
pub async fn generate_cover_art_hashes(
    file_paths: Vec<String>,
    force: Option<bool>,
    cache: tauri::State<'_, SharedImageCache>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<CoverArtHashResult>, String> {
    let cache = cache.inner().clone();
    let db = db.inner().clone();
    let roots = roots_state.inner().read().roots.clone();
    let force = force.unwrap_or(false);

    spawn_blocking(move || {
        let file_paths = allowed_metadata_paths(file_paths, &roots, "generate cover art hashes");
        run_with_pool(art_pool(), || {
            file_paths
                .par_iter()
                .map(|(path, open_path)| {
                    let normalized_path = normalize_path(path);

                    if !force {
                        if let Some(existing) =
                            db.get_cover_art_hash(&normalized_path).unwrap_or(None)
                        {
                            if cache.has_thumbnail(&existing) {
                                // We don't have blurhash in DB easily here, so we might re-scan it or return None
                                return (path.clone(), Some((existing, None)));
                            }
                        }
                    }

                    let result = read_tagged_file_from_path(open_path, true)
                        .ok()
                        .map(|bounded| bounded.tagged_file)
                        .and_then(|file| {
                            let data = bounded_picture_data(&file).ok().flatten()?;
                            let hash = cache.generate_thumbnails(data).ok()?;
                            let blurhash = generate_blurhash_from_bytes(data);
                            Some((hash, blurhash))
                        });

                    if let Some((ref hash, _)) = result {
                        let _ = db.set_cover_art_hash(&normalized_path, hash);
                    }

                    (path.clone(), result)
                })
                .collect()
        })
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_cover_art(
    file_path: String,
    cache: tauri::State<'_, SharedImageCache>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Option<String>, String> {
    let res = get_cover_art_with_blurhash(file_path, cache, db, roots_state).await?;
    Ok(res.map(|(hash, _)| hash))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_ops::{
        authorize_transient_file, consume_play_once_file_access, create_library_roots_state,
    };
    use crate::image_cache::MAX_ENCODED_IMAGE_BYTES;
    use std::fs;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tarab-metadata-{}-{}", name, nonce));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn metadata_path_validation_rejects_paths_outside_library_roots() {
        let allowed_root = temp_dir("allowed");
        let outside_root = temp_dir("outside");
        let outside_file = outside_root.join("outside.mp3");
        fs::write(&outside_file, b"not audio").expect("write outside file");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = ensure_metadata_path_allowed(
            &outside_file.to_string_lossy(),
            &roots,
            "read track metadata",
        );

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("outside configured library roots"));

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn metadata_path_filter_keeps_allowed_paths_only() {
        let allowed_root = temp_dir("allowed");
        let outside_root = temp_dir("outside");
        let allowed_file = allowed_root.join("inside.mp3");
        let outside_file = outside_root.join("outside.mp3");
        fs::write(&allowed_file, b"not audio").expect("write allowed file");
        fs::write(&outside_file, b"not audio").expect("write outside file");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let filtered = allowed_metadata_paths(
            vec![
                allowed_file.to_string_lossy().to_string(),
                outside_file.to_string_lossy().to_string(),
            ],
            &roots,
            "read track metadata",
        );

        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].0, allowed_file.to_string_lossy().to_string());
        assert_eq!(
            filtered[0].1,
            fs::canonicalize(&allowed_file).expect("canonical file")
        );

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn malformed_play_once_metadata_revokes_remaining_playback_authority() {
        let root = temp_dir("malformed-play-once");
        let file = root.join("malformed.mp3");
        fs::write(&file, b"not an audio stream").expect("write malformed audio");
        let roots = create_library_roots_state();
        let authority_id = authorize_transient_file(&roots, &file).expect("authorize file");

        let result = read_track_metadata_with_authority(
            file.to_string_lossy().into_owned(),
            Some(authority_id.clone()),
            Arc::clone(&roots),
        );

        assert!(result.is_err());
        assert!(
            consume_play_once_file_access(&roots, &file, Some(&authority_id), "test playback")
                .is_err()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn palette_and_blurhash_reject_oversized_encoded_artwork() {
        let artwork = vec![0_u8; MAX_ENCODED_IMAGE_BYTES + 1];

        assert!(extract_palette_from_bytes(&artwork).is_none());
        assert!(generate_blurhash_from_bytes(&artwork).is_none());
    }
}
