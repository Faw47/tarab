use rusqlite::Result as SqliteResult;

use super::{Database, DbAlbumAggregate, DbArtistAggregate, DbTrackAggregateRepresentative};

impl Database {
    fn get_aggregate_representatives(
        &self,
        ids: &[String],
    ) -> SqliteResult<std::collections::HashMap<String, DbTrackAggregateRepresentative>> {
        let conn = self.conn.lock();
        let mut representatives = std::collections::HashMap::with_capacity(ids.len());

        for chunk in ids.chunks(900) {
            let placeholders = (0..chunk.len())
                .map(|index| format!("?{}", index + 1))
                .collect::<Vec<_>>()
                .join(", ");
            let query = format!(
                "SELECT id, title, artist, album, year, duration, file_path, has_cover_art,
                        cover_art_hash, blurhash
                 FROM tracks
                 WHERE id IN ({placeholders})"
            );
            let mut statement = conn.prepare(&query)?;
            let rows = statement.query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                Ok(DbTrackAggregateRepresentative {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    album: row.get(3)?,
                    year: row.get(4)?,
                    duration: row.get(5)?,
                    file_path: row.get(6)?,
                    has_cover_art: row.get(7)?,
                    cover_art_hash: row.get(8)?,
                    blurhash: row.get(9)?,
                })
            })?;

            for row in rows {
                let representative = row?;
                representatives.insert(representative.id.clone(), representative);
            }
        }

        Ok(representatives)
    }

    pub fn get_album_aggregates(&self) -> SqliteResult<Vec<DbAlbumAggregate>> {
        let summaries = {
            let conn = self.conn.lock();
            let mut statement = conn.prepare(
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
            let rows = statement
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
        let representatives = self.get_aggregate_representatives(&ids)?;

        summaries
            .into_iter()
            .map(|(album, artist, track_count, id)| {
                let representative = representatives
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
            let mut statement = conn.prepare(
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
            let rows = statement
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
        let representatives = self.get_aggregate_representatives(&ids)?;

        summaries
            .into_iter()
            .map(|(artist, track_count, id)| {
                let representative = representatives
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
