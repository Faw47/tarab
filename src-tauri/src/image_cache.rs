use image::codecs::jpeg::JpegEncoder;
use image::image_dimensions;
use image::{imageops::FilterType, DynamicImage};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::async_runtime::spawn_blocking;

use crate::database::get_cache_dir;

const THUMBNAIL_SIZES: [(u32, &str); 3] = [
    (64, "small"),   // For grids
    (256, "medium"), // For cards / retina lists
    (512, "large"),  // For player
];

const MAX_CACHE_SIZE_MB: u64 = 200;
/// Lossy JPEG keeps thumbnails near 20 KB per album; lossless WebP (the only WebP mode of the
/// `image` crate) used about 200 KB, so the default cache held roughly 1,000 albums.
const THUMBNAIL_JPEG_QUALITY: u8 = 85;
const THUMBNAIL_EXTENSION: &str = "jpg";
pub(crate) const THUMBNAIL_CONTENT_TYPE: &str = "image/jpeg";
const LEGACY_THUMBNAIL_EXTENSION: &str = "webp";
const MAX_SOURCE_IMAGE_BYTES: usize = 25 * 1024 * 1024;
const MAX_SOURCE_IMAGE_PIXELS: u64 = 50_000_000;
const MAX_SOURCE_IMAGE_DIMENSION: u32 = 16_384;

/// Decodes cover art from an untrusted file. The byte size is capped, the dimensions are read from
/// the header and checked before any pixel buffer is allocated, and the decode itself runs under
/// `image::Limits`, so a small "decompression bomb" cannot force a large allocation.
pub(crate) fn decode_untrusted_image(bytes: &[u8]) -> Result<DynamicImage, String> {
    crate::parse_guard::guard("cover art", || decode_untrusted_image_unguarded(bytes))?
}

fn decode_untrusted_image_unguarded(bytes: &[u8]) -> Result<DynamicImage, String> {
    if bytes.is_empty() || bytes.len() > MAX_SOURCE_IMAGE_BYTES {
        return Err("Cover image exceeds the encoded byte limit".to_string());
    }
    let reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("Failed to read image: {}", e))?;
    let (width, height) = reader
        .into_dimensions()
        .map_err(|e| format!("Failed to read image dimensions: {}", e))?;
    if width > MAX_SOURCE_IMAGE_DIMENSION
        || height > MAX_SOURCE_IMAGE_DIMENSION
        || u64::from(width).saturating_mul(u64::from(height)) > MAX_SOURCE_IMAGE_PIXELS
    {
        return Err("Cover image exceeds the decoded pixel limit".to_string());
    }

    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_SOURCE_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_SOURCE_IMAGE_PIXELS * 4 + 16 * 1024 * 1024);
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("Failed to read image: {}", e))?;
    reader.limits(limits);
    reader
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))
}

fn max_thumbnail_bytes(size: &str) -> usize {
    match size {
        "small" => 200_000,
        "medium" => 700_000,
        "large" => 1_800_000,
        _ => 700_000,
    }
}

pub(crate) fn is_valid_thumbnail_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())
}

pub(crate) fn is_valid_thumbnail_size(size: &str) -> bool {
    THUMBNAIL_SIZES.iter().any(|(_, name)| *name == size)
}

fn read_thumbnail_file(path: &Path, size: &str) -> Result<Option<Vec<u8>>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to inspect thumbnail: {}", error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Thumbnail cache entry is not a regular file".to_string());
    }

    let limit = max_thumbnail_bytes(size);
    if metadata.len() > limit as u64 {
        return Err("Thumbnail cache entry exceeds the size limit".to_string());
    }
    let file =
        fs::File::open(path).map_err(|error| format!("Failed to open thumbnail: {}", error))?;
    let mut data = Vec::with_capacity(metadata.len() as usize);
    file.take(limit as u64 + 1)
        .read_to_end(&mut data)
        .map_err(|error| format!("Failed to read thumbnail: {}", error))?;
    if data.len() > limit {
        return Err("Thumbnail cache entry exceeds the size limit".to_string());
    }
    Ok(Some(data))
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
    max_memory_bytes: usize,
    disk_limit_mb: Mutex<u64>,
    last_access: RwLock<HashMap<String, std::time::SystemTime>>,
}

