use image::image_dimensions;
use image::{imageops::FilterType, DynamicImage, ImageFormat};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::async_runtime::spawn_blocking;

use crate::database::get_cache_dir;

const THUMBNAIL_SIZES: [(u32, &str); 3] = [
    (64, "small"),   // For grids
    (256, "medium"), // For cards / retina lists
    (512, "large"),  // For player
];

const MAX_CACHE_SIZE_MB: u64 = 500;

fn max_thumbnail_bytes(size: &str) -> usize {
    match size {
        "small" => 200_000,
        "medium" => 700_000,
        "large" => 1_800_000,
        _ => 700_000,
    }
}

fn is_valid_thumbnail_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_valid_thumbnail_size(size: &str) -> bool {
    THUMBNAIL_SIZES.iter().any(|(_, name)| *name == size)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub total_size_bytes: u64,
    pub file_count: u64,
    pub oldest_file: Option<i64>,
}

pub struct ImageCache {
    cache_dir: PathBuf,
    // In-memory LRU for recently accessed hashes
    memory_cache: RwLock<HashMap<String, (Vec<u8>, std::time::Instant)>>,
    max_memory_items: usize,
}

impl ImageCache {
    pub fn new() -> Self {
        let cache_dir = get_cache_dir().join("covers");
        fs::create_dir_all(&cache_dir).ok();

        Self {
            cache_dir,
            memory_cache: RwLock::new(HashMap::new()),
            max_memory_items: 100,
        }
    }

    /// Generate hash from image data for cache key
    pub fn hash_image_data(data: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(data);
        hex::encode(hasher.finalize())
    }

    fn thumbnails_valid(&self, hash: &str) -> bool {
        if !is_valid_thumbnail_hash(hash) {
            return false;
        }
        for (size, name) in THUMBNAIL_SIZES {
            let path = self.get_thumbnail_path(hash, name);
            if !path.exists() {
                return false;
            }
            match image_dimensions(&path) {
                Ok((w, h)) if w == size && h == size => {}
                _ => {
                    let _ = fs::remove_file(&path);
                    return false;
                }
            }
        }
        true
    }

    /// Generate all thumbnail sizes from raw image data
    pub fn generate_thumbnails(&self, image_data: &[u8]) -> Result<String, String> {
        let hash = Self::hash_image_data(image_data);

        // Check if already cached and square; otherwise regenerate
        if self.thumbnails_valid(&hash) {
            return Ok(hash);
        }

        // Decode image
        let img = image::load_from_memory(image_data)
            .map_err(|e| format!("Failed to decode image: {}", e))?;

        // Generate each size
        for (size, name) in THUMBNAIL_SIZES {
            let thumbnail = self.resize_image(&img, size);
            self.save_thumbnail(&hash, name, &thumbnail)?;
        }

        Ok(hash)
    }

    /// Resize image maintaining aspect ratio
    fn resize_image(&self, img: &DynamicImage, size: u32) -> DynamicImage {
        // Fill a square by cropping the longer side so cover art is always 1:1
        img.resize_to_fill(size, size, FilterType::Lanczos3)
    }

