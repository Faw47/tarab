use crate::database::{LyricsIndexEntry, SharedDatabase};
use crate::file_ops::{ensure_existing_path_allowed, SharedLibraryRoots};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::async_runtime::spawn_blocking;
use tauri::State;

#[derive(Debug, Deserialize)]
struct LrclibRecord {
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
}

fn trim_nonempty(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// Local sidecar `.lrc` / `.txt` lyrics only. Returns `None` if missing or blank.
fn load_local_lyrics_for_track(track_path: &str) -> Option<String> {
    let path = Path::new(track_path);
    let canonical: PathBuf = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    let read_nonempty = |p: &Path| -> Option<String> {
        std::fs::read_to_string(p)
            .ok()
            .and_then(|c| trim_nonempty(&c))
    };

    let lrc_path = canonical.with_extension("lrc");
    if lrc_path.exists() {
        if let Some(content) = read_nonempty(&lrc_path) {
            return Some(content);
        }
    }

    let txt_path = canonical.with_extension("txt");
    if txt_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&txt_path) {
            if content.contains('[') && content.contains(']') {
                if let Some(c) = trim_nonempty(&content) {
                    return Some(c);
                }
            }
        }
    }

    if let Some(stem) = canonical.file_stem() {
        if let Some(parent) = canonical.parent() {
            let lrc_path = parent.join(format!("{}.lrc", stem.to_string_lossy()));
            if lrc_path.exists() {
                if let Some(content) = read_nonempty(&lrc_path) {
                    return Some(content);
                }
            }
        }
    }

    None
}

/// LRCLIB fallback. Call only after local lyrics are confirmed empty.
pub async fn fetch_lrclib(
    artist: &str,
    title: &str,
    album: &str,
    duration_secs: f64,
) -> Result<Option<String>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Tarab/0.1.0")
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| format!("Failed to create lyrics client: {}", e))?;

    let duration_str = if duration_secs.is_finite() && duration_secs > 0.0 {
        Some(((duration_secs.round() as i64).max(1)).to_string())
    } else {
        None
    };

    let mut req = client.get("https://lrclib.net/api/get").query(&[
        ("artist_name", artist),
        ("track_name", title),
        ("album_name", album),
    ]);

    if let Some(ref d) = duration_str {
        req = req.query(&[("duration", d.as_str())]);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("Lyrics request failed: {}", e))?;
    if !resp.status().is_success() {
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        return Err(format!(
            "Lyrics request failed with status {}",
            resp.status()
        ));
    }

    let data: LrclibRecord = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse lyrics response: {}", e))?;

    if let Some(ref s) = data.synced_lyrics {
        if let Some(out) = trim_nonempty(s) {
            return Ok(Some(out));
        }
    }
    if let Some(ref s) = data.plain_lyrics {
        if let Some(out) = trim_nonempty(s) {
            return Ok(Some(out));
        }
    }
    Ok(None)
}

/// Result from lyrics search including the matched line
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsSearchResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub file_path: String,
    pub cover_art_hash: Option<String>,
    pub matched_line: String,      // The line containing the match
    pub matched_line_index: usize, // Line number (0-indexed)
}