impl ImageCache {
    pub fn new() -> Self {
        let cache_dir = get_cache_dir().join("covers");
        fs::create_dir_all(&cache_dir).ok();
        Self {
            cache_dir,
            memory_cache: RwLock::new(HashMap::new()),
            max_memory_bytes: 32 * 1024 * 1024,
            disk_limit_mb: Mutex::new(
                crate::fixed_store::image_cache_limit_mb().unwrap_or(MAX_CACHE_SIZE_MB),
            ),
            last_access: RwLock::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_dir(cache_dir: PathBuf) -> Self {
        Self {
            cache_dir,
            memory_cache: RwLock::new(HashMap::new()),
            max_memory_bytes: 32 * 1024 * 1024,
            disk_limit_mb: Mutex::new(MAX_CACHE_SIZE_MB),
            last_access: RwLock::new(HashMap::new()),
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
        if image_data.is_empty() || image_data.len() > MAX_SOURCE_IMAGE_BYTES {
            return Err("Cover image exceeds the encoded byte limit".to_string());
        }
        let limit = self.disk_limit_mb.lock();
        let hash = Self::hash_image_data(image_data);

        // Check if already cached and square; otherwise regenerate
        if self.thumbnails_valid(&hash) {
            self.touch_hash(&hash);
            return Ok(hash);
        }

        let img = decode_untrusted_image(image_data)?;

        // Crop to a square once at the largest size, then derive the smaller sizes from it instead
        // of resampling the full-resolution source three times.
        let mut previous = img.resize_to_fill(512, 512, FilterType::Lanczos3);
        for (size, name) in THUMBNAIL_SIZES.iter().rev() {
            if previous.width() != *size {
                previous = previous.resize_exact(*size, *size, FilterType::CatmullRom);
            }
            self.save_thumbnail(&hash, name, &previous)?;
        }

        self.touch_hash(&hash);
        self.enforce_size_limit_locked(*limit)?;
        Ok(hash)
    }

    /// Save thumbnail as JPEG
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

        let mut buffer = Cursor::new(Vec::new());
        JpegEncoder::new_with_quality(&mut buffer, THUMBNAIL_JPEG_QUALITY)
            .encode_image(&flatten_alpha(img))
            .map_err(|e| format!("Failed to encode JPEG: {}", e))?;

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
            .join(format!("{}_{}.{}", hash, size_name, THUMBNAIL_EXTENSION))
    }

    /// Both IPC and the cover-art protocol share the bounded memory cache.
    pub fn get_thumbnail(&self, hash: &str, size: &str) -> Result<Option<String>, String> {
        Ok(self.get_thumbnail_bytes(hash, size)?.map(|bytes| {
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes)
        }))
    }

    pub fn get_thumbnail_bytes(&self, hash: &str, size: &str) -> Result<Option<Vec<u8>>, String> {
        if !is_valid_thumbnail_hash(hash) || !is_valid_thumbnail_size(size) {
            return Ok(None);
        }
        let _guard = self.disk_limit_mb.lock();
        let cache_key = format!("{}_{}", hash, size);
        {
            let mut cache = self.memory_cache.write();
            if let Some((data, accessed)) = cache.get_mut(&cache_key) {
                *accessed = std::time::Instant::now();
                self.touch_hash(hash);
                return Ok(Some(data.clone()));
            }
        }
        let Some(data) = read_thumbnail_file(&self.get_thumbnail_path(hash, size), size)? else {
            return Ok(None);
        };
        let mut cache = self.memory_cache.write();
        let mut current_bytes: usize = cache.values().map(|(bytes, _)| bytes.len()).sum();
        while current_bytes.saturating_add(data.len()) > self.max_memory_bytes {
            let Some(oldest_key) = cache
                .iter()
                .min_by_key(|(_, (_, accessed))| *accessed)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            if let Some((removed, _)) = cache.remove(&oldest_key) {
                current_bytes = current_bytes.saturating_sub(removed.len());
            }
        }
        if data.len() <= self.max_memory_bytes {
            cache.insert(cache_key, (data.clone(), std::time::Instant::now()));
        }
        self.touch_hash(hash);
        Ok(Some(data))
    }

    fn touch_hash(&self, hash: &str) {
        let mut access = self.last_access.write();
        if access.len() >= 10_000 && !access.contains_key(hash) {
            if let Some(oldest) = access
                .iter()
                .min_by_key(|(_, accessed)| **accessed)
                .map(|(hash, _)| hash.clone())
            {
                access.remove(&oldest);
            }
        }
        access.insert(hash.to_string(), std::time::SystemTime::now());
    }

    /// Check if thumbnail exists
    pub fn has_thumbnail(&self, hash: &str) -> bool {
        let _guard = self.disk_limit_mb.lock();
        self.thumbnails_valid(hash)
    }

    pub fn has_valid_thumbnail(&self, hash: &str, size: &str) -> bool {
        let _guard = self.disk_limit_mb.lock();
        if !is_valid_thumbnail_hash(hash) || !is_valid_thumbnail_size(size) {
            return false;
        }

        let expected_size = THUMBNAIL_SIZES
            .iter()
            .find_map(|(pixels, name)| (*name == size).then_some(*pixels));
        let Some(expected_size) = expected_size else {
            return false;
        };
        let path = self.get_thumbnail_path(hash, size);

        match (read_thumbnail_file(&path, size), image_dimensions(&path)) {
            (Ok(Some(_)), Ok((width, height))) => width == expected_size && height == expected_size,
            _ => false,
        }
    }

    /// Get cache statistics
    pub fn get_stats(&self) -> CacheStats {
        let _guard = self.disk_limit_mb.lock();
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
        let _guard = self.disk_limit_mb.lock();
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
        self.last_access.write().clear();

        Ok(deleted)
    }

    /// Retain the native policy for subsequent writes, even without renderer maintenance.
    pub fn enforce_size_limit(&self, max_override_mb: Option<u64>) -> Result<u64, String> {
        let mut limit = self.disk_limit_mb.lock();
        if let Some(value) = max_override_mb {
            *limit = value.min(1000);
        }
        self.enforce_size_limit_locked(*limit)
    }

    fn enforce_size_limit_locked(&self, limit_mb: u64) -> Result<u64, String> {
        // One snapshot supplies both the total and eviction sizes. Generation, reads and
        // maintenance share the lock; external file changes still cannot underflow totals.
        let mut groups: HashMap<String, ThumbnailGroup> = HashMap::new();
        let mut current_size = 0u64;
        if let Ok(shards) = fs::read_dir(&self.cache_dir) {
            for shard in shards.filter_map(Result::ok) {
                if !shard.file_type().is_ok_and(|kind| kind.is_dir()) {
                    continue;
                }
                let Ok(entries) = fs::read_dir(shard.path()) else {
                    continue;
                };
                for entry in entries.filter_map(Result::ok) {
                    if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
                        continue;
                    }
                    let Ok(metadata) = entry.metadata() else {
                        continue;
                    };
                    let name = entry.file_name().to_string_lossy().into_owned();
                    let hash = name.split('_').next().unwrap_or(&name).to_string();
                    let modified = metadata.modified().unwrap_or(std::time::UNIX_EPOCH);
                    let group = groups.entry(hash.clone()).or_insert_with(|| ThumbnailGroup {
                        hash,
                        accessed: modified,
                        files: Vec::new(),
                    });
                    group.accessed = group.accessed.max(modified);
                    group.files.push((entry.path(), metadata.len()));
                    current_size = current_size.saturating_add(metadata.len());
                }
            }
        }
        let max_bytes = limit_mb.saturating_mul(1024 * 1024);
        if current_size <= max_bytes {
            return Ok(0);
        }
        let access = self.last_access.read();
        let mut groups: Vec<_> = groups.into_values().collect();
        for group in &mut groups {
            if let Some(accessed) = access.get(&group.hash) {
                group.accessed = *accessed;
            }
        }
        drop(access);
        // Runtime reads update group recency; after restart, modification time is the fallback.
        groups.sort_by_key(|group| group.accessed);
        let mut deleted = 0;
        for group in groups {
            if current_size <= max_bytes {
                break;
            }
            for (path, size) in group.files {
                if fs::remove_file(path).is_ok() {
                    current_size = current_size.saturating_sub(size);
                    deleted += 1;
                }
            }
            let prefix = format!("{}_", group.hash);
            self.memory_cache
                .write()
                .retain(|key, _| !key.starts_with(&prefix));
            self.last_access.write().remove(&group.hash);
        }
        if current_size > max_bytes {
            return Err("Image cache could not be reduced to its size limit".to_string());
        }
        Ok(deleted)
    }
}

