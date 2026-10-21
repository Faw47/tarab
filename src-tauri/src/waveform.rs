use parking_lot::{Mutex, RwLock};
use rodio::{Decoder, Source};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::PathBuf;
use std::sync::Arc;

use crate::database::get_cache_dir;
use crate::file_ops::{ensure_existing_path_allowed, SharedLibraryRoots};

const SAMPLES_PER_SECOND: u32 = 10; // 10 samples per second = 100ms resolution
const MAX_CACHE_SIZE: usize = 1000; // Max waveforms in memory and on disk
const MAX_DISK_CACHE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_CACHE_ENTRY_BYTES: u64 = 1024 * 1024;
const MAX_WAVEFORM_SAMPLE_RATE: u32 = 384_000;
const GENERATION_LOCK_STRIPES: usize = 64;
const MAX_WAVEFORM_CHANNELS: u16 = 8;

/// Reject malformed decoder metadata before allocating a waveform chunk.
fn waveform_chunk_size(sample_rate: u32, channels: u16) -> Result<usize, String> {
    if !(1..=MAX_WAVEFORM_SAMPLE_RATE).contains(&sample_rate) {
        return Err(format!("Unsupported waveform sample rate: {}", sample_rate));
    }
    if !(1..=MAX_WAVEFORM_CHANNELS).contains(&channels) {
        return Err(format!("Unsupported waveform channel count: {}", channels));
    }

    let frames = (sample_rate as usize).div_ceil(SAMPLES_PER_SECOND as usize);
    frames
        .checked_mul(channels as usize)
        .ok_or_else(|| "Waveform chunk size overflowed".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformData {
    pub peaks: Vec<f32>,         // Normalized peak values (0.0 - 1.0)
    pub duration_secs: f64,      // Duration in seconds
    pub sample_rate: u32,        // Original sample rate
    pub samples_per_second: u32, // Resolution
}

pub struct WaveformGenerator {
    cache_dir: PathBuf,
    memory_cache: RwLock<HashMap<String, WaveformData>>,
    cancel_requests: RwLock<HashSet<String>>,
    active_requests: RwLock<HashSet<String>>,
    lifecycle: RwLock<()>,
    generation: Vec<Mutex<()>>,
    disk_maintenance: Mutex<()>,
}

impl WaveformGenerator {
    pub fn new() -> Self {
        let cache_dir = get_cache_dir().join("waveforms");
        fs::create_dir_all(&cache_dir).ok();

        Self {
            cache_dir,
            memory_cache: RwLock::new(HashMap::new()),
            cancel_requests: RwLock::new(HashSet::new()),
            active_requests: RwLock::new(HashSet::new()),
            lifecycle: RwLock::new(()),
            generation: (0..GENERATION_LOCK_STRIPES).map(|_| Mutex::new(())).collect(),
            disk_maintenance: Mutex::new(()),
        }
    }

    pub fn cancel(&self, file_path: &str) {
        let active = self.active_requests.read();
        if active.contains(file_path) {
            self.cancel_requests.write().insert(file_path.to_string());
        }
    }

    fn clear_cancel(&self, file_path: &str) {
        self.cancel_requests.write().remove(file_path);
    }

    fn is_cancelled(&self, file_path: &str) -> bool {
        self.cancel_requests.read().contains(file_path)
    }

    /// A source identity invalidates both cache tiers when the file is edited or replaced.
    fn source_key(file_path: &str) -> Result<String, String> {
        use sha2::{Digest, Sha256};
        let path = fs::canonicalize(file_path)
            .map_err(|error| format!("Failed to resolve waveform source: {}", error))?;
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Failed to inspect waveform source: {}", error))?;
        if !metadata.is_file() {
            return Err("Waveform source is not a regular file".to_string());
        }
        let modified = metadata
            .modified()
            .map_err(|error| format!("Failed to inspect waveform source time: {}", error))?;
        let identity = serde_json::to_vec(&(path, metadata.len(), modified))
            .map_err(|error| format!("Failed to identify waveform source: {}", error))?;
        Ok(hex::encode(Sha256::digest(identity)))
    }

    /// Coalesce requests for the same source while allowing unrelated files to decode in parallel.
    pub fn generate(&self, file_path: &str) -> Result<WaveformData, String> {
        // Shared lifecycle access keeps clear_cache exclusive without serializing independent tracks.
        let _lifecycle = self.lifecycle.read();
        let key = Self::source_key(file_path)?;
        if let Some(data) = self.memory_cache.read().get(&key) {
            return Ok(data.clone());
        }

        let cache_path = self.get_cache_path(&key);
        if let Ok(data) = self.load_from_cache(&cache_path) {
            self.add_to_memory_cache(key, data.clone());
            return Ok(data);
        }

        // A fixed set bounds lock storage while requests for the same identity share one lock.
        let stripe = key.as_bytes().iter().take(8).fold(0usize, |value, byte| {
            value.wrapping_mul(31).wrapping_add(*byte as usize)
        }) % GENERATION_LOCK_STRIPES;
        let _generation = self.generation[stripe].lock();

        // Another request for this identity may have completed while this one waited.
        if let Some(data) = self.memory_cache.read().get(&key) {
            return Ok(data.clone());
        }
        if let Ok(data) = self.load_from_cache(&cache_path) {
            self.add_to_memory_cache(key, data.clone());
            return Ok(data);
        }

        self.clear_cancel(file_path);
        self.active_requests.write().insert(file_path.to_string());
        let result = self.extract_waveform(file_path);
        // Remove active status before clearing cancellation so idle calls cannot retain entries.
        self.active_requests.write().remove(file_path);
        self.clear_cancel(file_path);
        let data = result?;
        if Self::source_key(file_path)? != key {
            return Err("Audio file changed during waveform generation".to_string());
        }
        self.save_to_cache(&cache_path, &data).ok();
        self.enforce_disk_limit()?;
        self.add_to_memory_cache(key, data.clone());
        Ok(data)
    }

    /// Extract waveform peaks from audio file
    fn extract_waveform(&self, file_path: &str) -> Result<WaveformData, String> {
        let file = File::open(file_path).map_err(|e| format!("Failed to open file: {}", e))?;

        let reader = BufReader::with_capacity(256 * 1024, file);
        let source = Decoder::new(reader).map_err(|e| format!("Failed to decode: {}", e))?;

        let sample_rate = source.sample_rate();
        let channel_count = source.channels();
        let samples_per_chunk = waveform_chunk_size(sample_rate, channel_count)?;
        let channels = channel_count as usize;
        let duration = source
            .total_duration()
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);

        // Each chunk contains at least one interleaved frame, even at low sample rates.
        let mut peaks: Vec<f32> = Vec::new();
        let mut chunk: Vec<f32> = Vec::with_capacity(samples_per_chunk);
        let mut sample_count = 0;
        let check_interval = (sample_rate as usize * channels).max(1);

        // Process samples
        for sample in source {
            // Convert to float and normalize
            let normalized = (sample as f32) / (i16::MAX as f32);
            chunk.push(normalized.abs());
            sample_count += 1;

            if chunk.len() >= samples_per_chunk {
                // Calculate peak for this chunk
                let peak = chunk.iter().copied().fold(0.0f32, |max, val| max.max(val));
                peaks.push(peak);
                chunk.clear();
                if self.is_cancelled(file_path) {
                    return Err("Waveform generation cancelled".to_string());
                }
            }

            // Limit total samples processed (for very long files)
            if sample_count > sample_rate as usize * 60 * 30 * channels {
                // Max 30 minutes
                break;
            }

            if sample_count % check_interval == 0 && self.is_cancelled(file_path) {
                return Err("Waveform generation cancelled".to_string());
            }
        }

        // Process remaining samples
        if !chunk.is_empty() {
            let peak = chunk.iter().copied().fold(0.0f32, |max, val| max.max(val));
            peaks.push(peak);
        }

        // Normalize peaks to 0.0-1.0 range
        if !peaks.is_empty() {
            let max_peak = peaks.iter().copied().fold(0.0f32, |max, val| max.max(val));
            if max_peak > 0.0 {
                for peak in &mut peaks {
                    *peak /= max_peak;
                }
            }
        }

        Ok(WaveformData {
            peaks,
            duration_secs: duration,
            sample_rate,
            samples_per_second: SAMPLES_PER_SECOND,
        })
    }

    /// Get cache file path for a given audio file
    fn get_cache_path(&self, file_path: &str) -> PathBuf {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(file_path.as_bytes());
        let hash = hex::encode(hasher.finalize());

        let subdir = &hash[..2.min(hash.len())];
        self.cache_dir.join(subdir).join(format!("{}.wf", hash))
    }

    /// Load waveform from cache file
    fn load_from_cache(&self, path: &PathBuf) -> Result<WaveformData, String> {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("Failed to inspect cache: {}", error))?;
        if !metadata.is_file() || metadata.len() > MAX_CACHE_ENTRY_BYTES {
            return Err(
                "Waveform cache entry is not a regular file or exceeds the size limit".to_string(),
            );
        }
        let file = File::open(path).map_err(|error| format!("Failed to read cache: {}", error))?;
        let mut data = Vec::new();
        file.take(MAX_CACHE_ENTRY_BYTES + 1)
            .read_to_end(&mut data)
            .map_err(|error| format!("Failed to read cache: {}", error))?;
        if data.len() as u64 > MAX_CACHE_ENTRY_BYTES {
            return Err("Waveform cache entry exceeds the size limit".to_string());
        }

        serde_json::from_slice(&data).map_err(|e| format!("Failed to parse cache: {}", e))
    }

    /// Save waveform to cache file
    fn save_to_cache(&self, path: &PathBuf, data: &WaveformData) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).ok();
        }

        let json = serde_json::to_vec(data).map_err(|e| format!("Failed to serialize: {}", e))?;

        fs::write(path, json).map_err(|e| format!("Failed to write cache: {}", e))
    }

    /// Add to the bounded memory cache
    fn add_to_memory_cache(&self, key: String, data: WaveformData) {
        let mut cache = self.memory_cache.write();

        // Evict if at capacity
        if cache.len() >= MAX_CACHE_SIZE && !cache.contains_key(&key) {
            // Simple eviction: remove first entry
            if let Some(key) = cache.keys().next().cloned() {
                cache.remove(&key);
            }
        }

        cache.insert(key, data);
    }

    /// Check for the current source identity, never an older waveform at the same path.
    pub fn has_waveform(&self, file_path: &str) -> bool {
        let Ok(key) = Self::source_key(file_path) else {
            return false;
        };
        if self.memory_cache.read().contains_key(&key) {
            return true;
        }
        self.load_from_cache(&self.get_cache_path(&key)).is_ok()
    }

    fn enforce_disk_limit(&self) -> Result<(), String> {
        let _maintenance = self.disk_maintenance.lock();
        let mut files = Vec::new();
        let mut bytes = 0u64;
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
                    if let Ok(metadata) = entry.metadata() {
                        bytes = bytes.saturating_add(metadata.len());
                        files.push((
                            entry.path(),
                            metadata.modified().unwrap_or(std::time::UNIX_EPOCH),
                            metadata.len(),
                        ));
                    }
                }
            }
        }
        let mut count = files.len();
        files.sort_by_key(|(_, modified, _)| *modified);
        for (path, _, size) in files {
            if count <= MAX_CACHE_SIZE && bytes <= MAX_DISK_CACHE_BYTES {
                break;
            }
            if fs::remove_file(path).is_ok() {
                bytes = bytes.saturating_sub(size);
                count -= 1;
            }
        }
        if count > MAX_CACHE_SIZE || bytes > MAX_DISK_CACHE_BYTES {
            return Err("Waveform cache could not be reduced to its size limit".to_string());
        }
        Ok(())
    }

    /// Get cache statistics
    pub fn get_stats(&self) -> WaveformCacheStats {
        let memory_count = self.memory_cache.read().len();
        let mut disk_count = 0u64;
        let mut total_size = 0u64;

        if let Ok(entries) = fs::read_dir(&self.cache_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if entry.path().is_dir() {
                    if let Ok(sub_entries) = fs::read_dir(entry.path()) {
                        for sub_entry in sub_entries.filter_map(|e| e.ok()) {
                            if let Ok(metadata) = sub_entry.metadata() {
                                disk_count += 1;
                                total_size += metadata.len();
                            }
                        }
                    }
                }
            }
        }

        WaveformCacheStats {
            memory_count: memory_count as u64,
            disk_count,
            total_size_bytes: total_size,
        }
    }

    /// Clear cache
    pub fn clear_cache(&self) -> Result<u64, String> {
        let _lifecycle = self.lifecycle.write();
        let _maintenance = self.disk_maintenance.lock();
        // Clear memory
        self.memory_cache.write().clear();

        // Clear disk
        let mut deleted = 0u64;
        if let Ok(entries) = fs::read_dir(&self.cache_dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                if entry.path().is_dir() {
                    if let Ok(sub_entries) = fs::read_dir(entry.path()) {
                        for sub_entry in sub_entries.filter_map(|e| e.ok()) {
                            if fs::remove_file(sub_entry.path()).is_ok() {
                                deleted += 1;
                            }
                        }
                    }
                }
            }
        }

        Ok(deleted)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformCacheStats {
    pub memory_count: u64,
    pub disk_count: u64,
    pub total_size_bytes: u64,
}

