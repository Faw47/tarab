use parking_lot::RwLock;
use rodio::{Decoder, Source};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::Arc;

use crate::database::get_cache_dir;
use crate::file_ops::{ensure_existing_path_allowed, SharedLibraryRoots};

const SAMPLES_PER_SECOND: u32 = 10; // 10 samples per second = 100ms resolution
const MAX_CACHE_SIZE: usize = 1000; // Max waveforms in memory
const MAX_WAVEFORM_SAMPLE_RATE: u32 = 384_000;
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
}

impl WaveformGenerator {
    pub fn new() -> Self {
        let cache_dir = get_cache_dir().join("waveforms");
        fs::create_dir_all(&cache_dir).ok();

        Self {
            cache_dir,
            memory_cache: RwLock::new(HashMap::new()),
            cancel_requests: RwLock::new(HashSet::new()),
        }
    }

    pub fn cancel(&self, file_path: &str) {
        self.cancel_requests.write().insert(file_path.to_string());
    }

    fn clear_cancel(&self, file_path: &str) {
        self.cancel_requests.write().remove(file_path);
    }

    fn is_cancelled(&self, file_path: &str) -> bool {
        self.cancel_requests.read().contains(file_path)
    }

    /// Generate waveform from audio file
    pub fn generate(&self, file_path: &str) -> Result<WaveformData, String> {
        self.clear_cancel(file_path);
        // Check memory cache
        {
            let cache = self.memory_cache.read();
            if let Some(data) = cache.get(file_path) {
                return Ok(data.clone());
            }
        }

        // Check disk cache
        let cache_path = self.get_cache_path(file_path);
        if cache_path.exists() {
            if let Ok(data) = self.load_from_cache(&cache_path) {
                // Add to memory cache
                self.add_to_memory_cache(file_path.to_string(), data.clone());
                return Ok(data);
            }
        }

        // Generate waveform
        let data = self.extract_waveform(file_path)?;

        // Save to disk cache
        self.save_to_cache(&cache_path, &data).ok();

        // Add to memory cache
        self.add_to_memory_cache(file_path.to_string(), data.clone());

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
        let data = fs::read(path).map_err(|e| format!("Failed to read cache: {}", e))?;

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

    /// Add to memory cache with LRU eviction
    fn add_to_memory_cache(&self, key: String, data: WaveformData) {
        let mut cache = self.memory_cache.write();

        // Evict if at capacity
        if cache.len() >= MAX_CACHE_SIZE {
            // Simple eviction: remove first entry
            if let Some(key) = cache.keys().next().cloned() {
                cache.remove(&key);
            }
        }

        cache.insert(key, data);
    }

    /// Check if waveform exists
    pub fn has_waveform(&self, file_path: &str) -> bool {
        {
            let cache = self.memory_cache.read();
            if cache.contains_key(file_path) {
                return true;
            }
        }

        self.get_cache_path(file_path).exists()
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
    Arc::new(WaveformGenerator::new())
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
        assert!(restarted.generate(&file_path).unwrap().peaks.iter().all(|peak| *peak == 0.0));
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
