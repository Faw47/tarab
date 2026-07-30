use super::*;

impl Database {
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

    pub fn relink_playlist_track(
        &self,
        playlist_id: &str,
        old_track_id: &str,
        new_track_id: &str,
        updated_at: i64,
    ) -> SqliteResult<()> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let old_track_id = Self::normalize_path(old_track_id);
        let new_track_id = Self::normalize_path(new_track_id);
        let source_exists: i64 = tx.query_row(
            "SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?1 AND track_id = ?2",
            params![playlist_id, old_track_id],
            |row| row.get(0),
        )?;
        if source_exists == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        let target_exists: i64 = tx.query_row(
            "SELECT COUNT(*) FROM tracks WHERE id = ?1",
            params![new_track_id],
            |row| row.get(0),
        )?;
        if target_exists == 0 {
            return Err(rusqlite::Error::InvalidParameterName(
                "replacement track is not indexed".to_string(),
            ));
        }
        let duplicate: i64 = tx.query_row(
            "SELECT COUNT(*) FROM playlist_tracks
             WHERE playlist_id = ?1 AND track_id = ?2 AND track_id <> ?3",
            params![playlist_id, new_track_id, old_track_id],
            |row| row.get(0),
        )?;
        if duplicate > 0 {
            return Err(rusqlite::Error::InvalidParameterName(
                "replacement track is already in this playlist".to_string(),
            ));
        }
        tx.execute(
            r#"
            UPDATE playlist_tracks
            SET track_id = ?3,
                snapshot_title = (SELECT title FROM tracks WHERE id = ?3),
                snapshot_artist = (SELECT artist FROM tracks WHERE id = ?3),
                snapshot_album = (SELECT album FROM tracks WHERE id = ?3),
                snapshot_duration = (SELECT duration FROM tracks WHERE id = ?3),
                snapshot_file_path = (SELECT file_path FROM tracks WHERE id = ?3),
                snapshot_has_cover_art = COALESCE(
                    (SELECT has_cover_art FROM tracks WHERE id = ?3),
                    0
                ),
                snapshot_cover_art_hash = (SELECT cover_art_hash FROM tracks WHERE id = ?3),
                snapshot_blurhash = (SELECT blurhash FROM tracks WHERE id = ?3)
            WHERE playlist_id = ?1 AND track_id = ?2
            "#,
            params![playlist_id, old_track_id, new_track_id],
        )?;
        tx.execute(
            "UPDATE playlists SET updated_at = ?2 WHERE id = ?1",
            params![playlist_id, updated_at],
        )?;
        tx.commit()
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
}