    /// Save thumbnail as WebP
    fn save_thumbnail(
        &self,
        hash: &str,
        size_name: &str,
        img: &DynamicImage,
    ) -> Result<(), String> {
        let path = self.get_thumbnail_path(hash, size_name);

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).ok();
        }

        // Encode as WebP
        let mut buffer = Cursor::new(Vec::new());
        img.write_to(&mut buffer, ImageFormat::WebP)
            .map_err(|e| format!("Failed to encode WebP: {}", e))?;

        // Write to file
        fs::write(&path, buffer.into_inner())
            .map_err(|e| format!("Failed to write thumbnail: {}", e))?;

        Ok(())
    }

    /// Get path for a specific thumbnail size
    fn get_thumbnail_path(&self, hash: &str, size_name: &str) -> PathBuf {
        // Use first 2 chars of hash as subdirectory for better filesystem performance
        let subdir = &hash[..2.min(hash.len())];
        self.cache_dir
            .join(subdir)
            .join(format!("{}_{}.webp", hash, size_name))
    }

    /// Get thumbnail as base64
    pub fn get_thumbnail(&self, hash: &str, size: &str) -> Result<Option<String>, String> {
        if !is_valid_thumbnail_hash(hash) || !is_valid_thumbnail_size(size) {
            return Ok(None);
        }
        let cache_key = format!("{}_{}", hash, size);

        // Check memory cache first
        {
            let mut cache = self.memory_cache.write();
            if let Some((data, instant)) = cache.get_mut(&cache_key) {
                *instant = std::time::Instant::now();
                return Ok(Some(base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    &*data,
                )));
            }
        }

        // Load from disk
        let path = self.get_thumbnail_path(hash, size);
        if !path.exists() {
            return Ok(None);
        }

        let data = fs::read(&path).map_err(|e| format!("Failed to read thumbnail: {}", e))?;

        // Add to memory cache
        {
            let mut cache = self.memory_cache.write();
            if cache.len() >= self.max_memory_items {
                let mut oldest_key = String::new();
                let mut oldest_time = std::time::Instant::now();
                for (k, (_, t)) in cache.iter() {
                    if *t < oldest_time {
                        oldest_time = *t;
                        oldest_key = k.clone();
                    }
                }
                if !oldest_key.is_empty() {
                    cache.remove(&oldest_key);
                }
            }
            cache.insert(cache_key, (data.clone(), std::time::Instant::now()));
        }

        Ok(Some(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &data,
        )))
    }

    /// Get thumbnail as raw bytes (for frontend to display directly)
    pub fn get_thumbnail_bytes(&self, hash: &str, size: &str) -> Result<Option<Vec<u8>>, String> {
        if !is_valid_thumbnail_hash(hash) || !is_valid_thumbnail_size(size) {
            return Ok(None);
        }

        let path = self.get_thumbnail_path(hash, size);
        if !path.exists() {
            return Ok(None);
        }

        fs::read(&path)
            .map(Some)
            .map_err(|e| format!("Failed to read thumbnail: {}", e))
    }

    /// Check if thumbnail exists
    pub fn has_thumbnail(&self, hash: &str) -> bool {
        self.thumbnails_valid(hash)
    }

    /// Get cache statistics
    pub fn get_stats(&self) -> CacheStats {
        let mut total_size = 0u64;
        let mut file_count = 0u64;
        let mut oldest_time: Option<i64> = None;

        if let Ok(entries) = fs::read_dir(&self.cache_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if entry.path().is_dir() {
                    if let Ok(sub_entries) = fs::read_dir(entry.path()) {
                        for sub_entry in sub_entries.filter_map(|e| e.ok()) {
                            if let Ok(metadata) = sub_entry.metadata() {
                                total_size += metadata.len();
                                file_count += 1;

                                if let Ok(modified) = metadata.modified() {
                                    if let Ok(duration) =
                                        modified.duration_since(std::time::UNIX_EPOCH)
                                    {
                                        let time = duration.as_millis() as i64;
                                        oldest_time =
                                            Some(oldest_time.map_or(time, |t| t.min(time)));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        CacheStats {
            total_size_bytes: total_size,
            file_count,
            oldest_file: oldest_time,
        }
    }

    /// Clear cache (optionally keeping recent files)
    pub fn clear_cache(&self, keep_recent_days: Option<u32>) -> Result<u64, String> {
        let mut deleted = 0u64;
        let now = std::time::SystemTime::now();
        let cutoff_duration =
            keep_recent_days.map(|days| std::time::Duration::from_secs(days as u64 * 24 * 60 * 60));

        if let Ok(entries) = fs::read_dir(&self.cache_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if entry.path().is_dir() {
                    if let Ok(sub_entries) = fs::read_dir(entry.path()) {
                        for sub_entry in sub_entries.filter_map(|e| e.ok()) {
                            let should_delete = if let Some(cutoff) = cutoff_duration {
                                if let Ok(metadata) = sub_entry.metadata() {
                                    if let Ok(modified) = metadata.modified() {
                                        now.duration_since(modified)
                                            .map(|d| d > cutoff)
                                            .unwrap_or(true)
                                    } else {
                                        true
                                    }
                                } else {
                                    true
                                }
                            } else {
                                true
                            };

                            if should_delete && fs::remove_file(sub_entry.path()).is_ok() {
                                deleted += 1;
                            }
                        }
                    }
                }
            }
        }

        // Clear memory cache
        self.memory_cache.write().clear();

        Ok(deleted)
    }

    /// Evict old entries if cache exceeds size limit
    pub fn enforce_size_limit(&self, max_override_mb: Option<u64>) -> Result<u64, String> {
        let stats = self.get_stats();
        let max_bytes = max_override_mb.unwrap_or(MAX_CACHE_SIZE_MB) * 1024 * 1024;

        if stats.total_size_bytes <= max_bytes {
            return Ok(0);
        }

        // Collect all files with their modification times
        let mut files: Vec<(PathBuf, std::time::SystemTime, u64)> = Vec::new();

        if let Ok(entries) = fs::read_dir(&self.cache_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if entry.path().is_dir() {
                    if let Ok(sub_entries) = fs::read_dir(entry.path()) {
                        for sub_entry in sub_entries.filter_map(|e| e.ok()) {
                            if let Ok(metadata) = sub_entry.metadata() {
                                if let Ok(modified) = metadata.modified() {
                                    files.push((sub_entry.path(), modified, metadata.len()));
                                }
                            }
                        }
                    }
                }
            }
        }

        // Sort by modification time (oldest first)
        files.sort_by(|a, b| a.1.cmp(&b.1));

        // Delete oldest files until under limit
        let mut current_size = stats.total_size_bytes;
        let mut deleted = 0u64;

        for (path, _, size) in files {
            if current_size <= max_bytes {
                break;
            }

            if fs::remove_file(&path).is_ok() {
                current_size -= size;
                deleted += 1;
            }
        }

        Ok(deleted)
    }
}

pub type SharedImageCache = Arc<ImageCache>;

pub fn create_image_cache() -> SharedImageCache {
    Arc::new(ImageCache::new())
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
        let dir = std::env::temp_dir().join(format!("tarab-image-cache-{}-{}", name, nonce));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn test_cache(cache_dir: PathBuf) -> ImageCache {
        ImageCache {
            cache_dir,
            memory_cache: RwLock::new(HashMap::new()),
            max_memory_items: 100,
        }
    }

    #[test]
    fn generate_thumbnails_reuses_stable_hash() {
        let root = temp_dir("stable-hash");
        let cache_dir = root.join("covers");
        fs::create_dir_all(&cache_dir).expect("create cache dir");
        let cache = test_cache(cache_dir);

        let img = DynamicImage::new_rgb8(8, 8);
        let mut bytes = Cursor::new(Vec::new());
        img.write_to(&mut bytes, ImageFormat::Png)
            .expect("encode test image");
        let data = bytes.into_inner();

        let first = cache
            .generate_thumbnails(&data)
            .expect("generate thumbnails");
        let second = cache.generate_thumbnails(&data).expect("reuse thumbnails");

        assert_eq!(first, second);
        assert!(cache.has_thumbnail(&first));
        assert!(cache
            .get_thumbnail_bytes(&first, "small")
            .expect("small")
            .is_some());
        assert!(cache
            .get_thumbnail_bytes(&first, "medium")
            .expect("medium")
            .is_some());
        assert!(cache
            .get_thumbnail_bytes(&first, "large")
            .expect("large")
            .is_some());

        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn thumbnail_lookup_rejects_traversal_size() {
        let root = temp_dir("traversal");
        let cache_dir = root.join("covers");
        fs::create_dir_all(&cache_dir).expect("create cache dir");
        fs::write(root.join("secret.webp"), b"secret").expect("write outside cache file");
        let cache = test_cache(cache_dir);
        let hash = "a".repeat(64);

        let result = cache
            .get_thumbnail_bytes(&hash, "..\\..\\..\\secret")
            .expect("lookup should not error");

        assert!(result.is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn max_thumbnail_bytes_bounds_sizes() {
        assert_eq!(max_thumbnail_bytes("small"), 200_000);
        assert_eq!(max_thumbnail_bytes("medium"), 700_000);
        assert_eq!(max_thumbnail_bytes("large"), 1_800_000);
        assert_eq!(max_thumbnail_bytes("unexpected"), 700_000);
    }
}

// ========== Tauri Commands ==========

#[tauri::command]
pub async fn cache_generate_thumbnail(
    image_data: String, // Base64 encoded
    cache: tauri::State<'_, SharedImageCache>,
) -> Result<String, String> {
    let cache = cache.inner().clone();
    spawn_blocking(move || {
        let data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &image_data)
            .map_err(|e| format!("Failed to decode base64: {}", e))?;

        cache.generate_thumbnails(&data)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cache_get_thumbnail(
    hash: String,
    size: String,
    cache: tauri::State<'_, SharedImageCache>,
) -> Result<Option<String>, String> {
    let cache = cache.inner().clone();
    spawn_blocking(move || cache.get_thumbnail(&hash, &size))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cache_get_thumbnail_bytes(
    hash: String,
    size: String,
    cache: tauri::State<'_, SharedImageCache>,
) -> Result<Option<Vec<u8>>, String> {
    let cache = cache.inner().clone();
    spawn_blocking(move || match cache.get_thumbnail_bytes(&hash, &size) {
        Ok(Some(bytes)) => {
            if bytes.len() > max_thumbnail_bytes(&size) {
                return Ok(None);
            }
            Ok(Some(bytes))
        }
        Ok(None) => Ok(None),
        Err(e) => Err(e),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cache_has_thumbnail(
    hash: String,
    cache: tauri::State<'_, SharedImageCache>,
) -> Result<bool, String> {
    let cache = cache.inner().clone();
    spawn_blocking(move || cache.has_thumbnail(&hash))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cache_get_stats(
    cache: tauri::State<'_, SharedImageCache>,
) -> Result<CacheStats, String> {
    let cache = cache.inner().clone();
    spawn_blocking(move || cache.get_stats())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cache_clear(
    keep_recent_days: Option<u32>,
    cache: tauri::State<'_, SharedImageCache>,
) -> Result<u64, String> {
    let cache = cache.inner().clone();
    spawn_blocking(move || cache.clear_cache(keep_recent_days))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cache_enforce_limit(
    limit_mb: Option<u64>,
    cache: tauri::State<'_, SharedImageCache>,
) -> Result<u64, String> {
    let cache = cache.inner().clone();
    spawn_blocking(move || cache.enforce_size_limit(limit_mb))
        .await
        .map_err(|e| e.to_string())?
}
