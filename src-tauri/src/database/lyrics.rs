use rusqlite::{params, params_from_iter, Result as SqliteResult};
use std::io;

use super::{
    Database, LyricsIndexEntry, LyricsIndexMeta, LyricsIndexSyncApply, LyricsSearchCandidate,
};

const MAX_LYRICS_INDEX_CONTENT_BYTES: usize = 1024 * 1024;

fn oversized_lyrics_error() -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(io::Error::new(
        io::ErrorKind::InvalidInput,
        "lyrics index content exceeds 1 MiB",
    )))
}

impl Database {
    #[cfg(test)]
    pub(crate) fn insert_lyrics_index_orphan_for_tests(
        &self,
        entry: &LyricsIndexEntry,
    ) -> SqliteResult<()> {
        let conn = self.conn.lock();
        conn.execute_batch("PRAGMA foreign_keys=OFF;")?;
        let result = conn.execute(
            "INSERT OR REPLACE INTO lyrics_index (track_id, lyrics_path, lyrics_mtime, content)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                entry.track_id,
                entry.lyrics_path,
                entry.lyrics_mtime,
                entry.content
            ],
        );
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        result.map(|_| ())
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

    #[cfg(test)]
    pub fn upsert_lyrics_index_batch(&self, entries: &[LyricsIndexEntry]) -> SqliteResult<usize> {
        if entries.is_empty() {
            return Ok(0);
        }
        if entries
            .iter()
            .any(|entry| entry.content.len() > MAX_LYRICS_INDEX_CONTENT_BYTES)
        {
            return Err(oversized_lyrics_error());
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

    pub fn apply_lyrics_index_sync(
        &self,
        expected_revision: i64,
        entries: &[LyricsIndexEntry],
        track_ids_to_delete: &[String],
    ) -> SqliteResult<LyricsIndexSyncApply> {
        if entries
            .iter()
            .any(|entry| entry.content.len() > MAX_LYRICS_INDEX_CONTENT_BYTES)
        {
            return Err(oversized_lyrics_error());
        }

        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        if Self::library_revision_with_conn(&tx)? != expected_revision {
            return Ok(LyricsIndexSyncApply::RestartRequired);
        }

        let mut changed = 0usize;
        if !entries.is_empty() {
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
                changed += stmt.execute(params![
                    Self::normalize_path(&entry.track_id),
                    entry.lyrics_path,
                    entry.lyrics_mtime,
                    entry.content,
                ])?;
            }
        }

        let normalized_track_ids = track_ids_to_delete
            .iter()
            .map(|track_id| Self::normalize_path(track_id))
            .collect::<Vec<_>>();
        for chunk in normalized_track_ids.chunks(900) {
            let placeholders = std::iter::repeat_n("?", chunk.len())
                .collect::<Vec<_>>()
                .join(", ");
            let query = format!("DELETE FROM lyrics_index WHERE track_id IN ({placeholders})");
            changed += tx.execute(&query, params_from_iter(chunk.iter().map(String::as_str)))?;
        }
        changed += tx.execute(
            "DELETE FROM lyrics_index WHERE track_id NOT IN (SELECT id FROM tracks)",
            [],
        )?;
        tx.commit()?;
        Ok(LyricsIndexSyncApply::Applied(changed))
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
}