pub type SharedWaveformGenerator = Arc<WaveformGenerator>;

pub fn create_waveform_generator() -> SharedWaveformGenerator {
    let generator = Arc::new(WaveformGenerator::new());
    let maintenance = generator.clone();
    std::thread::spawn(move || {
        // Keep startup eviction from racing a just-generated cache entry.
        let _lifecycle = maintenance.lifecycle.write();
        if let Err(error) = maintenance.enforce_disk_limit() {
            eprintln!("Waveform cache maintenance failed: {}", error);
        }
    });
    generator
}

// ========== Tauri Commands ==========

fn ensure_waveform_path_allowed(file_path: &str, roots: &[PathBuf]) -> Result<(), String> {
    ensure_existing_path_allowed(&PathBuf::from(file_path), roots, "generate waveform")?;
    Ok(())
}

#[tauri::command]
pub async fn waveform_generate(
    file_path: String,
    gen: tauri::State<'_, SharedWaveformGenerator>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<WaveformData, String> {
    let gen = gen.inner().clone();
    let roots = roots_state.inner().read().roots.clone();
    tauri::async_runtime::spawn_blocking(move || {
        ensure_waveform_path_allowed(&file_path, &roots)?;
        gen.generate(&file_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn waveform_cancel(file_path: String, gen: tauri::State<'_, SharedWaveformGenerator>) {
    gen.cancel(&file_path);
}

#[tauri::command]
pub fn waveform_has(file_path: String, gen: tauri::State<'_, SharedWaveformGenerator>) -> bool {
    gen.has_waveform(&file_path)
}

/// Walks the waveform cache directory, so it runs off the main thread.
#[tauri::command]
pub async fn waveform_get_stats(
    gen: tauri::State<'_, SharedWaveformGenerator>,
) -> Result<WaveformCacheStats, String> {
    let gen = gen.inner().clone();
    tauri::async_runtime::spawn_blocking(move || gen.get_stats())
        .await
        .map_err(|e| e.to_string())
}

/// Deletes the waveform cache files, so it runs off the main thread.
#[tauri::command]
pub async fn waveform_clear_cache(
    gen: tauri::State<'_, SharedWaveformGenerator>,
) -> Result<u64, String> {
    let gen = gen.inner().clone();
    tauri::async_runtime::spawn_blocking(move || gen.clear_cache())
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tarab-waveform-{}-{}", name, nonce));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn test_generator(root: &std::path::Path) -> WaveformGenerator {
        let mut generator = WaveformGenerator::new();
        generator.cache_dir = root.join("cache");
        fs::create_dir_all(&generator.cache_dir).unwrap();
        generator
    }

    fn write_wav(path: &std::path::Path, sample: i16, count: u32) {
        let length = count * 2;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + length).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&100_u32.to_le_bytes());
        bytes.extend_from_slice(&200_u32.to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&length.to_le_bytes());
        for _ in 0..count {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn source_edits_invalidate_memory_and_disk_waveforms() {
        let root = temp_dir("source-edit");
        let track = root.join("track.wav");
        let file_path = track.to_string_lossy();
        let generator = test_generator(&root);
        write_wav(&track, 0, 100);
        let old = generator.generate(&file_path).unwrap();
        assert!(old.peaks.iter().all(|peak| *peak == 0.0));
        write_wav(&track, 1000, 200);
        assert!(!generator.has_waveform(&file_path));
        let current = generator.generate(&file_path).unwrap();
        assert!(current.peaks.iter().all(|peak| *peak == 1.0));
        drop(generator);
        let restarted = test_generator(&root);
        write_wav(&track, 0, 300);
        assert!(!restarted.has_waveform(&file_path));
        assert!(restarted
            .generate(&file_path)
            .unwrap()
            .peaks
            .iter()
            .all(|peak| *peak == 0.0));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn waveform_generation_bounds_existing_disk_entries() {
        let root = temp_dir("disk-bound");
        let generator = test_generator(&root);
        let shard = generator.cache_dir.join("aa");
        fs::create_dir_all(&shard).unwrap();
        for index in 0..1001 {
            fs::write(shard.join(format!("{}.wf", index)), b"{}").unwrap();
        }
        let track = root.join("track.wav");
        write_wav(&track, 1000, 100);
        generator.generate(&track.to_string_lossy()).unwrap();
        assert!(generator.get_stats().disk_count <= 1000);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn same_length_source_edit_invalidates_the_waveform() {
        let root = temp_dir("mtime-edit");
        let track = root.join("track.wav");
        write_wav(&track, 0, 100);
        let file = fs::File::options().write(true).open(&track).unwrap();
        file.set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1000))
            .unwrap();
        let generator = test_generator(&root);
        generator.generate(&track.to_string_lossy()).unwrap();
        write_wav(&track, 1000, 100);
        file.set_modified(UNIX_EPOCH + std::time::Duration::from_secs(2000))
            .unwrap();
        assert!(!generator.has_waveform(&track.to_string_lossy()));
        assert!(generator
            .generate(&track.to_string_lossy())
            .unwrap()
            .peaks
            .iter()
            .all(|peak| *peak == 1.0));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn waveform_generation_bounds_disk_bytes() {
        let root = temp_dir("disk-byte-bound");
        let generator = test_generator(&root);
        let shard = generator.cache_dir.join("aa");
        fs::create_dir_all(&shard).unwrap();
        for index in 0..2 {
            fs::File::create(shard.join(format!("{}.wf", index)))
                .unwrap()
                .set_len(40 * 1024 * 1024)
                .unwrap();
        }
        let track = root.join("track.wav");
        write_wav(&track, 1000, 100);
        generator.generate(&track.to_string_lossy()).unwrap();
        assert!(generator.get_stats().total_size_bytes <= 64 * 1024 * 1024);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cached_waveform_hit_does_not_run_disk_maintenance() {
        let root = temp_dir("cache-hit-maintenance");
        let track = root.join("track.wav");
        write_wav(&track, 1000, 100);
        let generator = test_generator(&root);
        let cached = generator.generate(&track.to_string_lossy()).unwrap();

        let shard = generator.cache_dir.join("ff");
        fs::create_dir_all(&shard).unwrap();
        for index in 0..MAX_CACHE_SIZE {
            fs::write(shard.join(format!("unrelated-{}.wf", index)), b"{}").unwrap();
        }
        let before = generator.get_stats().disk_count;
        assert!(before > MAX_CACHE_SIZE as u64);

        assert_eq!(
            generator.generate(&track.to_string_lossy()).unwrap().peaks,
            cached.peaks
        );
        assert_eq!(
            generator.get_stats().disk_count,
            before,
            "a cache hit should not walk and evict unrelated disk entries"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn oversized_waveform_cache_is_rejected_before_parsing() {
        let root = temp_dir("oversized-cache");
        let generator = test_generator(&root);
        let path = root.join("oversized.wf");
        let file = fs::File::create(&path).unwrap();
        file.set_len(2 * 1024 * 1024).unwrap();
        let error = generator.load_from_cache(&path).unwrap_err();
        assert!(error.contains("size limit"), "{}", error);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cancelling_idle_paths_does_not_accumulate_requests() {
        let root = temp_dir("idle-cancel");
        let generator = test_generator(&root);
        for index in 0..1001 {
            generator.cancel(&format!("missing-{}", index));
        }
        assert!(generator.cancel_requests.read().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_requests_reuse_one_disk_waveform() {
        let root = temp_dir("concurrent");
        let track = root.join("track.wav");
        write_wav(&track, 1000, 100);
        let generator = Arc::new(test_generator(&root));
        let mut requests = Vec::new();
        for _ in 0..4 {
            let generator = generator.clone();
            let track = track.clone();
            requests.push(std::thread::spawn(move || {
                generator.generate(&track.to_string_lossy()).unwrap()
            }));
        }
        for request in requests {
            assert!(request.join().unwrap().peaks.iter().all(|peak| *peak == 1.0));
        }
        assert_eq!(generator.get_stats().disk_count, 1);
        assert_eq!(generator.get_stats().memory_count, 1);
        assert!(generator.active_requests.read().is_empty());
        assert!(generator.cancel_requests.read().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn waveform_chunk_size_bounds_decoder_metadata() {
        // Regression for SEC-03: untrusted decoder metadata must not cause huge allocations.
        assert!(waveform_chunk_size(0, 2).is_err());
        assert!(waveform_chunk_size(u32::MAX, 2).is_err());
        assert!(waveform_chunk_size(48_000, 0).is_err());
        assert!(waveform_chunk_size(48_000, u16::MAX).is_err());
        assert_eq!(waveform_chunk_size(48_000, 2).unwrap(), 9_600);
        assert_eq!(waveform_chunk_size(1, 1).unwrap(), 1);
        assert_eq!(
            waveform_chunk_size(MAX_WAVEFORM_SAMPLE_RATE, MAX_WAVEFORM_CHANNELS).unwrap(),
            307_200
        );
    }

    #[test]
    fn waveform_generation_rejects_paths_outside_library_roots() {
        let allowed_root = temp_dir("allowed");
        let outside_root = temp_dir("outside");
        let outside_file = outside_root.join("outside.mp3");
        fs::write(&outside_file, b"not audio").expect("write outside file");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = ensure_waveform_path_allowed(&outside_file.to_string_lossy(), &roots);

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("outside configured library roots"));

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn waveform_generation_allows_existing_files_inside_library_roots() {
        let allowed_root = temp_dir("allowed");
        let track_file = allowed_root.join("track.mp3");
        fs::write(&track_file, b"not audio").expect("write track file");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        ensure_waveform_path_allowed(&track_file.to_string_lossy(), &roots)
            .expect("path should be allowed");

        let _ = fs::remove_dir_all(allowed_root);
    }
}
