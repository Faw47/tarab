use base64::{engine::general_purpose::STANDARD, Engine};
use lofty::file::{TaggedFile, TaggedFileExt};
use lofty::picture::Picture;
use lofty::prelude::*;
use lofty::probe::Probe;
use rayon::{prelude::*, ThreadPool, ThreadPoolBuilder};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::async_runtime::spawn_blocking;

use crate::database::SharedDatabase;
use crate::file_ops::{ensure_existing_path_allowed, SharedLibraryRoots};
use crate::image_cache::SharedImageCache;

#[derive(Debug, Serialize, Clone)]
pub struct TrackMetadata {
    pub title: String,
    pub artist: String,
    pub album_artist: Option<String>,
    pub album: String,
    pub year: Option<i32>,
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
    pub year: Option<i32>,
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

const MAX_METADATA_THREADS: usize = 4;
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

fn extract_metadata_fast(file_path: &str) -> Option<TrackMetadata> {
    let path = Path::new(file_path);

    let tagged_file = Probe::open(path).ok()?.read().ok()?;

    let properties = tagged_file.properties();
    let duration_secs = properties.duration().as_secs_f64();
    let bitrate = properties.audio_bitrate();
    let sample_rate = properties.sample_rate();

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let (title, artist, album_artist, album, year) = if let Some(tag) = tag {
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

        let year = tag.year().map(|y| y as i32);

        (title, artist, album_artist, album, year)
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
        )
    };
    let picture = first_picture(&tagged_file);
    let has_cover_art = picture.is_some();
    let blurhash = picture.and_then(|pic| generate_blurhash_from_bytes(pic.data()));

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
        year,
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

// Full metadata extraction with cover art
fn extract_metadata_with_art(file_path: &str) -> Option<TrackMetadataWithArt> {
    let path = Path::new(file_path);

    let tagged_file = Probe::open(path).ok()?.read().ok()?;

    let properties = tagged_file.properties();
    let duration_secs = properties.duration().as_secs_f64();
    let bitrate = properties.audio_bitrate();
    let sample_rate = properties.sample_rate();

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let (title, artist, album_artist, album, year) = if let Some(tag) = tag {
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

        let year = tag.year().map(|y| y as i32);

        (title, artist, album_artist, album, year)
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
        )
    };
    let picture = first_picture(&tagged_file);
    let cover_art = picture.map(|pic| STANDARD.encode(pic.data()));
    let blurhash = picture.and_then(|pic| generate_blurhash_from_bytes(pic.data()));

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
        year,
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
    let image = image::load_from_memory(bytes).ok()?.to_rgba8();
    let thumb = image::imageops::thumbnail(&image, 12, 12);
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
    let img = image::load_from_memory(bytes).ok()?;
    // Resize for faster processing
    let thumb = img.thumbnail(64, 64).to_rgba8();
    let (tw, th) = thumb.dimensions();

    blurhash::encode(4, 3, tw, th, &thumb.into_raw()).ok()
}

fn ensure_metadata_path_allowed(
    file_path: &str,
    roots: &[PathBuf],
    action: &str,
) -> Result<(), String> {
    ensure_existing_path_allowed(Path::new(file_path), roots, action)?;
    Ok(())
}

fn allowed_metadata_paths(file_paths: Vec<String>, roots: &[PathBuf], action: &str) -> Vec<String> {
    file_paths
        .into_iter()
        .filter(|path| {
            if let Err(err) = ensure_metadata_path_allowed(path, roots, action) {
                eprintln!("Skipped metadata path: {}", err);
                false
            } else {
                true
            }
        })
        .collect()
}

#[tauri::command]
pub async fn get_track_metadata(
    file_path: String,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<TrackMetadata, String> {
    let roots = roots_state.inner().read().roots.clone();
    spawn_blocking(move || {
        ensure_metadata_path_allowed(&file_path, &roots, "read track metadata")?;
        extract_metadata_fast(&file_path)
            .ok_or_else(|| format!("Failed to read metadata from: {}", file_path))
    })
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
        ensure_metadata_path_allowed(&file_path, &roots, "read cover art")?;
        let normalized_path = file_path.replace('\\', "/");

        if let Some(hash) = db.get_cover_art_hash(&normalized_path).unwrap_or(None) {
            if cache.has_thumbnail(&hash) {
                // Should also try to get blurhash from DB if we added it to tracks
                // For now just return the hash.
                return Ok(Some((hash, None)));
            }
        }

        let path = Path::new(&file_path);
        let tagged_file = Probe::open(path)
            .map_err(|e| format!("Failed to open file: {}", e))?
            .read()
            .map_err(|e| format!("Failed to read file: {}", e))?;

        if let Some(picture) = first_picture(&tagged_file) {
            let data = picture.data();
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
                .filter_map(|path| extract_metadata_fast(path))
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
        ensure_metadata_path_allowed(&file_path, &roots, "read cover art data")?;
        let path = Path::new(&file_path);
        let tagged_file = Probe::open(path)
            .map_err(|e| format!("Failed to open file: {}", e))?
            .read()
            .map_err(|e| format!("Failed to read file: {}", e))?;

        if let Some(picture) = first_picture(&tagged_file) {
            let mime = picture
                .mime_type()
                .map(|m| m.to_string())
                .unwrap_or_else(|| "image/jpeg".to_string());
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
                .filter_map(|path| extract_metadata_with_art(path))
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
                .map(|path| {
                    let art = Probe::open(Path::new(path))
                        .ok()
                        .and_then(|p| p.read().ok())
                        .and_then(|file| {
                            first_picture(&file).map(|pic| STANDARD.encode(pic.data()))
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
        ensure_metadata_path_allowed(&file_path, &roots, "read cover art palette")?;
        let path = Path::new(&file_path);
        let tagged_file = Probe::open(path)
            .map_err(|e| format!("Failed to open file: {}", e))?
            .read()
            .map_err(|e| format!("Failed to read file: {}", e))?;

        if let Some(picture) = first_picture(&tagged_file) {
            return Ok(extract_palette_from_bytes(picture.data()));
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
    cache: tauri::State<'_, SharedImageCache>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<CoverArtHashResult>, String> {
    let cache = cache.inner().clone();
    let db = db.inner().clone();
    let roots = roots_state.inner().read().roots.clone();

    spawn_blocking(move || {
        let file_paths = allowed_metadata_paths(file_paths, &roots, "generate cover art hashes");
        run_with_pool(art_pool(), || {
            file_paths
                .par_iter()
                .map(|path| {
                    let normalized_path = path.replace('\\', "/");

                    if let Some(existing) = db.get_cover_art_hash(&normalized_path).unwrap_or(None)
                    {
                        if cache.has_thumbnail(&existing) {
                            // We don't have blurhash in DB easily here, so we might re-scan it or return None
                            return (path.clone(), Some((existing, None)));
                        }
                    }

                    let picture = Probe::open(Path::new(path))
                        .ok()
                        .and_then(|p| p.read().ok())
                        .and_then(|file| first_picture(&file).cloned());

                    let result = picture.as_ref().and_then(|pic| {
                        let hash = cache.generate_thumbnails(pic.data()).ok()?;
                        let blurhash = generate_blurhash_from_bytes(pic.data());
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
    use std::fs;
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

        assert_eq!(filtered, vec![allowed_file.to_string_lossy().to_string()]);

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }
}
