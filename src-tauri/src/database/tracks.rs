use super::*;

fn scan_path_is_safe_regular_file(
    folder_path: &str,
    candidate_path: &str,
) -> std::io::Result<bool> {
    let folder_prefix = if folder_path.ends_with('/') {
        folder_path.to_string()
    } else {
        format!("{folder_path}/")
    };
    let Some(relative) = candidate_path.strip_prefix(&folder_prefix) else {
        return Ok(false);
    };
    if relative.is_empty() {
        return Ok(false);
    }

    let root = PathBuf::from(folder_path);
    let root_metadata = match std::fs::symlink_metadata(&root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Ok(false);
    }

    let mut current = root;
    let components = relative.split('/').collect::<Vec<_>>();
    for (index, component) in components.iter().enumerate() {
        if component.is_empty() || matches!(*component, "." | "..") {
            return Ok(false);
        }
        let mut native_components = Path::new(component).components();
        if !matches!(
            native_components.next(),
            Some(std::path::Component::Normal(_))
        ) || native_components.next().is_some()
        {
            return Ok(false);
        }

        current.push(component);
        let metadata = match std::fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        };
        if metadata.file_type().is_symlink() {
            return Ok(false);
        }
        let is_last = index + 1 == components.len();
        if is_last {
            return Ok(metadata.is_file());
        }
        if !metadata.is_dir() {
            return Ok(false);
        }
    }

    Ok(false)
}

impl Database {
    fn normalized_folder_scope(
        folder_path: &str,
        allow_root: bool,
    ) -> SqliteResult<(String, String)> {
        let normalized = Self::normalize_path(folder_path);
        let normalized = normalized.trim();
        let is_root = normalized == "/" || Path::new(normalized).parent().is_none();
        if normalized.is_empty() || matches!(normalized, "." | "..") || (!allow_root && is_root) {
            return Err(rusqlite::Error::InvalidParameterName(if allow_root {
                "folder_path must identify a folder".to_string()
            } else {
                "folder_path must identify a non-root folder".to_string()
            }));
        }

        let exact = if is_root {
            normalized.to_string()
        } else {
            normalized.trim_end_matches('/').to_string()
        };
        let prefix = if exact.ends_with('/') {
            exact.clone()
        } else {
            format!("{exact}/")
        };
        Ok((exact, prefix))
    }

