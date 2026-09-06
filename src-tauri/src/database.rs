use parking_lot::Mutex;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::async_runtime::spawn_blocking;

use crate::file_ops::{ensure_existing_path_allowed, SharedLibraryRoots};
use crate::library::SharedLibraryScanControl;

mod aggregates;
mod lyrics;
mod migrations;
mod playlists;
mod tracks;

const CURRENT_SCHEMA_VERSION: i32 = 12;
const PATH_NORMALIZATION_CLEANUP_KEY: &str = "path-normalization-cleanup-v2";
const DB_GET_ALL_TRACKS_HARD_LIMIT: i64 = 50_000;

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
const APP_STORAGE_DIRECTORY: &str = "com.fawaz.tarab";
const LEGACY_STORAGE_DIRECTORY: &str = "music-player";
const LEGACY_STORAGE_MARKER: &str = ".legacy-storage-migration-v1.json";
const LEGACY_STORAGE_CONFLICT_BACKUP: &str = "music-player.legacy-conflict-v1";
const DATABASE_FILE: &str = "library.db";
const DATABASE_MOVE_ORDER: [&str; 4] = [
    "library.db-wal",
    "library.db-shm",
    "library.db-journal",
    DATABASE_FILE,
];

static STORAGE_MIGRATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

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
    #[serde(default)]
    pub genre: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrackPageCursor {
    pub revision: i64,
    pub last_id: String,
    pub sort_by: String,
    pub sort_order: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrackCursorPageStatus {
    Ready,
    RestartRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbTrackCursorPage {
    pub status: TrackCursorPageStatus,
    pub tracks: Vec<DbTrack>,
    pub next_cursor: Option<TrackPageCursor>,
    pub revision: i64,
    pub total_count: i64,
}

#[derive(Debug)]
pub struct TrackPathCursorPage {
    pub tracks: Vec<TrackPathRow>,
    pub next_cursor: Option<TrackPageCursor>,
    pub revision: i64,
    pub restart_required: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LyricsIndexSyncApply {
    Applied(usize),
    RestartRequired,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    fn normalize_path(path: &str) -> String {
        #[cfg(windows)]
        {
            let normalized = path.replace('\\', "/");
            if let Some(network_path) = normalized.strip_prefix("//?/UNC/") {
                format!("//{network_path}")
            } else {
                normalized
                    .strip_prefix("//?/")
                    .unwrap_or(&normalized)
                    .to_string()
            }
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

    #[cfg(test)]
    pub(crate) fn execute_batch_for_tests(&self, sql: &str) -> SqliteResult<()> {
        self.conn.lock().execute_batch(sql)
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
                    COUNT(DISTINCT artist COLLATE NOCASE),
                    (
                        SELECT COUNT(*)
                        FROM (
                            SELECT album, COALESCE(NULLIF(TRIM(album_artist), ''), artist)
                            FROM tracks
                            GROUP BY album COLLATE NOCASE, COALESCE(NULLIF(TRIM(album_artist), ''), artist) COLLATE NOCASE
                        )
                    ),
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

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LegacyStorageResolution {
    version: u8,
    policy: String,
    legacy_backup: Option<String>,
}

fn read_legacy_storage_marker(app_dir: &Path) -> Result<Option<LegacyStorageResolution>, String> {
    let marker_path = app_dir.join(LEGACY_STORAGE_MARKER);
    if !marker_path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&marker_path).map_err(|error| {
        format!(
            "Failed to read legacy storage marker {}: {}",
            marker_path.display(),
            error
        )
    })?;
    let marker: LegacyStorageResolution = serde_json::from_slice(&bytes).map_err(|error| {
        format!(
            "Legacy storage marker {} is invalid: {}",
            marker_path.display(),
            error
        )
    })?;
    if marker.version != 1 {
        return Err(format!(
            "Legacy storage marker {} has unsupported version {}",
            marker_path.display(),
            marker.version
        ));
    }
    Ok(Some(marker))
}

fn write_legacy_storage_marker(
    app_dir: &Path,
    resolution: &LegacyStorageResolution,
) -> Result<(), String> {
    use std::io::Write;

    if let Some(existing) = read_legacy_storage_marker(app_dir)? {
        return if existing == *resolution {
            Ok(())
        } else {
            Err(format!(
                "Legacy storage marker in {} conflicts with the resolved migration policy",
                app_dir.display()
            ))
        };
    }

    let marker_path = app_dir.join(LEGACY_STORAGE_MARKER);
    let temp_path = app_dir.join(format!("{LEGACY_STORAGE_MARKER}.tmp"));
    if temp_path.exists() {
        std::fs::remove_file(&temp_path).map_err(|error| {
            format!(
                "Failed to remove interrupted legacy storage marker {}: {}",
                temp_path.display(),
                error
            )
        })?;
    }
    let bytes = serde_json::to_vec_pretty(resolution)
        .map_err(|error| format!("Failed to encode legacy storage marker: {error}"))?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .map_err(|error| {
            format!(
                "Failed to create legacy storage marker {}: {}",
                temp_path.display(),
                error
            )
        })?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Failed to persist legacy storage marker: {error}"))?;
    drop(file);
    std::fs::rename(&temp_path, &marker_path).map_err(|error| {
        format!(
            "Failed to install legacy storage marker {}: {}",
            marker_path.display(),
            error
        )
    })
}

fn directory_is_empty(path: &Path) -> Result<bool, String> {
    std::fs::read_dir(path)
        .map_err(|error| {
            format!(
                "Failed to inspect data directory {}: {}",
                path.display(),
                error
            )
        })
        .map(|mut entries| entries.next().is_none())
}

#[cfg(unix)]
fn sync_storage_directory(path: &Path) {
    let _ = std::fs::File::open(path).and_then(|directory| directory.sync_all());
}

#[cfg(not(unix))]
fn sync_storage_directory(_path: &Path) {}

fn regular_storage_file_exists(path: &Path) -> Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(format!(
            "Legacy database path {} is not a regular file",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "Failed to inspect legacy database path {}: {}",
            path.display(),
            error
        )),
    }
}

fn ensure_regular_storage_directory(path: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        format!(
            "Failed to inspect storage directory {}: {}",
            path.display(),
            error
        )
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "Storage directory {} is not a regular directory",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn rename_storage_file_no_replace(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::MoveFileW;

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    unsafe { MoveFileW(PCWSTR(source.as_ptr()), PCWSTR(target.as_ptr())) }
        .map_err(|_| std::io::Error::last_os_error())
}

#[cfg(unix)]
fn rename_storage_file_no_replace(source: &Path, target: &Path) -> std::io::Result<()> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};

    renameat_with(CWD, source, CWD, target, RenameFlags::NOREPLACE).map_err(std::io::Error::from)
}

#[cfg(not(any(unix, windows)))]
fn rename_storage_file_no_replace(source: &Path, target: &Path) -> std::io::Result<()> {
    if target.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "target already exists",
        ));
    }
    std::fs::rename(source, target)
}

