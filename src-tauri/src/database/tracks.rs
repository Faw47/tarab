use super::*;

pub(super) const TRACK_PATHS_FIRST_SQL: &str =
    "SELECT id, file_path FROM tracks ORDER BY id ASC LIMIT ?1";
pub(super) const TRACK_PATHS_AFTER_SQL: &str =
    "SELECT id, file_path FROM tracks WHERE id > ?1 ORDER BY id ASC LIMIT ?2";

const MIN_LIKE_FALLBACK_CHARS: usize = 3;

// Descendants of `folder/` sort below `folder0`; NOCASE keeps SQLite LIKE's ASCII
// case behavior while allowing prefix lookups to use an index.
fn folder_path_range(folder_path: &str) -> (String, String) {
    let folder_path = folder_path.trim_end_matches('/');
    (format!("{folder_path}/"), format!("{folder_path}0"))
}

impl Database {
    pub fn upsert_tracks_batch(&self, tracks: &[DbTrack]) -> SqliteResult<usize> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;

        {
            let mut stmt = tx.prepare_cached(
                r#"
                INSERT INTO tracks (id, title, artist, album_artist, album, year, duration, file_path, public_id,
                                   has_cover_art, cover_art_hash, blurhash, date_added, play_count, last_played, rating,
                                   track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                        ?17, ?18, ?19, ?20, ?21, ?22, ?23)
                ON CONFLICT(file_path) DO UPDATE SET
                    id = excluded.id,
                    public_id = excluded.public_id,
                    title = excluded.title,
                    artist = excluded.artist,
                    album_artist = excluded.album_artist,
                    album = excluded.album,
                    year = excluded.year,
                    duration = excluded.duration,
                    has_cover_art = excluded.has_cover_art,
                    cover_art_hash = excluded.cover_art_hash,
                    blurhash = excluded.blurhash,
                    track_number = excluded.track_number,
                    disc_number = excluded.disc_number,
                    file_format = excluded.file_format,
                    bitrate = excluded.bitrate,
                    sample_rate = excluded.sample_rate,
                    file_size = excluded.file_size,
                    genre = excluded.genre
                "#,
            )?;

            for track in tracks {
                // Normalize paths to ensure consistent representation
                let normalized_id = Self::normalize_path(&track.id);
                let normalized_file_path = Self::normalize_path(&track.file_path);
                let public_id = Self::public_track_id(&normalized_file_path);

                stmt.execute(params![
                    &normalized_id,
                    &track.title,
                    &track.artist,
                    &track.album_artist,
                    &track.album,
                    track.year,
                    track.duration,
                    &normalized_file_path,
                    public_id,
                    track.has_cover_art as i32,
                    &track.cover_art_hash,
                    &track.blurhash,
                    track.date_added,
                    track.play_count,
                    track.last_played,
                    track.rating,
                    track.track_number,
                    track.disc_number,
                    &track.file_format,
                    track.bitrate,
                    track.sample_rate,
                    track.file_size,
                    &track.genre,
                ])?;
            }
        }

