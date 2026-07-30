use super::*;

impl Database {
    pub(super) fn run_migrations(&self) -> SqliteResult<()> {
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

        if current_version < 7 {
            self.apply_migration_tx(&mut conn, 7, |tx| self.migrate_v7(tx))?;
        }

        if current_version < CURRENT_SCHEMA_VERSION {
            self.apply_migration_tx(&mut conn, CURRENT_SCHEMA_VERSION, |tx| self.migrate_v8(tx))?;
        }

        // Guard against schema drift: ensure lyrics index schema exists even if
        // schema_version metadata is stale or manually modified.
        self.ensure_lyrics_schema(&conn)?;

        Ok(())
    }

    pub(super) fn apply_migration_tx<F>(
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

    pub(super) fn ensure_path_cleanup_once(&self) -> SqliteResult<()> {
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

    #[cfg(all(test, windows))]
    pub(super) fn cleanup_duplicates_and_normalize(&self) -> SqliteResult<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        self.cleanup_duplicates_and_normalize_with_conn(&tx)?;
        tx.commit()
    }

    pub(super) fn cleanup_duplicates_and_normalize_with_conn(
        &self,
        conn: &Connection,
    ) -> SqliteResult<()> {
        #[cfg(not(windows))]
        {
            let _ = conn;
            Ok(())
        }

        #[cfg(windows)]
        {
            conn.execute_batch("PRAGMA defer_foreign_keys=ON;")?;

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

            // Normalize playlist path fields.
            conn.execute(
                "UPDATE playlist_tracks
             SET track_id = REPLACE(track_id, '\\', '/'),
                 snapshot_file_path = CASE
                     WHEN snapshot_file_path LIKE '%\\%' THEN REPLACE(snapshot_file_path, '\\', '/')
                     ELSE snapshot_file_path
                 END
             WHERE track_id LIKE '%\\%' OR snapshot_file_path LIKE '%\\%'",
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

            conn.execute(
                "UPDATE lyrics_index
             SET track_id = REPLACE(track_id, '\\', '/'),
                 lyrics_path = REPLACE(lyrics_path, '\\', '/')
             WHERE track_id LIKE '%\\%' OR lyrics_path LIKE '%\\%'",
                [],
            )?;

            Ok(())
        }
    }
    pub(super) fn migrate_v1(&self, conn: &Connection) -> SqliteResult<()> {
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
                rating INTEGER,
                track_number INTEGER,
                disc_number INTEGER,
                file_format TEXT,
                bitrate INTEGER,
                sample_rate INTEGER,
                file_size INTEGER
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

    pub(super) fn migrate_v2(&self, conn: &Connection) -> SqliteResult<()> {
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

    pub(super) fn migrate_v3(&self, conn: &Connection) -> SqliteResult<()> {
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

    pub(super) fn migrate_v4(&self, conn: &Connection) -> SqliteResult<()> {
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

    pub(super) fn migrate_v5(&self, conn: &Connection) -> SqliteResult<()> {
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

    pub(super) fn migrate_v6(&self, conn: &Connection) -> SqliteResult<()> {
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

    pub(super) fn migrate_v7(&self, conn: &Connection) -> SqliteResult<()> {
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

    pub(super) fn migrate_v8(&self, conn: &Connection) -> SqliteResult<()> {
        let columns = [
            ("track_number", "INTEGER"),
            ("disc_number", "INTEGER"),
            ("file_format", "TEXT"),
            ("bitrate", "INTEGER"),
            ("sample_rate", "INTEGER"),
            ("file_size", "INTEGER"),
        ];
        let existing = {
            let mut stmt = conn.prepare("PRAGMA table_info(tracks)")?;
            let columns = stmt
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<SqliteResult<std::collections::HashSet<_>>>()?;
            columns
        };
        for (name, data_type) in columns {
            if !existing.contains(name) {
                conn.execute(
                    &format!("ALTER TABLE tracks ADD COLUMN {name} {data_type}"),
                    [],
                )?;
            }
        }
        Ok(())
    }

    pub(super) fn ensure_lyrics_schema(&self, conn: &Connection) -> SqliteResult<()> {
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
}
