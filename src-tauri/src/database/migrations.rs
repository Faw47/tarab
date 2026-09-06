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

        if current_version > CURRENT_SCHEMA_VERSION {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "database schema version {current_version} is newer than supported version {CURRENT_SCHEMA_VERSION}"
            )));
        }

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

        if current_version < 8 {
            self.apply_migration_tx(&mut conn, 8, |tx| self.migrate_v8(tx))?;
        }

        if current_version < 9 {
            self.apply_migration_tx(&mut conn, 9, |tx| self.migrate_v9(tx))?;
        }

        if current_version < 10 {
            self.apply_migration_tx(&mut conn, 10, |tx| self.migrate_v10(tx))?;
        }

        if current_version < 11 {
            self.apply_migration_tx(&mut conn, 11, |tx| self.migrate_v11(tx))?;
        }

        if current_version < 12 {
            self.apply_migration_tx(&mut conn, 12, |tx| self.migrate_v12(tx))?;
        }

        // Guard against schema drift: ensure lyrics index schema exists even if
        // schema_version metadata is stale or manually modified.
        self.ensure_lyrics_schema(&conn)?;
        // Cursor correctness depends on every track mutation advancing this revision.
        self.migrate_v11(&conn)?;
        self.migrate_v12(&conn)?;

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
            let still_needs_verbatim_cleanup = conn.query_row(
                r#"
                SELECT
                    EXISTS(SELECT 1 FROM tracks
                           WHERE id LIKE '//?/%' OR file_path LIKE '//?/%')
                    OR EXISTS(SELECT 1 FROM playlist_tracks
                              WHERE track_id LIKE '//?/%'
                                 OR snapshot_file_path LIKE '//?/%')
                    OR EXISTS(SELECT 1 FROM lyrics_index
                              WHERE track_id LIKE '//?/%' OR lyrics_path LIKE '//?/%')
                "#,
                [],
                |row| row.get::<_, bool>(0),
            )?;
            if !still_needs_verbatim_cleanup {
                return Ok(());
            }
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
            #[derive(Clone)]
            struct TrackAliasRow {
                rowid: i64,
                id: String,
                file_path: String,
                date_added: i64,
                play_count: i64,
                last_played: Option<i64>,
                rating: Option<i32>,
            }

            #[derive(Clone)]
            struct PlaylistTrackRow {
                playlist_id: String,
                track_id: String,
                position: i32,
                added_at: i64,
                snapshot_title: Option<String>,
                snapshot_artist: Option<String>,
                snapshot_album: Option<String>,
                snapshot_duration: Option<f64>,
                snapshot_file_path: Option<String>,
                snapshot_has_cover_art: bool,
                snapshot_cover_art_hash: Option<String>,
                snapshot_blurhash: Option<String>,
            }

            #[derive(Clone)]
            struct LyricsRow {
                rowid: i64,
                track_id: String,
                lyrics_path: String,
                lyrics_mtime: i64,
                content: String,
            }

            conn.execute_batch("PRAGMA defer_foreign_keys=ON;")?;

            let needs_cleanup = conn.query_row(
                r#"
                SELECT
                    EXISTS(SELECT 1 FROM tracks
                           WHERE instr(id, '\') > 0 OR instr(file_path, '\') > 0
                              OR id LIKE '//?/%' OR file_path LIKE '//?/%')
                    OR EXISTS(SELECT 1 FROM playlist_tracks
                              WHERE instr(track_id, '\') > 0
                                 OR instr(snapshot_file_path, '\') > 0
                                 OR track_id LIKE '//?/%'
                                 OR snapshot_file_path LIKE '//?/%')
                    OR EXISTS(SELECT 1 FROM lyrics_index
                              WHERE instr(track_id, '\') > 0 OR instr(lyrics_path, '\') > 0
                                 OR track_id LIKE '//?/%' OR lyrics_path LIKE '//?/%')
                "#,
                [],
                |row| row.get::<_, bool>(0),
            )?;
            if !needs_cleanup {
                return Ok(());
            }

            let track_rows = {
                let mut stmt = conn.prepare(
                    "SELECT rowid, id, file_path, date_added, play_count, last_played, rating
                     FROM tracks ORDER BY rowid ASC",
                )?;
                let rows = stmt
                    .query_map([], |row| {
                        Ok(TrackAliasRow {
                            rowid: row.get(0)?,
                            id: row.get(1)?,
                            file_path: row.get(2)?,
                            date_added: row.get(3)?,
                            play_count: row.get(4)?,
                            last_played: row.get(5)?,
                            rating: row.get(6)?,
                        })
                    })?
                    .collect::<SqliteResult<Vec<_>>>()?;
                rows
            };
            let playlist_rows = {
                let mut stmt = conn.prepare(
                    r#"
                    SELECT playlist_id, track_id, position, added_at,
                           snapshot_title, snapshot_artist, snapshot_album, snapshot_duration,
                           snapshot_file_path, snapshot_has_cover_art, snapshot_cover_art_hash,
                           snapshot_blurhash
                    FROM playlist_tracks
                    "#,
                )?;
                let rows = stmt
                    .query_map([], |row| {
                        Ok(PlaylistTrackRow {
                            playlist_id: row.get(0)?,
                            track_id: row.get(1)?,
                            position: row.get(2)?,
                            added_at: row.get(3)?,
                            snapshot_title: row.get(4)?,
                            snapshot_artist: row.get(5)?,
                            snapshot_album: row.get(6)?,
                            snapshot_duration: row.get(7)?,
                            snapshot_file_path: row.get(8)?,
                            snapshot_has_cover_art: row.get::<_, i32>(9)? != 0,
                            snapshot_cover_art_hash: row.get(10)?,
                            snapshot_blurhash: row.get(11)?,
                        })
                    })?
                    .collect::<SqliteResult<Vec<_>>>()?;
                rows
            };
            let lyrics_rows = {
                let mut stmt = conn.prepare(
                    "SELECT rowid, track_id, lyrics_path, lyrics_mtime, content FROM lyrics_index",
                )?;
                let rows = stmt
                    .query_map([], |row| {
                        Ok(LyricsRow {
                            rowid: row.get(0)?,
                            track_id: row.get(1)?,
                            lyrics_path: row.get(2)?,
                            lyrics_mtime: row.get(3)?,
                            content: row.get(4)?,
                        })
                    })?
                    .collect::<SqliteResult<Vec<_>>>()?;
                rows
            };

            let has_public_id = {
                let mut stmt = conn.prepare("PRAGMA table_info(tracks)")?;
                let has_public_id = stmt
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<SqliteResult<std::collections::HashSet<_>>>()?
                    .contains("public_id");
                has_public_id
            };

            let mut track_groups = std::collections::BTreeMap::<String, Vec<TrackAliasRow>>::new();
            for row in track_rows {
                track_groups
                    .entry(Self::normalize_path(&row.file_path))
                    .or_default()
                    .push(row);
            }

            for (normalized_path, rows) in &mut track_groups {
                rows.sort_by(|left, right| {
                    let left_is_canonical = left.file_path == normalized_path.as_str()
                        && left.id == normalized_path.as_str();
                    let right_is_canonical = right.file_path == normalized_path.as_str()
                        && right.id == normalized_path.as_str();
                    right_is_canonical
                        .cmp(&left_is_canonical)
                        .then_with(|| left.rowid.cmp(&right.rowid))
                        .then_with(|| left.id.cmp(&right.id))
                });
                let survivor = &rows[0];
                let date_added = rows
                    .iter()
                    .map(|row| row.date_added)
                    .min()
                    .unwrap_or(survivor.date_added);
                let play_count = rows
                    .iter()
                    .fold(0_i64, |total, row| total.saturating_add(row.play_count))
                    .clamp(0, i64::from(i32::MAX));
                let last_played = rows.iter().filter_map(|row| row.last_played).max();
                let rating = rows.iter().find_map(|row| row.rating);
                conn.execute(
                    "UPDATE tracks
                     SET date_added = ?1, play_count = ?2, last_played = ?3, rating = ?4
                     WHERE rowid = ?5",
                    params![date_added, play_count, last_played, rating, survivor.rowid],
                )?;
            }

            // Relationships are rebuilt before aliases are removed so no user data is lost to
            // primary-key conflicts or ON DELETE cascades.
            conn.execute("DELETE FROM playlist_tracks", [])?;
            conn.execute("DELETE FROM lyrics_index", [])?;

            for (normalized_path, rows) in &track_groups {
                let survivor = &rows[0];
                for alias in rows.iter().skip(1) {
                    conn.execute("DELETE FROM tracks WHERE rowid = ?1", [alias.rowid])?;
                }
                if has_public_id {
                    conn.execute(
                        "UPDATE tracks SET id = ?1, file_path = ?1, public_id = ?2 WHERE rowid = ?3",
                        params![
                            normalized_path,
                            Self::public_track_id(normalized_path),
                            survivor.rowid
                        ],
                    )?;
                } else {
                    conn.execute(
                        "UPDATE tracks SET id = ?1, file_path = ?1 WHERE rowid = ?2",
                        params![normalized_path, survivor.rowid],
                    )?;
                }
            }

            let mut playlist_groups =
                std::collections::BTreeMap::<(String, String), Vec<PlaylistTrackRow>>::new();
            for row in playlist_rows {
                playlist_groups
                    .entry((row.playlist_id.clone(), Self::normalize_path(&row.track_id)))
                    .or_default()
                    .push(row);
            }
            for ((playlist_id, track_id), rows) in &mut playlist_groups {
                rows.sort_by(|left, right| {
                    left.position
                        .cmp(&right.position)
                        .then_with(|| left.added_at.cmp(&right.added_at))
                        .then_with(|| {
                            let left_is_canonical = left.track_id == track_id.as_str();
                            let right_is_canonical = right.track_id == track_id.as_str();
                            right_is_canonical.cmp(&left_is_canonical)
                        })
                        .then_with(|| left.track_id.cmp(&right.track_id))
                });
                let position = rows.iter().map(|row| row.position).min().unwrap_or(0);
                let added_at = rows.iter().map(|row| row.added_at).min().unwrap_or(0);
                let snapshot_title = rows.iter().find_map(|row| row.snapshot_title.clone());
                let snapshot_artist = rows.iter().find_map(|row| row.snapshot_artist.clone());
                let snapshot_album = rows.iter().find_map(|row| row.snapshot_album.clone());
                let snapshot_duration = rows.iter().find_map(|row| row.snapshot_duration);
                let snapshot_file_path = rows
                    .iter()
                    .find_map(|row| row.snapshot_file_path.as_deref())
                    .map(Self::normalize_path);
                let snapshot_has_cover_art = rows.iter().any(|row| row.snapshot_has_cover_art);
                let snapshot_cover_art_hash = rows
                    .iter()
                    .find_map(|row| row.snapshot_cover_art_hash.clone());
                let snapshot_blurhash = rows.iter().find_map(|row| row.snapshot_blurhash.clone());
                conn.execute(
                    r#"
                    INSERT INTO playlist_tracks (
                        playlist_id, track_id, position, added_at,
                        snapshot_title, snapshot_artist, snapshot_album, snapshot_duration,
                        snapshot_file_path, snapshot_has_cover_art, snapshot_cover_art_hash,
                        snapshot_blurhash
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                    "#,
                    params![
                        playlist_id,
                        track_id,
                        position,
                        added_at,
                        snapshot_title,
                        snapshot_artist,
                        snapshot_album,
                        snapshot_duration,
                        snapshot_file_path,
                        snapshot_has_cover_art as i32,
                        snapshot_cover_art_hash,
                        snapshot_blurhash,
                    ],
                )?;
            }

            let mut lyrics_groups = std::collections::BTreeMap::<String, Vec<LyricsRow>>::new();
            for row in lyrics_rows {
                lyrics_groups
                    .entry(Self::normalize_path(&row.track_id))
                    .or_default()
                    .push(row);
            }
            for (track_id, rows) in &mut lyrics_groups {
                rows.sort_by(|left, right| {
                    right
                        .lyrics_mtime
                        .cmp(&left.lyrics_mtime)
                        .then_with(|| {
                            let left_is_canonical = left.track_id == track_id.as_str();
                            let right_is_canonical = right.track_id == track_id.as_str();
                            right_is_canonical.cmp(&left_is_canonical)
                        })
                        .then_with(|| left.rowid.cmp(&right.rowid))
                });
                let track_exists = conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM tracks WHERE id = ?1)",
                    [track_id],
                    |row| row.get::<_, bool>(0),
                )?;
                if !track_exists {
                    continue;
                }
                let winner = &rows[0];
                conn.execute(
                    "INSERT INTO lyrics_index (track_id, lyrics_path, lyrics_mtime, content)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        track_id,
                        Self::normalize_path(&winner.lyrics_path),
                        winner.lyrics_mtime,
                        winner.content,
                    ],
                )?;
            }

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
                genre TEXT,
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

    pub(super) fn migrate_v9(&self, conn: &Connection) -> SqliteResult<()> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS playlist_mutations (
                mutation_key TEXT PRIMARY KEY,
                result_json TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_playlist_mutations_created_at
                ON playlist_mutations(created_at);
            "#,
        )
    }

    pub(super) fn migrate_v10(&self, conn: &Connection) -> SqliteResult<()> {
        #[cfg(windows)]
        self.cleanup_duplicates_and_normalize_with_conn(conn)?;

        let has_public_id = {
            let mut stmt = conn.prepare("PRAGMA table_info(tracks)")?;
            let columns = stmt
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<SqliteResult<std::collections::HashSet<_>>>()?
                .contains("public_id");
            columns
        };
        if !has_public_id {
            conn.execute("ALTER TABLE tracks ADD COLUMN public_id TEXT", [])?;
        }

        let tracks = {
            let mut stmt = conn.prepare("SELECT rowid, file_path FROM tracks")?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<SqliteResult<Vec<_>>>()?;
            rows
        };
        let mut update =
            conn.prepare_cached("UPDATE tracks SET public_id = ?1 WHERE rowid = ?2")?;
        for (rowid, file_path) in tracks {
            update.execute(params![Self::public_track_id(&file_path), rowid])?;
        }
        drop(update);

        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_public_id ON tracks(public_id)",
            [],
        )?;
        Ok(())
    }

    pub(super) fn migrate_v11(&self, conn: &Connection) -> SqliteResult<()> {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS library_revision (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                revision INTEGER NOT NULL
            );
            INSERT OR IGNORE INTO library_revision (singleton, revision) VALUES (1, 1);

            CREATE TRIGGER IF NOT EXISTS tracks_revision_ai
            AFTER INSERT ON tracks BEGIN
                UPDATE library_revision SET revision = revision + 1 WHERE singleton = 1;
            END;
            CREATE TRIGGER IF NOT EXISTS tracks_revision_au
            AFTER UPDATE ON tracks BEGIN
                UPDATE library_revision SET revision = revision + 1 WHERE singleton = 1;
            END;
            CREATE TRIGGER IF NOT EXISTS tracks_revision_ad
            AFTER DELETE ON tracks BEGIN
                UPDATE library_revision SET revision = revision + 1 WHERE singleton = 1;
            END;
            "#,
        )
    }

    pub(super) fn migrate_v12(&self, conn: &Connection) -> SqliteResult<()> {
        let has_genre = {
            let mut stmt = conn.prepare("PRAGMA table_info(tracks)")?;
            let names = stmt
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<SqliteResult<Vec<_>>>()?;
            names.iter().any(|name| name == "genre")
        };

        if !has_genre {
            conn.execute("ALTER TABLE tracks ADD COLUMN genre TEXT", [])?;
        }
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tracks_genre ON tracks(genre)",
            [],
        )?;
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
