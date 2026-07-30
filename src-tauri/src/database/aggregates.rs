use rusqlite::Result as SqliteResult;

use super::{Database, DbAlbumAggregate, DbArtistAggregate};

impl Database {
    pub fn get_album_aggregates(&self) -> SqliteResult<Vec<DbAlbumAggregate>> {
        let summaries = {
            let conn = self.conn.lock();
            let mut stmt = conn.prepare(
                "SELECT album,
                        COALESCE(NULLIF(album_artist, ''), artist) AS effective_artist,
                        COUNT(*) AS track_count,
                        COALESCE(
                            MIN(CASE WHEN has_cover_art = 1 THEN id END),
                            MIN(id)
                        ) AS representative_id
                 FROM tracks
                 GROUP BY album, effective_artist
                 ORDER BY album COLLATE NOCASE ASC, effective_artist COLLATE NOCASE ASC",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, usize>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })?
                .collect::<SqliteResult<Vec<_>>>()?;
            rows
        };
        let ids = summaries
            .iter()
            .map(|(_, _, _, id)| id.clone())
            .collect::<Vec<_>>();
        let tracks = self
            .get_tracks_by_ids(&ids)?
            .into_iter()
            .map(|track| (track.id.clone(), track))
            .collect::<std::collections::HashMap<_, _>>();
        summaries
            .into_iter()
            .map(|(album, artist, track_count, id)| {
                let representative = tracks
                    .get(&id)
                    .cloned()
                    .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
                Ok(DbAlbumAggregate {
                    album,
                    artist,
                    track_count,
                    representative,
                })
            })
            .collect()
    }

    pub fn get_artist_aggregates(&self) -> SqliteResult<Vec<DbArtistAggregate>> {
        let summaries = {
            let conn = self.conn.lock();
            let mut stmt = conn.prepare(
                "SELECT artist,
                        COUNT(*) AS track_count,
                        COALESCE(
                            MIN(CASE WHEN has_cover_art = 1 THEN id END),
                            MIN(id)
                        ) AS representative_id
                 FROM tracks
                 GROUP BY artist
                 ORDER BY artist COLLATE NOCASE ASC",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, usize>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<SqliteResult<Vec<_>>>()?;
            rows
        };
        let ids = summaries
            .iter()
            .map(|(_, _, id)| id.clone())
            .collect::<Vec<_>>();
        let tracks = self
            .get_tracks_by_ids(&ids)?
            .into_iter()
            .map(|track| (track.id.clone(), track))
            .collect::<std::collections::HashMap<_, _>>();
        summaries
            .into_iter()
            .map(|(artist, track_count, id)| {
                let representative = tracks
                    .get(&id)
                    .cloned()
                    .ok_or(rusqlite::Error::QueryReturnedNoRows)?;
                Ok(DbArtistAggregate {
                    artist,
                    track_count,
                    representative,
                })
            })
            .collect()
    }
}
