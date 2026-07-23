use crate::database::{LyricsIndexEntry, SharedDatabase, TrackPathRow};
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

const MAX_LYRICS_SIDECAR_BYTES: u64 = 1024 * 1024;
const MAX_LRCLIB_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_LRCLIB_FIELD_CHARS: usize = 512;

fn trim_nonempty(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// Local sidecar `.lrc` / `.txt` lyrics only. Returns `None` if missing or blank.
fn read_allowed_sidecar(path: &Path, roots: &[PathBuf]) -> Option<String> {
    let link_metadata = std::fs::symlink_metadata(path).ok()?;
    if link_metadata.file_type().is_symlink()
        || !link_metadata.is_file()
        || link_metadata.len() > MAX_LYRICS_SIDECAR_BYTES
    {
        return None;
    }

    let canonical = ensure_existing_path_allowed(path, roots, "read lyrics sidecar").ok()?;
    std::fs::read_to_string(canonical)
        .ok()
        .and_then(|content| trim_nonempty(&content))
}

fn load_local_lyrics_for_track(track_path: &str, roots: &[PathBuf]) -> Option<String> {
    let path = Path::new(track_path);
    let canonical = ensure_existing_path_allowed(path, roots, "read lyrics for track").ok()?;

    let lrc_path = canonical.with_extension("lrc");
    if let Some(content) = read_allowed_sidecar(&lrc_path, roots) {
        return Some(content);
    }

    let txt_path = canonical.with_extension("txt");
    if let Some(content) = read_allowed_sidecar(&txt_path, roots) {
        if content.contains('[') && content.contains(']') {
            return Some(content);
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
    if [artist, title, album]
        .iter()
        .any(|value| value.chars().count() > MAX_LRCLIB_FIELD_CHARS)
    {
        return Err("Lyrics request metadata is too long".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent("Tarab/1.0.0")
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
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

    let mut resp = req
        .send()
        .await
        .map_err(|e| format!("Lyrics request failed: {}", e))?;
    let response_url = resp.url();
    if response_url.scheme() != "https"
        || response_url.host_str() != Some("lrclib.net")
        || response_url.port_or_known_default() != Some(443)
    {
        return Err("Lyrics response came from an unexpected endpoint".to_string());
    }
    if !resp.status().is_success() {
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        return Err(format!(
            "Lyrics request failed with status {}",
            resp.status()
        ));
    }

    if resp
        .content_length()
        .is_some_and(|length| length > MAX_LRCLIB_RESPONSE_BYTES as u64)
    {
        return Err("Lyrics response is too large".to_string());
    }

    let mut body = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Failed to read lyrics response: {}", e))?
    {
        let next_len = body
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| "Lyrics response is too large".to_string())?;
        if next_len > MAX_LRCLIB_RESPONSE_BYTES {
            return Err("Lyrics response is too large".to_string());
        }
        body.extend_from_slice(&chunk);
    }

    let data: LrclibRecord = serde_json::from_slice(&body)
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
    if crate::file_ops::ensure_existing_path_allowed(path, &roots, "read lyrics for track").is_err()
    {
        return Ok(None);
    }
    if let Some(local) = load_local_lyrics_for_track(&track_path, &roots) {
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
    if let Ok(metadata) = std::fs::symlink_metadata(&lrc_path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Lyrics destination must be a regular file".to_string());
        }
        ensure_existing_path_allowed(&lrc_path, roots, "write lyrics sidecar")?;
    } else {
        crate::file_ops::ensure_target_path_allowed(&lrc_path, roots, "write lyrics sidecar")?;
    }
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
fn find_lyrics_file(track_path: &str, roots: &[PathBuf]) -> Option<PathBuf> {
    // Normalize path separators for the current platform
    let normalized_path = normalize_path_separators(track_path);
    let path = Path::new(&normalized_path);

    // Try to get canonical path, but don't fail if it doesn't exist
    let base_path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

    // Try .lrc file with the base path
    let lrc_path = base_path.with_extension("lrc");
    if read_allowed_sidecar(&lrc_path, roots).is_some() {
        return ensure_existing_path_allowed(&lrc_path, roots, "index lyrics sidecar").ok();
    }

    // Also try with the original (non-canonicalized) path
    let lrc_path_original = path.with_extension("lrc");
    if read_allowed_sidecar(&lrc_path_original, roots).is_some() {
        return ensure_existing_path_allowed(&lrc_path_original, roots, "index lyrics sidecar")
            .ok();
    }

    // Try .txt file
    let txt_path = base_path.with_extension("txt");
    if let Some(content) = read_allowed_sidecar(&txt_path, roots) {
        if content.contains('[') && content.contains(']') {
            return ensure_existing_path_allowed(&txt_path, roots, "index lyrics sidecar").ok();
        }
    }

    // Try filename.lrc (same name, different extension) with canonicalized path
    if let Some(stem) = base_path.file_stem() {
        if let Some(parent) = base_path.parent() {
            let lrc_path = parent.join(format!("{}.lrc", stem.to_string_lossy()));
            if read_allowed_sidecar(&lrc_path, roots).is_some() {
                return ensure_existing_path_allowed(&lrc_path, roots, "index lyrics sidecar").ok();
            }
        }
    }

    // Try filename.lrc with original path
    if let Some(stem) = path.file_stem() {
        if let Some(parent) = path.parent() {
            let lrc_path = parent.join(format!("{}.lrc", stem.to_string_lossy()));
            if read_allowed_sidecar(&lrc_path, roots).is_some() {
                return ensure_existing_path_allowed(&lrc_path, roots, "index lyrics sidecar").ok();
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

fn is_track_path_allowed_for_lyrics(track_path: &str, roots: Option<&[PathBuf]>) -> bool {
    roots
        .map(|roots| {
            ensure_existing_path_allowed(Path::new(track_path), roots, "sync lyrics for track")
                .is_ok()
        })
        .unwrap_or(true)
}

fn sync_lyrics_index_blocking(
    db: &SharedDatabase,
    roots: Option<&[PathBuf]>,
) -> Result<u32, String> {
    if matches!(roots, Some(roots) if roots.is_empty()) {
        return Ok(0);
    }

    const TRACK_PAGE_SIZE: u32 = 1000;

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
    let mut offset = 0;

    loop {
        let tracks = db
            .get_track_paths_page(offset, TRACK_PAGE_SIZE)
            .map_err(|e| format!("Failed to get tracks for lyrics sync: {}", e))?;
        if tracks.is_empty() {
            break;
        }

        for TrackPathRow { id, file_path } in tracks {
            track_ids.insert(id.clone());
            let existing_meta = existing_by_track.get(&id);
            if !is_track_path_allowed_for_lyrics(&file_path, roots) {
                if existing_meta.is_some() {
                    deletes.push(id.clone());
                }
                continue;
            }
            let lyrics_file = find_lyrics_file(&file_path, roots.unwrap_or(&[]));

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
                                deletes.push(id.clone());
                            } else {
                                upserts.push(LyricsIndexEntry {
                                    track_id: id.clone(),
                                    lyrics_path: normalized_path,
                                    lyrics_mtime: mtime,
                                    content,
                                });
                            }
                        }
                        Err(_) => {
                            deletes.push(id.clone());
                        }
                    }
                }
                None => {
                    if existing_meta.is_some() {
                        deletes.push(id.clone());
                    }
                }
            }
        }

        offset += TRACK_PAGE_SIZE;
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

    u32::try_from(changed).map_err(|_| "Lyrics sync changed row count overflowed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{Database, DbTrack};
    use std::fs;
    use std::sync::Arc;
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

    #[cfg(unix)]
    #[test]
    fn local_lyrics_rejects_sidecar_symlink_outside_root() {
        use std::os::unix::fs::symlink;

        let allowed_root = temp_dir("sidecar-read-allowed");
        let outside_root = temp_dir("sidecar-read-outside");
        let track = allowed_root.join("song.mp3");
        let outside_lyrics = outside_root.join("outside.lrc");
        fs::write(&track, b"audio").expect("write track");
        fs::write(&outside_lyrics, "[00:01]Outside").expect("write outside lyrics");
        symlink(&outside_lyrics, track.with_extension("lrc")).expect("create sidecar symlink");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        assert_eq!(
            load_local_lyrics_for_track(&track.to_string_lossy(), &roots),
            None
        );

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[cfg(unix)]
    #[test]
    fn write_lyrics_rejects_sidecar_symlink_outside_root() {
        use std::os::unix::fs::symlink;

        let allowed_root = temp_dir("sidecar-write-allowed");
        let outside_root = temp_dir("sidecar-write-outside");
        let track = allowed_root.join("song.mp3");
        let outside_lyrics = outside_root.join("outside.lrc");
        fs::write(&track, b"audio").expect("write track");
        fs::write(&outside_lyrics, "original").expect("write outside lyrics");
        symlink(&outside_lyrics, track.with_extension("lrc")).expect("create sidecar symlink");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = write_lyrics_for_track_checked(
            &track.to_string_lossy(),
            "[00:01]Changed".to_string(),
            &roots,
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&outside_lyrics).expect("read outside lyrics"),
            "original"
        );

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    fn sample_track(id: &str, file_path: String) -> DbTrack {
        DbTrack {
            id: id.to_string(),
            title: id.to_string(),
            artist: "Artist".to_string(),
            album_artist: None,
            album: "Album".to_string(),
            year: Some(2024),
            duration: 180.0,
            file_path,
            has_cover_art: false,
            cover_art_hash: None,
            blurhash: None,
            date_added: 1,
            play_count: 0,
            last_played: None,
            rating: None,
        }
    }

    #[test]
    fn sync_lyrics_index_paginates_tracks_and_cleans_orphans() {
        let db = Arc::new(Database::in_memory_for_tests().expect("create db"));
        let dir = temp_dir("sync-pages");
        let tracks: Vec<DbTrack> = (0..1001)
            .map(|i| {
                let path = dir.join(format!("track-{i:04}.mp3"));
                fs::write(&path, b"audio").expect("write track");
                fs::write(path.with_extension("lrc"), "[00:01]Line").expect("write lrc");
                sample_track(&format!("track-{i:04}"), path.to_string_lossy().to_string())
            })
            .collect();
        db.upsert_tracks_batch(&tracks).expect("seed tracks");
        db.insert_lyrics_index_orphan_for_tests(&LyricsIndexEntry {
            track_id: "orphan".to_string(),
            lyrics_path: dir.join("orphan.lrc").to_string_lossy().to_string(),
            lyrics_mtime: 1,
            content: "orphan".to_string(),
        })
        .expect("seed orphan");

        let roots = vec![fs::canonicalize(&dir).expect("canonical root")];
        let changed = sync_lyrics_index_blocking(&db, Some(&roots)).expect("sync lyrics");

        assert_eq!(changed, 1002);
        assert_eq!(db.lyrics_index_count().expect("lyrics count"), 1001);

        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn sync_lyrics_index_with_empty_roots_is_noop() {
        let db = Arc::new(Database::in_memory_for_tests().expect("create db"));
        let dir = temp_dir("sync-empty-roots");
        let track = dir.join("song.mp3");
        fs::write(&track, b"audio").expect("write track");
        fs::write(track.with_extension("lrc"), "[00:01]Line").expect("write lrc");
        db.upsert_tracks_batch(&[sample_track("track", track.to_string_lossy().to_string())])
            .expect("seed track");

        let changed = sync_lyrics_index_blocking(&db, Some(&[])).expect("sync lyrics");

        assert_eq!(changed, 0);
        assert_eq!(db.lyrics_index_count().expect("lyrics count"), 0);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn sync_lyrics_index_skips_tracks_outside_library_roots() {
        let db = Arc::new(Database::in_memory_for_tests().expect("create db"));
        let allowed_root = temp_dir("sync-allowed");
        let outside_root = temp_dir("sync-outside");
        let allowed_track = allowed_root.join("allowed.mp3");
        let outside_track = outside_root.join("outside.mp3");
        fs::write(&allowed_track, b"audio").expect("write allowed track");
        fs::write(&outside_track, b"audio").expect("write outside track");
        fs::write(allowed_track.with_extension("lrc"), "[00:01]Allowed")
            .expect("write allowed lrc");
        fs::write(outside_track.with_extension("lrc"), "[00:01]Outside")
            .expect("write outside lrc");
        db.upsert_tracks_batch(&[
            sample_track("allowed", allowed_track.to_string_lossy().to_string()),
            sample_track("outside", outside_track.to_string_lossy().to_string()),
        ])
        .expect("seed tracks");
        db.upsert_lyrics_index_batch(&[LyricsIndexEntry {
            track_id: "outside".to_string(),
            lyrics_path: outside_track
                .with_extension("lrc")
                .to_string_lossy()
                .to_string(),
            lyrics_mtime: 1,
            content: "stale outside".to_string(),
        }])
        .expect("seed outside lyrics index");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        sync_lyrics_index_blocking(&db, Some(&roots)).expect("sync lyrics");

        let entries = db.get_lyrics_index_meta().expect("read lyrics index");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].track_id, "allowed");

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn clean_lrc_line_removes_millisecond_line_and_word_timestamps() {
        let line = "[00:01.234]<00:01.250>Hello <00:02.000>world";

        assert_eq!(clean_lrc_line(line), "Hello world");
    }
}

#[tauri::command]
pub async fn sync_lyrics_index(
    db: State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<u32, String> {
    let db_clone = db.inner().clone();
    let roots = roots_state.inner().read().roots.clone();
    spawn_blocking(move || sync_lyrics_index_blocking(&db_clone, Some(&roots)))
        .await
        .map_err(|e| format!("Lyrics sync task failed: {}", e))?
}

#[tauri::command]
pub async fn search_lyrics(
    query: String,
    limit: u32,
    db: State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<Vec<LyricsSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let db_clone = db.inner().clone();
    let roots = roots_state.inner().read().roots.clone();
    let query_lower = query.to_lowercase();
    let query_for_db = query.clone();

    spawn_blocking(move || {
        if db_clone
            .lyrics_index_count()
            .map_err(|e| format!("Failed to read lyrics index count: {}", e))?
            == 0
        {
            let _ = sync_lyrics_index_blocking(&db_clone, Some(&roots));
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