    pub fn upsert_tracks_batch(&self, tracks: &[DbTrack]) -> SqliteResult<usize> {
        let prepared_tracks = tracks
            .iter()
            .map(|track| {
                let normalized_id = Self::normalize_path(&track.id);
                let normalized_file_path = Self::normalize_path(&track.file_path);
                let public_id = Self::public_track_id(&normalized_file_path);
                (track, normalized_id, normalized_file_path, public_id)
            })
            .collect::<Vec<_>>();
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;

        {
            let mut stmt = tx.prepare_cached(
                r#"
                INSERT INTO tracks (id, title, artist, album_artist, album, year, duration, file_path,
                                   public_id, has_cover_art, cover_art_hash, blurhash, date_added, play_count,
                                   last_played, rating, track_number, disc_number, file_format, bitrate,
                                   sample_rate, file_size, genre)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                        ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
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

            for (track, normalized_id, normalized_file_path, public_id) in &prepared_tracks {
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

    #[cfg(test)]
    pub fn reconcile_folder_scan(
        &self,
        request: ScanReconcileRequest,
    ) -> SqliteResult<ScanReconcileResult> {
        self.reconcile_folder_scan_cancellable(request, None)
    }

    pub fn reconcile_folder_scan_cancellable(
        &self,
        request: ScanReconcileRequest,
        cancellation: Option<&AtomicBool>,
    ) -> SqliteResult<ScanReconcileResult> {
        use std::collections::{HashMap, HashSet};

        let ensure_not_cancelled = || {
            if cancellation.is_some_and(|flag| flag.load(Ordering::Acquire)) {
                Err(rusqlite::Error::InvalidParameterName(
                    "Library scan cancelled before reconciliation completed".to_string(),
                ))
            } else {
                Ok(())
            }
        };
        ensure_not_cancelled()?;

        let normalized_folder = Self::normalize_path(&request.folder_path);
        let normalized_folder = normalized_folder.trim();
        let is_windows_drive_root = cfg!(windows)
            && normalized_folder.len() == 3
            && normalized_folder.as_bytes().get(1) == Some(&b':')
            && normalized_folder.ends_with('/');
        let trimmed = if normalized_folder == "/" || is_windows_drive_root {
            normalized_folder
        } else {
            normalized_folder.trim_end_matches('/')
        };
        if trimmed.is_empty() || matches!(trimmed, "." | "..") {
            return Err(rusqlite::Error::InvalidParameterName(
                "folder_path must identify an absolute folder".to_string(),
            ));
        }
        let folder_prefix = if trimmed.ends_with('/') {
            trimmed.to_string()
        } else {
            format!("{}/", trimmed)
        };
        let mut discovered = HashSet::with_capacity(request.discovered_paths.len());
        for path in &request.discovered_paths {
            ensure_not_cancelled()?;
            discovered.insert(Self::normalize_path(path));
        }
        for path in &discovered {
            ensure_not_cancelled()?;
            if !path.starts_with(&folder_prefix) {
                return Err(rusqlite::Error::InvalidParameterName(
                    "discovered_paths must remain inside folder_path".to_string(),
                ));
            }
        }
        let mut reconciled_paths = HashSet::with_capacity(request.tracks.len());
        let mut prepared_tracks = Vec::with_capacity(request.tracks.len());
        for track in &request.tracks {
            ensure_not_cancelled()?;
            let normalized_path = Self::normalize_path(&track.file_path);
            if !discovered.contains(&normalized_path) {
                return Err(rusqlite::Error::InvalidParameterName(
                    "every reconciled track must appear in discovered_paths".to_string(),
                ));
            }
            let normalized_id = Self::normalize_path(&track.id);
            let public_id = Self::public_track_id(&normalized_path);
            reconciled_paths.insert(normalized_path.clone());
            prepared_tracks.push((track, normalized_id, normalized_path, public_id));
        }
        let escaped_prefix = folder_prefix
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
        let like_pattern = format!("{}%", escaped_prefix);

        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let existing = {
            let mut stmt = tx.prepare(
                "SELECT id, title, artist, album_artist, album, year, duration, file_path,
                        has_cover_art, cover_art_hash, blurhash, date_added, play_count, last_played, rating
                        ,track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre
                 FROM tracks
                 WHERE file_path = ?1 OR file_path LIKE ?2 ESCAPE '\\'",
            )?;
            let rows = stmt
                .query_map(
                    params![normalized_folder, like_pattern],
                    Self::map_db_track_row,
                )?
                .collect::<SqliteResult<Vec<_>>>()?;
            rows
        };
        let existing_by_path: HashMap<String, DbTrack> = existing
            .into_iter()
            .map(|track| (track.file_path.clone(), track))
            .collect();
        let mut added_count = 0;
        let mut updated_count = 0;
        let mut unchanged_count = 0;
        {
            let mut stmt = tx.prepare_cached(
                r#"
                INSERT INTO tracks (id, title, artist, album_artist, album, year, duration, file_path,
                                   public_id, has_cover_art, cover_art_hash, blurhash, date_added, play_count,
                                   last_played, rating, track_number, disc_number, file_format, bitrate,
                                   sample_rate, file_size, genre)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                        ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
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

            for (track, normalized_id, normalized_file_path, public_id) in &prepared_tracks {
                ensure_not_cancelled()?;
                match existing_by_path.get(normalized_file_path) {
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

        ensure_not_cancelled()?;
        let mut stale_candidates = Vec::new();
        let mut preserved_count = 0;
        if request.traversal_complete {
            for track in existing_by_path.values() {
                ensure_not_cancelled()?;
                if !discovered.contains(&track.file_path) {
                    stale_candidates.push((track.id.clone(), track.file_path.clone()));
                }
            }
        }
        let mut missing_count = 0;
        for (id, path) in &stale_candidates {
            ensure_not_cancelled()?;
            if !matches!(scan_path_is_safe_regular_file(trimmed, path), Ok(false)) {
                preserved_count += 1;
                continue;
            }
            tx.execute("DELETE FROM lyrics_index WHERE track_id = ?1", [id])?;
            tx.execute("DELETE FROM tracks WHERE id = ?1", [id])?;
            missing_count += 1;
        }

        for path in &discovered {
            ensure_not_cancelled()?;
            if existing_by_path.contains_key(path) && !reconciled_paths.contains(path) {
                preserved_count += 1;
            }
        }
        ensure_not_cancelled()?;
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
        let normalized_old = Self::normalize_path(old_path);
        let normalized_new = Self::normalize_path(new_path);
        let new_public_id = Self::public_track_id(&normalized_new);
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        tx.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
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
        tx.execute(
            "UPDATE tracks SET id = ?1, file_path = ?1, public_id = ?2 WHERE file_path = ?3",
            params![normalized_new, new_public_id, normalized_old],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn rebase_track_paths(&self, old_root: &str, new_root: &str) -> SqliteResult<usize> {
        let (normalized_old, old_prefix) = Self::normalized_folder_scope(old_root, true)?;
        let (normalized_new, new_prefix) = Self::normalized_folder_scope(new_root, true)?;

        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        tx.execute_batch("PRAGMA defer_foreign_keys=ON;")?;
        let like_pattern = format!("{}%", escape_like(&old_prefix));
        let paths = {
            let mut stmt = tx.prepare(
                "SELECT file_path FROM tracks
                 WHERE file_path = ?1 OR file_path LIKE ?2 ESCAPE '\\'
                 ORDER BY length(file_path) ASC",
            )?;
            let rows = stmt
                .query_map(params![normalized_old, like_pattern], |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<SqliteResult<Vec<_>>>()?;
            rows
        };

        for old_path in &paths {
            let suffix = old_path.strip_prefix(&old_prefix).unwrap_or("");
            let new_path = if suffix.is_empty() {
                normalized_new.clone()
            } else {
                format!("{new_prefix}{suffix}")
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
            tx.execute(
                "UPDATE tracks SET id = ?1, file_path = ?1, public_id = ?2 WHERE file_path = ?3",
                params![new_path, Self::public_track_id(&new_path), old_path],
            )?;
        }

        let folder_paths = {
            let mut stmt =
                tx.prepare("SELECT id, folder_path FROM playlists WHERE folder_path IS NOT NULL")?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<SqliteResult<Vec<_>>>()?
                .into_iter()
                .filter_map(|(id, path)| {
                    let normalized = Self::normalize_path(&path);
                    (normalized == normalized_old || normalized.starts_with(&old_prefix))
                        .then_some((id, normalized))
                })
                .collect::<Vec<_>>();
            rows
        };
        for (playlist_id, old_folder_path) in folder_paths {
            let suffix = old_folder_path.strip_prefix(&old_prefix).unwrap_or("");
            let new_folder_path = if suffix.is_empty() {
                normalized_new.clone()
            } else {
                format!("{new_prefix}{suffix}")
            };
            tx.execute(
                "UPDATE playlists SET folder_path = ?1 WHERE id = ?2",
                params![new_folder_path, playlist_id],
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
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating,
                    track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre
             FROM tracks ORDER BY {} {}, id COLLATE BINARY ASC LIMIT ?1 OFFSET ?2",
            order_clause, order_dir
        );

        let mut stmt = conn.prepare(&query)?;
        let tracks = stmt
            .query_map(params![limit, offset], Self::map_db_track_row)?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(tracks)
    }

    pub(super) fn library_revision_with_conn(conn: &Connection) -> SqliteResult<i64> {
        conn.query_row(
            "SELECT revision FROM library_revision WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
    }

    pub fn get_tracks_cursor_page(
        &self,
        cursor: Option<&TrackPageCursor>,
        limit: u32,
        sort_by: &str,
        sort_order: &str,
    ) -> SqliteResult<DbTrackCursorPage> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let revision = Self::library_revision_with_conn(&tx)?;
        let total_count = tx.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))?;
        let (order_clause, canonical_sort_by) = match sort_by {
            "title" => ("title", "title"),
            "artist" => ("artist", "artist"),
            "album" => ("album", "album"),
            "dateAdded" => ("date_added", "dateAdded"),
            "playCount" => ("play_count", "playCount"),
            "duration" => ("duration", "duration"),
            _ => ("date_added", "dateAdded"),
        };
        let (order_dir, comparison, canonical_sort_order) = if sort_order == "asc" {
            ("ASC", ">", "asc")
        } else {
            ("DESC", "<", "desc")
        };

        if let Some(cursor) = cursor {
            let anchor_exists = cursor.revision == revision
                && cursor.sort_by == canonical_sort_by
                && cursor.sort_order == canonical_sort_order
                && tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM tracks WHERE id = ?1)",
                    [&cursor.last_id],
                    |row| row.get::<_, bool>(0),
                )?;
            if !anchor_exists {
                return Ok(DbTrackCursorPage {
                    status: TrackCursorPageStatus::RestartRequired,
                    tracks: Vec::new(),
                    next_cursor: None,
                    revision,
                    total_count,
                });
            }
        }

        let page_limit = limit.clamp(1, 5_000);
        let fetch_limit = i64::from(page_limit) + 1;
        let select = "SELECT id, title, artist, album_artist, album, year, duration, file_path,
                    has_cover_art, cover_art_hash, blurhash, date_added, play_count, last_played,
                    rating, track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre
             FROM tracks";
        let mut tracks = if let Some(cursor) = cursor {
            let query = format!(
                "{select}
                 WHERE {order_clause} {comparison} (SELECT {order_clause} FROM tracks WHERE id = ?1)
                    OR ({order_clause} = (SELECT {order_clause} FROM tracks WHERE id = ?1)
                        AND id COLLATE BINARY > ?1 COLLATE BINARY)
                 ORDER BY {order_clause} {order_dir}, id COLLATE BINARY ASC
                 LIMIT ?2"
            );
            let mut stmt = tx.prepare(&query)?;
            let tracks = stmt
                .query_map(params![cursor.last_id, fetch_limit], Self::map_db_track_row)?
                .collect::<SqliteResult<Vec<_>>>()?;
            tracks
        } else {
            let query = format!(
                "{select}
                 ORDER BY {order_clause} {order_dir}, id COLLATE BINARY ASC
                 LIMIT ?1"
            );
            let mut stmt = tx.prepare(&query)?;
            let tracks = stmt
                .query_map([fetch_limit], Self::map_db_track_row)?
                .collect::<SqliteResult<Vec<_>>>()?;
            tracks
        };

        let has_more = tracks.len() > page_limit as usize;
        if has_more {
            tracks.truncate(page_limit as usize);
        }
        let next_cursor = if has_more {
            tracks.last().map(|track| TrackPageCursor {
                revision,
                last_id: track.id.clone(),
                sort_by: canonical_sort_by.to_string(),
                sort_order: canonical_sort_order.to_string(),
            })
        } else {
            None
        };

        let page = DbTrackCursorPage {
            status: TrackCursorPageStatus::Ready,
            tracks,
            next_cursor,
            revision,
            total_count,
        };
        tx.commit()?;
        Ok(page)
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

    pub fn get_all_track_ids(&self) -> SqliteResult<Vec<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT id FROM tracks ORDER BY id COLLATE BINARY ASC")?;
        let ids = stmt
            .query_map([], |row| row.get(0))?
            .collect::<SqliteResult<Vec<_>>>();
        ids
    }

    #[cfg(test)]
    pub fn get_track_paths_page(&self, offset: u32, limit: u32) -> SqliteResult<Vec<TrackPathRow>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, file_path FROM tracks
             ORDER BY id COLLATE NOCASE ASC, id COLLATE BINARY ASC
             LIMIT ?1 OFFSET ?2",
        )?;
        let tracks = stmt
            .query_map(params![limit, offset], |row| {
                Ok(TrackPathRow {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                })
            })?
            .collect::<SqliteResult<Vec<_>>>()?;

        Ok(tracks)
    }

    pub fn get_track_paths_cursor_page(
        &self,
        cursor: Option<&TrackPageCursor>,
        limit: u32,
    ) -> SqliteResult<TrackPathCursorPage> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let revision = Self::library_revision_with_conn(&tx)?;
        if let Some(cursor) = cursor {
            let anchor_exists = cursor.revision == revision
                && cursor.sort_by == "id"
                && cursor.sort_order == "asc"
                && tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM tracks WHERE id = ?1)",
                    [&cursor.last_id],
                    |row| row.get::<_, bool>(0),
                )?;
            if !anchor_exists {
                return Ok(TrackPathCursorPage {
                    tracks: Vec::new(),
                    next_cursor: None,
                    revision,
                    restart_required: true,
                });
            }
        }

        let page_limit = limit.clamp(1, 5_000);
        let fetch_limit = i64::from(page_limit) + 1;
        let mut tracks = if let Some(cursor) = cursor {
            let mut stmt = tx.prepare(
                "SELECT id, file_path FROM tracks
                 WHERE id COLLATE BINARY > ?1 COLLATE BINARY
                 ORDER BY id COLLATE BINARY ASC
                 LIMIT ?2",
            )?;
            let tracks = stmt
                .query_map(params![cursor.last_id, fetch_limit], |row| {
                    Ok(TrackPathRow {
                        id: row.get(0)?,
                        file_path: row.get(1)?,
                    })
                })?
                .collect::<SqliteResult<Vec<_>>>()?;
            tracks
        } else {
            let mut stmt = tx.prepare(
                "SELECT id, file_path FROM tracks
                 ORDER BY id COLLATE BINARY ASC
                 LIMIT ?1",
            )?;
            let tracks = stmt
                .query_map([fetch_limit], |row| {
                    Ok(TrackPathRow {
                        id: row.get(0)?,
                        file_path: row.get(1)?,
                    })
                })?
                .collect::<SqliteResult<Vec<_>>>()?;
            tracks
        };

        let has_more = tracks.len() > page_limit as usize;
        if has_more {
            tracks.truncate(page_limit as usize);
        }
        let next_cursor = if has_more {
            tracks.last().map(|track| TrackPageCursor {
                revision,
                last_id: track.id.clone(),
                sort_by: "id".to_string(),
                sort_order: "asc".to_string(),
            })
        } else {
            None
        };

        let page = TrackPathCursorPage {
            tracks,
            next_cursor,
            revision,
            restart_required: false,
        };
        tx.commit()?;
        Ok(page)
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
        conn.query_row(
            "SELECT id, title, artist, album_artist, album, year, duration, file_path, has_cover_art,
                    cover_art_hash, blurhash, date_added, play_count, last_played, rating,
                    track_number, disc_number, file_format, bitrate, sample_rate, file_size, genre
             FROM tracks WHERE public_id = ?1 LIMIT 1",
            [public_id.to_ascii_lowercase()],
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
             WHERE album COLLATE NOCASE = ?1 COLLATE NOCASE
               AND COALESCE(NULLIF(TRIM(album_artist), ''), artist) COLLATE NOCASE = ?2 COLLATE NOCASE
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
             WHERE artist COLLATE NOCASE = ?1 COLLATE NOCASE
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

    pub fn get_track_count(&self) -> SqliteResult<i64> {
        let conn = self.conn.lock();
        conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0))
    }

    pub fn count_tracks_by_folder(&self, folder_path: &str) -> SqliteResult<i64> {
        let (normalized, prefix) = Self::normalized_folder_scope(folder_path, true)?;
        let like_pattern = format!("{}%", escape_like(&prefix));
        let conn = self.conn.lock();
        conn.query_row(
            "SELECT COUNT(*) FROM tracks
             WHERE file_path = ?1 OR file_path LIKE ?2 ESCAPE '\\'",
            params![normalized, like_pattern],
            |row| row.get(0),
        )
    }

    pub fn get_track_ids_by_folder(&self, folder_path: &str) -> SqliteResult<Vec<String>> {
        let (normalized, folder_prefix) = Self::normalized_folder_scope(folder_path, false)?;
        let prefix = format!("{}%", escape_like(&folder_prefix));
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id
             FROM tracks
             WHERE file_path = ?1 OR file_path LIKE ?2 ESCAPE '\\'
             ORDER BY file_path COLLATE NOCASE ASC",
        )?;
        let ids = stmt
            .query_map(params![normalized, prefix], |row| row.get::<_, String>(0))?
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
        self.delete_tracks_by_folder_inner(folder_path, false)
    }

    pub fn delete_tracks_for_library_source(&self, folder_path: &str) -> SqliteResult<usize> {
        self.delete_tracks_by_folder_inner(folder_path, true)
    }

    fn delete_tracks_by_folder_inner(
        &self,
        folder_path: &str,
        allow_root: bool,
    ) -> SqliteResult<usize> {
        let (normalized_folder, prefix) = Self::normalized_folder_scope(folder_path, allow_root)?;
        let mut conn = self.conn.lock();
        let like_pattern = format!("{}%", escape_like(&prefix));
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM lyrics_index WHERE track_id = ?1 OR track_id LIKE ?2 ESCAPE '\\'",
            params![normalized_folder, like_pattern],
        )?;
        // Query using normalized paths only (database should have normalized paths)
        let count = tx.execute(
            "DELETE FROM tracks WHERE file_path = ?1 OR file_path LIKE ?2 ESCAPE '\\'",
            params![normalized_folder, like_pattern],
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