struct ThumbnailGroup {
    hash: String,
    accessed: std::time::SystemTime,
    files: Vec<(PathBuf, u64)>,
}

/// JPEG has no alpha channel. Transparent covers are composited onto a dark neutral instead of
/// exposing whatever colour the transparent pixels carry.
fn flatten_alpha(img: &DynamicImage) -> image::RgbImage {
    if !img.color().has_alpha() {
        return img.to_rgb8();
    }
    const BACKGROUND: [f32; 3] = [24.0, 24.0, 24.0];
    let rgba = img.to_rgba8();
    image::RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let alpha = f32::from(a) / 255.0;
        let blend = |channel: u8, background: f32| {
            (f32::from(channel) * alpha + background * (1.0 - alpha)).round() as u8
        };
        image::Rgb([
            blend(r, BACKGROUND[0]),
            blend(g, BACKGROUND[1]),
            blend(b, BACKGROUND[2]),
        ])
    })
}

/// Deletes thumbnails written by older builds in the previous format; they are regenerated as
/// JPEG on demand, and would otherwise fill the size limit until evicted.
fn remove_legacy_thumbnails(cache_dir: &Path) -> u64 {
    let mut removed = 0;
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return 0;
    };
    for entry in entries.filter_map(Result::ok) {
        let Ok(sub_entries) = fs::read_dir(entry.path()) else {
            continue;
        };
        for sub_entry in sub_entries.filter_map(Result::ok) {
            let path = sub_entry.path();
            let legacy = path
                .extension()
                .is_some_and(|ext| ext == LEGACY_THUMBNAIL_EXTENSION);
            if legacy
                && sub_entry.file_type().is_ok_and(|t| t.is_file())
                && fs::remove_file(&path).is_ok()
            {
                removed += 1;
            }
        }
    }
    removed
}