        tx.commit()?;
        Ok(tracks.len())
    }

    fn metadata_matches(existing: &DbTrack, incoming: &DbTrack) -> bool {
        existing.title == incoming.title
            && existing.artist == incoming.artist
            && existing.album_artist == incoming.album_artist
            && existing.album == incoming.album
            && existing.year == incoming.year
            && (existing.duration - incoming.duration).abs() < 0.001
            && existing.has_cover_art == incoming.has_cover_art
            && existing.cover_art_hash == incoming.cover_art_hash
            && existing.blurhash == incoming.blurhash
            && existing.track_number == incoming.track_number
            && existing.disc_number == incoming.disc_number
            && existing.file_format == incoming.file_format
            && existing.bitrate == incoming.bitrate
            && existing.sample_rate == incoming.sample_rate
            && existing.file_size == incoming.file_size
            && existing.genre == incoming.genre
    }

    pub fn reconcile_folder_scan(
        &self,
        request: ScanReconcileRequest,
    ) -> SqliteResult<ScanReconcileResult> {
        use std::collections::{HashMap, HashSet};

        let normalized_folder = Self::normalize_path(&request.folder_path);
        let trimmed = normalized_folder.trim().trim_end_matches('/');
        if trimmed.is_empty()
            || matches!(trimmed, "." | "..")
            || Path::new(&normalized_folder).parent().is_none()
        {
            return Err(rusqlite::Error::InvalidParameterName(
                "folder_path must identify a non-root folder".to_string(),
            ));
        }
        let folder_prefix = format!("{}/", trimmed);

        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let existing = {
            let mut stmt = tx.prepare(
                "SELECT id, title, artist, album_artist, album, year, duration, file_path,
                        has_cover_art, cover_art_hash, blurhash, date_added, play_count, last_played, rating
                        ,track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre
                 FROM tracks
                 WHERE file_path = ?1
                    OR substr(file_path, 1, length(?2)) = ?2 COLLATE BINARY",
            )?;
            let rows = stmt
                .query_map(
                    params![normalized_folder, folder_prefix],
                    Self::map_db_track_row,
                )?
                .collect::<SqliteResult<Vec<_>>>()?;
            rows
        };
        let existing_by_path: HashMap<String, DbTrack> = existing
            .into_iter()
            .map(|track| (track.file_path.clone(), track))
            .collect();
        let discovered: HashSet<String> = request
            .discovered_paths
            .iter()
            .map(|path| Self::normalize_path(path))
            .collect();

        let mut added_count = 0;
        let mut updated_count = 0;
        let mut unchanged_count = 0;
        let mut incoming_paths: HashSet<String> = HashSet::with_capacity(request.tracks.len());
        {
            let mut stmt = tx.prepare_cached(
                r#"
                INSERT INTO tracks (id, title, artist, album_artist, album, year, duration, file_path, public_id,
                                   has_cover_art, cover_art_hash, blurhash, date_added, play_count, last_played, rating,
                                   track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                        ?17, ?18, ?19, ?20, ?21, ?22, ?23)
                ON CONFLICT(file_path) DO UPDATE SET
                    id = excluded.id,
                    public_id = excluded.public_id,
                    title = excluded.title,
                    artist = excluded.artist,
                    album_artist = excluded.album_artist,
                    album = excluded.album,
                    year = excluded.year,
                    duration = excluded.duration,
                    has_cover_art = excluded.has_cover_art,
                    cover_art_hash = COALESCE(excluded.cover_art_hash, tracks.cover_art_hash),
                    blurhash = COALESCE(excluded.blurhash, tracks.blurhash),
                    track_number = excluded.track_number,
                    disc_number = excluded.disc_number,
                    file_format = excluded.file_format,
                    bitrate = excluded.bitrate,
                    sample_rate = excluded.sample_rate,
                    file_size = excluded.file_size,
                    genre = excluded.genre
                "#,
            )?;

            for track in &request.tracks {
                let normalized_id = Self::normalize_path(&track.id);
                let normalized_file_path = Self::normalize_path(&track.file_path);
                let public_id = Self::public_track_id(&normalized_file_path);
                incoming_paths.insert(normalized_file_path.clone());
                match existing_by_path.get(&normalized_file_path) {
                    Some(existing) if Self::metadata_matches(existing, track) => {
                        unchanged_count += 1;
                    }
                    Some(_) => updated_count += 1,
                    None => added_count += 1,
                }
                stmt.execute(params![
                    normalized_id,
                    &track.title,
                    &track.artist,
                    &track.album_artist,
                    &track.album,
                    track.year,
                    track.duration,
                    normalized_file_path,
                    public_id,
                    track.has_cover_art as i32,
                    &track.cover_art_hash,
                    &track.blurhash,
                    track.date_added,
                    track.play_count,
                    track.last_played,
                    track.rating,
                    track.track_number,
                    track.disc_number,
                    &track.file_format,
                    track.bitrate,
                    track.sample_rate,
                    track.file_size,
                    &track.genre,
                ])?;
            }
        }

        let stale_ids: Vec<String> = if request.traversal_complete {
            existing_by_path
                .values()
                .filter(|track| !discovered.contains(&track.file_path))
                .map(|track| track.id.clone())
                .collect()
        } else {
            Vec::new()
        };
        let missing_count = stale_ids.len();
        for id in &stale_ids {
            tx.execute("DELETE FROM lyrics_index WHERE track_id = ?1", [id])?;
            tx.execute("DELETE FROM tracks WHERE id = ?1", [id])?;
        }

        let preserved_count = discovered
            .iter()
            .filter(|path| existing_by_path.contains_key(*path) && !incoming_paths.contains(*path))
            .count();
        tx.commit()?;

        let status = if !request.traversal_complete {
            "failed"
        } else if request.errors.is_empty() {
            "complete"
        } else {
            "partial"
        };
        Ok(ScanReconcileResult {
            status: status.to_string(),
            folder_path: request.folder_path,
            discovered_count: discovered.len(),
            added_count,
            updated_count,
            unchanged_count,
            missing_count,
            preserved_count,
            errors: request.errors,
        })
    }

    pub fn delete_tracks(&self, ids: &[String]) -> SqliteResult<usize> {
        if ids.is_empty() {
            return Ok(0);
        }
        let normalized_ids: Vec<String> = ids.iter().map(|id| Self::normalize_path(id)).collect();
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let mut removed = 0;
        {
            let mut delete_lyrics =
                tx.prepare_cached("DELETE FROM lyrics_index WHERE track_id = ?1")?;
            let mut delete_track = tx.prepare_cached("DELETE FROM tracks WHERE id = ?1")?;
            for id in &normalized_ids {
                delete_lyrics.execute([id])?;
                removed += delete_track.execute([id])?;
            }
        }
        tx.commit()?;
        Ok(removed)
    }

    pub fn rename_track_path(&self, old_path: &str, new_path: &str) -> SqliteResult<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        tx.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
        // Normalize both paths for consistent database operations
        let normalized_old = Self::normalize_path(old_path);
        let normalized_new = Self::normalize_path(new_path);
        tx.execute(
            "UPDATE playlist_tracks
             SET track_id = ?1,
                 snapshot_file_path = CASE WHEN snapshot_file_path = ?2 THEN ?1 ELSE snapshot_file_path END
             WHERE track_id = ?2",
            params![normalized_new, normalized_old],
        )?;
        tx.execute(
            "UPDATE lyrics_index SET track_id = ?1 WHERE track_id = ?2",
            params![normalized_new, normalized_old],
        )?;
        let public_id = Self::public_track_id(&normalized_new);
        tx.execute(
            "UPDATE tracks SET id = ?1, file_path = ?1, public_id = ?2 WHERE file_path = ?3",
            params![normalized_new, public_id, normalized_old],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn rebase_track_paths(&self, old_root: &str, new_root: &str) -> SqliteResult<usize> {
        let normalized_old = Self::normalize_path(old_root)
            .trim_end_matches('/')
            .to_string();
        let normalized_new = Self::normalize_path(new_root)
            .trim_end_matches('/')
            .to_string();
        if normalized_old.is_empty() || normalized_new.is_empty() {
            return Err(rusqlite::Error::InvalidParameterName(
                "library root must not be empty".to_string(),
            ));
        }

        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        tx.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
        let (path_prefix, path_upper_bound) = folder_path_range(&normalized_old);
        let paths = {
            let mut stmt = tx.prepare(
                "SELECT file_path FROM tracks
                 WHERE file_path = ?1 COLLATE BINARY
                    OR (file_path >= ?2 COLLATE NOCASE AND file_path < ?3 COLLATE NOCASE)
                 ORDER BY length(file_path) ASC",
            )?;
            let rows = stmt
                .query_map(
                    params![normalized_old, path_prefix, path_upper_bound],
                    |row| row.get::<_, String>(0),
                )?
                .collect::<SqliteResult<Vec<_>>>()?;
            rows
        };

        for old_path in &paths {
            let suffix = old_path
                .strip_prefix(&normalized_old)
                .unwrap_or("")
                .trim_start_matches('/');
            let new_path = if suffix.is_empty() {
                normalized_new.clone()
            } else {
                format!("{normalized_new}/{suffix}")
            };
            let conflict: i64 = tx.query_row(
                "SELECT COUNT(*) FROM tracks WHERE file_path = ?1 AND file_path <> ?2",
                params![new_path, old_path],
                |row| row.get(0),
            )?;
            if conflict > 0 {
                return Err(rusqlite::Error::InvalidParameterName(format!(
                    "destination track already exists: {new_path}"
                )));
            }
            tx.execute(
                "UPDATE playlist_tracks
                 SET track_id = ?1,
                     snapshot_file_path = CASE WHEN snapshot_file_path = ?2 THEN ?1 ELSE snapshot_file_path END
                 WHERE track_id = ?2",
                params![new_path, old_path],
            )?;
            tx.execute(
                "UPDATE lyrics_index SET track_id = ?1 WHERE track_id = ?2",
                params![new_path, old_path],
            )?;
            let public_id = Self::public_track_id(&new_path);
            tx.execute(
                "UPDATE tracks SET id = ?1, file_path = ?1, public_id = ?2 WHERE file_path = ?3",
                params![new_path, public_id, old_path],
            )?;
        }
        tx.commit()?;
        Ok(paths.len())
    }

    pub(super) fn map_db_track_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DbTrack> {
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
            track_number: row.get(15)?,
            disc_number: row.get(16)?,
            file_format: row.get(17)?,
            bitrate: row.get(18)?,
            sample_rate: row.get(19)?,
            file_size: row.get(20)?,
            genre: row.get(21)?,
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
        cursor: Option<&TrackPageCursor>,
        limit: u32,
        sort_by: &str,
        sort_order: &str,
    ) -> SqliteResult<Vec<DbTrack>> {
        let conn = self.conn.lock();

        let (order_clause, text_key) = match sort_by {
            "title" => ("title COLLATE NOCASE", true),
            "artist" => ("artist COLLATE NOCASE", true),
            "album" => ("album COLLATE NOCASE", true),
            "dateAdded" => ("date_added", false),
            "playCount" => ("play_count", false),
            "duration" => ("duration", false),
            _ => ("date_added", false),
        };
        let order_dir = if sort_order == "asc" { "ASC" } else { "DESC" };
        let cursor_operator = if sort_order == "asc" { ">" } else { "<" };
        let cursor_value = match cursor.map(|cursor| &cursor.value) {
            None => None,
            Some(TrackPageCursorValue::Text(value)) if text_key => {
                Some(rusqlite::types::Value::Text(value.clone()))
            }
            Some(TrackPageCursorValue::Number(value)) if !text_key => {
                Some(rusqlite::types::Value::Real(*value))
            }
            Some(_) => {
                return Err(rusqlite::Error::InvalidParameterName(
                    "cursor value does not match the selected sort key".to_string(),
                ));
            }
        };

        let select_columns = "SELECT id, title, artist, album_artist, album, year, duration, file_path,
                                     has_cover_art, cover_art_hash, blurhash, date_added, play_count,
                                     last_played, rating, track_number, disc_number, file_format, bitrate,
                                     sample_rate, file_size, genre FROM tracks";
        let query = if cursor.is_some() {
            format!(
                "{select_columns}
                 WHERE ({order_clause}, id) {cursor_operator} (?1, ?2)
                 ORDER BY {order_clause} {order_dir}, id {order_dir}
                 LIMIT ?3"
            )
        } else {
            format!(
                "{select_columns}
                 ORDER BY {order_clause} {order_dir}, id {order_dir}
                 LIMIT ?1"
            )
        };

        let mut stmt = conn.prepare(&query)?;
        let tracks = match cursor {
            Some(cursor) => stmt
                .query_map(
                    params![
                        cursor_value.expect("cursor value validated"),
                        cursor.id.as_str(),
                        limit
                    ],
                    Self::map_db_track_row,
                )?
                .collect::<SqliteResult<Vec<_>>>()?,
            None => stmt
                .query_map(params![limit], Self::map_db_track_row)?
                .collect::<SqliteResult<Vec<_>>>()?,
        };

        Ok(tracks)
    }

    pub fn get_all_tracks(&self) -> SqliteResult<Vec<DbTrack>> {
        let conn = self.conn.lock();

        let mut stmt = conn.prepare(
            "SELECT id, title, artist, album_artist, album, year, duration, file_path, has_cover_art, 
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating,
                    track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre
             FROM tracks ORDER BY date_added DESC",
        )?;

        let tracks = stmt
            .query_map([], Self::map_db_track_row)?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(tracks)
    }

    /// Returns up to `limit` tracks with an id after `after_id`, in primary-key order. Keyset
    /// paging walks the primary key index; OFFSET paging re-sorted the table for every page.
    pub fn get_track_paths_after(
        &self,
        after_id: Option<&str>,
        limit: u32,
    ) -> SqliteResult<Vec<TrackPathRow>> {
        let conn = self.conn.lock();
        let map_row = |row: &rusqlite::Row<'_>| {
            Ok(TrackPathRow {
                id: row.get(0)?,
                file_path: row.get(1)?,
            })
        };
        match after_id {
            Some(after_id) => conn
                .prepare(TRACK_PATHS_AFTER_SQL)?
                .query_map(params![after_id, limit], map_row)?
                .collect(),
            None => conn
                .prepare(TRACK_PATHS_FIRST_SQL)?
                .query_map(params![limit], map_row)?
                .collect(),
        }
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
                        cover_art_hash, blurhash, date_added, play_count, last_played, rating,
                        track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre
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

    pub fn get_track_by_public_id(&self, public_id: &str) -> SqliteResult<Option<DbTrack>> {
        if public_id.len() != 64 || !public_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Ok(None);
        }
        let conn = self.conn.lock();
        let normalized_public_id = public_id.to_ascii_lowercase();
        conn.query_row(
            "SELECT id, title, artist, album_artist, album, year, duration, file_path, has_cover_art,
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating,
                    track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre
             FROM tracks
             WHERE public_id = ?1",
            params![normalized_public_id],
            Self::map_db_track_row,
        )
        .optional()
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
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating,
                    track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre
             FROM tracks
             WHERE album = ?1 AND COALESCE(NULLIF(album_artist, ''), artist) = ?2
             ORDER BY COALESCE(disc_number, 1) ASC,
                      COALESCE(track_number, 2147483647) ASC,
                      file_path COLLATE NOCASE ASC",
        )?;

        let tracks = stmt
            .query_map(params![album, artist], Self::map_db_track_row)?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(tracks)
    }

    pub fn get_tracks_by_artist(&self, artist: &str) -> SqliteResult<Vec<DbTrack>> {
        if artist.trim().is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, title, artist, album_artist, album, year, duration, file_path, has_cover_art,
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating,
                    track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre
             FROM tracks
             WHERE artist = ?1
             ORDER BY album COLLATE NOCASE ASC,
                      COALESCE(disc_number, 1) ASC,
                      COALESCE(track_number, 2147483647) ASC,
                      file_path COLLATE NOCASE ASC",
        )?;
        let tracks = stmt
            .query_map(params![artist], Self::map_db_track_row)?
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

        let trimmed_query = query.trim();
        if trimmed_query.chars().count() < MIN_LIKE_FALLBACK_CHARS {
            return Ok(Vec::new());
        }
        let escaped_like = trimmed_query
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

    pub fn get_track_count(&self) -> SqliteResult<i64> {
        let conn = self.conn.lock();
        conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
    }

    pub fn count_tracks_by_folder(&self, folder_path: &str) -> SqliteResult<i64> {
        let normalized = Self::normalize_path(folder_path)
            .trim_end_matches('/')
            .to_string();
        if normalized.is_empty() {
            return Ok(0);
        }
        let (path_prefix, path_upper_bound) = folder_path_range(&normalized);
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT COUNT(*) FROM tracks
             WHERE file_path = ?1 COLLATE BINARY
                OR (file_path >= ?2 COLLATE NOCASE AND file_path < ?3 COLLATE NOCASE)",
            params![normalized, path_prefix, path_upper_bound],
            |row| row.get(0),
        )
    }

    pub fn get_track_ids_by_folder(&self, folder_path: &str) -> SqliteResult<Vec<String>> {
        let normalized = Self::normalize_path(folder_path)
            .trim_end_matches('/')
            .to_string();
        if normalized.is_empty() || Path::new(&normalized).parent().is_none() {
            return Err(rusqlite::Error::InvalidParameterName(
                "folder_path must identify a non-root folder".to_string(),
            ));
        }
        let (path_prefix, path_upper_bound) = folder_path_range(&normalized);
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id
             FROM tracks
             WHERE file_path = ?1 COLLATE BINARY
                OR (file_path >= ?2 COLLATE NOCASE AND file_path < ?3 COLLATE NOCASE)
             ORDER BY file_path COLLATE NOCASE ASC",
        )?;
        let ids = stmt
            .query_map(params![normalized, path_prefix, path_upper_bound], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(ids)
    }

    #[allow(dead_code)]
    pub fn delete_track(&self, track_id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM tracks WHERE id = ?1", params![track_id])?;
        Ok(())
    }

    pub fn delete_tracks_by_folder(&self, folder_path: &str) -> SqliteResult<usize> {
        let mut conn = self.conn.lock();
        // Normalize the folder path first
        let normalized_folder = Self::normalize_path(folder_path);
        let trimmed = normalized_folder.trim().trim_end_matches('/');
        if trimmed.is_empty()
            || matches!(trimmed, "." | "..")
            || Path::new(&normalized_folder).parent().is_none()
        {
            return Err(rusqlite::Error::InvalidParameterName(
                "folder_path must identify a non-root folder".to_string(),
            ));
        }
        let normalized = normalized_folder.trim_end_matches('/').to_string();
        let (path_prefix, path_upper_bound) = folder_path_range(&normalized);
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM lyrics_index
             WHERE track_id = ?1 COLLATE BINARY
                OR (track_id >= ?2 COLLATE NOCASE AND track_id < ?3 COLLATE NOCASE)",
            params![normalized, path_prefix, path_upper_bound],
        )?;
        // Query using normalized paths only (database should have normalized paths)
        let count = tx.execute(
            "DELETE FROM tracks
             WHERE file_path = ?1 COLLATE BINARY
                OR (file_path >= ?2 COLLATE NOCASE AND file_path < ?3 COLLATE NOCASE)",
            params![normalized, path_prefix, path_upper_bound],
        )?;
        tx.commit()?;
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
}