/// Resolves lyrics: **local sidecars first**; LRCLIB only when local is empty and `auto_lyrics` is true.
#[tauri::command]
pub async fn get_lyrics_for_track(
    track_path: String,
    auto_lyrics: bool,
    artist: String,
    title: String,
    album: String,
    duration: f64,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Option<String>, String> {
    let path = std::path::Path::new(&track_path);
    let roots = roots_state.read().roots.clone();
    if crate::file_ops::ensure_existing_path_allowed(path, &roots, "read lyrics for track").is_err() {
        return Ok(None);
    }
    if let Some(local) = load_local_lyrics_for_track(&track_path) {
        return Ok(Some(local));
    }
    if auto_lyrics {
        return fetch_lrclib(&artist, &title, &album, duration).await;
    }
    Ok(None)
}

#[tauri::command]
pub async fn fetch_lrclib_lyrics(
    file_path: String,
    artist: String,
    title: String,
    album: String,
    duration: f64,
) -> Result<Option<String>, String> {
    let _ = file_path;
    fetch_lrclib(&artist, &title, &album, duration).await
}

#[tauri::command]
pub fn write_lyrics_for_track(
    track_path: String,
    content: String,
    roots_state: State<'_, SharedLibraryRoots>,
) -> Result<(), String> {
    let roots = roots_state.read().roots.clone();
    write_lyrics_for_track_checked(&track_path, content, &roots)
}

fn write_lyrics_for_track_checked(
    track_path: &str,
    content: String,
    roots: &[PathBuf],
) -> Result<(), String> {
    let path = Path::new(track_path);
    let canonical = ensure_existing_path_allowed(path, roots, "write lyrics for track")?;
    let lrc_path = canonical.with_extension("lrc");
    std::fs::write(&lrc_path, content).map_err(|e| format!("Failed to write lyrics: {}", e))
}

/// Normalize path separators for the current platform
fn normalize_path_separators(path: &str) -> String {
    #[cfg(windows)]
    {
        path.replace('/', "\\")
    }
    #[cfg(not(windows))]
    {
        path.to_string()
    }
}

/// Helper function to find .lrc file for a track
/// Handles Windows path normalization and tries multiple locations
fn find_lyrics_file(track_path: &str) -> Option<PathBuf> {
    // Normalize path separators for the current platform
    let normalized_path = normalize_path_separators(track_path);
    let path = Path::new(&normalized_path);

    // Try to get canonical path, but don't fail if it doesn't exist
    let base_path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    // Try .lrc file with the base path
    let lrc_path = base_path.with_extension("lrc");
    if lrc_path.exists() {
        return Some(lrc_path);
    }

    // Also try with the original (non-canonicalized) path
    let lrc_path_original = path.with_extension("lrc");
    if lrc_path_original.exists() {
        return Some(lrc_path_original);
    }

    // Try .txt file
    let txt_path = base_path.with_extension("txt");
    if txt_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&txt_path) {
            // Check if it looks like LRC format
            if content.contains('[') && content.contains(']') {
                return Some(txt_path);
            }
        }
    }

    // Try filename.lrc (same name, different extension) with canonicalized path
    if let Some(stem) = base_path.file_stem() {
        if let Some(parent) = base_path.parent() {
            let lrc_path = parent.join(format!("{}.lrc", stem.to_string_lossy()));
            if lrc_path.exists() {
                return Some(lrc_path);
            }
        }
    }

    // Try filename.lrc with original path
    if let Some(stem) = path.file_stem() {
        if let Some(parent) = path.parent() {
            let lrc_path = parent.join(format!("{}.lrc", stem.to_string_lossy()));
            if lrc_path.exists() {
                return Some(lrc_path);
            }
        }
    }

    None
}

/// Extract clean text from an LRC line (removes timestamp)
/// Handles formats: [mm:ss.xxx], [mm:ss.xx], [mm:ss], [m:ss.xxx], [m:ss], and angle-bracket word timestamps.
/// Removes all timestamp patterns (both square and angle brackets) from anywhere in the line
fn clean_lrc_line(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut result = String::new();
    let chars: Vec<char> = trimmed.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        // Check for both square brackets [ ] and angle brackets < >
        let close_bracket = if chars[i] == '[' {
            ']'
        } else if chars[i] == '<' {
            '>'
        } else {
            // Not a bracket, include the character
            result.push(chars[i]);
            i += 1;
            continue;
        };

        // Try to find the closing bracket and check if it's a timestamp
        let start = i;
        let mut j = i + 1;
        let mut found_close = false;

        // Find the matching closing bracket
        while j < chars.len() {
            if chars[j] == close_bracket {
                found_close = true;
                break;
            }
            if chars[j] == '\n' || chars[j] == '\r' {
                // Newline before closing bracket, not a timestamp
                break;
            }
            j += 1;
        }

        if found_close {
            // Extract the potential timestamp
            let potential_timestamp: String = chars[start..=j].iter().collect();
            if is_valid_timestamp(&potential_timestamp) {
                // Skip the timestamp
                i = j + 1;
                continue;
            }
        }

        // Not a timestamp, include the bracket
        result.push(chars[i]);
        i += 1;
    }

    result.trim().to_string()
}