fn move_legacy_database_family(source_dir: &Path, app_dir: &Path) -> Result<bool, String> {
    ensure_regular_storage_directory(source_dir)?;
    ensure_regular_storage_directory(app_dir)?;
    if !regular_storage_file_exists(&source_dir.join(DATABASE_FILE))?
        || regular_storage_file_exists(&app_dir.join(DATABASE_FILE))?
    {
        return Ok(false);
    }

    for file_name in DATABASE_MOVE_ORDER {
        let source = source_dir.join(file_name);
        let target = app_dir.join(file_name);
        if regular_storage_file_exists(&source)? && regular_storage_file_exists(&target)? {
            return Err(format!(
                "Cannot merge legacy database because both {} and {} exist",
                source.display(),
                target.display()
            ));
        }
    }

    // Sidecars move first and the main database moves last. Until the final rename, a crash leaves
    // the authoritative database in the legacy directory and a retry can finish the same layout.
    for file_name in DATABASE_MOVE_ORDER {
        let source = source_dir.join(file_name);
        if !regular_storage_file_exists(&source)? {
            continue;
        }
        let target = app_dir.join(file_name);
        rename_storage_file_no_replace(&source, &target).map_err(|error| {
            format!(
                "Failed to move legacy database file from {} to {}: {}",
                source.display(),
                target.display(),
                error
            )
        })?;
        sync_storage_directory(source_dir);
        sync_storage_directory(app_dir);
    }

    Ok(true)
}

fn archive_legacy_remainder(
    legacy_dir: &Path,
    conflict_backup: &Path,
) -> Result<Option<String>, String> {
    if directory_is_empty(legacy_dir)? {
        std::fs::remove_dir(legacy_dir).map_err(|error| {
            format!(
                "Failed to remove migrated legacy directory {}: {}",
                legacy_dir.display(),
                error
            )
        })?;
        sync_storage_directory(legacy_dir.parent().unwrap_or_else(|| Path::new(".")));
        return Ok(None);
    }

    std::fs::rename(legacy_dir, conflict_backup).map_err(|error| {
        format!(
            "Failed to preserve remaining legacy Tarab data from {} at {}: {}",
            legacy_dir.display(),
            conflict_backup.display(),
            error
        )
    })?;
    sync_storage_directory(conflict_backup.parent().unwrap_or_else(|| Path::new(".")));
    Ok(Some(LEGACY_STORAGE_CONFLICT_BACKUP.to_string()))
}

