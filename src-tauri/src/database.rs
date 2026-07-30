use parking_lot::Mutex;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::async_runtime::spawn_blocking;

use crate::file_ops::{ensure_existing_path_allowed, SharedLibraryRoots};

mod aggregates;
mod lyrics;
mod migrations;
mod playlists;
mod tracks;

const CURRENT_SCHEMA_VERSION: i32 = 8;
const PATH_NORMALIZATION_CLEANUP_KEY: &str = "path-normalization-cleanup-v1";
const DB_GET_ALL_TRACKS_HARD_LIMIT: i64 = 50_000;

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
const APP_STORAGE_DIRECTORY: &str = "com.fawaz.tarab";
const LEGACY_STORAGE_DIRECTORY: &str = "music-player";

fn now_millis_i64_or_default() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

fn now_unix_secs_i64() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album_artist: Option<String>,
    pub album: String,
    pub year: Option<i32>,
    pub duration: f64,
    pub file_path: String,
    pub has_cover_art: bool,
    pub cover_art_hash: Option<String>,
    pub blurhash: Option<String>,
    pub date_added: i64,
    pub play_count: i32,
    pub last_played: Option<i64>,
    pub rating: Option<i32>,
    #[serde(default)]
    pub track_number: Option<u32>,
    #[serde(default)]
    pub disc_number: Option<u32>,
    #[serde(default)]
    pub file_format: Option<String>,
    #[serde(default)]
    pub bitrate: Option<u32>,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub file_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbAlbumAggregate {
    pub album: String,
    pub artist: String,
    pub track_count: usize,
    pub representative: DbTrack,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbArtistAggregate {
    pub artist: String,
    pub track_count: usize,
    pub representative: DbTrack,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanReconcileError {
    pub path: Option<String>,
    pub code: String,
    pub message: String,
    pub recoverable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReconcileRequest {
    pub folder_path: String,
    pub discovered_paths: Vec<String>,
    pub tracks: Vec<DbTrack>,
    pub traversal_complete: bool,
    pub errors: Vec<ScanReconcileError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReconcileResult {
    pub status: String,
    pub folder_path: String,
    pub discovered_count: usize,
    pub added_count: usize,
    pub updated_count: usize,
    pub unchanged_count: usize,
    pub missing_count: usize,
    pub preserved_count: usize,
    pub errors: Vec<ScanReconcileError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbPlaylist {
    pub id: String,
    pub name: String,
    pub playlist_type: String,
    pub folder_path: Option<String>,
    pub smart_rules: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_pinned: bool,
    pub pinned_at: Option<i64>,
    pub last_synced_at: Option<i64>,
    pub sync_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DbPlaylistTrackEntry {
    pub track_id: String,
    pub position: i32,
    pub snapshot_title: Option<String>,
    pub snapshot_artist: Option<String>,
    pub snapshot_album: Option<String>,
    pub snapshot_duration: Option<f64>,
    pub snapshot_file_path: Option<String>,
    pub snapshot_has_cover_art: bool,
    pub snapshot_cover_art_hash: Option<String>,
    pub snapshot_blurhash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub file_path: String,
    pub cover_art_hash: Option<String>,
    pub blurhash: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LyricsIndexMeta {
    pub track_id: String,
    pub lyrics_path: String,
    pub lyrics_mtime: i64,
}

#[derive(Debug, Clone)]
pub struct LyricsIndexEntry {
    pub track_id: String,
    pub lyrics_path: String,
    pub lyrics_mtime: i64,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct LyricsSearchCandidate {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub file_path: String,
    pub cover_art_hash: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct TrackPathRow {
    pub id: String,
    pub file_path: String,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    fn normalize_path(path: &str) -> String {
        #[cfg(windows)]
        {
            path.replace('\\', "/")
        }
        #[cfg(not(windows))]
        {
            path.to_string()
        }
    }

    fn public_track_id(path: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(b"tarab-track-v1\0");
        hasher.update(Self::normalize_path(path).as_bytes());
        hex::encode(hasher.finalize())
    }

    pub fn new(db_path: PathBuf) -> SqliteResult<Self> {
        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(&db_path)?;

        // Enable WAL mode for better concurrent performance
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;

        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        let db = Self {
            conn: Mutex::new(conn),
        };

        db.run_migrations()?;
        db.ensure_path_cleanup_once()?;

        Ok(db)
    }

    #[cfg(test)]
    pub(crate) fn in_memory_for_tests() -> SqliteResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        Ok(db)
    }

    pub fn get_recently_added(&self, days: i32, limit: u32) -> SqliteResult<Vec<DbTrack>> {
        let conn = self.conn.lock();
        let cutoff = now_millis_i64_or_default() - (days as i64 * 24 * 60 * 60 * 1000);

        let mut stmt = conn.prepare(
            "SELECT id, title, artist, album_artist, album, year, duration, file_path, has_cover_art, 
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating,
                    track_number, disc_number, file_format, bitrate, sample_rate, file_size
             FROM tracks 
             WHERE date_added >= ?1 
             ORDER BY date_added DESC 
             LIMIT ?2",
        )?;

        let tracks = stmt
            .query_map(params![cutoff, limit], Self::map_db_track_row)?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(tracks)
    }

    pub fn get_most_played(&self, limit: u32) -> SqliteResult<Vec<DbTrack>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, title, artist, album_artist, album, year, duration, file_path, has_cover_art, 
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating,
                    track_number, disc_number, file_format, bitrate, sample_rate, file_size
             FROM tracks 
             WHERE play_count > 0
             ORDER BY play_count DESC 
             LIMIT ?1",
        )?;

        let tracks = stmt
            .query_map(params![limit], Self::map_db_track_row)?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(tracks)
    }

    pub fn get_smart_shuffle_queue(&self, track_ids: Vec<String>) -> SqliteResult<Vec<String>> {
        use rand::Rng;

        if track_ids.is_empty() {
            return Ok(vec![]);
        }

        let normalized_ids: Vec<String> = track_ids
            .iter()
            .map(|id| Self::normalize_path(id))
            .collect();
        let now = now_unix_secs_i64();
        let seven_days_secs: i64 = 7 * 24 * 3600;
        let weighted: Vec<(String, String, f64)> = {
            let conn = self.conn.lock();
            let mut candidates = Vec::new();
            for chunk in normalized_ids.chunks(900) {
                let placeholders = (0..chunk.len())
                    .map(|i| format!("?{}", i + 1))
                    .collect::<Vec<_>>()
                    .join(", ");
                let query = format!(
                    "SELECT id, artist, play_count, last_played FROM tracks WHERE id IN ({})",
                    placeholders
                );
                let mut stmt = conn.prepare(&query)?;
                let rows = stmt.query_map(params_from_iter(chunk.iter()), |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i32>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                })?;

                for row in rows {
                    let (id, artist, play_count, last_played) = row?;
                    let base = 1.0 / (play_count as f64 + 1.0);
                    let recency = match last_played {
                        None => 2.0,
                        Some(ts) if now.saturating_sub(ts) > seven_days_secs => 2.0,
                        _ => 1.0,
                    };
                    candidates.push((id, artist, base * recency));
                }
            }
            candidates
        };

        if weighted.is_empty() {
            return Ok(track_ids);
        }

        let mut rng = rand::thread_rng();
        let mut ranked: Vec<(String, String, f64)> = weighted
            .into_iter()
            .map(|(id, artist, weight)| {
                let draw = rng.gen_range(f64::EPSILON..1.0_f64);
                (id, artist, -draw.ln() / weight.max(f64::EPSILON))
            })
            .collect();
        ranked.sort_unstable_by(|left, right| left.2.total_cmp(&right.2));
        let mut ordered: Vec<(String, String)> = ranked
            .into_iter()
            .map(|(id, artist, _)| (id, artist))
            .collect();

        let n = ordered.len();
        for _ in 0..(n * 3).min(512) {
            let mut swapped = false;
            for i in 0..n {
                let artist_i = ordered[i].1.clone();
                let near_dup = (1..=3).any(|d| {
                    let j = i + d;
                    j < n && ordered[j].1 == artist_i
                });
                if !near_dup {
                    continue;
                }
                for j in (i + 4)..n {
                    if ordered[j].1 != artist_i {
                        ordered.swap(i + 1, j);
                        swapped = true;
                        break;
                    }
                }
            }
            if !swapped {
                break;
            }
        }

        Ok(ordered.into_iter().map(|(id, _)| id).collect())
    }

    // ========== Stats ==========

    pub fn get_library_stats(&self) -> SqliteResult<LibraryStats> {
        let conn = self.conn.lock();

        let (track_count, total_duration, artist_count, album_count, total_plays) = conn
            .query_row(
                r#"
                SELECT
                    COUNT(*),
                    COALESCE(SUM(duration), 0),
                    COUNT(DISTINCT artist),
                    COUNT(DISTINCT album),
                    COALESCE(SUM(play_count), 0)
                FROM tracks
                "#,
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )?;

        Ok(LibraryStats {
            track_count,
            total_duration,
            artist_count,
            album_count,
            total_plays,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub track_count: i64,
    pub total_duration: f64,
    pub artist_count: i64,
    pub album_count: i64,
    pub total_plays: i64,
}

fn prepare_app_directory(base_dir: &Path) -> Result<PathBuf, String> {
    let app_dir = base_dir.join(APP_STORAGE_DIRECTORY);
    if app_dir.exists() {
        return Ok(app_dir);
    }

    let legacy_dir = base_dir.join(LEGACY_STORAGE_DIRECTORY);
    if legacy_dir.exists() {
        std::fs::rename(&legacy_dir, &app_dir).map_err(|error| {
            format!(
                "Failed to migrate legacy Tarab data from {} to {}: {}",
                legacy_dir.display(),
                app_dir.display(),
                error
            )
        })?;
    } else {
        std::fs::create_dir_all(&app_dir).map_err(|error| {
            format!(
                "Failed to create Tarab data directory {}: {}",
                app_dir.display(),
                error
            )
        })?;
    }

    Ok(app_dir)
}

fn get_database_path() -> Result<PathBuf, String> {
    let base_dir = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    prepare_app_directory(&base_dir).map(|directory| directory.join("library.db"))
}

pub fn get_app_data_dir() -> Result<PathBuf, String> {
    let base_dir = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    prepare_app_directory(&base_dir)
}

pub fn get_cache_dir() -> PathBuf {
    let base_dir = dirs::cache_dir().unwrap_or_else(|| PathBuf::from("."));
    prepare_app_directory(&base_dir).unwrap_or_else(|error| {
        eprintln!("{}", error);
        base_dir.join(APP_STORAGE_DIRECTORY)
    })
}

// Shared database instance
pub type SharedDatabase = Arc<Database>;

pub fn create_database() -> Result<SharedDatabase, String> {
    let db_path = get_database_path()?;
    Database::new(db_path)
        .map(Arc::new)
        .map_err(|e| format!("Failed to create database: {}", e))
}

// ========== Tauri Commands ==========

fn ensure_upsert_tracks_allowed(tracks: &[DbTrack], roots: &[PathBuf]) -> Result<(), String> {
    for track in tracks {
        ensure_existing_path_allowed(Path::new(&track.file_path), roots, "upsert library track")?;
    }
    Ok(())
}

#[tauri::command]
pub async fn db_get_all_tracks(
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<DbTrack>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || {
        let count = db.get_track_count().map_err(|e| e.to_string())?;
        if count > DB_GET_ALL_TRACKS_HARD_LIMIT {
            return Err(format!(
                "db_get_all_tracks is disabled for libraries larger than {} tracks (current: {}); use db_get_tracks_paginated instead",
                DB_GET_ALL_TRACKS_HARD_LIMIT, count
            ));
        }
        db.get_all_tracks().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_get_tracks_by_ids(
    ids: Vec<String>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<DbTrack>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_tracks_by_ids(&ids))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_track_by_public_id(
    public_id: String,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Option<DbTrack>, String> {
    let db = db.inner().clone();
    let roots = roots_state.read().roots.clone();
    spawn_blocking(move || {
        let track = db
            .get_track_by_public_id(&public_id)
            .map_err(|error| error.to_string())?;
        match track {
            Some(track) => {
                ensure_existing_path_allowed(
                    Path::new(&track.file_path),
                    &roots,
                    "resolve public track link",
                )?;
                Ok(Some(track))
            }
            None => Ok(None),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn db_get_tracks_by_album_artist(
    album: String,
    artist: String,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<DbTrack>, String> {
    if album.trim().is_empty() || artist.trim().is_empty() {
        return Ok(vec![]);
    }
    let db = db.inner().clone();
    spawn_blocking(move || db.get_tracks_by_album_artist(&album, &artist))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_tracks_by_artist(
    db: tauri::State<'_, SharedDatabase>,
    artist: String,
) -> Result<Vec<DbTrack>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_tracks_by_artist(&artist).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_get_album_aggregates(
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<DbAlbumAggregate>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_album_aggregates().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_get_artist_aggregates(
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<DbArtistAggregate>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_artist_aggregates().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_get_tracks_paginated(
    offset: u32,
    limit: u32,
    sort_by: String,
    sort_order: String,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<DbTrack>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_tracks_paginated(offset, limit, &sort_by, &sort_order))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_search_tracks(
    query: String,
    limit: u32,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<SearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    let db = db.inner().clone();
    spawn_blocking(move || db.search_tracks(&query, limit))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_existing_paths(
    paths: Vec<String>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Ok(vec![]);
    }
    let db = db.inner().clone();
    spawn_blocking(move || db.get_existing_paths(&paths))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_upsert_tracks(
    tracks: Vec<DbTrack>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<usize, String> {
    let db = db.inner().clone();
    let roots = roots_state.inner().read().roots.clone();
    spawn_blocking(move || {
        ensure_upsert_tracks_allowed(&tracks, &roots)?;
        db.upsert_tracks_batch(&tracks).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_reconcile_folder_scan(
    request: ScanReconcileRequest,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<ScanReconcileResult, String> {
    let db = db.inner().clone();
    let roots = roots_state.inner().read().roots.clone();
    spawn_blocking(move || {
        ensure_existing_path_allowed(Path::new(&request.folder_path), &roots, "reconcile scan")?;
        ensure_upsert_tracks_allowed(&request.tracks, &roots)?;
        db.reconcile_folder_scan(request)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn db_get_track_count(db: tauri::State<'_, SharedDatabase>) -> Result<i64, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_track_count())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_update_play_stats(
    track_id: String,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<(), String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.update_play_stats(&track_id))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_set_track_rating(
    track_id: String,
    rating: Option<i32>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<(), String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.set_track_rating(&track_id, rating))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_recently_added(
    days: i32,
    limit: u32,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<DbTrack>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_recently_added(days, limit))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_most_played(
    limit: u32,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<DbTrack>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_most_played(limit))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_smart_shuffle_queue(
    track_ids: Vec<String>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<String>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_smart_shuffle_queue(track_ids))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_get_library_stats(
    db: tauri::State<'_, SharedDatabase>,
) -> Result<LibraryStats, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_library_stats())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_delete_tracks(
    ids: Vec<String>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<usize, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.delete_tracks(&ids))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_rename_track_path(
    old_path: String,
    new_path: String,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<(), String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.rename_track_path(&old_path, &new_path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_delete_tracks_by_folder(
    folder_path: String,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<usize, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.delete_tracks_by_folder(&folder_path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Database {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        let db = Database {
            conn: Mutex::new(conn),
        };
        db.run_migrations().expect("run_migrations");
        db
    }

    #[test]
    fn legacy_storage_directory_is_migrated_to_app_identifier() {
        let base_dir = std::env::temp_dir().join(format!(
            "tarab-storage-migration-{}",
            now_millis_i64_or_default()
        ));
        let legacy_dir = base_dir.join(LEGACY_STORAGE_DIRECTORY);
        std::fs::create_dir_all(&legacy_dir).expect("create legacy directory");
        std::fs::write(legacy_dir.join("library.db"), b"legacy").expect("seed legacy database");

        let migrated = prepare_app_directory(&base_dir).expect("migrate legacy directory");

        assert_eq!(migrated, base_dir.join(APP_STORAGE_DIRECTORY));
        assert!(migrated.join("library.db").exists());
        assert!(!legacy_dir.exists());

        let _ = std::fs::remove_dir_all(base_dir);
    }

    #[test]
    fn upsert_track_validation_rejects_paths_outside_library_roots() {
        let allowed_root =
            std::env::temp_dir().join(format!("tarab-db-allowed-{}", now_millis_i64_or_default()));
        let outside_root =
            std::env::temp_dir().join(format!("tarab-db-outside-{}", now_millis_i64_or_default()));
        std::fs::create_dir_all(&allowed_root).expect("create allowed root");
        std::fs::create_dir_all(&outside_root).expect("create outside root");
        let outside_file = outside_root.join("outside.mp3");
        std::fs::write(&outside_file, b"not audio").expect("write outside file");
        let roots = vec![std::fs::canonicalize(&allowed_root).expect("canonical root")];
        let track = DbTrack {
            id: outside_file.to_string_lossy().to_string(),
            title: "Outside".to_string(),
            artist: "Artist".to_string(),
            album_artist: None,
            album: "Album".to_string(),
            year: None,
            duration: 1.0,
            file_path: outside_file.to_string_lossy().to_string(),
            has_cover_art: false,
            cover_art_hash: None,
            blurhash: None,
            date_added: now_millis_i64_or_default(),
            play_count: 0,
            last_played: None,
            rating: None,
            track_number: None,
            disc_number: None,
            file_format: Some("MP3".to_string()),
            bitrate: None,
            sample_rate: None,
            file_size: None,
        };

        let result = ensure_upsert_tracks_allowed(&[track], &roots);

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("outside configured library roots"));

        let _ = std::fs::remove_dir_all(allowed_root);
        let _ = std::fs::remove_dir_all(outside_root);
    }
    fn sample_track(id: &str) -> DbTrack {
        DbTrack {
            id: id.to_string(),
            title: format!("Track {}", id),
            artist: "Artist".to_string(),
            album_artist: None,
            album: "Album".to_string(),
            year: Some(2020),
            duration: 180.0,
            file_path: format!("/tmp/{}.mp3", id),
            has_cover_art: false,
            cover_art_hash: None,
            blurhash: None,
            date_added: now_millis_i64_or_default(),
            play_count: 0,
            last_played: None,
            rating: None,
            track_number: None,
            disc_number: None,
            file_format: Some("MP3".to_string()),
            bitrate: None,
            sample_rate: None,
            file_size: None,
        }
    }

    #[test]
    fn public_track_id_resolves_without_exposing_the_path() {
        let db = test_db();
        let track = sample_track("public-link");
        db.upsert_tracks_batch(std::slice::from_ref(&track))
            .expect("seed track");
        let public_id = Database::public_track_id(&track.file_path);

        assert_eq!(public_id.len(), 64);
        assert!(!public_id.contains("public-link"));
        assert_eq!(
            db.get_track_by_public_id(&public_id)
                .expect("resolve public id")
                .expect("linked track")
                .id,
            track.id
        );
        assert!(db
            .get_track_by_public_id("../not-an-id")
            .expect("reject invalid public id")
            .is_none());
    }

    #[test]
    fn track_order_and_technical_metadata_survive_database_reload() {
        let db = test_db();
        let mut track = sample_track("metadata");
        track.track_number = Some(7);
        track.disc_number = Some(2);
        track.file_format = Some("FLAC".to_string());
        track.bitrate = Some(921_000);
        track.sample_rate = Some(96_000);
        track.file_size = Some(42_000_000);

        db.upsert_tracks_batch(std::slice::from_ref(&track))
            .expect("store metadata");

        let loaded = db
            .get_tracks_by_ids(std::slice::from_ref(&track.id))
            .expect("reload metadata")
            .into_iter()
            .next()
            .expect("stored track");
        assert_eq!(loaded.track_number, track.track_number);
        assert_eq!(loaded.disc_number, track.disc_number);
        assert_eq!(loaded.file_format, track.file_format);
        assert_eq!(loaded.bitrate, track.bitrate);
        assert_eq!(loaded.sample_rate, track.sample_rate);
        assert_eq!(loaded.file_size, track.file_size);
    }

    fn sample_playlist(id: &str) -> DbPlaylist {
        let now = now_millis_i64_or_default();
        DbPlaylist {
            id: id.to_string(),
            name: "Playlist".to_string(),
            playlist_type: "manual".to_string(),
            folder_path: None,
            smart_rules: None,
            created_at: now,
            updated_at: now,
            is_pinned: false,
            pinned_at: None,
            last_synced_at: None,
            sync_error: None,
        }
    }

    #[test]
    fn add_tracks_to_playlist_enforces_unique_membership() {
        let db = test_db();
        db.upsert_tracks_batch(&[sample_track("a"), sample_track("b")])
            .expect("seed tracks");
        db.create_playlist(&sample_playlist("pl_1"))
            .expect("create playlist");

        db.add_tracks_to_playlist("pl_1", &["a".to_string(), "a".to_string(), "b".to_string()])
            .expect("add tracks");

        let ids = db
            .get_playlist_track_entries("pl_1")
            .expect("read playlist tracks")
            .into_iter()
            .map(|entry| entry.track_id)
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn set_playlist_tracks_preserves_order_and_unknown_ids() {
        let db = test_db();
        db.upsert_tracks_batch(&[sample_track("a"), sample_track("b")])
            .expect("seed tracks");
        db.create_playlist(&sample_playlist("pl_2"))
            .expect("create playlist");

        db.set_playlist_tracks(
            "pl_2",
            &[
                "missing_1".to_string(),
                "b".to_string(),
                "a".to_string(),
                "missing_2".to_string(),
            ],
            now_millis_i64_or_default(),
        )
        .expect("set playlist tracks");

        let ids = db
            .get_playlist_track_entries("pl_2")
            .expect("read playlist tracks")
            .into_iter()
            .map(|entry| entry.track_id)
            .collect::<Vec<_>>();
        assert_eq!(
            ids,
            vec![
                "missing_1".to_string(),
                "b".to_string(),
                "a".to_string(),
                "missing_2".to_string()
            ]
        );
    }

    #[test]
    fn relink_playlist_track_replaces_missing_reference_and_snapshot() {
        let db = test_db();
        let replacement = sample_track("replacement");
        db.upsert_tracks_batch(std::slice::from_ref(&replacement))
            .expect("seed replacement");
        db.create_playlist(&sample_playlist("relink-playlist"))
            .expect("create playlist");
        db.set_playlist_tracks(
            "relink-playlist",
            &["missing-track".to_string()],
            now_millis_i64_or_default(),
        )
        .expect("seed missing reference");

        db.relink_playlist_track(
            "relink-playlist",
            "missing-track",
            &replacement.id,
            now_millis_i64_or_default(),
        )
        .expect("relink track");

        let entries = db
            .get_playlist_track_entries("relink-playlist")
            .expect("read relinked entry");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].track_id, replacement.id);
        assert_eq!(
            entries[0].snapshot_title.as_deref(),
            Some("Track replacement")
        );
        assert_eq!(
            entries[0].snapshot_file_path.as_deref(),
            Some(replacement.file_path.as_str())
        );
    }

    #[test]
    fn rename_track_path_updates_playlist_and_lyrics_references() {
        let db = test_db();
        let old_path = "/tmp/song.mp3";
        let new_path = "/tmp/song-renamed.mp3";
        let mut track = sample_track("song");
        track.id = old_path.to_string();
        track.file_path = old_path.to_string();

        db.upsert_tracks_batch(&[track]).expect("seed track");
        db.create_playlist(&sample_playlist("pl_rename"))
            .expect("create playlist");
        db.set_playlist_tracks(
            "pl_rename",
            &[old_path.to_string()],
            now_millis_i64_or_default(),
        )
        .expect("set playlist tracks");
        db.upsert_lyrics_index_batch(&[LyricsIndexEntry {
            track_id: old_path.to_string(),
            lyrics_path: "/tmp/song.lrc".to_string(),
            lyrics_mtime: 1,
            content: "hello".to_string(),
        }])
        .expect("seed lyrics index");

        db.rename_track_path(old_path, new_path)
            .expect("rename track");

        let tracks = db
            .get_tracks_by_ids(&[new_path.to_string()])
            .expect("read track");
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].file_path, new_path);
        let playlist_entries = db
            .get_playlist_track_entries("pl_rename")
            .expect("read playlist tracks");
        assert_eq!(playlist_entries.len(), 1);
        assert_eq!(playlist_entries[0].track_id, new_path);
        assert_eq!(
            playlist_entries[0].snapshot_file_path.as_deref(),
            Some(new_path)
        );
        let lyrics_ids = db
            .get_lyrics_index_meta()
            .expect("read lyrics index")
            .into_iter()
            .map(|entry| entry.track_id)
            .collect::<Vec<_>>();
        assert_eq!(lyrics_ids, vec![new_path.to_string()]);
    }

    #[test]
    fn deleting_tracks_keeps_playlist_references_for_unavailable_entries() {
        let db = test_db();
        db.upsert_tracks_batch(&[sample_track("a")])
            .expect("seed track");
        db.create_playlist(&sample_playlist("pl_3"))
            .expect("create playlist");
        db.set_playlist_tracks("pl_3", &["a".to_string()], now_millis_i64_or_default())
            .expect("set playlist tracks");
        db.upsert_lyrics_index_batch(&[LyricsIndexEntry {
            track_id: "a".to_string(),
            lyrics_path: "/tmp/a.lrc".to_string(),
            lyrics_mtime: 1,
            content: "line".to_string(),
        }])
        .expect("seed lyrics index");

        db.delete_tracks(&["a".to_string()]).expect("delete track");

        assert_eq!(db.lyrics_index_count().expect("lyrics count"), 0);
        let ids = db
            .get_playlist_track_entries("pl_3")
            .expect("read playlist tracks")
            .into_iter()
            .map(|entry| entry.track_id)
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["a".to_string()]);
    }

    #[test]
    fn deleting_tracks_by_folder_cleans_lyrics_index() {
        let db = test_db();
        let mut inside = sample_track("inside");
        inside.id = "/tmp/folder/inside.mp3".to_string();
        inside.file_path = inside.id.clone();
        let mut outside = sample_track("outside");
        outside.id = "/tmp/other/outside.mp3".to_string();
        outside.file_path = outside.id.clone();
        db.upsert_tracks_batch(&[inside.clone(), outside.clone()])
            .expect("seed tracks");
        db.upsert_lyrics_index_batch(&[
            LyricsIndexEntry {
                track_id: inside.id.clone(),
                lyrics_path: "/tmp/folder/inside.lrc".to_string(),
                lyrics_mtime: 1,
                content: "inside".to_string(),
            },
            LyricsIndexEntry {
                track_id: outside.id.clone(),
                lyrics_path: "/tmp/other/outside.lrc".to_string(),
                lyrics_mtime: 1,
                content: "outside".to_string(),
            },
        ])
        .expect("seed lyrics index");

        assert_eq!(
            db.delete_tracks_by_folder("/tmp/folder")
                .expect("delete folder"),
            1
        );

        let ids = db
            .get_lyrics_index_meta()
            .expect("read lyrics index")
            .into_iter()
            .map(|entry| entry.track_id)
            .collect::<Vec<_>>();
        assert_eq!(ids, vec![outside.id]);
    }

    #[test]
    fn deleting_tracks_by_folder_rejects_empty_and_root_paths() {
        let db = test_db();
        let track = sample_track("kept");
        db.upsert_tracks_batch(std::slice::from_ref(&track))
            .expect("seed track");

        for invalid in ["", " ", "/", ".", ".."] {
            assert!(
                db.delete_tracks_by_folder(invalid).is_err(),
                "expected invalid folder path to fail: {invalid:?}"
            );
        }

        assert_eq!(db.get_track_count().expect("track count"), 1);
    }

    #[test]
    fn reconcile_folder_scan_preserves_user_fields_and_unreadable_discovered_rows() {
        let db = test_db();
        let mut updated = sample_track("updated");
        updated.id = "/tmp/folder/updated.mp3".to_string();
        updated.file_path = updated.id.clone();
        updated.rating = Some(4);
        updated.play_count = 9;
        updated.last_played = Some(1234);
        updated.date_added = 42;
        let mut unreadable = sample_track("unreadable");
        unreadable.id = "/tmp/folder/unreadable.mp3".to_string();
        unreadable.file_path = unreadable.id.clone();
        db.upsert_tracks_batch(&[updated.clone(), unreadable.clone()])
            .expect("seed tracks");

        let mut incoming = updated.clone();
        incoming.title = "Updated title".to_string();
        incoming.rating = None;
        incoming.play_count = 0;
        incoming.last_played = None;
        incoming.date_added = 9999;
        let result = db
            .reconcile_folder_scan(ScanReconcileRequest {
                folder_path: "/tmp/folder".to_string(),
                discovered_paths: vec![updated.file_path.clone(), unreadable.file_path.clone()],
                tracks: vec![incoming],
                traversal_complete: true,
                errors: vec![ScanReconcileError {
                    path: Some(unreadable.file_path.clone()),
                    code: "metadataReadFailed".to_string(),
                    message: "metadata failed".to_string(),
                    recoverable: true,
                }],
            })
            .expect("reconcile scan");

        assert_eq!(result.status, "partial");
        assert_eq!(result.preserved_count, 1);
        assert_eq!(result.missing_count, 0);
        let stored = db
            .get_tracks_by_ids(&[updated.id.clone(), unreadable.id.clone()])
            .expect("read reconciled tracks");
        let stored_updated = stored
            .iter()
            .find(|track| track.id == updated.id)
            .expect("updated track");
        assert_eq!(stored_updated.title, "Updated title");
        assert_eq!(stored_updated.rating, Some(4));
        assert_eq!(stored_updated.play_count, 9);
        assert_eq!(stored_updated.last_played, Some(1234));
        assert_eq!(stored_updated.date_added, 42);
        assert!(stored.iter().any(|track| track.id == unreadable.id));
    }

    #[test]
    fn reconcile_folder_scan_does_not_delete_rows_after_incomplete_traversal() {
        let db = test_db();
        let mut existing = sample_track("kept-after-failure");
        existing.id = "/tmp/folder/kept.mp3".to_string();
        existing.file_path = existing.id.clone();
        db.upsert_tracks_batch(std::slice::from_ref(&existing))
            .expect("seed track");

        let result = db
            .reconcile_folder_scan(ScanReconcileRequest {
                folder_path: "/tmp/folder".to_string(),
                discovered_paths: Vec::new(),
                tracks: Vec::new(),
                traversal_complete: false,
                errors: vec![ScanReconcileError {
                    path: None,
                    code: "traversalFailed".to_string(),
                    message: "scan failed".to_string(),
                    recoverable: true,
                }],
            })
            .expect("reconcile incomplete scan");

        assert_eq!(result.status, "failed");
        assert_eq!(result.missing_count, 0);
        assert_eq!(db.get_track_count().expect("track count"), 1);
    }

    #[test]
    fn reconcile_complete_scan_reports_counts_and_removes_only_confirmed_missing_rows() {
        let db = test_db();
        let mut unchanged = sample_track("unchanged");
        unchanged.id = "/tmp/folder/unchanged.mp3".to_string();
        unchanged.file_path = unchanged.id.clone();
        let mut missing = sample_track("missing");
        missing.id = "/tmp/folder/missing.mp3".to_string();
        missing.file_path = missing.id.clone();
        let mut outside = sample_track("outside");
        outside.id = "/tmp/other/outside.mp3".to_string();
        outside.file_path = outside.id.clone();
        db.upsert_tracks_batch(&[unchanged.clone(), missing.clone(), outside.clone()])
            .expect("seed tracks");

        let mut added = sample_track("added");
        added.id = "/tmp/folder/added.mp3".to_string();
        added.file_path = added.id.clone();
        let result = db
            .reconcile_folder_scan(ScanReconcileRequest {
                folder_path: "/tmp/folder".to_string(),
                discovered_paths: vec![unchanged.file_path.clone(), added.file_path.clone()],
                tracks: vec![unchanged.clone(), added.clone()],
                traversal_complete: true,
                errors: Vec::new(),
            })
            .expect("reconcile complete scan");

        assert_eq!(result.status, "complete");
        assert_eq!(result.discovered_count, 2);
        assert_eq!(result.added_count, 1);
        assert_eq!(result.updated_count, 0);
        assert_eq!(result.unchanged_count, 1);
        assert_eq!(result.missing_count, 1);
        assert_eq!(result.preserved_count, 0);
        let stored = db
            .get_tracks_by_ids(&[
                unchanged.id.clone(),
                missing.id.clone(),
                outside.id.clone(),
                added.id.clone(),
            ])
            .expect("read reconciled tracks");
        assert!(stored.iter().any(|track| track.id == unchanged.id));
        assert!(stored.iter().any(|track| track.id == added.id));
        assert!(stored.iter().any(|track| track.id == outside.id));
        assert!(!stored.iter().any(|track| track.id == missing.id));
    }

    #[test]
    fn migrate_v4_backfills_snapshots_and_allows_missing_references() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(
            r#"
            CREATE TABLE tracks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                year INTEGER,
                duration REAL NOT NULL,
                file_path TEXT UNIQUE NOT NULL,
                has_cover_art INTEGER NOT NULL DEFAULT 0,
                cover_art_hash TEXT,
                blurhash TEXT,
                date_added INTEGER NOT NULL,
                play_count INTEGER NOT NULL DEFAULT 0,
                last_played INTEGER,
                rating INTEGER
            );
            CREATE TABLE playlists (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                playlist_type TEXT NOT NULL DEFAULT 'manual',
                folder_path TEXT,
                smart_rules TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE playlist_tracks (
                playlist_id TEXT NOT NULL,
                track_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                added_at INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, track_id),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );
            "#,
        )
        .expect("seed v3-ish schema");

        conn.execute(
            "INSERT INTO tracks (id, title, artist, album, year, duration, file_path, has_cover_art, cover_art_hash, date_added, play_count, last_played, rating)
             VALUES (?1, ?2, ?3, ?4, NULL, 180, ?5, 0, NULL, 1, 0, NULL, NULL)",
            params!["trk_1", "Track One", "Artist One", "Album One", "/tmp/one.mp3"],
        )
        .expect("insert track");
        conn.execute(
            "INSERT INTO playlists (id, name, playlist_type, folder_path, smart_rules, created_at, updated_at)
             VALUES (?1, ?2, 'manual', NULL, NULL, 1, 1)",
            params!["pl_old", "Legacy"],
        )
        .expect("insert playlist");
        conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?1, ?2, 0, 1)",
            params!["pl_old", "trk_1"],
        )
        .expect("insert playlist membership");

        let db = Database {
            conn: Mutex::new(conn),
        };
        {
            let conn = db.conn.lock();
            db.migrate_v4(&conn).expect("run v4 migration");
        }

        let entries = db
            .get_playlist_track_entries("pl_old")
            .expect("read migrated entries");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].snapshot_title.as_deref(), Some("Track One"));
        assert_eq!(entries[0].snapshot_artist.as_deref(), Some("Artist One"));
        assert_eq!(entries[0].snapshot_album.as_deref(), Some("Album One"));

        // v4 removes track FK so unavailable references can be preserved.
        let conn = db.conn.lock();
        conn.execute(
            "INSERT INTO playlist_tracks (
                playlist_id, track_id, position, added_at,
                snapshot_title, snapshot_artist, snapshot_album, snapshot_duration,
                snapshot_file_path, snapshot_has_cover_art, snapshot_cover_art_hash
             ) VALUES (?1, ?2, 1, 1, ?3, NULL, NULL, NULL, NULL, 0, NULL)",
            params!["pl_old", "missing_ref", "Missing Snapshot"],
        )
        .expect("insert missing reference");
    }

    #[test]
    fn pinning_playlist_updates_state_and_sort_order() {
        let db = test_db();

        let mut later = sample_playlist("pl_b");
        later.name = "B".to_string();
        later.updated_at += 100;

        let mut earlier = sample_playlist("pl_a");
        earlier.name = "A".to_string();

        db.create_playlist(&later).expect("create later playlist");
        db.create_playlist(&earlier)
            .expect("create earlier playlist");

        let now = now_millis_i64_or_default();
        db.set_playlist_pinned("pl_a", true, Some(now), now)
            .expect("pin playlist");

        let playlists = db.get_all_playlists().expect("load playlists");
        assert_eq!(playlists[0].id, "pl_a");
        assert!(playlists[0].is_pinned);
        assert_eq!(playlists[0].pinned_at, Some(now));
    }

    #[test]
    fn smart_shuffle_fetches_requested_tracks_in_batch() {
        let db = test_db();
        db.upsert_tracks_batch(&[sample_track("a"), sample_track("b"), sample_track("c")])
            .expect("seed tracks");

        let result = db
            .get_smart_shuffle_queue(vec!["a".to_string(), "b".to_string(), "c".to_string()])
            .expect("smart shuffle");

        assert_eq!(result.len(), 3);
        assert!(result.contains(&"a".to_string()));
        assert!(result.contains(&"b".to_string()));
        assert!(result.contains(&"c".to_string()));
    }

    #[test]
    fn track_path_pages_return_only_requested_window() {
        let db = test_db();
        db.upsert_tracks_batch(&[sample_track("a"), sample_track("b"), sample_track("c")])
            .expect("seed tracks");

        let page = db.get_track_paths_page(1, 1).expect("track path page");

        assert_eq!(page.len(), 1);
        assert_eq!(page[0].id, "b");
        assert_eq!(page[0].file_path, "/tmp/b.mp3");
    }

    #[test]
    fn folder_track_ids_are_sorted_and_do_not_include_siblings() {
        let db = test_db();
        let mut second = sample_track("folder-second");
        second.id = "/music/album/02.mp3".to_string();
        second.file_path = second.id.clone();
        let mut first = sample_track("folder-first");
        first.id = "/music/album/01.mp3".to_string();
        first.file_path = first.id.clone();
        let mut sibling = sample_track("folder-sibling");
        sibling.id = "/music/album-live/01.mp3".to_string();
        sibling.file_path = sibling.id.clone();
        db.upsert_tracks_batch(&[second, sibling, first])
            .expect("seed folder tracks");

        let ids = db
            .get_track_ids_by_folder("/music/album")
            .expect("read folder track IDs");

        assert_eq!(
            ids,
            vec![
                "/music/album/01.mp3".to_string(),
                "/music/album/02.mp3".to_string()
            ]
        );
    }

    #[test]
    fn album_and_artist_aggregates_cover_the_full_library() {
        let db = test_db();
        let mut first = sample_track("aggregate-a");
        first.artist = "Track Artist".to_string();
        first.album_artist = Some("Album Artist".to_string());
        first.album = "Shared Album".to_string();
        let mut second = sample_track("aggregate-b");
        second.artist = "Track Artist".to_string();
        second.album_artist = Some("Album Artist".to_string());
        second.album = "Shared Album".to_string();
        second.has_cover_art = true;
        second.cover_art_hash = Some("b".repeat(64));
        let mut third = sample_track("aggregate-c");
        third.artist = "Other Artist".to_string();
        third.album = "Other Album".to_string();
        db.upsert_tracks_batch(&[first, second, third])
            .expect("seed aggregate tracks");

        let albums = db.get_album_aggregates().expect("read album aggregates");
        let shared_album = albums
            .iter()
            .find(|album| album.album == "Shared Album")
            .expect("shared album aggregate");
        assert_eq!(shared_album.artist, "Album Artist");
        assert_eq!(shared_album.track_count, 2);
        assert!(shared_album.representative.has_cover_art);

        let artists = db.get_artist_aggregates().expect("read artist aggregates");
        let track_artist = artists
            .iter()
            .find(|artist| artist.artist == "Track Artist")
            .expect("track artist aggregate");
        assert_eq!(track_artist.track_count, 2);
        assert!(track_artist.representative.has_cover_art);
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_path_normalization_preserves_backslashes() {
        let path = "/tmp/artist\\live/song.mp3";
        assert_eq!(Database::normalize_path(path), path);
    }

    #[test]
    fn rebase_track_paths_preserves_track_and_playlist_identity() {
        let db = test_db();
        let old_path = "/missing/music/album/song.mp3";
        let new_path = "/restored/music/album/song.mp3";
        let mut track = sample_track("rebase");
        track.id = old_path.to_string();
        track.file_path = old_path.to_string();
        track.rating = Some(4);
        track.play_count = 12;
        db.upsert_tracks_batch(std::slice::from_ref(&track))
            .expect("seed track");
        db.create_playlist(&sample_playlist("rebase-playlist"))
            .expect("create playlist");
        db.add_tracks_to_playlist("rebase-playlist", &[old_path.to_string()])
            .expect("add track");

        let count = db
            .rebase_track_paths("/missing/music", "/restored/music")
            .expect("rebase source");

        assert_eq!(count, 1);
        let updated = db
            .get_tracks_by_ids(&[new_path.to_string()])
            .expect("read updated track");
        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].rating, Some(4));
        assert_eq!(updated[0].play_count, 12);
        let entries = db
            .get_playlist_track_entries("rebase-playlist")
            .expect("read playlist");
        assert_eq!(entries[0].track_id, new_path);
        assert_eq!(entries[0].snapshot_file_path.as_deref(), Some(new_path));
    }

    #[cfg(windows)]
    #[test]
    fn cleanup_duplicates_and_normalize_merges_path_variants() {
        let db = test_db();
        let now = now_millis_i64_or_default();
        let backslash_path = r"C:\music\song.mp3";
        let slash_path = "C:/music/song.mp3";

        db.create_playlist(&sample_playlist("pl_cleanup"))
            .expect("create playlist");

        {
            let conn = db.conn.lock();
            conn.execute(
                "INSERT INTO tracks (id, title, artist, album, year, duration, file_path, has_cover_art, cover_art_hash, date_added, play_count, last_played, rating)
                 VALUES (?1, ?2, ?3, ?4, NULL, 180, ?5, 0, NULL, ?6, 0, NULL, NULL)",
                params![backslash_path, "Backslash", "Artist", "Album", backslash_path, now],
            )
            .expect("insert backslash track");
            conn.execute(
                "INSERT INTO tracks (id, title, artist, album, year, duration, file_path, has_cover_art, cover_art_hash, date_added, play_count, last_played, rating)
                 VALUES (?1, ?2, ?3, ?4, NULL, 180, ?5, 0, NULL, ?6, 0, NULL, NULL)",
                params![slash_path, "Slash", "Artist", "Album", slash_path, now + 1],
            )
            .expect("insert slash track");
            conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at, snapshot_file_path) VALUES (?1, ?2, 0, ?3, ?4)",
                params!["pl_cleanup", backslash_path, now, backslash_path],
            )
            .expect("insert backslash playlist track");
            conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at, snapshot_file_path) VALUES (?1, ?2, 1, ?3, ?4)",
                params!["pl_cleanup", slash_path, now + 1, slash_path],
            )
            .expect("insert slash playlist track");
            conn.execute(
                "INSERT OR REPLACE INTO lyrics_index (track_id, lyrics_path, lyrics_mtime, content) VALUES (?1, ?2, 1, 'line')",
                params![backslash_path, r"C:\music\song.lrc"],
            )
            .expect("insert backslash lyrics index");
        }

        db.cleanup_duplicates_and_normalize()
            .expect("cleanup_duplicates_and_normalize");

        let tracks = db.get_all_tracks().expect("read tracks");
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].id, slash_path);
        assert_eq!(tracks[0].file_path, slash_path);

        let playlist_entries = db
            .get_playlist_track_entries("pl_cleanup")
            .expect("read playlist entries");
        assert_eq!(playlist_entries.len(), 1);
        assert_eq!(playlist_entries[0].track_id, slash_path);
        assert_eq!(
            playlist_entries[0].snapshot_file_path.as_deref(),
            Some(slash_path)
        );

        let lyrics_entries = db.get_lyrics_index_meta().expect("read lyrics index");
        assert_eq!(lyrics_entries.len(), 1);
        assert_eq!(lyrics_entries[0].track_id, slash_path);
        assert_eq!(lyrics_entries[0].lyrics_path, "C:/music/song.lrc");
    }
}