/// Check if a string matches LRC timestamp pattern
/// Supports both square brackets and angle brackets with one to three fractional digits.
fn is_valid_timestamp(s: &str) -> bool {
    // Check for both bracket types
    if !((s.starts_with('[') && s.ends_with(']')) || (s.starts_with('<') && s.ends_with('>'))) {
        return false;
    }

    if s.len() < 6 {
        return false;
    }

    let inner = &s[1..s.len() - 1]; // Remove brackets
    let parts: Vec<&str> = inner.split(':').collect();

    if parts.len() != 2 {
        return false;
    }

    // Check minutes part (1-2 digits)
    let minutes = parts[0];
    if minutes.is_empty() || minutes.len() > 2 || !minutes.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }

    let seconds_part = parts[1];
    let sec_parts: Vec<&str> = seconds_part.split('.').collect();
    match sec_parts.as_slice() {
        [seconds] => seconds.len() == 2 && seconds.chars().all(|c| c.is_ascii_digit()),
        [seconds, fraction] => {
            seconds.len() == 2
                && seconds.chars().all(|c| c.is_ascii_digit())
                && (1..=3).contains(&fraction.len())
                && fraction.chars().all(|c| c.is_ascii_digit())
        }
        _ => false,
    }
}

fn file_mtime_millis(path: &Path) -> i64 {
    path.metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .and_then(|d| i64::try_from(d.as_millis()).ok())
        .unwrap_or(0)
}

fn find_first_match_line(content: &str, query_lower: &str) -> Option<(String, usize)> {
    for (line_idx, line) in content.lines().enumerate() {
        let clean_line = clean_lrc_line(line);
        if clean_line.is_empty() {
            continue;
        }
        if clean_line.to_lowercase().contains(query_lower) {
            return Some((clean_line, line_idx));
        }
    }
    None
}

