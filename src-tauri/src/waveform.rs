use parking_lot::RwLock;
use rodio::{Decoder, Source};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::Arc;

use crate::database::get_cache_dir;

const SAMPLES_PER_SECOND: u32 = 10; // 10 samples per second = 100ms resolution
const MAX_CACHE_SIZE: usize = 1000; // Max waveforms in memory

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
        let channels = source.channels() as usize;
        let duration = source
            .total_duration()
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);

        // Calculate samples per chunk for desired resolution
        let samples_per_chunk = (sample_rate as usize) / (SAMPLES_PER_SECOND as usize) * channels;

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

#[tauri::command]
pub async fn waveform_generate(
    file_path: String,
    gen: tauri::State<'_, SharedWaveformGenerator>,
) -> Result<WaveformData, String> {
    let gen = gen.inner().clone();
    tauri::async_runtime::spawn_blocking(move || gen.generate(&file_path))
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

#[tauri::command]
pub fn waveform_get_stats(gen: tauri::State<'_, SharedWaveformGenerator>) -> WaveformCacheStats {
    gen.get_stats()
}

#[tauri::command]
pub fn waveform_clear_cache(gen: tauri::State<'_, SharedWaveformGenerator>) -> Result<u64, String> {
    gen.clear_cache()
}