pub type SharedImageCache = Arc<ImageCache>;

pub fn create_image_cache() -> SharedImageCache {
    let cache = Arc::new(ImageCache::new());
    let maintenance = cache.clone();
    std::thread::spawn(move || {
        let limit = maintenance.disk_limit_mb.lock();
        remove_legacy_thumbnails(&maintenance.cache_dir);
        if let Err(error) = maintenance.enforce_size_limit_locked(*limit) {
            eprintln!("Image cache maintenance failed: {}", error);
        }
    });
    cache
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageFormat;
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
            max_memory_bytes: 32 * 1024 * 1024,
            disk_limit_mb: Mutex::new(MAX_CACHE_SIZE_MB),
            last_access: RwLock::new(HashMap::new()),
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
    /// A noisy gradient, closer to photographic cover art than a flat colour.
    fn photo_like_png(size: u32) -> Vec<u8> {
        let img = image::RgbImage::from_fn(size, size, |x, y| {
            let noise = ((x * 7919 + y * 104_729) % 37) as u8;
            image::Rgb([
                (x * 255 / size) as u8 ^ noise,
                (y * 255 / size) as u8,
                ((x + y) * 127 / size) as u8 ^ (noise / 2),
            ])
        });
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(img)
            .write_to(&mut bytes, ImageFormat::Png)
            .expect("encode source");
        bytes.into_inner()
    }

    #[test]
    fn thumbnails_are_lossy_jpeg_at_each_size() {
        // Regression for AR-09: lossless WebP thumbnails were about ten times larger.
        let root = temp_dir("jpeg");
        let cache = test_cache(root.join("covers"));
        let hash = cache
            .generate_thumbnails(&photo_like_png(1200))
            .expect("generate thumbnails");

        for (size, name) in THUMBNAIL_SIZES {
            let bytes = cache
                .get_thumbnail_bytes(&hash, name)
                .expect("read")
                .expect("thumbnail exists");
            assert_eq!(image::guess_format(&bytes).ok(), Some(ImageFormat::Jpeg));
            let decoded = image::load_from_memory(&bytes).expect("decode");
            assert_eq!((decoded.width(), decoded.height()), (size, size));
        }
        let large = cache
            .get_thumbnail_bytes(&hash, "large")
            .expect("read")
            .expect("large");
        assert!(
            large.len() < 150_000,
            "large thumbnail is {} bytes",
            large.len()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn protocol_reads_share_the_memory_cache() {
        let root = temp_dir("protocol-memory");
        let cache = test_cache(root.clone());
        let hash = cache.generate_thumbnails(&photo_like_png(32)).unwrap();
        let bytes = cache.get_thumbnail_bytes(&hash, "small").unwrap().unwrap();
        assert!(!bytes.is_empty());
        assert!(cache
            .memory_cache
            .read()
            .contains_key(&format!("{}_small", hash)));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn size_limit_overflow_does_not_evict_entries() {
        let root = temp_dir("limit-overflow");
        let cache = test_cache(root.clone());
        let hash = cache.generate_thumbnails(&photo_like_png(32)).unwrap();
        assert_eq!(cache.enforce_size_limit(Some(u64::MAX)).unwrap(), 0);
        assert!(cache.has_thumbnail(&hash));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cached_thumbnail_hit_does_not_scan_and_evict_unrelated_groups() {
        let root = temp_dir("cache-hit-maintenance");
        let cache = test_cache(root.clone());
        let data = photo_like_png(32);
        let hash = cache.generate_thumbnails(&data).unwrap();
        cache.enforce_size_limit(Some(1)).unwrap();

        let unrelated = cache.get_thumbnail_path(&"d".repeat(64), "large");
        fs::create_dir_all(unrelated.parent().unwrap()).unwrap();
        fs::File::create(&unrelated)
            .unwrap()
            .set_len(2 * 1024 * 1024)
            .unwrap();

        assert_eq!(cache.generate_thumbnails(&data).unwrap(), hash);
        assert!(
            unrelated.exists(),
            "a cache hit should not trigger a full-disk quota walk"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn eviction_keeps_thumbnail_groups_complete() {
        let root = temp_dir("group-eviction");
        let cache = test_cache(root.clone());
        let hash = cache.generate_thumbnails(&photo_like_png(32)).unwrap();
        let large = cache.get_thumbnail_path(&hash, "large");
        fs::File::options()
            .write(true)
            .open(&large)
            .unwrap()
            .set_len(2 * 1024 * 1024)
            .unwrap();
        fs::File::options()
            .write(true)
            .open(&large)
            .unwrap()
            .set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1000))
            .unwrap();
        cache.enforce_size_limit(Some(1)).unwrap();
        assert!(THUMBNAIL_SIZES
            .iter()
            .all(|(_, size)| !cache.get_thumbnail_path(&hash, size).exists()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn generation_enforces_the_native_limit_without_a_renderer_request() {
        let root = temp_dir("native-limit");
        let cache = test_cache(root.clone());
        cache.enforce_size_limit(Some(1)).unwrap();
        let old = cache.get_thumbnail_path(&"a".repeat(64), "large");
        fs::create_dir_all(old.parent().unwrap()).unwrap();
        fs::File::create(&old)
            .unwrap()
            .set_len(2 * 1024 * 1024)
            .unwrap();
        let hash = cache.generate_thumbnails(&photo_like_png(32)).unwrap();
        assert!(cache.get_stats().total_size_bytes <= 1024 * 1024);
        assert!(cache.has_thumbnail(&hash));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn recently_read_cover_survives_group_eviction() {
        let root = temp_dir("read-recency");
        let cache = test_cache(root.clone());
        let first = cache.generate_thumbnails(&photo_like_png(32)).unwrap();
        let second = cache.generate_thumbnails(&photo_like_png(33)).unwrap();
        for (hash, age) in [(&first, 1000), (&second, 2000)] {
            for (_, size) in THUMBNAIL_SIZES {
                let file = fs::File::options()
                    .write(true)
                    .open(cache.get_thumbnail_path(hash, size))
                    .unwrap();
                if size == "large" {
                    file.set_len(600 * 1024).unwrap();
                }
                file.set_modified(UNIX_EPOCH + std::time::Duration::from_secs(age))
                    .unwrap();
            }
        }
        // Remove generation-time access records to model covers loaded from disk at startup.
        cache.last_access.write().clear();
        cache.get_thumbnail_bytes(&first, "small").unwrap().unwrap();
        cache.enforce_size_limit(Some(1)).unwrap();
        assert!(cache.has_thumbnail(&first));
        assert!(THUMBNAIL_SIZES
            .iter()
            .all(|(_, size)| !cache.get_thumbnail_path(&second, size).exists()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn clearing_cache_invalidates_protocol_memory_entries() {
        let root = temp_dir("clear-memory");
        let cache = test_cache(root.clone());
        let hash = cache.generate_thumbnails(&photo_like_png(32)).unwrap();
        cache.get_thumbnail_bytes(&hash, "small").unwrap().unwrap();
        cache.clear_cache(None).unwrap();
        assert!(cache.get_thumbnail_bytes(&hash, "small").unwrap().is_none());
        let _ = fs::remove_dir_all(root);
    }

    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for byte in bytes {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }

    /// A small valid PNG whose header is rewritten to claim the given dimensions.
    fn png_claiming(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        DynamicImage::new_rgb8(1, 1)
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .expect("encode");
        // IHDR data starts after the 8-byte signature, 4-byte length and 4-byte type.
        bytes[16..20].copy_from_slice(&width.to_be_bytes());
        bytes[20..24].copy_from_slice(&height.to_be_bytes());
        let crc = crc32(&bytes[12..29]);
        bytes[29..33].copy_from_slice(&crc.to_be_bytes());
        bytes
    }

    #[test]
    fn oversized_images_are_rejected_from_the_header_before_decoding() {
        // Regression for SEC-02: limits were checked only after a full decode.
        let bomb = png_claiming(10_000, 6_000);
        assert_eq!(
            decode_untrusted_image(&bomb).err().as_deref(),
            Some("Cover image exceeds the decoded pixel limit")
        );
        assert!(decode_untrusted_image(&png_claiming(1, 1)).is_ok());
    }

    #[test]
    fn transparent_pixels_become_the_background_not_their_hidden_colour() {
        let mut img = image::RgbaImage::new(2, 1);
        img.put_pixel(0, 0, image::Rgba([255, 0, 0, 0]));
        img.put_pixel(1, 0, image::Rgba([255, 0, 0, 255]));

        let flat = flatten_alpha(&DynamicImage::ImageRgba8(img));

        assert_eq!(flat.get_pixel(0, 0).0, [24, 24, 24]);
        assert_eq!(flat.get_pixel(1, 0).0, [255, 0, 0]);
    }

    #[test]
    fn legacy_thumbnails_are_removed() {
        let root = temp_dir("legacy");
        let shard = root.join("ab");
        fs::create_dir_all(&shard).expect("create shard");
        fs::write(shard.join("old_small.webp"), b"old").expect("write legacy");
        fs::write(shard.join("new_small.jpg"), b"new").expect("write current");

        assert_eq!(remove_legacy_thumbnails(&root), 1);
        assert!(!shard.join("old_small.webp").exists());
        assert!(shard.join("new_small.jpg").exists());
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
    fn thumbnail_read_rejects_oversized_cache_entry() {
        let root = temp_dir("oversized");
        let cache_dir = root.join("covers");
        let hash = "b".repeat(64);
        let cache = test_cache(cache_dir);
        let path = cache.get_thumbnail_path(&hash, "small");
        fs::create_dir_all(path.parent().expect("thumbnail parent")).expect("create parent");
        let file = fs::File::create(&path).expect("create thumbnail");
        file.set_len(max_thumbnail_bytes("small") as u64 + 1)
            .expect("set oversized length");

        let result = cache.get_thumbnail_bytes(&hash, "small");

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("size limit"));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn thumbnail_read_rejects_symlink_cache_entry() {
        use std::os::unix::fs::symlink;

        let root = temp_dir("symlink");
        let cache_dir = root.join("covers");
        let hash = "c".repeat(64);
        let cache = test_cache(cache_dir);
        let path = cache.get_thumbnail_path(&hash, "small");
        fs::create_dir_all(path.parent().expect("thumbnail parent")).expect("create parent");
        let outside = root.join("outside.webp");
        fs::write(&outside, b"outside").expect("write outside");
        symlink(&outside, &path).expect("create cache symlink");

        let result = cache.get_thumbnail_bytes(&hash, "small");

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("regular file"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn max_thumbnail_bytes_bounds_sizes() {
        assert_eq!(max_thumbnail_bytes("small"), 200_000);
        assert_eq!(max_thumbnail_bytes("medium"), 700_000);
        assert_eq!(max_thumbnail_bytes("large"), 1_800_000);
        assert_eq!(max_thumbnail_bytes("unexpected"), 700_000);
    }

    #[test]
    fn source_image_rejects_oversized_encoded_input() {
        let root = temp_dir("oversized-source");
        let cache = test_cache(root.join("covers"));
        let data = vec![0_u8; MAX_SOURCE_IMAGE_BYTES + 1];

        let result = cache.generate_thumbnails(&data);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("encoded byte limit"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn requested_thumbnail_validation_rejects_wrong_dimensions() {
        let root = temp_dir("wrong-dimensions");
        let cache_dir = root.join("covers");
        fs::create_dir_all(&cache_dir).expect("create cache directory");
        let cache = test_cache(cache_dir);
        let image = DynamicImage::new_rgb8(16, 16);
        let mut encoded = Cursor::new(Vec::new());
        image
            .write_to(&mut encoded, ImageFormat::Png)
            .expect("encode test image");
        let hash = ImageCache::hash_image_data(encoded.get_ref());
        cache
            .save_thumbnail(&hash, "large", &image)
            .expect("save wrong-sized thumbnail");

        assert!(!cache.has_valid_thumbnail(&hash, "large"));
        let _ = fs::remove_dir_all(root);
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