fn sync_lyrics_index_blocking(db: &SharedDatabase) -> Result<u32, String> {
    let tracks = db
        .get_all_tracks()
        .map_err(|e| format!("Failed to get tracks for lyrics sync: {}", e))?;
    let existing = db
        .get_lyrics_index_meta()
        .map_err(|e| format!("Failed to get existing lyrics index: {}", e))?;

    let existing_by_track: HashMap<String, (String, i64)> = existing
        .iter()
        .map(|entry| {
            (
                entry.track_id.clone(),
                (entry.lyrics_path.clone(), entry.lyrics_mtime),
            )
        })
        .collect();

    let mut upserts: Vec<LyricsIndexEntry> = Vec::new();
    let mut deletes: Vec<String> = Vec::new();
    let mut track_ids = HashSet::new();

    for track in tracks {
        track_ids.insert(track.id.clone());
        let existing_meta = existing_by_track.get(&track.id);
        let lyrics_file = find_lyrics_file(&track.file_path);

        match lyrics_file {
            Some(path) => {
                let mtime = file_mtime_millis(&path);
                let normalized_path = path.to_string_lossy().replace('\\', "/");
                let unchanged = existing_meta
                    .map(|(p, t)| p == &normalized_path && *t == mtime)
                    .unwrap_or(false);

                if unchanged {
                    continue;
                }

                match std::fs::read_to_string(&path) {
                    Ok(content) => {
                        if content.trim().is_empty() {
                            deletes.push(track.id.clone());
                        } else {
                            upserts.push(LyricsIndexEntry {
                                track_id: track.id.clone(),
                                lyrics_path: normalized_path,
                                lyrics_mtime: mtime,
                                content,
                            });
                        }
                    }
                    Err(_) => {
                        deletes.push(track.id.clone());
                    }
                }
            }
            None => {
                if existing_meta.is_some() {
                    deletes.push(track.id.clone());
                }
            }
        }
    }

    for orphan in existing_by_track.keys() {
        if !track_ids.contains(orphan) {
            deletes.push(orphan.clone());
        }
    }

    deletes.sort();
    deletes.dedup();

    let mut changed = 0usize;
    if !upserts.is_empty() {
        changed += db
            .upsert_lyrics_index_batch(&upserts)
            .map_err(|e| format!("Failed to upsert lyrics index: {}", e))?;
    }
    if !deletes.is_empty() {
        changed += db
            .delete_lyrics_index_tracks(&deletes)
            .map_err(|e| format!("Failed to delete stale lyrics index rows: {}", e))?;
    }

    changed += db
        .cleanup_lyrics_index_orphans()
        .map_err(|e| format!("Failed to cleanup orphan lyrics rows: {}", e))?;

    Ok(changed as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tarab-lyrics-{}-{}", name, nonce));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn write_lyrics_rejects_outside_root() {
        let allowed_root = temp_dir("allowed");
        let outside_root = temp_dir("outside");
        let track = outside_root.join("song.mp3");
        fs::write(&track, b"audio").expect("write track");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = write_lyrics_for_track_checked(
            &track.to_string_lossy(),
            "[00:01]Nope".to_string(),
            &roots,
        );

        assert!(result.is_err());
        assert!(!outside_root.join("song.lrc").exists());

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn write_lyrics_writes_lrc_next_to_allowed_track() {
        let allowed_root = temp_dir("allowed-write");
        let track = allowed_root.join("song.mp3");
        fs::write(&track, b"audio").expect("write track");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        write_lyrics_for_track_checked(&track.to_string_lossy(), "[00:01]Line".to_string(), &roots)
            .expect("write lyrics");

        assert_eq!(
            fs::read_to_string(allowed_root.join("song.lrc")).expect("read lrc"),
            "[00:01]Line"
        );

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[test]
    fn clean_lrc_line_removes_millisecond_line_and_word_timestamps() {
        let line = "[00:01.234]<00:01.250>Hello <00:02.000>world";

        assert_eq!(clean_lrc_line(line), "Hello world");
    }
}

#[tauri::command]
pub async fn sync_lyrics_index(db: State<'_, SharedDatabase>) -> Result<u32, String> {
    let db_clone = db.inner().clone();
    spawn_blocking(move || sync_lyrics_index_blocking(&db_clone))
        .await
        .map_err(|e| format!("Lyrics sync task failed: {}", e))?
}

#[tauri::command]
pub async fn search_lyrics(
    query: String,
    limit: u32,
    db: State<'_, SharedDatabase>,
) -> Result<Vec<LyricsSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let db_clone = db.inner().clone();
    let query_lower = query.to_lowercase();
    let query_for_db = query.clone();

    spawn_blocking(move || {
        if db_clone
            .lyrics_index_count()
            .map_err(|e| format!("Failed to read lyrics index count: {}", e))?
            == 0
        {
            let _ = sync_lyrics_index_blocking(&db_clone);
        }

        let candidates = db_clone
            .search_lyrics_index_candidates(&query_for_db, limit)
            .map_err(|e| format!("Failed to query lyrics index: {}", e))?;

        let mut results: Vec<LyricsSearchResult> = Vec::new();
        for candidate in candidates {
            if let Some((matched_line, matched_line_index)) =
                find_first_match_line(&candidate.content, &query_lower)
            {
                results.push(LyricsSearchResult {
                    id: candidate.id,
                    title: candidate.title,
                    artist: candidate.artist,
                    album: candidate.album,
                    duration: candidate.duration,
                    file_path: candidate.file_path,
                    cover_art_hash: candidate.cover_art_hash,
                    matched_line,
                    matched_line_index,
                });
            }

            if results.len() >= limit as usize {
                break;
            }
        }

        Ok(results)
    })
    .await
    .map_err(|e| format!("Search task failed: {}", e))?
}
