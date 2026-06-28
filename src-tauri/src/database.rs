use parking_lot::Mutex;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::async_runtime::spawn_blocking;

const CURRENT_SCHEMA_VERSION: i32 = 7;
const PATH_NORMALIZATION_CLEANUP_KEY: &str = "path-normalization-cleanup-v1";
const DB_GET_ALL_TRACKS_HARD_LIMIT: i64 = 50_000;

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

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Normalize file paths by replacing backslashes with forward slashes.
    /// This ensures consistent path representation across Windows and Unix-like systems.
    fn normalize_path(path: &str) -> String {
        path.replace('\\', "/")
    }

    pub fn new() -> SqliteResult<Self> {
        let db_path = get_database_path();

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(&db_path)?;

        // Enable WAL mode for better concurrent performance
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;

        let db = Self {
            conn: Mutex::new(conn),
        };

        db.run_migrations()?;
        db.ensure_path_cleanup_once()?;

        Ok(db)
    }

    fn run_migrations(&self) -> SqliteResult<()> {
        let mut conn = self.conn.lock();

        // Create schema version table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)",
            [],
        )?;

        let current_version: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if current_version < 1 {
            self.apply_migration_tx(&mut conn, 1, |tx| self.migrate_v1(tx))?;
        }

        if current_version < 2 {
            self.apply_migration_tx(&mut conn, 2, |tx| self.migrate_v2(tx))?;
        }

        if current_version < 3 {
            self.apply_migration_tx(&mut conn, 3, |tx| self.migrate_v3(tx))?;
        }

        if current_version < 4 {
            self.apply_migration_tx(&mut conn, 4, |tx| self.migrate_v4(tx))?;
        }

        if current_version < 5 {
            self.apply_migration_tx(&mut conn, 5, |tx| self.migrate_v5(tx))?;
        }

        if current_version < 6 {
            self.apply_migration_tx(&mut conn, 6, |tx| self.migrate_v6(tx))?;
        }

        if current_version < CURRENT_SCHEMA_VERSION {
            self.apply_migration_tx(&mut conn, CURRENT_SCHEMA_VERSION, |tx| self.migrate_v7(tx))?;
        }

        // Guard against schema drift: ensure lyrics index schema exists even if
        // schema_version metadata is stale or manually modified.
        self.ensure_lyrics_schema(&conn)?;

        Ok(())
    }

    fn apply_migration_tx<F>(
        &self,
        conn: &mut Connection,
        version: i32,
        migrate: F,
    ) -> SqliteResult<()>
    where
        F: FnOnce(&Connection) -> SqliteResult<()>,
    {
        let tx = conn.transaction()?;
        migrate(&tx)?;
        tx.execute(
            "INSERT INTO schema_version (version) VALUES (?1)",
            [version],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn ensure_path_cleanup_once(&self) -> SqliteResult<()> {
        let mut conn = self.conn.lock();
        let already_cleaned = conn
            .query_row(
                "SELECT 1 FROM cache_metadata WHERE key = ?1 LIMIT 1",
                [PATH_NORMALIZATION_CLEANUP_KEY],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some();

        if already_cleaned {
            return Ok(());
        }

        let tx = conn.transaction()?;
        self.cleanup_duplicates_and_normalize_with_conn(&tx)?;
        tx.execute(
            r#"
            INSERT INTO cache_metadata (key, value, created_at, expires_at)
            VALUES (?1, 'done', ?2, NULL)
            ON CONFLICT(key) DO UPDATE
            SET value = excluded.value,
                created_at = excluded.created_at,
                expires_at = NULL
            "#,
            params![PATH_NORMALIZATION_CLEANUP_KEY, now_millis_i64_or_default()],
        )?;
        tx.commit()?;
        Ok(())
    }

    #[cfg(test)]
    fn cleanup_duplicates_and_normalize(&self) -> SqliteResult<()> {
        let conn = self.conn.lock();
        self.cleanup_duplicates_and_normalize_with_conn(&conn)
    }

    fn cleanup_duplicates_and_normalize_with_conn(&self, conn: &Connection) -> SqliteResult<()> {
        // Dedupe playlist memberships that collapse to the same normalized track id.
        // This prevents primary-key conflicts when normalizing `track_id` values.
        conn.execute(
            r#"
            DELETE FROM playlist_tracks
            WHERE rowid NOT IN (
                SELECT MIN(rowid)
                FROM playlist_tracks
                GROUP BY playlist_id, REPLACE(track_id, '\', '/')
            )
            "#,
            [],
        )?;

        // Normalize playlist track ids.
        conn.execute(
            "UPDATE playlist_tracks SET track_id = REPLACE(track_id, '\\', '/') WHERE track_id LIKE '%\\%'",
            [],
        )?;

        // Dedupe tracks that collapse to the same normalized file path.
        // This prevents unique-key conflicts when normalizing `file_path` and `id`.
        conn.execute(
            r#"
            DELETE FROM tracks 
            WHERE rowid NOT IN (
                SELECT MIN(rowid) 
                FROM tracks 
                GROUP BY REPLACE(file_path, '\', '/')
            )
            "#,
            [],
        )?;

        // Final cleanup: normalize remaining path/id values.
        conn.execute(
            "UPDATE tracks SET file_path = REPLACE(file_path, '\\', '/'), id = REPLACE(id, '\\', '/') WHERE file_path LIKE '%\\%' OR id LIKE '%\\%'",
            [],
        )?;

        Ok(())
    }
    fn migrate_v1(&self, conn: &Connection) -> SqliteResult<()> {
        // Main tracks table
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS tracks (
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
            
            CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
            CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
            CREATE INDEX IF NOT EXISTS idx_tracks_date_added ON tracks(date_added DESC);
            CREATE INDEX IF NOT EXISTS idx_tracks_play_count ON tracks(play_count DESC);
            CREATE INDEX IF NOT EXISTS idx_tracks_file_path ON tracks(file_path);
            
            -- FTS5 virtual table for full-text search
            CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
                title, artist, album,
                content='tracks',
                content_rowid='rowid'
            );
            
            -- Triggers to keep FTS in sync
            CREATE TRIGGER IF NOT EXISTS tracks_ai AFTER INSERT ON tracks BEGIN
                INSERT INTO tracks_fts(rowid, title, artist, album) 
                VALUES (NEW.rowid, NEW.title, NEW.artist, NEW.album);
            END;
            
            CREATE TRIGGER IF NOT EXISTS tracks_ad AFTER DELETE ON tracks BEGIN
                INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album) 
                VALUES ('delete', OLD.rowid, OLD.title, OLD.artist, OLD.album);
            END;
            
            CREATE TRIGGER IF NOT EXISTS tracks_au AFTER UPDATE ON tracks BEGIN
                INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album) 
                VALUES ('delete', OLD.rowid, OLD.title, OLD.artist, OLD.album);
                INSERT INTO tracks_fts(rowid, title, artist, album) 
                VALUES (NEW.rowid, NEW.title, NEW.artist, NEW.album);
            END;
            
            -- Playlists table
            CREATE TABLE IF NOT EXISTS playlists (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                playlist_type TEXT NOT NULL DEFAULT 'manual',
                folder_path TEXT,
                smart_rules TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                pinned_at INTEGER
            );
            
            -- Playlist tracks junction table
            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_id TEXT NOT NULL,
                track_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                added_at INTEGER NOT NULL,
                snapshot_title TEXT,
                snapshot_artist TEXT,
                snapshot_album TEXT,
                snapshot_duration REAL,
                snapshot_file_path TEXT,
                snapshot_has_cover_art INTEGER NOT NULL DEFAULT 0,
                snapshot_cover_art_hash TEXT,
                snapshot_blurhash TEXT,
                PRIMARY KEY (playlist_id, track_id),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position);
            
            -- Cache metadata table
            CREATE TABLE IF NOT EXISTS cache_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER
            );
            "#,
        )?;

        Ok(())
    }

    fn migrate_v2(&self, conn: &Connection) -> SqliteResult<()> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS lyrics_index (
                track_id TEXT PRIMARY KEY,
                lyrics_path TEXT NOT NULL,
                lyrics_mtime INTEGER NOT NULL,
                content TEXT NOT NULL,
                FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_lyrics_index_track_id ON lyrics_index(track_id);
            CREATE INDEX IF NOT EXISTS idx_lyrics_index_path ON lyrics_index(lyrics_path);
            CREATE INDEX IF NOT EXISTS idx_lyrics_index_mtime ON lyrics_index(lyrics_mtime);

            CREATE VIRTUAL TABLE IF NOT EXISTS lyrics_fts USING fts5(
                content,
                content='lyrics_index',
                content_rowid='rowid'
            );

            CREATE TRIGGER IF NOT EXISTS lyrics_index_ai AFTER INSERT ON lyrics_index BEGIN
                INSERT INTO lyrics_fts(rowid, content)
                VALUES (NEW.rowid, NEW.content);
            END;

            CREATE TRIGGER IF NOT EXISTS lyrics_index_ad AFTER DELETE ON lyrics_index BEGIN
                INSERT INTO lyrics_fts(lyrics_fts, rowid, content)
                VALUES ('delete', OLD.rowid, OLD.content);
            END;

            CREATE TRIGGER IF NOT EXISTS lyrics_index_au AFTER UPDATE ON lyrics_index BEGIN
                INSERT INTO lyrics_fts(lyrics_fts, rowid, content)
                VALUES ('delete', OLD.rowid, OLD.content);
                INSERT INTO lyrics_fts(rowid, content)
                VALUES (NEW.rowid, NEW.content);
            END;
            "#,
        )?;
        Ok(())
    }

    fn migrate_v3(&self, conn: &Connection) -> SqliteResult<()> {
        let mut stmt = conn.prepare("PRAGMA table_info(playlists)")?;
        let mut has_last_synced = false;
        let mut has_sync_error = false;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for name in rows.flatten() {
            if name == "last_synced_at" {
                has_last_synced = true;
            } else if name == "sync_error" {
                has_sync_error = true;
            }
        }

        if !has_last_synced {
            conn.execute(
                "ALTER TABLE playlists ADD COLUMN last_synced_at INTEGER",
                [],
            )?;
        }
        if !has_sync_error {
            conn.execute("ALTER TABLE playlists ADD COLUMN sync_error TEXT", [])?;
        }
        Ok(())
    }

    fn migrate_v4(&self, conn: &Connection) -> SqliteResult<()> {
        let mut stmt = conn.prepare("PRAGMA table_info(playlist_tracks)")?;
        let mut has_snapshot_title = false;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for name in rows.flatten() {
            if name == "snapshot_title" {
                has_snapshot_title = true;
                break;
            }
        }

        if has_snapshot_title {
            return Ok(());
        }

        let duplicate_memberships: i64 = conn.query_row(
            r#"
            SELECT COALESCE(SUM(dup_count - 1), 0)
            FROM (
                SELECT COUNT(*) AS dup_count
                FROM playlist_tracks
                GROUP BY playlist_id, track_id
                HAVING COUNT(*) > 1
            )
            "#,
            [],
            |row| row.get(0),
        )?;
        if duplicate_memberships > 0 {
            eprintln!(
                "migrate_v4: detected {} duplicate playlist membership rows; preserving one per (playlist_id, track_id)",
                duplicate_memberships
            );
        }

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS playlist_tracks_v4 (
                playlist_id TEXT NOT NULL,
                track_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                added_at INTEGER NOT NULL,
                snapshot_title TEXT,
                snapshot_artist TEXT,
                snapshot_album TEXT,
                snapshot_duration REAL,
                snapshot_file_path TEXT,
                snapshot_has_cover_art INTEGER NOT NULL DEFAULT 0,
                snapshot_cover_art_hash TEXT,
                snapshot_blurhash TEXT,
                PRIMARY KEY (playlist_id, track_id),
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
            );

            INSERT OR IGNORE INTO playlist_tracks_v4 (
                playlist_id,
                track_id,
                position,
                added_at,
                snapshot_title,
                snapshot_artist,
                snapshot_album,
                snapshot_duration,
                snapshot_file_path,
                snapshot_has_cover_art,
                snapshot_cover_art_hash
            )
            SELECT
                pt.playlist_id,
                pt.track_id,
                pt.position,
                pt.added_at,
                t.title,
                t.artist,
                t.album,
                t.duration,
                t.file_path,
                COALESCE(t.has_cover_art, 0),
                t.cover_art_hash
            FROM playlist_tracks pt
            LEFT JOIN tracks t ON t.id = pt.track_id;

            DROP TABLE playlist_tracks;
            ALTER TABLE playlist_tracks_v4 RENAME TO playlist_tracks;
            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id, position);
            "#,
        )?;

        Ok(())
    }

    fn migrate_v5(&self, conn: &Connection) -> SqliteResult<()> {
        let mut stmt = conn.prepare("PRAGMA table_info(playlists)")?;
        let mut has_is_pinned = false;
        let mut has_pinned_at = false;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for name in rows.flatten() {
            if name == "is_pinned" {
                has_is_pinned = true;
            } else if name == "pinned_at" {
                has_pinned_at = true;
            }
        }

        if !has_is_pinned {
            conn.execute(
                "ALTER TABLE playlists ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }

        if !has_pinned_at {
            conn.execute("ALTER TABLE playlists ADD COLUMN pinned_at INTEGER", [])?;
        }

        Ok(())
    }

    fn migrate_v6(&self, conn: &Connection) -> SqliteResult<()> {
        let mut stmt = conn.prepare("PRAGMA table_info(tracks)")?;
        let mut has_blurhash = false;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for name in rows.flatten() {
            if name == "blurhash" {
                has_blurhash = true;
                break;
            }
        }

        if !has_blurhash {
            conn.execute("ALTER TABLE tracks ADD COLUMN blurhash TEXT", [])?;
        }

        let mut stmt = conn.prepare("PRAGMA table_info(playlist_tracks)")?;
        let mut has_snapshot_blurhash = false;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for name in rows.flatten() {
            if name == "snapshot_blurhash" {
                has_snapshot_blurhash = true;
                break;
            }
        }

        if !has_snapshot_blurhash {
            conn.execute(
                "ALTER TABLE playlist_tracks ADD COLUMN snapshot_blurhash TEXT",
                [],
            )?;
        }

        Ok(())
    }

    fn migrate_v7(&self, conn: &Connection) -> SqliteResult<()> {
        let mut stmt = conn.prepare("PRAGMA table_info(tracks)")?;
        let mut has_album_artist = false;
        let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for name in rows.flatten() {
            if name == "album_artist" {
                has_album_artist = true;
                break;
            }
        }

        if !has_album_artist {
            conn.execute("ALTER TABLE tracks ADD COLUMN album_artist TEXT", [])?;
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_tracks_album_artist ON tracks(album_artist)",
                [],
            )?;
        }

        Ok(())
    }

    fn ensure_lyrics_schema(&self, conn: &Connection) -> SqliteResult<()> {
        let had_lyrics_fts = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='lyrics_fts')",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            != 0;

        // If FTS was missing and got recreated, rebuild from existing lyrics_index rows.
        if !had_lyrics_fts {
            self.migrate_v2(conn)?;
            let _ = conn.execute("INSERT INTO lyrics_fts(lyrics_fts) VALUES ('rebuild')", []);
        }

        Ok(())
    }

    // ========== Track Operations ==========

    pub fn upsert_tracks_batch(&self, tracks: &[DbTrack]) -> SqliteResult<usize> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;

        {
            let mut stmt = tx.prepare_cached(
                r#"
                INSERT INTO tracks (id, title, artist, album_artist, album, year, duration, file_path, 
                                   has_cover_art, cover_art_hash, blurhash, date_added, play_count, last_played, rating)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                ON CONFLICT(file_path) DO UPDATE SET
                    id = excluded.id,
                    title = excluded.title,
                    artist = excluded.artist,
                    album_artist = excluded.album_artist,
                    album = excluded.album,
                    year = excluded.year,
                    duration = excluded.duration,
                    has_cover_art = excluded.has_cover_art,
                    cover_art_hash = excluded.cover_art_hash,
                    blurhash = excluded.blurhash
                "#,
            )?;

            for track in tracks {
                // Normalize paths to ensure consistent representation
                let normalized_id = Self::normalize_path(&track.id);
                let normalized_file_path = Self::normalize_path(&track.file_path);

                stmt.execute(params![
                    &normalized_id,
                    &track.title,
                    &track.artist,
                    &track.album_artist,
                    &track.album,
                    track.year,
                    track.duration,
                    &normalized_file_path,
                    track.has_cover_art as i32,
                    &track.cover_art_hash,
                    &track.blurhash,
                    track.date_added,
                    track.play_count,
                    track.last_played,
                    track.rating,
                ])?;
            }
        }

        tx.commit()?;
        Ok(tracks.len())
    }

    pub fn delete_tracks(&self, ids: &[String]) -> SqliteResult<usize> {
        if ids.is_empty() {
            return Ok(0);
        }
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let mut removed = 0;
        {
            let mut stmt = tx.prepare_cached("DELETE FROM tracks WHERE id = ?1")?;
            for id in ids {
                let normalized_id = Self::normalize_path(id);
                removed += stmt.execute([&normalized_id])?;
            }
        }
        tx.commit()?;
        Ok(removed)
    }

    pub fn rename_track_path(&self, old_path: &str, new_path: &str) -> SqliteResult<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        // Normalize both paths for consistent database operations
        let normalized_old = Self::normalize_path(old_path);
        let normalized_new = Self::normalize_path(new_path);
        tx.execute(
            "UPDATE playlist_tracks SET track_id = ?1 WHERE track_id = ?2",
            params![normalized_new, normalized_old],
        )?;
        tx.execute(
            "UPDATE tracks SET id = ?1, file_path = ?1 WHERE file_path = ?2",
            params![normalized_new, normalized_old],
        )?;
        tx.commit()?;
        Ok(())
    }

    fn map_db_track_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DbTrack> {
        Ok(DbTrack {
            id: row.get(0)?,
            title: row.get(1)?,
            artist: row.get(2)?,
            album_artist: row.get(3)?,
            album: row.get(4)?,
            year: row.get(5)?,
            duration: row.get(6)?,
            file_path: row.get(7)?,
            has_cover_art: row.get::<_, i32>(8)? != 0,
            cover_art_hash: row.get(9)?,
            blurhash: row.get(10)?,
            date_added: row.get(11)?,
            play_count: row.get(12)?,
            last_played: row.get(13)?,
            rating: row.get(14)?,
        })
    }

    fn map_search_result_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SearchResult> {
        Ok(SearchResult {
            id: row.get(0)?,
            title: row.get(1)?,
            artist: row.get(2)?,
            album: row.get(3)?,
            duration: row.get(4)?,
            file_path: row.get(5)?,
            cover_art_hash: row.get(6)?,
            blurhash: row.get(7)?,
        })
    }

    pub fn get_tracks_paginated(
        &self,
        offset: u32,
        limit: u32,
        sort_by: &str,
        sort_order: &str,
    ) -> SqliteResult<Vec<DbTrack>> {
        let conn = self.conn.lock();

        let order_clause = match sort_by {
            "title" => "title",
            "artist" => "artist",
            "album" => "album",
            "dateAdded" => "date_added",
            "playCount" => "play_count",
            "duration" => "duration",
            _ => "date_added",
        };

        let order_dir = if sort_order == "asc" { "ASC" } else { "DESC" };

        let query = format!(
            "SELECT id, title, artist, album_artist, album, year, duration, file_path, has_cover_art, 
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating
             FROM tracks ORDER BY {} {} LIMIT ?1 OFFSET ?2",
            order_clause, order_dir
        );

        let mut stmt = conn.prepare(&query)?;
        let tracks = stmt
            .query_map(params![limit, offset], Self::map_db_track_row)?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(tracks)
    }

    pub fn get_all_tracks(&self) -> SqliteResult<Vec<DbTrack>> {
        let conn = self.conn.lock();

        let mut stmt = conn.prepare(
            "SELECT id, title, artist, album_artist, album, year, duration, file_path, has_cover_art, 
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating
             FROM tracks ORDER BY date_added DESC",
        )?;

        let tracks = stmt
            .query_map([], Self::map_db_track_row)?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(tracks)
    }

    pub fn get_tracks_by_ids(&self, ids: &[String]) -> SqliteResult<Vec<DbTrack>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock();
        // Normalize IDs since they're typically file paths
        let normalized_ids: Vec<String> = ids.iter().map(|id| Self::normalize_path(id)).collect();
        let mut tracks_by_id: std::collections::HashMap<String, DbTrack> =
            std::collections::HashMap::with_capacity(normalized_ids.len());

        for chunk in normalized_ids.chunks(900) {
            let placeholders = (0..chunk.len())
                .map(|i| format!("?{}", i + 1))
                .collect::<Vec<_>>()
                .join(", ");
            let query = format!(
                "SELECT id, title, artist, album_artist, album, year, duration, file_path, has_cover_art, 
                        cover_art_hash, blurhash, date_added, play_count, last_played, rating
                 FROM tracks WHERE id IN ({})",
                placeholders
            );
            let mut stmt = conn.prepare(&query)?;
            let tracks = stmt
                .query_map(params_from_iter(chunk.iter()), Self::map_db_track_row)?
                .collect::<SqliteResult<Vec<_>>>()?;
            for track in tracks {
                tracks_by_id.insert(track.id.clone(), track);
            }
        }

        let mut ordered_tracks = Vec::with_capacity(normalized_ids.len());
        for id in &normalized_ids {
            if let Some(track) = tracks_by_id.get(id) {
                ordered_tracks.push(track.clone());
            }
        }

        Ok(ordered_tracks)
    }

    pub fn get_tracks_by_album_artist(
        &self,
        album: &str,
        artist: &str,
    ) -> SqliteResult<Vec<DbTrack>> {
        if album.trim().is_empty() || artist.trim().is_empty() {
            return Ok(Vec::new());
        }

        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, title, artist, album_artist, album, year, duration, file_path, has_cover_art,
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating
             FROM tracks
             WHERE album = ?1 AND COALESCE(NULLIF(album_artist, ''), artist) = ?2
             ORDER BY title COLLATE NOCASE ASC, file_path COLLATE NOCASE ASC",
        )?;

        let tracks = stmt
            .query_map(params![album, artist], Self::map_db_track_row)?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(tracks)
    }

    pub fn search_tracks(&self, query: &str, limit: u32) -> SqliteResult<Vec<SearchResult>> {
        let conn = self.conn.lock();

        let fts_terms = query
            .split_whitespace()
            .map(|word| {
                word.chars()
                    .filter(|ch| ch.is_alphanumeric() || *ch == '-' || *ch == '\'' || *ch == '.')
                    .collect::<String>()
            })
            .filter(|word| !word.is_empty())
            .map(|word| format!("\"{}\"*", word.replace('"', "\"\"")))
            .collect::<Vec<_>>();

        if !fts_terms.is_empty() {
            let search_query = fts_terms.join(" ");
            let mut stmt = conn.prepare(
                r#"
                SELECT t.id, t.title, t.artist, t.album, t.duration, t.file_path, t.cover_art_hash, t.blurhash
                FROM tracks t
                INNER JOIN tracks_fts fts ON t.rowid = fts.rowid
                WHERE tracks_fts MATCH ?1
                ORDER BY bm25(tracks_fts)
                LIMIT ?2
                "#,
            )?;

            match stmt.query_map(params![search_query, limit], Self::map_search_result_row) {
                Ok(rows) => {
                    let results = rows.collect::<SqliteResult<Vec<_>>>()?;
                    if !results.is_empty() {
                        return Ok(results);
                    }
                }
                Err(_) => {
                    // Fall through to LIKE search for punctuation-heavy or otherwise invalid FTS input.
                }
            };
        }

        let escaped_like = query
            .trim()
            .to_lowercase()
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let like_query = format!("%{}%", escaped_like);
        let mut stmt = conn.prepare(
            r#"
            SELECT id, title, artist, album, duration, file_path, cover_art_hash, blurhash
            FROM tracks
            WHERE LOWER(title) LIKE ?1 ESCAPE '\'
               OR LOWER(artist) LIKE ?1 ESCAPE '\'
               OR LOWER(album) LIKE ?1 ESCAPE '\'
            ORDER BY title COLLATE NOCASE ASC, artist COLLATE NOCASE ASC
            LIMIT ?2
            "#,
        )?;

        let results = stmt
            .query_map(params![like_query, limit], Self::map_search_result_row)?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(results)
    }

    pub fn get_existing_paths(&self, paths: &[String]) -> SqliteResult<Vec<String>> {
        if paths.is_empty() {
            return Ok(vec![]);
        }

        let conn = self.conn.lock();
        let normalized_paths: Vec<String> = paths.iter().map(|p| Self::normalize_path(p)).collect();
        let mut existing = Vec::new();

        for chunk in normalized_paths.chunks(900) {
            let placeholders = (0..chunk.len())
                .map(|i| format!("?{}", i + 1))
                .collect::<Vec<_>>()
                .join(", ");

            let query = format!(
                "SELECT file_path FROM tracks WHERE file_path IN ({})",
                placeholders
            );
            let mut stmt = conn.prepare(&query)?;
            let found: Vec<String> = stmt
                .query_map(params_from_iter(chunk.iter()), |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<SqliteResult<Vec<_>>>()?;
            existing.extend(found);
        }

        Ok(existing)
    }

    pub fn get_lyrics_index_meta(&self) -> SqliteResult<Vec<LyricsIndexMeta>> {
        let conn = self.conn.lock();
        let mut stmt =
            conn.prepare("SELECT track_id, lyrics_path, lyrics_mtime FROM lyrics_index")?;
        let rows = stmt
            .query_map([], |row| {
                Ok(LyricsIndexMeta {
                    track_id: row.get(0)?,
                    lyrics_path: row.get(1)?,
                    lyrics_mtime: row.get(2)?,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn upsert_lyrics_index_batch(&self, entries: &[LyricsIndexEntry]) -> SqliteResult<usize> {
        if entries.is_empty() {
            return Ok(0);
        }

        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare_cached(
                r#"
                INSERT INTO lyrics_index (track_id, lyrics_path, lyrics_mtime, content)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(track_id) DO UPDATE SET
                    lyrics_path = excluded.lyrics_path,
                    lyrics_mtime = excluded.lyrics_mtime,
                    content = excluded.content
                "#,
            )?;

            for entry in entries {
                stmt.execute(params![
                    Self::normalize_path(&entry.track_id),
                    entry.lyrics_path,
                    entry.lyrics_mtime,
                    entry.content,
                ])?;
            }
        }
        tx.commit()?;
        Ok(entries.len())
    }

    pub fn delete_lyrics_index_tracks(&self, track_ids: &[String]) -> SqliteResult<usize> {
        if track_ids.is_empty() {
            return Ok(0);
        }

        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let mut deleted = 0;
        let normalized_track_ids: Vec<String> = track_ids
            .iter()
            .map(|track_id| Self::normalize_path(track_id))
            .collect();
        for chunk in normalized_track_ids.chunks(900) {
            let placeholders = std::iter::repeat_n("?", chunk.len())
                .collect::<Vec<_>>()
                .join(", ");
            let query = format!(
                "DELETE FROM lyrics_index WHERE track_id IN ({})",
                placeholders
            );
            deleted += tx.execute(&query, params_from_iter(chunk.iter().map(String::as_str)))?;
        }
        tx.commit()?;
        Ok(deleted)
    }

    pub fn cleanup_lyrics_index_orphans(&self) -> SqliteResult<usize> {
        let conn = self.conn.lock();
        conn.execute(
            "DELETE FROM lyrics_index WHERE track_id NOT IN (SELECT id FROM tracks)",
            [],
        )
    }

    pub fn lyrics_index_count(&self) -> SqliteResult<i64> {
        let conn = self.conn.lock();
        conn.query_row("SELECT COUNT(*) FROM lyrics_index", [], |row| row.get(0))
    }

    pub fn search_lyrics_index_candidates(
        &self,
        query: &str,
        limit: u32,
    ) -> SqliteResult<Vec<LyricsSearchCandidate>> {
        if query.trim().is_empty() {
            return Ok(vec![]);
        }

        let conn = self.conn.lock();
        let map_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<LyricsSearchCandidate> {
            Ok(LyricsSearchCandidate {
                id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                duration: row.get(4)?,
                file_path: row.get(5)?,
                cover_art_hash: row.get(6)?,
                content: row.get(7)?,
            })
        };

        let fts_terms = query
            .split_whitespace()
            .map(|word| {
                word.chars()
                    .filter(|ch| ch.is_alphanumeric())
                    .collect::<String>()
            })
            .filter(|word| !word.is_empty())
            .map(|word| format!("\"{}\"*", word.replace('"', "\"\"")))
            .collect::<Vec<_>>();

        if !fts_terms.is_empty() {
            let search_query = fts_terms.join(" ");
            let mut stmt = conn.prepare(
                r#"
                SELECT t.id, t.title, t.artist, t.album, t.duration, t.file_path, t.cover_art_hash, li.content
                FROM lyrics_index li
                INNER JOIN tracks t ON t.id = li.track_id
                INNER JOIN lyrics_fts fts ON fts.rowid = li.rowid
                WHERE lyrics_fts MATCH ?1
                ORDER BY bm25(lyrics_fts)
                LIMIT ?2
                "#,
            )?;

            match stmt.query_map(params![search_query, limit], map_row) {
                Ok(rows) => {
                    let results = rows.collect::<SqliteResult<Vec<_>>>()?;
                    if !results.is_empty() {
                        return Ok(results);
                    }
                }
                Err(_) => {
                    // Fall through to LIKE search for punctuation-heavy or invalid FTS input.
                }
            };
        }

        let escaped_like = query
            .trim()
            .to_lowercase()
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let like_query = format!("%{}%", escaped_like);
        let mut stmt = conn.prepare(
            r#"
            SELECT t.id, t.title, t.artist, t.album, t.duration, t.file_path, t.cover_art_hash, li.content
            FROM lyrics_index li
            INNER JOIN tracks t ON t.id = li.track_id
            WHERE LOWER(li.content) LIKE ?1 ESCAPE '\'
            ORDER BY t.title COLLATE NOCASE ASC, t.artist COLLATE NOCASE ASC
            LIMIT ?2
            "#,
        )?;

        let results = stmt
            .query_map(params![like_query, limit], map_row)?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(results)
    }

    pub fn get_track_count(&self) -> SqliteResult<i64> {
        let conn = self.conn.lock();
        conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
    }

    #[allow(dead_code)]
    pub fn delete_track(&self, track_id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])?;
        Ok(())
    }

    pub fn delete_tracks_by_folder(&self, folder_path: &str) -> SqliteResult<usize> {
        let conn = self.conn.lock();
        // Normalize the folder path first
        let normalized_folder = Self::normalize_path(folder_path);
        let normalized = if normalized_folder.ends_with('/') {
            normalized_folder.clone()
        } else {
            format!("{}/", normalized_folder)
        };
        // Escape special LIKE characters with a backslash
        let escaped = normalized.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        // Query using normalized paths only (database should have normalized paths)
        let count = conn.execute(
            "DELETE FROM tracks WHERE file_path = ?1 OR file_path LIKE ?2 ESCAPE '\\'",
            params![normalized_folder, format!("{}%", escaped)],
        )?;
        Ok(count)
    }

    pub fn update_play_stats(&self, track_id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock();
        let normalized_id = Self::normalize_path(track_id);
        let now = now_unix_secs_i64();

        conn.execute(
            "UPDATE tracks SET play_count = play_count + 1, last_played = ?1 WHERE id = ?2",
            params![now, normalized_id],
        )?;
        Ok(())
    }

    pub fn set_track_rating(&self, track_id: &str, rating: Option<i32>) -> SqliteResult<()> {
        let conn = self.conn.lock();
        let normalized_id = Self::normalize_path(track_id);
        conn.execute(
            "UPDATE tracks SET rating = ?1 WHERE id = ?2",
            params![rating, normalized_id],
        )?;
        Ok(())
    }

    pub fn get_cover_art_hash(&self, file_path: &str) -> SqliteResult<Option<String>> {
        let conn = self.conn.lock();
        let normalized_path = Self::normalize_path(file_path);
        conn.query_row(
            "SELECT cover_art_hash FROM tracks WHERE file_path = ?1",
            params![normalized_path],
            |row| row.get(0),
        )
        .optional()
    }

    pub fn set_cover_art_hash(&self, file_path: &str, hash: &str) -> SqliteResult<()> {
        let conn = self.conn.lock();
        let normalized_path = Self::normalize_path(file_path);
        conn.execute(
            "UPDATE tracks SET cover_art_hash = ?1, has_cover_art = 1 WHERE file_path = ?2",
            params![hash, normalized_path],
        )?;
        Ok(())
    }

    // ========== Playlist Operations ==========

    pub fn get_playlist_count(&self) -> SqliteResult<i64> {
        let conn = self.conn.lock();
        conn.query_row("SELECT COUNT(*) FROM playlists", [], |row| row.get(0))
    }

    pub fn clear_playlists(&self) -> SqliteResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM playlists", [])?;
        Ok(())
    }

    pub fn create_playlist(&self, playlist: &DbPlaylist) -> SqliteResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            r#"
            INSERT INTO playlists (
              id, name, playlist_type, folder_path, smart_rules, created_at, updated_at, is_pinned, pinned_at, last_synced_at, sync_error
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#,
            params![
                playlist.id,
                playlist.name,
                playlist.playlist_type,
                playlist.folder_path,
                playlist.smart_rules,
                playlist.created_at,
                playlist.updated_at,
                playlist.is_pinned,
                playlist.pinned_at,
                playlist.last_synced_at,
                playlist.sync_error,
            ],
        )?;
        Ok(())
    }

    pub fn replace_playlist(&self, playlist: &DbPlaylist) -> SqliteResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            r#"
            UPDATE playlists
            SET name = ?2,
                playlist_type = ?3,
                folder_path = ?4,
                smart_rules = ?5,
                created_at = ?6,
                updated_at = ?7,
                is_pinned = ?8,
                pinned_at = ?9,
                last_synced_at = ?10,
                sync_error = ?11
            WHERE id = ?1
            "#,
            params![
                playlist.id,
                playlist.name,
                playlist.playlist_type,
                playlist.folder_path,
                playlist.smart_rules,
                playlist.created_at,
                playlist.updated_at,
                playlist.is_pinned,
                playlist.pinned_at,
                playlist.last_synced_at,
                playlist.sync_error,
            ],
        )?;
        Ok(())
    }

    pub fn get_all_playlists(&self) -> SqliteResult<Vec<DbPlaylist>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, playlist_type, folder_path, smart_rules, created_at, updated_at, is_pinned, pinned_at, last_synced_at, sync_error
             FROM playlists
             ORDER BY is_pinned DESC, COALESCE(pinned_at, 0) DESC, updated_at DESC, name COLLATE NOCASE ASC",
        )?;

        let playlists = stmt
            .query_map([], |row| {
                Ok(DbPlaylist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    playlist_type: row.get(2)?,
                    folder_path: row.get(3)?,
                    smart_rules: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                    is_pinned: row.get::<_, i32>(7)? != 0,
                    pinned_at: row.get(8)?,
                    last_synced_at: row.get(9)?,
                    sync_error: row.get(10)?,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(playlists)
    }

    pub fn get_playlist_by_id(&self, playlist_id: &str) -> SqliteResult<Option<DbPlaylist>> {
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT id, name, playlist_type, folder_path, smart_rules, created_at, updated_at, is_pinned, pinned_at, last_synced_at, sync_error
             FROM playlists
             WHERE id = ?1",
            params![playlist_id],
            |row| {
                Ok(DbPlaylist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    playlist_type: row.get(2)?,
                    folder_path: row.get(3)?,
                    smart_rules: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                    is_pinned: row.get::<_, i32>(7)? != 0,
                    pinned_at: row.get(8)?,
                    last_synced_at: row.get(9)?,
                    sync_error: row.get(10)?,
                })
            },
        )
        .optional()
    }

    pub fn get_playlist_track_entries(
        &self,
        playlist_id: &str,
    ) -> SqliteResult<Vec<DbPlaylistTrackEntry>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            r#"
            SELECT
                track_id,
                position,
                snapshot_title,
                snapshot_artist,
                snapshot_album,
                snapshot_duration,
                snapshot_file_path,
                snapshot_has_cover_art,
                snapshot_cover_art_hash,
                snapshot_blurhash
            FROM playlist_tracks
            WHERE playlist_id = ?1
            ORDER BY position ASC
            "#,
        )?;

        let entries = stmt
            .query_map(params![playlist_id], |row| {
                Ok(DbPlaylistTrackEntry {
                    track_id: row.get(0)?,
                    position: row.get(1)?,
                    snapshot_title: row.get(2)?,
                    snapshot_artist: row.get(3)?,
                    snapshot_album: row.get(4)?,
                    snapshot_duration: row.get(5)?,
                    snapshot_file_path: row.get(6)?,
                    snapshot_has_cover_art: row.get::<_, i32>(7)? != 0,
                    snapshot_cover_art_hash: row.get(8)?,
                    snapshot_blurhash: row.get(9)?,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;
        Ok(entries)
    }

    pub fn set_playlist_tracks(
        &self,
        playlist_id: &str,
        track_ids: &[String],
        updated_at: i64,
    ) -> SqliteResult<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;

        // Preserve snapshots for references that are no longer in the tracks table.
        let old_snapshots = {
            let mut old_snapshot_stmt = tx.prepare_cached(
                r#"
                SELECT
                    track_id,
                    snapshot_title,
                    snapshot_artist,
                    snapshot_album,
                    snapshot_duration,
                    snapshot_file_path,
                    snapshot_has_cover_art,
                    snapshot_cover_art_hash,
                    snapshot_blurhash
                FROM playlist_tracks
                WHERE playlist_id = ?1
                "#,
            )?;
            let rows = old_snapshot_stmt
                .query_map(params![playlist_id], |row| {
                    let track_id: String = row.get(0)?;
                    Ok((
                        Self::normalize_path(&track_id),
                        (
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, Option<f64>>(4)?,
                            row.get::<_, Option<String>>(5)?,
                            row.get::<_, i32>(6)?,
                            row.get::<_, Option<String>>(7)?,
                            row.get::<_, Option<String>>(8)?,
                        ),
                    ))
                })?
                .collect::<SqliteResult<Vec<_>>>()?;
            rows.into_iter().collect::<std::collections::HashMap<
                String,
                (
                    Option<String>,
                    Option<String>,
                    Option<String>,
                    Option<f64>,
                    Option<String>,
                    i32,
                    Option<String>,
                    Option<String>,
                ),
            >>()
        };

        tx.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist_id],
        )?;

        {
            let mut stmt = tx.prepare_cached(
                r#"
                INSERT OR IGNORE INTO playlist_tracks (
                    playlist_id,
                    track_id,
                    position,
                    added_at,
                    snapshot_title,
                    snapshot_artist,
                    snapshot_album,
                    snapshot_duration,
                    snapshot_file_path,
                    snapshot_has_cover_art,
                    snapshot_cover_art_hash,
                    snapshot_blurhash
                )
                SELECT
                    ?1,
                    ?2,
                    ?3,
                    ?4,
                    COALESCE(t.title, ?5),
                    COALESCE(t.artist, ?6),
                    COALESCE(t.album, ?7),
                    COALESCE(t.duration, ?8),
                    COALESCE(t.file_path, ?9),
                    COALESCE(t.has_cover_art, ?10),
                    COALESCE(t.cover_art_hash, ?11),
                    COALESCE(t.blurhash, ?12)
                FROM (SELECT 1)
                LEFT JOIN tracks t ON t.id = ?2
                "#,
            )?;
            for (i, track_id) in track_ids.iter().enumerate() {
                let normalized = Self::normalize_path(track_id);
                let snapshot = old_snapshots.get(&normalized);
                stmt.execute(params![
                    playlist_id,
                    normalized,
                    i as i32,
                    updated_at,
                    snapshot.and_then(|value| value.0.clone()),
                    snapshot.and_then(|value| value.1.clone()),
                    snapshot.and_then(|value| value.2.clone()),
                    snapshot.and_then(|value| value.3),
                    snapshot.and_then(|value| value.4.clone()),
                    snapshot.map(|value| value.5).unwrap_or(0),
                    snapshot.and_then(|value| value.6.clone()),
                    snapshot.and_then(|value| value.7.clone()),
                ])?;
            }
        }

        tx.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![updated_at, playlist_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn add_tracks_to_playlist(
        &self,
        playlist_id: &str,
        track_ids: &[String],
    ) -> SqliteResult<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;

        let now = now_millis_i64_or_default();

        // Get current max position
        let max_pos: i32 = tx
            .query_row(
                "SELECT COALESCE(MAX(position), 0) FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        {
            let mut stmt = tx.prepare_cached(
                r#"
                INSERT OR IGNORE INTO playlist_tracks (
                    playlist_id,
                    track_id,
                    position,
                    added_at,
                    snapshot_title,
                    snapshot_artist,
                    snapshot_album,
                    snapshot_duration,
                    snapshot_file_path,
                    snapshot_has_cover_art,
                    snapshot_cover_art_hash,
                    snapshot_blurhash
                )
                SELECT
                    ?1,
                    ?2,
                    ?3,
                    ?4,
                    t.title,
                    t.artist,
                    t.album,
                    t.duration,
                    t.file_path,
                    COALESCE(t.has_cover_art, 0),
                    t.cover_art_hash,
                    t.blurhash
                FROM (SELECT 1)
                LEFT JOIN tracks t ON t.id = ?2
                "#,
            )?;

            for (i, track_id) in track_ids.iter().enumerate() {
                let normalized = Self::normalize_path(track_id);
                stmt.execute(params![
                    playlist_id,
                    normalized,
                    max_pos + 1 + i as i32,
                    now
                ])?;
            }
        }

        // Update playlist timestamp
        tx.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now, playlist_id],
        )?;

        tx.commit()?;
        Ok(())
    }

    pub fn remove_tracks_from_playlist(
        &self,
        playlist_id: &str,
        track_ids: &[String],
    ) -> SqliteResult<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let normalized_track_ids: Vec<String> = track_ids
            .iter()
            .map(|track_id| Self::normalize_path(track_id))
            .collect();
        for chunk in normalized_track_ids.chunks(900) {
            let placeholders = std::iter::repeat_n("?", chunk.len())
                .collect::<Vec<_>>()
                .join(", ");
            let query = format!(
                "DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id IN ({})",
                placeholders
            );
            let params_iter = std::iter::once(playlist_id).chain(chunk.iter().map(String::as_str));
            tx.execute(&query, params_from_iter(params_iter))?;
        }

        // Update playlist timestamp
        let now = now_millis_i64_or_default();
        tx.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now, playlist_id],
        )?;

        tx.commit()?;
        Ok(())
    }

    pub fn set_playlist_sync_state(
        &self,
        playlist_id: &str,
        last_synced_at: Option<i64>,
        sync_error: Option<&str>,
        updated_at: i64,
    ) -> SqliteResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE playlists
             SET last_synced_at = ?1, sync_error = ?2, updated_at = ?3
             WHERE id = ?4",
            params![last_synced_at, sync_error, updated_at, playlist_id],
        )?;
        Ok(())
    }

    pub fn set_playlist_pinned(
        &self,
        playlist_id: &str,
        is_pinned: bool,
        pinned_at: Option<i64>,
        updated_at: i64,
    ) -> SqliteResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE playlists
             SET is_pinned = ?1, pinned_at = ?2, updated_at = ?3
             WHERE id = ?4",
            params![is_pinned, pinned_at, updated_at, playlist_id],
        )?;
        Ok(())
    }

    pub fn delete_playlist(&self, playlist_id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM playlists WHERE id = ?1", params![playlist_id])?;
        Ok(())
    }

    // ========== Smart Playlist Queries ==========

    pub fn get_recently_added(&self, days: i32, limit: u32) -> SqliteResult<Vec<DbTrack>> {
        let conn = self.conn.lock();
        let cutoff = now_millis_i64_or_default() - (days as i64 * 24 * 60 * 60 * 1000);

        let mut stmt = conn.prepare(
            "SELECT id, title, artist, album_artist, album, year, duration, file_path, has_cover_art, 
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating
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
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating
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

        let conn = self.conn.lock();
        let mut weighted: Vec<(String, String, f64)> = Vec::new();
        for raw_id in &track_ids {
            let normalized_id = Self::normalize_path(raw_id);
            let row = conn.query_row(
                "SELECT id, artist, play_count, last_played FROM tracks WHERE id = ?1",
                params![normalized_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i32>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            );
            if let Ok((id, artist, play_count, last_played)) = row {
                let base = 1.0 / (play_count as f64 + 1.0);
                let now = now_unix_secs_i64();
                let seven_days_secs: i64 = 7 * 24 * 3600;
                let recency = match last_played {
                    None => 2.0,
                    Some(ts) if now.saturating_sub(ts) > seven_days_secs => 2.0,
                    _ => 1.0,
                };
                weighted.push((id, artist, base * recency));
            }
        }

        if weighted.is_empty() {
            return Ok(track_ids);
        }

        let mut rng = rand::thread_rng();
        let mut ordered: Vec<(String, String)> = Vec::with_capacity(weighted.len());
        while !weighted.is_empty() {
            let total: f64 = weighted.iter().map(|(_, _, w)| w).sum();
            if total <= 0.0 {
                break;
            }
            let mut pick = rng.gen::<f64>() * total;
            let mut idx = weighted.len().saturating_sub(1);
            for (i, (_, _, w)) in weighted.iter().enumerate() {
                pick -= w;
                if pick <= 0.0 {
                    idx = i;
                    break;
                }
            }
            let (id, artist, _) = weighted.swap_remove(idx);
            ordered.push((id, artist));
        }

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

fn get_database_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("music-player")
        .join("library.db")
}

pub fn get_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("music-player")
}

// Shared database instance
pub type SharedDatabase = Arc<Database>;

pub fn create_database() -> Result<SharedDatabase, String> {
    Database::new()
        .map(Arc::new)
        .map_err(|e| format!("Failed to create database: {}", e))
}

// ========== Tauri Commands ==========

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
) -> Result<usize, String> {
    let db = db.inner().clone();
    spawn_blocking(move || db.upsert_tracks_batch(&tracks))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
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
        }
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
    fn deleting_tracks_keeps_playlist_references_for_unavailable_entries() {
        let db = test_db();
        db.upsert_tracks_batch(&[sample_track("a")])
            .expect("seed track");
        db.create_playlist(&sample_playlist("pl_3"))
            .expect("create playlist");
        db.set_playlist_tracks("pl_3", &["a".to_string()], now_millis_i64_or_default())
            .expect("set playlist tracks");

        db.delete_tracks(&["a".to_string()]).expect("delete track");

        let ids = db
            .get_playlist_track_entries("pl_3")
            .expect("read playlist tracks")
            .into_iter()
            .map(|entry| entry.track_id)
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["a".to_string()]);
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
                "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?1, ?2, 0, ?3)",
                params!["pl_cleanup", backslash_path, now],
            )
            .expect("insert backslash playlist track");
            conn.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at) VALUES (?1, ?2, 1, ?3)",
                params!["pl_cleanup", slash_path, now + 1],
            )
            .expect("insert slash playlist track");
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
    }
}