fn prepare_app_directory(base_dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(base_dir).map_err(|error| {
        format!(
            "Failed to create application data root {}: {}",
            base_dir.display(),
            error
        )
    })?;
    let _migration_guard = STORAGE_MIGRATION_LOCK.get_or_init(|| Mutex::new(())).lock();
    let app_dir = base_dir.join(APP_STORAGE_DIRECTORY);
    let legacy_dir = base_dir.join(LEGACY_STORAGE_DIRECTORY);
    let conflict_backup = base_dir.join(LEGACY_STORAGE_CONFLICT_BACKUP);

    if app_dir.exists() && legacy_dir.exists() {
        if read_legacy_storage_marker(&app_dir)?.is_some() {
            return Err(format!(
                "Both {} and {} exist after legacy storage was already resolved; refusing to ignore the newly reappeared legacy directory",
                app_dir.display(),
                legacy_dir.display()
            ));
        }
        if conflict_backup.exists() {
            return Err(format!(
                "Cannot resolve legacy storage conflict because backup {} already exists; both active directories were preserved",
                conflict_backup.display()
            ));
        }

        if directory_is_empty(&app_dir)? {
            std::fs::remove_dir(&app_dir).map_err(|error| {
                format!(
                    "Failed to remove empty Tarab data directory {}: {}",
                    app_dir.display(),
                    error
                )
            })?;
            write_legacy_storage_marker(
                &legacy_dir,
                &LegacyStorageResolution {
                    version: 1,
                    policy: "legacyRenamedIntoEmptyAppDirectory".to_string(),
                    legacy_backup: None,
                },
            )?;
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

        if move_legacy_database_family(&legacy_dir, &app_dir)? {
            let legacy_backup = archive_legacy_remainder(&legacy_dir, &conflict_backup)?;
            write_legacy_storage_marker(
                &app_dir,
                &LegacyStorageResolution {
                    version: 1,
                    policy: "legacyDatabaseMergedIntoAppDirectory".to_string(),
                    legacy_backup,
                },
            )?;
            return Ok(app_dir);
        }

        std::fs::rename(&legacy_dir, &conflict_backup).map_err(|error| {
            format!(
                "Failed to preserve conflicting legacy Tarab data from {} at {}: {}",
                legacy_dir.display(),
                conflict_backup.display(),
                error
            )
        })?;
        write_legacy_storage_marker(
            &app_dir,
            &LegacyStorageResolution {
                version: 1,
                policy: "appDirectoryAuthoritativeLegacyArchived".to_string(),
                legacy_backup: Some(LEGACY_STORAGE_CONFLICT_BACKUP.to_string()),
            },
        )?;
        eprintln!(
            "Both Tarab data directories existed; using {} and preserving legacy data at {}",
            app_dir.display(),
            conflict_backup.display()
        );
        return Ok(app_dir);
    }

    if app_dir.exists() {
        let marker = read_legacy_storage_marker(&app_dir)?;
        let recovered_database = if conflict_backup.exists() {
            move_legacy_database_family(&conflict_backup, &app_dir)?
        } else {
            false
        };
        if conflict_backup.exists() && marker.is_none() {
            write_legacy_storage_marker(
                &app_dir,
                &LegacyStorageResolution {
                    version: 1,
                    policy: if recovered_database {
                        "legacyDatabaseRecoveredFromConflictBackup".to_string()
                    } else {
                        "appDirectoryAuthoritativeLegacyArchived".to_string()
                    },
                    legacy_backup: Some(LEGACY_STORAGE_CONFLICT_BACKUP.to_string()),
                },
            )?;
        }
        if recovered_database {
            eprintln!(
                "Recovered the legacy Tarab database from {} into {}",
                conflict_backup.display(),
                app_dir.display()
            );
        }
        return Ok(app_dir);
    }

    if legacy_dir.exists() {
        if conflict_backup.exists() {
            return Err(format!(
                "Cannot migrate {} while unresolved legacy backup {} exists",
                legacy_dir.display(),
                conflict_backup.display()
            ));
        }
        write_legacy_storage_marker(
            &legacy_dir,
            &LegacyStorageResolution {
                version: 1,
                policy: "legacyDirectoryRenamed".to_string(),
                legacy_backup: None,
            },
        )?;
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
    prepare_app_directory(&base_dir).map(|directory| directory.join(DATABASE_FILE))
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
                "db_get_all_tracks is disabled for libraries larger than {} tracks (current: {}); use db_get_tracks_cursor_page instead",
                DB_GET_ALL_TRACKS_HARD_LIMIT, count
            ));
        }
        db.get_all_tracks().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn db_get_all_track_ids(
    db: tauri::State<'_, SharedDatabase>,
) -> Result<Vec<String>, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_all_track_ids())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
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
/// Compatibility-only random access. Multi-page traversals must use the revision-bound cursor API.
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
pub async fn db_get_tracks_cursor_page(
    cursor: Option<TrackPageCursor>,
    limit: u32,
    sort_by: String,
    sort_order: String,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<DbTrackCursorPage, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.get_tracks_cursor_page(cursor.as_ref(), limit, &sort_by, &sort_order))
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
    scan_id: String,
    request: ScanReconcileRequest,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
    scan_control: tauri::State<'_, SharedLibraryScanControl>,
) -> Result<ScanReconcileResult, String> {
    let db = db.inner().clone();
    let roots = roots_state.inner().read().roots.clone();
    let cancellation = scan_control.cancellation(&scan_id)?;
    spawn_blocking(move || {
        ensure_existing_path_allowed(Path::new(&request.folder_path), &roots, "reconcile scan")?;
        ensure_upsert_tracks_allowed(&request.tracks, &roots)?;
        db.reconcile_folder_scan_cancellable(request, Some(&cancellation))
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
        assert!(migrated.join(LEGACY_STORAGE_MARKER).exists());
        assert!(!legacy_dir.exists());

        let _ = std::fs::remove_dir_all(base_dir);
    }

    #[test]
    fn populated_app_directory_merges_the_legacy_database_family() {
        let base_dir = std::env::temp_dir().join(format!(
            "tarab-storage-split-layout-{}-{:032x}",
            std::process::id(),
            rand::random::<u128>()
        ));
        let app_dir = base_dir.join(APP_STORAGE_DIRECTORY);
        let legacy_dir = base_dir.join(LEGACY_STORAGE_DIRECTORY);
        std::fs::create_dir_all(&app_dir).expect("create app directory");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy directory");
        std::fs::write(app_dir.join("settings.json"), b"settings").expect("seed settings");
        std::fs::write(app_dir.join("playlists.json"), b"playlists").expect("seed playlists");
        std::fs::write(legacy_dir.join(DATABASE_FILE), b"legacy database")
            .expect("seed legacy database");
        std::fs::write(legacy_dir.join("library.db-wal"), b"legacy wal").expect("seed legacy wal");
        std::fs::write(legacy_dir.join("library.db-shm"), b"legacy shm").expect("seed legacy shm");

        let selected = prepare_app_directory(&base_dir).expect("merge split storage layout");

        assert_eq!(selected, app_dir);
        assert_eq!(
            std::fs::read(app_dir.join(DATABASE_FILE)).expect("read merged database"),
            b"legacy database"
        );
        assert_eq!(
            std::fs::read(app_dir.join("library.db-wal")).expect("read merged wal"),
            b"legacy wal"
        );
        assert_eq!(
            std::fs::read(app_dir.join("settings.json")).expect("read settings"),
            b"settings"
        );
        assert_eq!(
            std::fs::read(app_dir.join("playlists.json")).expect("read playlists"),
            b"playlists"
        );
        assert!(!legacy_dir.exists());
        assert!(!base_dir.join(LEGACY_STORAGE_CONFLICT_BACKUP).exists());
        let marker = read_legacy_storage_marker(&app_dir)
            .expect("read migration marker")
            .expect("migration marker");
        assert_eq!(marker.policy, "legacyDatabaseMergedIntoAppDirectory");
        assert_eq!(marker.legacy_backup, None);

        let _ = std::fs::remove_dir_all(base_dir);
    }

    #[test]
    fn split_layout_archives_only_non_database_legacy_remainders() {
        let base_dir = std::env::temp_dir().join(format!(
            "tarab-storage-split-remainder-{}-{:032x}",
            std::process::id(),
            rand::random::<u128>()
        ));
        let app_dir = base_dir.join(APP_STORAGE_DIRECTORY);
        let legacy_dir = base_dir.join(LEGACY_STORAGE_DIRECTORY);
        let backup_dir = base_dir.join(LEGACY_STORAGE_CONFLICT_BACKUP);
        std::fs::create_dir_all(&app_dir).expect("create app directory");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy directory");
        std::fs::write(app_dir.join("settings.json"), b"settings").expect("seed settings");
        std::fs::write(legacy_dir.join(DATABASE_FILE), b"legacy database")
            .expect("seed legacy database");
        std::fs::write(legacy_dir.join("old-cache"), b"cache").expect("seed legacy remainder");

        prepare_app_directory(&base_dir).expect("merge legacy database");

        assert_eq!(
            std::fs::read(app_dir.join(DATABASE_FILE)).expect("read merged database"),
            b"legacy database"
        );
        assert!(!backup_dir.join(DATABASE_FILE).exists());
        assert_eq!(
            std::fs::read(backup_dir.join("old-cache")).expect("read archived remainder"),
            b"cache"
        );
        let marker = read_legacy_storage_marker(&app_dir)
            .expect("read migration marker")
            .expect("migration marker");
        assert_eq!(
            marker.legacy_backup.as_deref(),
            Some(LEGACY_STORAGE_CONFLICT_BACKUP)
        );

        let _ = std::fs::remove_dir_all(base_dir);
    }

    #[test]
    fn interrupted_split_layout_move_finishes_main_database_last() {
        let base_dir = std::env::temp_dir().join(format!(
            "tarab-storage-split-crash-{}-{:032x}",
            std::process::id(),
            rand::random::<u128>()
        ));
        let app_dir = base_dir.join(APP_STORAGE_DIRECTORY);
        let legacy_dir = base_dir.join(LEGACY_STORAGE_DIRECTORY);
        std::fs::create_dir_all(&app_dir).expect("create app directory");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy directory");
        std::fs::write(app_dir.join("settings.json"), b"settings").expect("seed settings");
        std::fs::write(app_dir.join("library.db-wal"), b"already moved wal")
            .expect("seed moved wal");
        std::fs::write(legacy_dir.join(DATABASE_FILE), b"legacy database")
            .expect("seed legacy database");

        prepare_app_directory(&base_dir).expect("resume interrupted database move");

        assert_eq!(
            std::fs::read(app_dir.join(DATABASE_FILE)).expect("read recovered database"),
            b"legacy database"
        );
        assert_eq!(
            std::fs::read(app_dir.join("library.db-wal")).expect("read retained wal"),
            b"already moved wal"
        );
        assert!(!legacy_dir.exists());

        let _ = std::fs::remove_dir_all(base_dir);
    }

    #[test]
    fn interrupted_legacy_archive_recovers_database_before_marker_creation() {
        let base_dir = std::env::temp_dir().join(format!(
            "tarab-storage-archive-crash-{}-{:032x}",
            std::process::id(),
            rand::random::<u128>()
        ));
        let app_dir = base_dir.join(APP_STORAGE_DIRECTORY);
        let backup_dir = base_dir.join(LEGACY_STORAGE_CONFLICT_BACKUP);
        std::fs::create_dir_all(&app_dir).expect("create app directory");
        std::fs::create_dir_all(&backup_dir).expect("create interrupted backup");
        std::fs::write(app_dir.join("settings.json"), b"settings").expect("seed settings");
        std::fs::write(backup_dir.join(DATABASE_FILE), b"legacy database")
            .expect("seed archived database");

        prepare_app_directory(&base_dir).expect("recover interrupted archive");

        assert_eq!(
            std::fs::read(app_dir.join(DATABASE_FILE)).expect("read recovered database"),
            b"legacy database"
        );
        assert!(!backup_dir.join(DATABASE_FILE).exists());
        let marker = read_legacy_storage_marker(&app_dir)
            .expect("read recovery marker")
            .expect("recovery marker");
        assert_eq!(marker.policy, "legacyDatabaseRecoveredFromConflictBackup");

        let _ = std::fs::remove_dir_all(base_dir);
    }

    #[test]
    fn both_storage_directories_archive_legacy_data_with_a_durable_policy() {
        let base_dir = std::env::temp_dir().join(format!(
            "tarab-storage-both-{}-{}",
            std::process::id(),
            now_millis_i64_or_default()
        ));
        let app_dir = base_dir.join(APP_STORAGE_DIRECTORY);
        let legacy_dir = base_dir.join(LEGACY_STORAGE_DIRECTORY);
        std::fs::create_dir_all(&app_dir).expect("create app directory");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy directory");
        std::fs::write(app_dir.join("library.db"), b"current").expect("seed current database");
        std::fs::write(legacy_dir.join("library.db"), b"legacy").expect("seed legacy database");

        let selected = prepare_app_directory(&base_dir).expect("resolve dual directories");

        assert_eq!(selected, app_dir);
        assert_eq!(
            std::fs::read(selected.join("library.db")).expect("read current database"),
            b"current"
        );
        assert!(!legacy_dir.exists());
        assert_eq!(
            std::fs::read(
                base_dir
                    .join(LEGACY_STORAGE_CONFLICT_BACKUP)
                    .join("library.db")
            )
            .expect("read archived legacy database"),
            b"legacy"
        );
        let marker = read_legacy_storage_marker(&selected)
            .expect("read resolution marker")
            .expect("resolution marker");
        assert_eq!(marker.policy, "appDirectoryAuthoritativeLegacyArchived");
        assert_eq!(
            prepare_app_directory(&base_dir).expect("repeat resolved migration"),
            selected
        );

        let _ = std::fs::remove_dir_all(base_dir);
    }

    #[test]
    fn storage_migration_conflict_preserves_all_directories_and_returns_an_error() {
        let base_dir = std::env::temp_dir().join(format!(
            "tarab-storage-conflict-{}-{}",
            std::process::id(),
            now_millis_i64_or_default()
        ));
        let app_dir = base_dir.join(APP_STORAGE_DIRECTORY);
        let legacy_dir = base_dir.join(LEGACY_STORAGE_DIRECTORY);
        let backup_dir = base_dir.join(LEGACY_STORAGE_CONFLICT_BACKUP);
        for directory in [&app_dir, &legacy_dir, &backup_dir] {
            std::fs::create_dir_all(directory).expect("create data directory");
            std::fs::write(
                directory.join("owner"),
                directory.to_string_lossy().as_bytes(),
            )
            .expect("seed data directory");
        }

        let error = prepare_app_directory(&base_dir).expect_err("reject ambiguous migration");

        assert!(error.contains("backup"));
        assert!(app_dir.join("owner").exists());
        assert!(legacy_dir.join("owner").exists());
        assert!(backup_dir.join("owner").exists());

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
            genre: None,
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
            genre: None,
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
        {
            let conn = db.conn.lock();
            let stored_id: String = conn
                .query_row(
                    "SELECT public_id FROM tracks WHERE id = ?1",
                    [&track.id],
                    |row| row.get(0),
                )
                .expect("stored public id");
            assert_eq!(stored_id, public_id);
            let public_id_index: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_tracks_public_id'",
                    [],
                    |row| row.get(0),
                )
                .expect("public id index");
            assert_eq!(public_id_index, 1);
        }
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
    fn migrate_v10_backfills_and_indexes_public_track_ids() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        conn.execute_batch(
            r#"
            CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT UNIQUE NOT NULL);
            CREATE TABLE playlist_tracks (
                playlist_id TEXT NOT NULL,
                track_id TEXT NOT NULL,
                snapshot_file_path TEXT
            );
            CREATE TABLE lyrics_index (track_id TEXT PRIMARY KEY, lyrics_path TEXT NOT NULL);
            INSERT INTO tracks (id, file_path) VALUES ('legacy', '/music/legacy.mp3');
            "#,
        )
        .expect("seed legacy tracks schema");
        let db = Database {
            conn: Mutex::new(conn),
        };

        {
            let conn = db.conn.lock();
            db.migrate_v10(&conn).expect("migrate public ids");
            let public_id: String = conn
                .query_row(
                    "SELECT public_id FROM tracks WHERE id = 'legacy'",
                    [],
                    |row| row.get(0),
                )
                .expect("backfilled public id");
            assert_eq!(public_id, Database::public_track_id("/music/legacy.mp3"));
            let index_is_unique: i64 = conn
                .query_row(
                    "SELECT \"unique\" FROM pragma_index_list('tracks') WHERE name = 'idx_tracks_public_id'",
                    [],
                    |row| row.get(0),
                )
                .expect("public id index");
            assert_eq!(index_is_unique, 1);
        }
    }

    #[test]
    fn migrate_v12_adds_genre_to_existing_track_tables() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch(
            r#"
            CREATE TABLE tracks (
                id TEXT PRIMARY KEY,
                file_path TEXT UNIQUE NOT NULL
            );
            INSERT INTO tracks (id, file_path) VALUES ('legacy', '/music/legacy.mp3');
            "#,
        )
        .expect("create pre-genre schema");

        let db = Database {
            conn: Mutex::new(conn),
        };

        {
            let conn = db.conn.lock();
            db.migrate_v12(&conn).expect("add genre column");
            db.migrate_v12(&conn).expect("repeat genre migration");

            let genre_columns: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info('tracks') WHERE name = 'genre'",
                    [],
                    |row| row.get(0),
                )
                .expect("count genre columns");
            assert_eq!(genre_columns, 1);

            let genre_indexes: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_index_list('tracks') WHERE name = 'idx_tracks_genre'",
                    [],
                    |row| row.get(0),
                )
                .expect("count genre indexes");
            assert_eq!(genre_indexes, 1);

            let track_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
                .expect("count legacy tracks");
            assert_eq!(track_count, 1);
        }
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
        track.genre = Some("Classical".to_string());

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
        assert_eq!(loaded.genre, track.genre);
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
    fn playlist_reorder_mutation_survives_cache_loss_without_deleting_later_additions() {
        let db = test_db();
        db.upsert_tracks_batch(&[sample_track("a"), sample_track("b"), sample_track("c")])
            .expect("seed tracks");
        db.create_playlist(&sample_playlist("pl_retry"))
            .expect("create playlist");
        let key = "reorder:pl_retry:mutation-1";

        assert!(
            db.set_playlist_tracks_idempotent(
                "pl_retry",
                &["b".to_string(), "a".to_string()],
                1,
                key,
            )
            .expect("first reorder")
        );
        db.add_tracks_to_playlist("pl_retry", &["c".to_string()])
            .expect("later addition");
        assert!(
            !db.set_playlist_tracks_idempotent(
                "pl_retry",
                &["b".to_string(), "a".to_string()],
                2,
                key,
            )
            .expect("retry reorder")
        );

        let ids = db
            .get_playlist_track_entries("pl_retry")
            .expect("read tracks")
            .into_iter()
            .map(|entry| entry.track_id)
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["b", "a", "c"]);
    }

    #[test]
    fn legacy_playlist_import_fills_interrupted_empty_rows_and_marks_completion() {
        let db = test_db();
        db.upsert_tracks_batch(&[sample_track("a"), sample_track("b")])
            .expect("seed tracks");
        let playlist = sample_playlist("legacy");
        db.create_playlist(&playlist)
            .expect("seed interrupted playlist row");

        db.import_legacy_playlists(
            &[(playlist, vec!["a".to_string(), "b".to_string()])],
            "legacy-migration-test",
        )
        .expect("recover migration");

        assert!(db
            .playlist_migration_completed("legacy-migration-test")
            .expect("read marker"));
        let ids = db
            .get_playlist_track_entries("legacy")
            .expect("read imported tracks")
            .into_iter()
            .map(|entry| entry.track_id)
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["a", "b"]);
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
    fn reconcile_folder_scan_clears_stale_art_cache_fields_when_hashes_are_not_precomputed() {
        let db = test_db();
        let mut changed = sample_track("art-reindexed");
        changed.id = "/tmp/folder/art-reindexed.mp3".to_string();
        changed.file_path = changed.id.clone();
        changed.has_cover_art = true;
        changed.cover_art_hash = Some("old-art-hash".to_string());
        changed.blurhash = Some("old-blurhash".to_string());

        let mut removed = sample_track("art-removed");
        removed.id = "/tmp/folder/art-removed.mp3".to_string();
        removed.file_path = removed.id.clone();
        removed.has_cover_art = true;
        removed.cover_art_hash = Some("removed-art-hash".to_string());
        removed.blurhash = Some("removed-blurhash".to_string());

        db.upsert_tracks_batch(&[changed.clone(), removed.clone()])
            .expect("seed artwork cache fields");

        let mut changed_scan = changed.clone();
        changed_scan.cover_art_hash = None;
        changed_scan.blurhash = None;
        let mut removed_scan = removed.clone();
        removed_scan.has_cover_art = false;
        removed_scan.cover_art_hash = None;
        removed_scan.blurhash = None;

        db.reconcile_folder_scan(ScanReconcileRequest {
            folder_path: "/tmp/folder".to_string(),
            discovered_paths: vec![changed.file_path.clone(), removed.file_path.clone()],
            tracks: vec![changed_scan, removed_scan],
            traversal_complete: true,
            errors: Vec::new(),
        })
        .expect("reconcile artwork refresh");

        let stored = db
            .get_tracks_by_ids(&[changed.id, removed.id])
            .expect("read refreshed artwork fields");
        let changed_stored = stored
            .iter()
            .find(|track| track.file_path.ends_with("art-reindexed.mp3"))
            .expect("changed artwork track");
        let removed_stored = stored
            .iter()
            .find(|track| track.file_path.ends_with("art-removed.mp3"))
            .expect("removed artwork track");

        assert!(changed_stored.has_cover_art);
        assert_eq!(changed_stored.cover_art_hash, None);
        assert_eq!(changed_stored.blurhash, None);
        assert!(!removed_stored.has_cover_art);
        assert_eq!(removed_stored.cover_art_hash, None);
        assert_eq!(removed_stored.blurhash, None);
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
    fn cancelled_reconciliation_rolls_back_without_deleting_rows() {
        let db = test_db();
        let mut existing = sample_track("kept-after-cancel");
        existing.id = "/tmp/folder/kept.mp3".to_string();
        existing.file_path = existing.id.clone();
        db.upsert_tracks_batch(std::slice::from_ref(&existing))
            .expect("seed track");
        let cancellation = AtomicBool::new(true);

        let result = db.reconcile_folder_scan_cancellable(
            ScanReconcileRequest {
                folder_path: "/tmp/folder".to_string(),
                discovered_paths: Vec::new(),
                tracks: Vec::new(),
                traversal_complete: true,
                errors: Vec::new(),
            },
            Some(&cancellation),
        );

        assert!(result.is_err());
        assert_eq!(db.get_track_count().expect("track count"), 1);
    }

    #[test]
    fn reconcile_rejects_tracks_missing_from_discovery_evidence() {
        let db = test_db();
        let mut existing = sample_track("kept-after-invalid-request");
        existing.id = "/tmp/folder/kept.mp3".to_string();
        existing.file_path = existing.id.clone();
        existing.rating = Some(5);
        db.upsert_tracks_batch(std::slice::from_ref(&existing))
            .expect("seed track");

        let result = db.reconcile_folder_scan(ScanReconcileRequest {
            folder_path: "/tmp/folder".to_string(),
            discovered_paths: Vec::new(),
            tracks: vec![existing.clone()],
            traversal_complete: true,
            errors: Vec::new(),
        });

        assert!(result.is_err());
        let stored = db
            .get_tracks_by_ids(&[existing.id.clone()])
            .expect("read preserved track");
        assert_eq!(stored.first().and_then(|track| track.rating), Some(5));
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
    fn reconcile_preserves_a_file_restored_after_traversal() {
        let root = std::env::temp_dir().join(format!(
            "tarab-reconcile-restored-{}-{:032x}",
            std::process::id(),
            rand::random::<u128>()
        ));
        std::fs::create_dir_all(&root).expect("create scan root");
        let restored_path = root.join("restored.mp3");
        let normalized_root = Database::normalize_path(&root.to_string_lossy());
        let normalized_path = Database::normalize_path(&restored_path.to_string_lossy());
        let db = test_db();
        let mut restored = sample_track("restored-after-traversal");
        restored.id = normalized_path.clone();
        restored.file_path = normalized_path.clone();
        db.upsert_tracks_batch(std::slice::from_ref(&restored))
            .expect("seed omitted track");
        let request = ScanReconcileRequest {
            folder_path: normalized_root,
            discovered_paths: Vec::new(),
            tracks: Vec::new(),
            traversal_complete: true,
            errors: Vec::new(),
        };

        std::fs::write(&restored_path, b"restored after traversal").expect("restore file");
        let result = db
            .reconcile_folder_scan(request)
            .expect("reconcile restored file");

        assert_eq!(result.missing_count, 0);
        assert_eq!(result.preserved_count, 1);
        assert_eq!(
            db.get_tracks_by_ids(&[normalized_path])
                .expect("read preserved track")
                .len(),
            1
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn reconcile_does_not_treat_a_symlink_escape_as_a_restored_file() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "tarab-reconcile-symlink-{}-{:032x}",
            std::process::id(),
            rand::random::<u128>()
        ));
        let outside = std::env::temp_dir().join(format!(
            "tarab-reconcile-outside-{}-{:032x}",
            std::process::id(),
            rand::random::<u128>()
        ));
        std::fs::create_dir_all(&root).expect("create scan root");
        std::fs::create_dir_all(&outside).expect("create outside root");
        std::fs::write(outside.join("escaped.mp3"), b"outside audio").expect("write outside file");
        symlink(&outside, root.join("escape")).expect("create escape symlink");
        let normalized_root = Database::normalize_path(&root.to_string_lossy());
        let escaped_path =
            Database::normalize_path(&root.join("escape").join("escaped.mp3").to_string_lossy());
        let db = test_db();
        let mut escaped = sample_track("escaped-track");
        escaped.id = escaped_path.clone();
        escaped.file_path = escaped_path.clone();
        db.upsert_tracks_batch(std::slice::from_ref(&escaped))
            .expect("seed escaped track");

        let result = db
            .reconcile_folder_scan(ScanReconcileRequest {
                folder_path: normalized_root,
                discovered_paths: Vec::new(),
                tracks: Vec::new(),
                traversal_complete: true,
                errors: Vec::new(),
            })
            .expect("reconcile symlink escape");

        assert_eq!(result.missing_count, 1);
        assert_eq!(result.preserved_count, 0);
        assert!(db
            .get_tracks_by_ids(&[escaped_path])
            .expect("read tracks")
            .is_empty());
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(outside);
    }

    #[test]
    fn reconcile_large_scan_counts_preserved_paths_from_precomputed_sets() {
        const TRACK_COUNT: usize = 2_048;

        let db = test_db();
        let tracks = (0..TRACK_COUNT)
            .map(|index| sample_track(&format!("large-{index:04}")))
            .collect::<Vec<_>>();
        db.upsert_tracks_batch(&tracks).expect("seed large scan");

        let mut discovered_paths = tracks
            .iter()
            .map(|track| track.file_path.clone())
            .collect::<Vec<_>>();
        discovered_paths.push(tracks[0].file_path.clone());
        let reconciled_tracks = tracks.iter().step_by(2).cloned().collect::<Vec<_>>();

        let result = db
            .reconcile_folder_scan(ScanReconcileRequest {
                folder_path: "/tmp".to_string(),
                discovered_paths,
                tracks: reconciled_tracks,
                traversal_complete: true,
                errors: vec![ScanReconcileError {
                    path: None,
                    code: "metadataReadFailed".to_string(),
                    message: "some metadata was unavailable".to_string(),
                    recoverable: true,
                }],
            })
            .expect("reconcile large scan");

        assert_eq!(result.status, "partial");
        assert_eq!(result.discovered_count, TRACK_COUNT);
        assert_eq!(result.unchanged_count, TRACK_COUNT / 2);
        assert_eq!(result.preserved_count, TRACK_COUNT / 2);
        assert_eq!(result.missing_count, 0);
        assert_eq!(
            db.get_track_count().expect("track count"),
            TRACK_COUNT as i64
        );
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
    fn all_track_ids_are_returned_in_a_stable_order() {
        let db = test_db();
        db.upsert_tracks_batch(&[sample_track("b"), sample_track("a")])
            .expect("seed tracks");

        let ids = db.get_all_track_ids().expect("read track ids");

        assert_eq!(ids, vec!["a".to_string(), "b".to_string()]);
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
    fn paginated_track_sort_uses_id_to_stabilize_ties() {
        let db = test_db();
        let mut tracks = [sample_track("z"), sample_track("m"), sample_track("a")];
        for track in &mut tracks {
            track.title = "Tied title".to_string();
        }
        db.upsert_tracks_batch(&tracks).expect("seed tied tracks");

        let ids = (0..tracks.len() as u32)
            .map(|offset| {
                db.get_tracks_paginated(offset, 1, "title", "asc")
                    .expect("read tied page")[0]
                    .id
                    .clone()
            })
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["a", "m", "z"]);
    }

    #[test]
    fn cursor_track_pages_use_id_to_stabilize_sort_ties() {
        let db = test_db();
        let mut tracks = [sample_track("z"), sample_track("m"), sample_track("a")];
        for track in &mut tracks {
            track.title = "Tied title".to_string();
        }
        db.upsert_tracks_batch(&tracks).expect("seed tied tracks");

        let mut cursor = None;
        let mut ids = Vec::new();
        loop {
            let page = db
                .get_tracks_cursor_page(cursor.as_ref(), 1, "title", "asc")
                .expect("read cursor page");
            assert_eq!(page.status, TrackCursorPageStatus::Ready);
            ids.extend(page.tracks.into_iter().map(|track| track.id));
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }

        assert_eq!(ids, vec!["a", "m", "z"]);
    }

    #[test]
    fn cursor_track_pages_require_restart_after_insert_and_delete() {
        let db = test_db();
        let mut tracks = [sample_track("a"), sample_track("b"), sample_track("c")];
        for track in &mut tracks {
            track.title = "Tied title".to_string();
        }
        db.upsert_tracks_batch(&tracks).expect("seed tracks");
        let first = db
            .get_tracks_cursor_page(None, 1, "title", "asc")
            .expect("read first page");
        let cursor = first.next_cursor.expect("next cursor");
        assert_eq!(first.tracks[0].id, "a");

        db.delete_tracks(&["b".to_string()])
            .expect("delete between pages");
        let mut inserted = sample_track("d");
        inserted.title = "Tied title".to_string();
        db.upsert_tracks_batch(&[inserted])
            .expect("insert between pages");

        let stale = db
            .get_tracks_cursor_page(Some(&cursor), 1, "title", "asc")
            .expect("reject stale cursor");
        assert_eq!(stale.status, TrackCursorPageStatus::RestartRequired);
        assert!(stale.tracks.is_empty());

        let mut restarted_cursor = None;
        let mut restarted_ids = Vec::new();
        loop {
            let page = db
                .get_tracks_cursor_page(restarted_cursor.as_ref(), 1, "title", "asc")
                .expect("read restarted page");
            assert_eq!(page.status, TrackCursorPageStatus::Ready);
            restarted_ids.extend(page.tracks.into_iter().map(|track| track.id));
            match page.next_cursor {
                Some(next) => restarted_cursor = Some(next),
                None => break,
            }
        }
        assert_eq!(restarted_ids, vec!["a", "c", "d"]);
    }

    #[test]
    fn lyrics_track_pages_break_nocase_id_ties_with_unique_id() {
        let db = test_db();
        db.upsert_tracks_batch(&[sample_track("a"), sample_track("A")])
            .expect("seed case-tied tracks");

        let first = db
            .get_track_paths_page(0, 1)
            .expect("read first lyrics track page");
        let second = db
            .get_track_paths_page(1, 1)
            .expect("read second lyrics track page");

        assert_eq!(first[0].id, "A");
        assert_eq!(second[0].id, "a");
    }

    #[test]
    fn lyrics_cursor_and_apply_reject_a_mutation_between_traversal_and_commit() {
        let db = test_db();
        db.upsert_tracks_batch(&[sample_track("a"), sample_track("b")])
            .expect("seed tracks");
        db.upsert_lyrics_index_batch(&[LyricsIndexEntry {
            track_id: "a".to_string(),
            lyrics_path: "/tmp/a.lrc".to_string(),
            lyrics_mtime: 1,
            content: "original".to_string(),
        }])
        .expect("seed lyrics");
        let first = db
            .get_track_paths_cursor_page(None, 1)
            .expect("read lyrics cursor page");
        let cursor = first.next_cursor.expect("next lyrics cursor");

        db.delete_tracks(&["b".to_string()])
            .expect("mutate library between pages");
        let stale_page = db
            .get_track_paths_cursor_page(Some(&cursor), 1)
            .expect("reject stale lyrics cursor");
        assert!(stale_page.restart_required);
        assert_eq!(
            db.apply_lyrics_index_sync(first.revision, &[], &["a".to_string()])
                .expect("reject stale lyrics apply"),
            LyricsIndexSyncApply::RestartRequired
        );
        assert_eq!(db.lyrics_index_count().expect("lyrics count"), 1);
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

    #[test]
    fn album_aggregates_and_detail_queries_ignore_case_differences() {
        let db = test_db();
        let mut first = sample_track("case-album-first");
        first.album = "Shared Album".to_string();
        first.artist = "Various".to_string();
        let mut second = sample_track("case-album-second");
        second.album = "shared album".to_string();
        second.artist = "various".to_string();

        db.upsert_tracks_batch(&[first, second])
            .expect("seed case-variant album tracks");

        let aggregates = db.get_album_aggregates().expect("read album aggregates");
        assert_eq!(aggregates.len(), 1);
        assert_eq!(
            db.get_tracks_by_album_artist("SHARED ALBUM", "VARIOUS")
                .expect("read case-insensitive album details")
                .len(),
            2
        );
    }
    #[test]
    fn artist_aggregates_and_detail_queries_ignore_case_differences() {
        let db = test_db();
        let mut first = sample_track("case-artist-first");
        first.artist = "Various".to_string();
        let mut second = sample_track("case-artist-second");
        second.artist = "various".to_string();

        db.upsert_tracks_batch(&[first, second])
            .expect("seed case-variant artist tracks");

        let aggregates = db.get_artist_aggregates().expect("read artist aggregates");
        assert_eq!(aggregates.len(), 1);
        assert_eq!(aggregates[0].track_count, 2);
        assert!(aggregates[0].artist.eq_ignore_ascii_case("various"));
        assert_eq!(
            db.get_tracks_by_artist("VARIOUS")
                .expect("read case-insensitive artist details")
                .len(),
            2
        );
    }

    #[test]
    fn library_stats_count_albums_by_effective_artist() {
        let db = test_db();
        let mut first = sample_track("stats-first");
        first.album = "Shared Album".to_string();
        first.artist = "First Artist".to_string();
        let mut second = sample_track("stats-second");
        second.album = "Shared Album".to_string();
        second.artist = "Second Artist".to_string();
        let mut third = sample_track("stats-third");
        third.album = "Shared Album".to_string();
        third.artist = "First Artist".to_string();

        db.upsert_tracks_batch(&[first, second, third])
            .expect("seed library stats tracks");

        let stats = db.get_library_stats().expect("read library stats");

        assert_eq!(stats.track_count, 3);
        assert_eq!(stats.artist_count, 2);
        assert_eq!(stats.album_count, 2);
    }
    #[test]
    fn library_stats_count_artist_names_without_case_splits() {
        let db = test_db();
        let mut first = sample_track("stats-case-first");
        first.artist = "Artist".to_string();
        let mut second = sample_track("stats-case-second");
        second.artist = "artist".to_string();

        db.upsert_tracks_batch(&[first, second])
            .expect("seed case-variant stats tracks");

        let stats = db.get_library_stats().expect("read library stats");

        assert_eq!(stats.track_count, 2);
        assert_eq!(stats.artist_count, 1);
    }

    #[test]
    fn whitespace_album_artist_falls_back_to_track_artist() {
        let db = test_db();
        let mut first = sample_track("whitespace-album-artist-first");
        first.album = "Shared Album".to_string();
        first.artist = "Artist".to_string();
        first.album_artist = Some("   ".to_string());

        let mut second = sample_track("whitespace-album-artist-second");
        second.album = "shared album".to_string();
        second.artist = "Artist".to_string();

        db.upsert_tracks_batch(&[first, second])
            .expect("seed whitespace album artist tracks");

        let albums = db
            .get_album_aggregates()
            .expect("read whitespace aggregate");
        assert_eq!(albums.len(), 1);
        assert_eq!(albums[0].artist, "Artist");
        assert_eq!(albums[0].track_count, 2);
        assert_eq!(
            db.get_tracks_by_album_artist("SHARED ALBUM", "ARTIST")
                .expect("read whitespace album detail")
                .len(),
            2
        );
        assert_eq!(
            db.get_library_stats()
                .expect("read whitespace stats")
                .album_count,
            1
        );
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
        let mut folder_playlist = sample_playlist("rebase-folder-playlist");
        folder_playlist.playlist_type = "foldersync".to_string();
        folder_playlist.folder_path = Some("/missing/music/album".to_string());
        db.create_playlist(&folder_playlist)
            .expect("create folder playlist");

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
        assert_eq!(
            db.get_playlist_by_id("rebase-folder-playlist")
                .expect("read folder playlist")
                .expect("folder playlist")
                .folder_path
                .as_deref(),
            Some("/restored/music/album")
        );
    }

    #[test]
    fn revoked_root_source_cleanup_is_explicit_and_root_safe() {
        let db = test_db();
        let mut first = sample_track("root-a");
        first.id = "/music/a.mp3".to_string();
        first.file_path = first.id.clone();
        let mut second = sample_track("root-b");
        second.id = "/other/b.mp3".to_string();
        second.file_path = second.id.clone();
        db.upsert_tracks_batch(&[first, second])
            .expect("seed root tracks");

        assert!(db.delete_tracks_by_folder("/").is_err());
        assert_eq!(
            db.delete_tracks_for_library_source("/")
                .expect("clean revoked root source"),
            2
        );
        assert_eq!(db.get_track_count().expect("track count"), 0);
    }

    #[cfg(windows)]
    #[test]
    fn revoked_windows_drive_root_cleanup_matches_only_that_drive() {
        let db = test_db();
        let mut c_drive = sample_track("drive-c");
        c_drive.id = "C:/Music/a.mp3".to_string();
        c_drive.file_path = c_drive.id.clone();
        let mut d_drive = sample_track("drive-d");
        d_drive.id = "D:/Music/b.mp3".to_string();
        d_drive.file_path = d_drive.id.clone();
        db.upsert_tracks_batch(&[c_drive, d_drive.clone()])
            .expect("seed drive tracks");

        assert!(db.delete_tracks_by_folder("C:/").is_err());
        assert_eq!(
            db.delete_tracks_for_library_source("C:/")
                .expect("clean revoked drive root"),
            1
        );
        assert_eq!(
            db.get_tracks_by_ids(&[d_drive.id])
                .expect("remaining drive track")
                .len(),
            1
        );
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
                 VALUES (?1, ?2, ?3, ?4, NULL, 180, ?5, 0, NULL, ?6, 7, 20, 5)",
                params![backslash_path, "Backslash", "Artist", "Album", backslash_path, now],
            )
            .expect("insert backslash track");
            conn.execute(
                "INSERT INTO tracks (id, title, artist, album, year, duration, file_path, has_cover_art, cover_art_hash, date_added, play_count, last_played, rating)
                 VALUES (?1, ?2, ?3, ?4, NULL, 180, ?5, 0, NULL, ?6, 3, 10, NULL)",
                params![slash_path, "Slash", "Artist", "Album", slash_path, now + 1],
            )
            .expect("insert slash track");
            conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at, snapshot_title, snapshot_file_path) VALUES (?1, ?2, 0, ?3, 'Backslash snapshot', ?4)",
                params!["pl_cleanup", backslash_path, now, backslash_path],
            )
            .expect("insert backslash playlist track");
            conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at, snapshot_artist, snapshot_file_path) VALUES (?1, ?2, 1, ?3, 'Slash snapshot artist', ?4)",
                params!["pl_cleanup", slash_path, now + 1, slash_path],
            )
            .expect("insert slash playlist track");
            conn.execute(
                "INSERT INTO lyrics_index (track_id, lyrics_path, lyrics_mtime, content) VALUES (?1, ?2, 1, 'old line')",
                params![backslash_path, r"C:\music\song.lrc"],
            )
            .expect("insert backslash lyrics index");
            conn.execute(
                "INSERT INTO lyrics_index (track_id, lyrics_path, lyrics_mtime, content) VALUES (?1, ?2, 2, 'new line')",
                params![slash_path, "C:/music/song.lrc"],
            )
            .expect("insert slash lyrics index");
        }

        db.cleanup_duplicates_and_normalize()
            .expect("cleanup_duplicates_and_normalize");

        let tracks = db.get_all_tracks().expect("read tracks");
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].id, slash_path);
        assert_eq!(tracks[0].file_path, slash_path);
        assert_eq!(tracks[0].title, "Slash");
        assert_eq!(tracks[0].rating, Some(5));
        assert_eq!(tracks[0].play_count, 10);
        assert_eq!(tracks[0].last_played, Some(20));
        assert_eq!(tracks[0].date_added, now);

        let playlist_entries = db
            .get_playlist_track_entries("pl_cleanup")
            .expect("read playlist entries");
        assert_eq!(playlist_entries.len(), 1);
        assert_eq!(playlist_entries[0].track_id, slash_path);
        assert_eq!(
            playlist_entries[0].snapshot_title.as_deref(),
            Some("Backslash snapshot")
        );
        assert_eq!(
            playlist_entries[0].snapshot_artist.as_deref(),
            Some("Slash snapshot artist")
        );
        assert_eq!(
            playlist_entries[0].snapshot_file_path.as_deref(),
            Some(slash_path)
        );

        let lyrics_entries = db.get_lyrics_index_meta().expect("read lyrics index");
        assert_eq!(lyrics_entries.len(), 1);
        assert_eq!(lyrics_entries[0].track_id, slash_path);
        assert_eq!(lyrics_entries[0].lyrics_path, "C:/music/song.lrc");
        assert_eq!(lyrics_entries[0].lyrics_mtime, 2);
        let lyrics_content: String = db
            .conn
            .lock()
            .query_row(
                "SELECT content FROM lyrics_index WHERE track_id = ?1",
                [slash_path],
                |row| row.get(0),
            )
            .expect("read merged lyrics content");
        assert_eq!(lyrics_content, "new line");
    }

    #[cfg(windows)]
    #[test]
    fn reconcile_accepts_verbatim_prefixed_folder_with_public_discovered_paths() {
        let db = test_db();
        let mut track = sample_track("verbatim");
        track.id = "C:/music/song.mp3".to_string();
        track.file_path = track.id.clone();

        let result = db
            .reconcile_folder_scan(ScanReconcileRequest {
                folder_path: "//?/C:/music".to_string(),
                discovered_paths: vec!["C:/music/song.mp3".to_string()],
                tracks: vec![track.clone()],
                traversal_complete: true,
                errors: vec![],
            })
            .expect("reconcile verbatim folder path");

        assert_eq!(result.status, "complete");
        assert_eq!(result.added_count, 1);
        let stored = db
            .get_tracks_by_ids(&["C:/music/song.mp3".to_string()])
            .expect("read reconciled track");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].file_path, "C:/music/song.mp3");
    }

    #[cfg(windows)]
    #[test]
    fn cleanup_normalizes_verbatim_prefixed_legacy_rows() {
        let db = test_db();
        let now = now_millis_i64_or_default();
        let verbatim_path = "//?/C:/music/song.mp3";
        let public_path = "C:/music/song.mp3";

        db.create_playlist(&sample_playlist("pl_verbatim"))
            .expect("create playlist");

        {
            let conn = db.conn.lock();
            conn.execute(
                "INSERT INTO tracks (id, title, artist, album, year, duration, file_path, has_cover_art, cover_art_hash, date_added, play_count, last_played, rating)
                 VALUES (?1, ?2, ?3, ?4, NULL, 180, ?5, 0, NULL, ?6, 7, 20, 5)",
                params![verbatim_path, "Verbatim", "Artist", "Album", verbatim_path, now],
            )
            .expect("insert verbatim track");
            conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at, snapshot_title, snapshot_file_path) VALUES (?1, ?2, 0, ?3, 'Verbatim snapshot', ?4)",
                params!["pl_verbatim", verbatim_path, now, verbatim_path],
            )
            .expect("insert verbatim playlist track");
            conn.execute(
                "INSERT INTO lyrics_index (track_id, lyrics_path, lyrics_mtime, content) VALUES (?1, ?2, 1, 'verbatim line')",
                params![verbatim_path, "//?/C:/music/song.lrc"],
            )
            .expect("insert verbatim lyrics index");
        }

        db.cleanup_duplicates_and_normalize()
            .expect("cleanup_duplicates_and_normalize");

        let tracks = db.get_all_tracks().expect("read tracks");
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].id, public_path);
        assert_eq!(tracks[0].file_path, public_path);

        let playlist_entries = db
            .get_playlist_track_entries("pl_verbatim")
            .expect("read playlist entries");
        assert_eq!(playlist_entries.len(), 1);
        assert_eq!(playlist_entries[0].track_id, public_path);
        assert_eq!(
            playlist_entries[0].snapshot_file_path.as_deref(),
            Some(public_path)
        );

        let lyrics_entries = db.get_lyrics_index_meta().expect("read lyrics index");
        assert_eq!(lyrics_entries.len(), 1);
        assert_eq!(lyrics_entries[0].track_id, public_path);
        assert_eq!(lyrics_entries[0].lyrics_path, "C:/music/song.lrc");
    }
}
