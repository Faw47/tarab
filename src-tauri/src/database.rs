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

const CURRENT_SCHEMA_VERSION: i32 = 12;
const PLAYLIST_MUTATION_RESULT_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1_000;
const PATH_NORMALIZATION_CLEANUP_KEY: &str = "path-normalization-cleanup-v1";
const DB_GET_ALL_TRACKS_HARD_LIMIT: i64 = 50_000;

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
    #[serde(default)]
    pub genre: Option<String>,
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
pub struct DbTrackAggregateRepresentative {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub year: Option<i32>,
    pub duration: f64,
    pub file_path: String,
    pub has_cover_art: bool,
    pub cover_art_hash: Option<String>,
    pub blurhash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbShuffleQueueTrack {
    pub id: String,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbAlbumAggregate {
    pub album: String,
    pub artist: String,
    pub track_count: usize,
    pub representative: DbTrackAggregateRepresentative,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbArtistAggregate {
    pub artist: String,
    pub track_count: usize,
    pub representative: DbTrackAggregateRepresentative,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum TrackPageCursorValue {
    Text(String),
    Number(f64),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackPageCursor {
    pub id: String,
    pub value: TrackPageCursorValue,
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
                    track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre
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
                    track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre
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

    pub fn get_queue_track_references(
        &self,
        ids: &[String],
    ) -> SqliteResult<Vec<DbShuffleQueueTrack>> {
        let conn = self.conn.lock();
        let mut by_id = std::collections::HashMap::with_capacity(ids.len());

        for chunk in ids.chunks(900) {
            if chunk.is_empty() {
                continue;
            }
            let placeholders = (0..chunk.len())
                .map(|index| format!("?{}", index + 1))
                .collect::<Vec<_>>()
                .join(", ");
            let query = format!("SELECT id, duration FROM tracks WHERE id IN ({placeholders})");
            let mut statement = conn.prepare(&query)?;
            let rows = statement.query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                Ok(DbShuffleQueueTrack {
                    id: row.get(0)?,
                    duration: row.get(1)?,
                })
            })?;
            let references = rows.collect::<SqliteResult<Vec<_>>>()?;
            for reference in references {
                by_id.insert(reference.id.clone(), reference);
            }
        }

        Ok(ids.iter().filter_map(|id| by_id.get(id).cloned()).collect())
    }

    pub fn get_shuffle_all_queue(
        &self,
        smart_shuffle: bool,
    ) -> SqliteResult<Vec<DbShuffleQueueTrack>> {
        let tracks = {
            let conn = self.conn.lock();
            let query = if smart_shuffle {
                "SELECT id, duration FROM tracks ORDER BY id"
            } else {
                "SELECT id, duration FROM tracks ORDER BY random()"
            };
            let mut statement = conn.prepare(query)?;
            let rows = statement.query_map([], |row| {
                Ok(DbShuffleQueueTrack {
                    id: row.get(0)?,
                    duration: row.get(1)?,
                })
            })?;
            rows.collect::<SqliteResult<Vec<_>>>()?
        };

        if !smart_shuffle || tracks.is_empty() {
            return Ok(tracks);
        }

        let ordered_ids =
            self.get_smart_shuffle_queue(tracks.iter().map(|track| track.id.clone()).collect())?;
        let mut by_id = tracks
            .into_iter()
            .map(|track| (track.id.clone(), track))
            .collect::<std::collections::HashMap<_, _>>();
        let mut ordered = Vec::with_capacity(by_id.len());
        for id in ordered_ids {
            if let Some(track) = by_id.remove(&id) {
                ordered.push(track);
            }
        }
        ordered.extend(by_id.into_values());
        Ok(ordered)
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
        let ordered: Vec<(String, String)> = ranked
            .into_iter()
            .map(|(id, artist, _)| (id, artist))
            .collect();

        let ordered = Self::interleave_smart_shuffle_by_artist(ordered);
        Ok(ordered.into_iter().map(|(id, _)| id).collect())
    }

    fn interleave_smart_shuffle_by_artist(ordered: Vec<(String, String)>) -> Vec<(String, String)> {
        if ordered.len() < 2 {
            return ordered;
        }

        // Preserve each artist's weighted rank, while choosing the best-ranked artist whose
        // bucket has not appeared in the last three slots. Only one head per artist is available,
        // so at most three heads can be skipped before finding an eligible bucket.
        let mut artist_indices = std::collections::HashMap::<String, usize>::new();
        let mut artist_buckets = Vec::<Vec<usize>>::new();
        for (rank, (_, artist)) in ordered.iter().enumerate() {
            let bucket_index = match artist_indices.get(artist) {
                Some(index) => *index,
                None => {
                    let index = artist_buckets.len();
                    artist_buckets.push(Vec::new());
                    artist_indices.insert(artist.clone(), index);
                    index
                }
            };
            artist_buckets[bucket_index].push(rank);
        }

        let mut available = std::collections::BTreeSet::<(usize, usize)>::new();
        for (artist_index, bucket) in artist_buckets.iter().enumerate() {
            if let Some(rank) = bucket.first() {
                available.insert((*rank, artist_index));
            }
        }

        let mut bucket_cursors = vec![0; artist_buckets.len()];
        let mut recent_artists = std::collections::VecDeque::with_capacity(3);
        let mut interleaved = Vec::with_capacity(ordered.len());

        while !available.is_empty() {
            let next = available
                .iter()
                .find(|(_, artist_index)| !recent_artists.contains(artist_index))
                .copied()
                .or_else(|| available.iter().next().copied());
            let Some((rank, artist_index)) = next else {
                break;
            };

            available.remove(&(rank, artist_index));
            let (id, artist) = &ordered[rank];
            interleaved.push((id.clone(), artist.clone()));

            bucket_cursors[artist_index] += 1;
            if let Some(next_rank) = artist_buckets[artist_index].get(bucket_cursors[artist_index])
            {
                available.insert((*next_rank, artist_index));
            }

            if recent_artists.len() == 3 {
                let _ = recent_artists.pop_front();
            }
            recent_artists.push_back(artist_index);
        }

        interleaved
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
    let legacy_dir = base_dir.join(LEGACY_STORAGE_DIRECTORY);

    // A database in the new location is authoritative. The app directory alone is not:
    // Linux logging may create it before database initialization.
    if app_dir.join("library.db").is_file() {
        return Ok(app_dir);
    }

    if !app_dir.exists() && legacy_dir.exists() {
        std::fs::rename(&legacy_dir, &app_dir).map_err(|error| {
            format!(
                "Failed to migrate legacy Tarab data from {} to {}: {}",
                legacy_dir.display(),
                app_dir.display(),
                error
            )
        })?;
        return Ok(app_dir);
    }

    std::fs::create_dir_all(&app_dir).map_err(|error| {
        format!(
            "Failed to create Tarab data directory {}: {}",
            app_dir.display(),
            error
        )
    })?;

    if legacy_dir.exists() {
        merge_legacy_directory(&legacy_dir, &app_dir)?;
    }

    Ok(app_dir)
}

fn merge_legacy_directory(source_dir: &Path, destination_dir: &Path) -> Result<(), String> {
    let mut entries = std::fs::read_dir(source_dir)
        .map_err(|error| {
            format!(
                "Failed to read legacy Tarab data directory {}: {}",
                source_dir.display(),
                error
            )
        })?
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|error| {
            format!(
                "Failed to enumerate legacy Tarab data directory {}: {}",
                source_dir.display(),
                error
            )
        })?;

    // Move the database last so a failed merge cannot expose a partially migrated database.
    entries.sort_by_key(|entry| {
        let name = entry.file_name();
        (name == "library.db", name)
    });

    for entry in entries {
        let source = entry.path();
        let destination = destination_dir.join(entry.file_name());
        let source_type = std::fs::symlink_metadata(&source)
            .map_err(|error| format!("Failed to inspect {}: {}", source.display(), error))?
            .file_type();
        let destination_type = match std::fs::symlink_metadata(&destination) {
            Ok(metadata) => Some(metadata.file_type()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(format!(
                    "Failed to inspect migration destination {}: {}",
                    destination.display(),
                    error
                ));
            }
        };

        if source_type.is_dir() {
            match destination_type {
                Some(file_type) if file_type.is_dir() => {
                    merge_legacy_directory(&source, &destination)?;
                }
                Some(_) => {
                    return Err(format!(
                        "Cannot migrate {} because {} already exists and is not a directory",
                        source.display(),
                        destination.display()
                    ));
                }
                None => {
                    std::fs::rename(&source, &destination).map_err(|error| {
                        format!(
                            "Failed to migrate legacy Tarab data from {} to {}: {}",
                            source.display(),
                            destination.display(),
                            error
                        )
                    })?;
                }
            }
        } else {
            if destination_type.is_some() {
                return Err(format!(
                    "Cannot migrate {} because {} already exists",
                    source.display(),
                    destination.display()
                ));
            }
            std::fs::rename(&source, &destination).map_err(|error| {
                format!(
                    "Failed to migrate legacy Tarab data from {} to {}: {}",
                    source.display(),
                    destination.display(),
                    error
                )
            })?;
        }
    }

    std::fs::remove_dir(source_dir).map_err(|error| {
        format!(
            "Failed to remove migrated legacy Tarab data directory {}: {}",
            source_dir.display(),
            error
        )
    })
}

pub(crate) fn get_database_path() -> Result<PathBuf, String> {
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
    cursor: Option<TrackPageCursor>,
    limit: u32,
    sort_by: String,
    sort_order: String,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<DbTrack>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_tracks_paginated(cursor.as_ref(), limit, &sort_by, &sort_order))
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
pub async fn db_get_shuffle_all_queue(
    smart_shuffle: bool,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<DbShuffleQueueTrack>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_shuffle_all_queue(smart_shuffle))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn db_get_queue_track_references(
    ids: Vec<String>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<DbShuffleQueueTrack>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_queue_track_references(&ids))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
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
    fn legacy_database_migrates_when_app_directory_already_exists() {
        let base_dir = std::env::temp_dir().join(format!(
            "tarab-storage-migration-existing-app-{}",
            now_millis_i64_or_default()
        ));
        let app_dir = base_dir.join(APP_STORAGE_DIRECTORY);
        let logs_dir = app_dir.join("logs");
        let legacy_dir = base_dir.join(LEGACY_STORAGE_DIRECTORY);
        std::fs::create_dir_all(&logs_dir).expect("create preexisting app logs");
        std::fs::write(logs_dir.join("plugin.log"), b"log").expect("seed plugin log");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy directory");
        std::fs::write(legacy_dir.join("library.db"), b"legacy").expect("seed legacy database");

        let migrated = prepare_app_directory(&base_dir).expect("migrate legacy database");

        assert_eq!(migrated, app_dir);
        assert_eq!(
            std::fs::read(migrated.join("library.db")).expect("read migrated database"),
            b"legacy"
        );
        assert_eq!(
            std::fs::read(logs_dir.join("plugin.log")).expect("read plugin log"),
            b"log"
        );
        assert!(!legacy_dir.exists());

        let _ = std::fs::remove_dir_all(base_dir);
    }

    #[test]
    fn existing_database_is_authoritative_over_legacy_database() {
        let base_dir = std::env::temp_dir().join(format!(
            "tarab-storage-migration-authoritative-{}",
            now_millis_i64_or_default()
        ));
        let app_dir = base_dir.join(APP_STORAGE_DIRECTORY);
        let legacy_dir = base_dir.join(LEGACY_STORAGE_DIRECTORY);
        std::fs::create_dir_all(&app_dir).expect("create app directory");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy directory");
        std::fs::write(app_dir.join("library.db"), b"current").expect("seed current database");
        std::fs::write(legacy_dir.join("library.db"), b"legacy").expect("seed legacy database");

        let migrated = prepare_app_directory(&base_dir).expect("keep current database");

        assert_eq!(migrated, app_dir);
        assert_eq!(
            std::fs::read(migrated.join("library.db")).expect("read current database"),
            b"current"
        );
        assert_eq!(
            std::fs::read(legacy_dir.join("library.db")).expect("read legacy database"),
            b"legacy"
        );

        let _ = std::fs::remove_dir_all(base_dir);
    }

    #[test]
    fn legacy_migration_preserves_conflicting_files_and_reports_error() {
        let base_dir = std::env::temp_dir().join(format!(
            "tarab-storage-migration-conflict-{}",
            now_millis_i64_or_default()
        ));
        let app_dir = base_dir.join(APP_STORAGE_DIRECTORY);
        let legacy_dir = base_dir.join(LEGACY_STORAGE_DIRECTORY);
        std::fs::create_dir_all(&app_dir).expect("create app directory");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy directory");
        std::fs::write(app_dir.join("settings.json"), b"current").expect("seed current settings");
        std::fs::write(legacy_dir.join("settings.json"), b"legacy").expect("seed legacy settings");
        std::fs::write(legacy_dir.join("library.db"), b"legacy").expect("seed legacy database");

        let result = prepare_app_directory(&base_dir);

        assert!(result.is_err());
        assert_eq!(
            std::fs::read(app_dir.join("settings.json")).expect("read current settings"),
            b"current"
        );
        assert_eq!(
            std::fs::read(legacy_dir.join("settings.json")).expect("read legacy settings"),
            b"legacy"
        );
        assert_eq!(
            std::fs::read(legacy_dir.join("library.db")).expect("read legacy database"),
            b"legacy"
        );

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
            genre: None,
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
            genre: None,
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
    fn schema_migration_adds_genre_for_existing_tracks() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(
            "CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
             INSERT INTO schema_version (version) VALUES (11);
             CREATE TABLE tracks (
                 id TEXT PRIMARY KEY,
                 title TEXT NOT NULL,
                 file_path TEXT NOT NULL
             );
             INSERT INTO tracks (id, title, file_path)
                 VALUES ('legacy-track', 'Legacy track', '/music/legacy.mp3');
             CREATE TABLE lyrics_fts (content TEXT);",
        )
        .expect("create schema-v11 database");
        let db = Database {
            conn: Mutex::new(conn),
        };

        db.run_migrations().expect("apply pending migrations");

        let conn = db.conn.lock();
        let (title, genre): (String, Option<String>) = conn
            .query_row(
                "SELECT title, genre FROM tracks WHERE id = 'legacy-track'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read migrated track");
        assert_eq!(title, "Legacy track");
        assert_eq!(genre, None);

        let version: i32 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .expect("read schema version");
        assert_eq!(version, 12);
    }

    #[test]
    fn db_track_json_round_trips_genre() {
        let mut encoded = serde_json::to_value(sample_track("genre-json")).expect("encode track");
        encoded["genre"] = serde_json::json!("Classical");

        let decoded: DbTrack = serde_json::from_value(encoded).expect("decode track with genre");

        assert_eq!(
            serde_json::to_value(decoded).expect("encode decoded track")["genre"],
            "Classical"
        );
    }

    #[test]
    fn album_and_artist_aggregate_payloads_use_track_summaries() {
        let db = test_db();
        let mut track = sample_track("aggregate-payload");
        track.has_cover_art = true;
        track.cover_art_hash = Some("aggregate-cover".to_string());
        track.blurhash = Some("aggregate-blurhash".to_string());
        db.upsert_tracks_batch(&[track])
            .expect("seed aggregate track");

        let album = db
            .get_album_aggregates()
            .expect("load album aggregates")
            .pop()
            .expect("album aggregate");
        let artist = db
            .get_artist_aggregates()
            .expect("load artist aggregates")
            .pop()
            .expect("artist aggregate");

        for aggregate in [
            serde_json::to_value(album).expect("serialize album aggregate"),
            serde_json::to_value(artist).expect("serialize artist aggregate"),
        ] {
            let representative = aggregate["representative"]
                .as_object()
                .expect("representative object");
            for field in [
                "trackNumber",
                "discNumber",
                "dateAdded",
                "playCount",
                "lastPlayed",
                "rating",
                "fileFormat",
                "bitrate",
                "sampleRate",
                "fileSize",
                "albumArtist",
            ] {
                assert!(
                    !representative.contains_key(field),
                    "aggregate representative should omit full-track field {field}"
                );
            }
            for field in [
                "id",
                "title",
                "artist",
                "album",
                "hasCoverArt",
                "coverArtHash",
                "blurhash",
                "year",
                "duration",
                "filePath",
            ] {
                assert!(
                    representative.contains_key(field),
                    "aggregate representative needs card field {field}"
                );
            }
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
        assert_eq!(
            db.get_track_by_public_id(&public_id.to_ascii_uppercase())
                .expect("resolve uppercase public id")
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
    fn public_track_id_lookup_uses_an_index() {
        let db = test_db();
        let conn = db.conn.lock();
        let mut statement = conn
            .prepare("EXPLAIN QUERY PLAN SELECT id FROM tracks WHERE public_id = ?1")
            .expect("prepare public ID lookup plan");
        let details = statement
            .query_map(rusqlite::params!["c".repeat(64)], |row| {
                row.get::<_, String>(3)
            })
            .expect("query public ID lookup plan")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect public ID lookup plan");

        assert!(
            details
                .iter()
                .any(|detail| detail.contains("idx_tracks_public_id")),
            "public ID lookup should use its index: {details:?}"
        );
    }

    #[test]
    fn folder_scan_upsert_stores_the_public_track_id() {
        let db = test_db();
        let mut track = sample_track("reconciled-public");
        track.id = track.file_path.clone();
        let file_path = track.file_path.clone();

        db.reconcile_folder_scan(ScanReconcileRequest {
            folder_path: "/tmp".to_string(),
            discovered_paths: vec![file_path.clone()],
            tracks: vec![track],
            traversal_complete: true,
            errors: Vec::new(),
        })
        .expect("reconcile track");

        let resolved = db
            .get_track_by_public_id(&Database::public_track_id(&file_path))
            .expect("resolve reconciled track")
            .expect("reconciled track exists");
        assert_eq!(resolved.file_path, file_path);
    }

    #[test]
    fn public_track_id_follows_renames_and_folder_rebases() {
        let db = test_db();
        let track = sample_track("public-path");
        db.upsert_tracks_batch(std::slice::from_ref(&track))
            .expect("seed track");

        let original_id = Database::public_track_id(&track.file_path);
        let renamed_path = "/tmp/public-path-renamed.mp3";
        db.rename_track_path(&track.file_path, renamed_path)
            .expect("rename track path");
        assert!(db
            .get_track_by_public_id(&original_id)
            .expect("lookup old path")
            .is_none());

        let renamed_id = Database::public_track_id(renamed_path);
        assert_eq!(
            db.get_track_by_public_id(&renamed_id)
                .expect("lookup renamed path")
                .expect("renamed track")
                .file_path,
            renamed_path
        );

        db.rebase_track_paths("/tmp", "/archive")
            .expect("rebase track paths");
        let rebased_path = "/archive/public-path-renamed.mp3";
        assert!(db
            .get_track_by_public_id(&renamed_id)
            .expect("lookup pre-rebase path")
            .is_none());
        assert_eq!(
            db.get_track_by_public_id(&Database::public_track_id(rebased_path))
                .expect("lookup rebased path")
                .expect("rebased track")
                .file_path,
            rebased_path
        );
    }

    #[test]
    fn migration_v11_backfills_and_indexes_existing_public_track_ids() {
        let db = test_db();
        let conn = Connection::open_in_memory().expect("open legacy database");
        conn.execute_batch("CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT NOT NULL);")
            .expect("create legacy tracks table");
        let file_path = "/tmp/legacy-public-track.mp3";
        conn.execute(
            "INSERT INTO tracks (id, file_path) VALUES (?1, ?2)",
            params!["legacy-track", file_path],
        )
        .expect("insert legacy track");

        db.migrate_v11(&conn).expect("migrate public track IDs");

        let stored_id: String = conn
            .query_row(
                "SELECT public_id FROM tracks WHERE id = ?1",
                rusqlite::params!["legacy-track"],
                |row| row.get(0),
            )
            .expect("read backfilled public ID");
        assert_eq!(stored_id, Database::public_track_id(file_path));
        let index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index' AND name = 'idx_tracks_public_id'",
                [],
                |row| row.get(0),
            )
            .expect("verify public ID index");
        assert_eq!(index_count, 1);
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
    fn reconcile_folder_scan_does_not_delete_tracks_from_ascii_case_distinct_folder() {
        let db = test_db();
        let mut scanned_folder_track = sample_track("scanned-folder");
        scanned_folder_track.id = "/Music/Rock/missing.mp3".to_string();
        scanned_folder_track.file_path = scanned_folder_track.id.clone();
        let mut case_distinct_track = sample_track("case-distinct-folder");
        case_distinct_track.id = "/music/rock/kept.mp3".to_string();
        case_distinct_track.file_path = case_distinct_track.id.clone();
        db.upsert_tracks_batch(&[scanned_folder_track.clone(), case_distinct_track.clone()])
            .expect("seed tracks");

        let result = db
            .reconcile_folder_scan(ScanReconcileRequest {
                folder_path: "/Music/Rock".to_string(),
                discovered_paths: Vec::new(),
                tracks: Vec::new(),
                traversal_complete: true,
                errors: Vec::new(),
            })
            .expect("reconcile case-sensitive folder");

        assert_eq!(result.missing_count, 1);
        let stored = db
            .get_tracks_by_ids(&[scanned_folder_track.id, case_distinct_track.id.clone()])
            .expect("read reconciled tracks");
        let case_distinct_track_is_kept = stored
            .iter()
            .any(|track| track.id == case_distinct_track.id);
        assert!(case_distinct_track_is_kept);
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
    fn paginated_tracks_sort_case_insensitively_with_a_stable_tiebreaker() {
        // Regression for LD-02/LD-15: pages ordered by a non-unique column could repeat or skip
        // rows at page boundaries, and BINARY ordering put "Zebra" before "apple".
        let db = test_db();
        let titles = ["beta", "Same", "Alpha", "same", "Same", "zebra", "Same"];
        let tracks: Vec<DbTrack> = titles
            .iter()
            .enumerate()
            .map(|(index, title)| {
                let mut track = sample_track(&format!("p{index}"));
                track.title = title.to_string();
                track
            })
            .collect();
        db.upsert_tracks_batch(&tracks).expect("seed tracks");

        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let rows = db
                .get_tracks_paginated(cursor.as_ref(), 2, "title", "asc")
                .expect("page");
            if rows.is_empty() {
                break;
            }
            cursor = rows.last().map(|track| TrackPageCursor {
                id: track.id.clone(),
                value: TrackPageCursorValue::Text(track.title.clone()),
            });
            seen.extend(rows.into_iter().map(|track| (track.title, track.id)));
        }

        let ids: std::collections::HashSet<&String> = seen.iter().map(|(_, id)| id).collect();
        assert_eq!(seen.len(), titles.len(), "every row appears exactly once");
        assert_eq!(ids.len(), titles.len());
        let order: Vec<String> = seen.iter().map(|(title, _)| title.to_lowercase()).collect();
        let mut sorted = order.clone();
        sorted.sort();
        assert_eq!(order, sorted, "titles are ordered case-insensitively");
        assert_eq!(seen.first().map(|(title, _)| title.as_str()), Some("Alpha"));
    }

    #[test]
    fn paginated_tracks_keyset_pages_descending_with_stable_ties() {
        let db = test_db();
        let titles = ["Beta", "same", "Same", "Alpha"];
        let tracks: Vec<DbTrack> = titles
            .iter()
            .enumerate()
            .map(|(index, title)| {
                let mut track = sample_track(&format!("desc{index}"));
                track.title = title.to_string();
                track
            })
            .collect();
        db.upsert_tracks_batch(&tracks).expect("seed tracks");

        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let rows = db
                .get_tracks_paginated(cursor.as_ref(), 1, "title", "desc")
                .expect("page");
            if rows.is_empty() {
                break;
            }
            cursor = rows.last().map(|track| TrackPageCursor {
                id: track.id.clone(),
                value: TrackPageCursorValue::Text(track.title.clone()),
            });
            seen.extend(rows.into_iter().map(|track| (track.title, track.id)));
        }

        let mut expected: Vec<(String, String)> = tracks
            .iter()
            .map(|track| (track.title.clone(), track.id.clone()))
            .collect();
        expected.sort_by(|left, right| {
            right
                .0
                .to_lowercase()
                .cmp(&left.0.to_lowercase())
                .then_with(|| right.1.cmp(&left.1))
        });
        assert_eq!(seen, expected);
    }

    #[test]
    fn paginated_tracks_keyset_pages_numeric_values() {
        let db = test_db();
        let mut tracks = Vec::new();
        for (id, date_added) in [("recent", 30), ("oldest", 10), ("middle", 20)] {
            let mut track = sample_track(id);
            track.date_added = date_added;
            tracks.push(track);
        }
        db.upsert_tracks_batch(&tracks).expect("seed tracks");

        let mut seen = Vec::new();
        let mut cursor = None;
        loop {
            let rows = db
                .get_tracks_paginated(cursor.as_ref(), 1, "dateAdded", "asc")
                .expect("page");
            if rows.is_empty() {
                break;
            }
            cursor = rows.last().map(|track| TrackPageCursor {
                id: track.id.clone(),
                value: TrackPageCursorValue::Number(track.date_added as f64),
            });
            seen.extend(rows.into_iter().map(|track| track.id));
        }

        assert_eq!(
            seen,
            vec![
                "oldest".to_string(),
                "middle".to_string(),
                "recent".to_string()
            ]
        );
    }

    #[test]
    fn reconcile_folder_scan_rescan_of_large_folder_is_not_quadratic() {
        // Regression for PB-04: a rescan sends every track again, and counting preserved rows
        // used to scan the incoming list once per discovered path (O(n^2)) under the DB lock.
        let db = test_db();
        let tracks: Vec<DbTrack> = (0..20_000)
            .map(|index| {
                let mut track = sample_track(&format!("t{index}"));
                track.id = format!("/tmp/big/{index}.mp3");
                track.file_path = track.id.clone();
                track
            })
            .collect();
        db.upsert_tracks_batch(&tracks).expect("seed tracks");
        let discovered: Vec<String> = tracks.iter().map(|track| track.file_path.clone()).collect();

        let started = std::time::Instant::now();
        let result = db
            .reconcile_folder_scan(ScanReconcileRequest {
                folder_path: "/tmp/big".to_string(),
                discovered_paths: discovered,
                tracks,
                traversal_complete: true,
                errors: Vec::new(),
            })
            .expect("reconcile scan");
        let elapsed = started.elapsed();

        assert_eq!(result.unchanged_count, 20_000);
        assert_eq!(result.preserved_count, 0);
        assert!(
            elapsed < std::time::Duration::from_secs(8),
            "reconcile of 20k tracks took {elapsed:?}"
        );
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
    fn queue_track_references_preserve_order_and_duplicate_entries() {
        let db = test_db();
        db.upsert_tracks_batch(&[
            sample_track("queue-reference-a"),
            sample_track("queue-reference-b"),
        ])
        .expect("seed tracks");

        let requested = vec![
            "queue-reference-b".to_string(),
            "queue-reference-a".to_string(),
            "queue-reference-b".to_string(),
            "missing".to_string(),
        ];
        let references = db
            .get_queue_track_references(&requested)
            .expect("load queue references");

        assert_eq!(
            references
                .iter()
                .map(|track| track.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "queue-reference-b",
                "queue-reference-a",
                "queue-reference-b"
            ]
        );
        assert!(references.iter().all(|track| track.duration > 0.0));
    }

    #[test]
    fn shuffle_all_queue_returns_compact_references_for_every_track() {
        let db = test_db();
        db.upsert_tracks_batch(&[
            sample_track("shuffle-a"),
            sample_track("shuffle-b"),
            sample_track("shuffle-c"),
        ])
        .expect("seed tracks");

        let expected = ["shuffle-a", "shuffle-b", "shuffle-c"]
            .into_iter()
            .map(str::to_string)
            .collect::<std::collections::HashSet<_>>();
        for smart_shuffle in [false, true] {
            let queue = db
                .get_shuffle_all_queue(smart_shuffle)
                .expect("shuffle queue references");
            assert_eq!(queue.len(), expected.len());
            assert_eq!(
                queue
                    .iter()
                    .map(|track| track.id.clone())
                    .collect::<std::collections::HashSet<_>>(),
                expected
            );
            let serialized = serde_json::to_value(&queue[0]).expect("serialize queue reference");
            let reference = serialized.as_object().expect("queue reference object");
            assert_eq!(reference.len(), 2);
            assert!(reference.contains_key("id"));
            assert!(reference.contains_key("duration"));
        }
    }

    #[test]
    fn smart_shuffle_scales_for_a_large_single_artist_library() {
        const TRACK_COUNT: usize = 50_000;
        let db = test_db();
        let tracks = (0..TRACK_COUNT)
            .map(|index| {
                let mut track = sample_track(&format!("smart-shuffle-{index:05}"));
                track.artist = "One artist".to_string();
                track
            })
            .collect::<Vec<_>>();
        let ids = tracks.iter().map(|track| track.id.clone()).collect();

        db.upsert_tracks_batch(&tracks).expect("seed tracks");

        let started = std::time::Instant::now();
        let result = db.get_smart_shuffle_queue(ids).expect("smart shuffle");
        let elapsed = started.elapsed();

        assert_eq!(result.len(), TRACK_COUNT);
        assert!(
            elapsed < std::time::Duration::from_secs(8),
            "smart shuffle took {elapsed:?} for {TRACK_COUNT} tracks by one artist"
        );
    }

    #[test]
    fn smart_shuffle_interleaves_artist_buckets_when_alternatives_exist() {
        let ranked = [
            ("a-1", "A"),
            ("a-2", "A"),
            ("b-1", "B"),
            ("c-1", "C"),
            ("d-1", "D"),
        ]
        .into_iter()
        .map(|(id, artist)| (id.to_string(), artist.to_string()))
        .collect();

        let interleaved = Database::interleave_smart_shuffle_by_artist(ranked);
        let ids = interleaved
            .iter()
            .map(|(id, _)| id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["a-1", "b-1", "c-1", "d-1", "a-2"]);
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

        let first = db.get_track_paths_after(None, 1).expect("first page");
        let page = db
            .get_track_paths_after(Some(&first[0].id), 1)
            .expect("track path page");

        assert_eq!(first[0].id, "a");
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].id, "b");
        assert_eq!(page[0].file_path, "/tmp/b.mp3");
    }

    #[test]
    fn track_path_pages_walk_the_primary_key_without_sorting() {
        // Regression for AR-11: ORDER BY id COLLATE NOCASE with OFFSET sorted the whole table in
        // a temporary B-tree for every page (41 s for 100 pages at 100k tracks).
        let db = test_db();
        let conn = db.conn.lock();
        let plan_of = |sql: &str, args: &[&dyn rusqlite::ToSql]| -> String {
            conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("plan")
                .query_map(args, |row| row.get::<_, String>(3))
                .expect("query plan")
                .filter_map(Result::ok)
                .collect::<Vec<_>>()
                .join(" | ")
        };
        let first = plan_of(tracks::TRACK_PATHS_FIRST_SQL, &[&1]);
        let after = plan_of(tracks::TRACK_PATHS_AFTER_SQL, &[&"x", &1]);

        assert!(!first.contains("TEMP B-TREE"), "{first}");
        assert!(!after.contains("TEMP B-TREE"), "{after}");
        assert!(after.contains("SEARCH"), "{after}");
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

    #[test]
    fn migration_drops_the_redundant_file_path_index() {
        let db = test_db();
        let conn = db.conn.lock();
        let indexes = conn
            .prepare("PRAGMA index_list(tracks)")
            .expect("prepare index list")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("query index list")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect index list");

        assert!(
            !indexes.iter().any(|name| name == "idx_tracks_file_path"),
            "file_path UNIQUE already provides an index; redundant index remains: {indexes:?}"
        );
        assert!(
            indexes
                .iter()
                .any(|name| name == "idx_tracks_file_path_nocase"),
            "folder range queries need the case-insensitive path index: {indexes:?}"
        );
    }

    #[test]
    fn fts_update_trigger_only_targets_searchable_columns() {
        let db = test_db();
        let conn = db.conn.lock();
        let trigger_sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'tracks_au'",
                [],
                |row| row.get(0),
            )
            .expect("find FTS update trigger");

        assert!(
            trigger_sql
                .to_ascii_uppercase()
                .contains("AFTER UPDATE OF TITLE, ARTIST, ALBUM"),
            "play-count and rating updates should not rewrite FTS rows: {trigger_sql}"
        );
    }

    #[test]
    fn title_keyset_pages_use_an_ordered_index_without_a_temp_sort() {
        let db = test_db();
        let conn = db.conn.lock();
        let mut statement = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT id FROM tracks
                 WHERE (title COLLATE NOCASE, id) > (?1, ?2)
                 ORDER BY title COLLATE NOCASE ASC, id ASC
                 LIMIT ?3",
            )
            .expect("prepare title keyset query plan");
        let details = statement
            .query_map(rusqlite::params!["Alpha", "/tmp/alpha.mp3", 100], |row| {
                row.get::<_, String>(3)
            })
            .expect("query title keyset plan")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect title keyset plan");

        assert!(
            details
                .iter()
                .any(|detail| detail.contains("idx_tracks_title_id")),
            "title keyset should seek through idx_tracks_title_id: {details:?}"
        );
        assert!(
            !details
                .iter()
                .any(|detail| detail.contains("USE TEMP B-TREE")),
            "title keyset should not sort each page: {details:?}"
        );
    }

    #[test]
    fn folder_path_ranges_keep_literal_metacharacters_and_exclude_siblings() {
        let db = test_db();
        let mut inside = sample_track("inside-literal-folder");
        inside.id = "/music/100%_Jazz/01.flac".to_string();
        inside.file_path = inside.id.clone();
        let mut prefix_sibling = sample_track("prefix-sibling");
        prefix_sibling.id = "/music/100%_Jazz0/02.flac".to_string();
        prefix_sibling.file_path = prefix_sibling.id.clone();
        let mut wildcard_lookalike = sample_track("wildcard-lookalike");
        wildcard_lookalike.id = "/music/100X_Jazz/03.flac".to_string();
        wildcard_lookalike.file_path = wildcard_lookalike.id.clone();
        db.upsert_tracks_batch(&[
            inside.clone(),
            prefix_sibling.clone(),
            wildcard_lookalike.clone(),
        ])
        .expect("seed folder tracks");

        assert_eq!(
            db.get_track_ids_by_folder("/music/100%_Jazz")
                .expect("read folder track IDs"),
            vec![inside.id.clone()]
        );
        assert_eq!(
            db.delete_tracks_by_folder("/music/100%_Jazz")
                .expect("delete folder tracks"),
            1
        );
        let remaining = db
            .get_tracks_by_ids(&[prefix_sibling.id.clone(), wildcard_lookalike.id.clone()])
            .expect("read sibling tracks");
        assert_eq!(remaining.len(), 2);
    }

    #[test]
    fn folder_prefix_search_uses_an_index_instead_of_scanning_paths() {
        let db = test_db();
        let conn = db.conn.lock();
        let mut statement = conn
            .prepare(
                "EXPLAIN QUERY PLAN
                 SELECT file_path FROM tracks
                 WHERE file_path = ?1 COLLATE BINARY
                    OR (file_path >= ?2 COLLATE NOCASE AND file_path < ?3 COLLATE NOCASE)",
            )
            .expect("prepare folder range query plan");
        let details = statement
            .query_map(
                rusqlite::params!["/tmp/music/album", "/tmp/music/album/", "/tmp/music/album0"],
                |row| row.get::<_, String>(3),
            )
            .expect("query folder range plan")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect folder range plan");

        assert!(
            details
                .iter()
                .any(|detail| detail.contains("idx_tracks_file_path_nocase")),
            "folder prefix should use the case-insensitive path index: {details:?}"
        );
    }

    #[test]
    fn short_substring_search_does_not_run_the_like_fallback() {
        let db = test_db();
        let mut track = sample_track("short-search");
        track.title = "Black".to_string();
        db.upsert_tracks_batch(&[track]).expect("seed track");

        let results = db.search_tracks("la", 10).expect("search short substring");

        assert!(
            results.is_empty(),
            "two-character no-hit prefixes should not scan all text columns: {results:?}"
        );
    }
}
