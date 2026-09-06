use crate::database::{DbPlaylist, DbTrack, SharedDatabase, TrackCursorPageStatus};
use crate::file_ops::{ensure_existing_path_allowed, path_to_public_string, SharedLibraryRoots};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use walkdir::WalkDir;

const LEGACY_PLAYLIST_MIGRATION_KEY: &str = "legacy-playlist-migration-v1";
const PLAYLIST_TRACK_PAGE_SIZE: u32 = 5_000;
const MAX_PLAYLIST_TRACK_PAGE_RESTARTS: usize = 3;
pub struct PlaylistGuard {
    lock: Mutex<()>,
    recent_mutations: Mutex<VecDeque<(String, PlaylistDetail)>>,
}

pub type SharedPlaylistGuard = Arc<PlaylistGuard>;

pub fn create_playlist_guard() -> SharedPlaylistGuard {
    Arc::new(PlaylistGuard {
        lock: Mutex::new(()),
        recent_mutations: Mutex::new(VecDeque::new()),
    })
}

impl PlaylistGuard {
    fn mutation_result(&self, key: &str) -> Option<PlaylistDetail> {
        self.recent_mutations
            .lock()
            .iter()
            .find(|(stored_key, _)| stored_key == key)
            .map(|(_, detail)| detail.clone())
    }

    fn store_mutation_result(&self, key: String, detail: PlaylistDetail) {
        const MAX_RECENT_MUTATIONS: usize = 256;
        let mut recent = self.recent_mutations.lock();
        if recent.len() >= MAX_RECENT_MUTATIONS {
            recent.pop_front();
        }
        recent.push_back((key, detail));
    }
}

fn load_persisted_mutation_result(
    db: &SharedDatabase,
    key: &str,
) -> Result<Option<PlaylistDetail>, String> {
    let Some(json) = db
        .get_playlist_mutation_result(key)
        .map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    serde_json::from_str(&json)
        .map(Some)
        .map_err(|error| format!("Stored playlist mutation result is invalid: {error}"))
}

fn persist_mutation_result(
    db: &SharedDatabase,
    key: &str,
    detail: &PlaylistDetail,
) -> Result<(), String> {
    let json = serde_json::to_string(detail)
        .map_err(|error| format!("Failed to serialize playlist mutation result: {error}"))?;
    db.store_playlist_mutation_result(key, &json)
        .map_err(|error| error.to_string())
}

fn mutation_key(operation: &str, playlist_id: &str, mutation_id: &str) -> Result<String, String> {
    let id = mutation_id.trim();
    if id.is_empty() || id.len() > 128 {
        return Err("mutationId must contain 1 to 128 characters".to_string());
    }
    Ok(format!("{operation}:{playlist_id}:{id}"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum PlaylistType {
    #[serde(alias = "manual")]
    Manual,
    #[serde(alias = "smart")]
    Smart,
    #[serde(alias = "folderSync")]
    FolderSync,
}

impl PlaylistType {
    fn as_db_value(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Smart => "smart",
            Self::FolderSync => "foldersync",
        }
    }

    fn from_db_value(value: &str) -> Self {
        match value.to_lowercase().as_str() {
            "manual" => Self::Manual,
            "smart" => Self::Smart,
            "foldersync" | "folder_sync" | "folder" => Self::FolderSync,
            _ => Self::Manual,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "PascalCase")]
pub enum SmartPlaylistRule {
    #[serde(alias = "recentlyAdded")]
    RecentlyAdded { days: u32 },
    #[serde(alias = "mostPlayed")]
    MostPlayed { min_plays: u32 },
    #[serde(alias = "topRated")]
    TopRated { min_rating: u8 },
    #[serde(alias = "byArtist")]
    ByArtist { artist: String },
    #[serde(alias = "byAlbum")]
    ByAlbum { album: String },
    #[serde(alias = "byGenre")]
    ByGenre { genre: String },
    #[serde(alias = "byYear")]
    ByYear { start_year: u32, end_year: u32 },
    #[serde(alias = "longerThan")]
    LongerThan { seconds: u32 },
    #[serde(alias = "shorterThan")]
    ShorterThan { seconds: u32 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub playlist_type: PlaylistType,
    pub track_ids: Vec<String>,
    pub smart_rules: Option<Vec<SmartPlaylistRule>>,
    pub folder_path: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub is_pinned: bool,
    #[serde(default)]
    pub pinned_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSummary {
    pub id: String,
    pub name: String,
    pub playlist_type: PlaylistType,
    pub track_count: usize,
    pub missing_count: usize,
    pub smart_rules: Option<Vec<SmartPlaylistRule>>,
    pub folder_path: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    pub is_pinned: bool,
    pub pinned_at: Option<u64>,
    pub last_synced_at: Option<u64>,
    pub sync_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub track_id: String,
    pub position: usize,
    pub available: bool,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: Option<f64>,
    pub file_path: Option<String>,
    pub has_cover_art: bool,
    pub cover_art_hash: Option<String>,
    pub blurhash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetail {
    #[serde(flatten)]
    pub summary: PlaylistSummary,
    pub track_ids: Vec<String>,
    pub entries: Vec<PlaylistEntry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyPlaylistsData {
    playlists: Vec<Playlist>,
    track_stats: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone)]
enum PlaylistLoadStatus {
    Clean,
    Recovered {
        source: String,
        message: String,
    },
    Corrupt {
        reason: String,
        attempted_recovery: bool,
        recovered_from: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistRecoveredEvent {
    source: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistCorruptEvent {
    reason: String,
    attempted_recovery: bool,
    recovered_from: Option<String>,
}

fn get_playlists_path(app: &tauri::AppHandle) -> PathBuf {
    let app_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&app_dir);
    app_dir.join("playlists.json")
}

fn backup_path(path: &Path, idx: usize) -> PathBuf {
    PathBuf::from(format!("{}.bak.{}", path.to_string_lossy(), idx))
}

fn emit_playlist_load_event(app: &tauri::AppHandle, status: &PlaylistLoadStatus) {
    match status {
        PlaylistLoadStatus::Recovered { source, message } => {
            let _ = app.emit(
                "playlists-recovered",
                PlaylistRecoveredEvent {
                    source: source.clone(),
                    message: message.clone(),
                },
            );
        }
        PlaylistLoadStatus::Corrupt {
            reason,
            attempted_recovery,
            recovered_from,
        } => {
            let _ = app.emit(
                "playlists-corrupt",
                PlaylistCorruptEvent {
                    reason: reason.clone(),
                    attempted_recovery: *attempted_recovery,
                    recovered_from: recovered_from.clone(),
                },
            );
        }
        PlaylistLoadStatus::Clean => {}
    }
}

fn try_recover_from_backups(
    path: &Path,
    reason: String,
) -> (LegacyPlaylistsData, PlaylistLoadStatus) {
    for idx in 1..=3 {
        let bak = backup_path(path, idx);
        if !bak.exists() {
            continue;
        }
        let Ok(content) = fs::read_to_string(&bak) else {
            continue;
        };
        let Ok(data) = serde_json::from_str::<LegacyPlaylistsData>(&content) else {
            continue;
        };
        return (
            data,
            PlaylistLoadStatus::Recovered {
                source: bak
                    .file_name()
                    .map(|v| v.to_string_lossy().to_string())
                    .unwrap_or_else(|| format!("backup #{}", idx)),
                message: format!("Recovered playlists from backup after failure: {}", reason),
            },
        );
    }

    (
        LegacyPlaylistsData::default(),
        PlaylistLoadStatus::Corrupt {
            reason,
            attempted_recovery: true,
            recovered_from: None,
        },
    )
}

fn load_legacy_playlists_data(app: &tauri::AppHandle) -> (LegacyPlaylistsData, PlaylistLoadStatus) {
    let path = get_playlists_path(app);
    if !path.exists() {
        return (LegacyPlaylistsData::default(), PlaylistLoadStatus::Clean);
    }

    let content = match fs::read_to_string(&path) {
        Ok(value) => value,
        Err(err) => {
            return try_recover_from_backups(
                &path,
                format!("Failed to read playlists file {}: {}", path.display(), err),
            );
        }
    };

    match serde_json::from_str::<LegacyPlaylistsData>(&content) {
        Ok(data) => (data, PlaylistLoadStatus::Clean),
        Err(err) => try_recover_from_backups(
            &path,
            format!("Failed to parse playlists file {}: {}", path.display(), err),
        ),
    }
}

fn now_millis_u64() -> Result<u64, String> {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("System clock error: {}", e))?
        .as_millis();
    u64::try_from(millis).map_err(|_| "Timestamp overflow".to_string())
}

fn next_playlist_id() -> Result<String, String> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("System clock error: {}", e))?
        .as_nanos();
    Ok(format!("pl_{}", nanos))
}

fn to_i64(timestamp: u64) -> i64 {
    i64::try_from(timestamp).unwrap_or(i64::MAX)
}

fn to_u64(timestamp: i64) -> u64 {
    if timestamp <= 0 {
        0
    } else {
        u64::try_from(timestamp).unwrap_or(u64::MAX)
    }
}

#[cfg(windows)]
fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

#[cfg(not(windows))]
fn normalize_path(path: &str) -> String {
    path.to_string()
}

#[cfg(windows)]
fn normalize_path_for_folder_match(path: &str) -> String {
    normalize_path(path).to_lowercase()
}

#[cfg(not(windows))]
fn normalize_path_for_folder_match(path: &str) -> String {
    normalize_path(path)
}

fn serialize_rules(rules: &Option<Vec<SmartPlaylistRule>>) -> Option<String> {
    rules.as_ref().and_then(|r| serde_json::to_string(r).ok())
}

fn deserialize_rules(raw: &Option<String>) -> Option<Vec<SmartPlaylistRule>> {
    raw.as_ref()
        .and_then(|value| serde_json::from_str::<Vec<SmartPlaylistRule>>(value).ok())
}

fn ensure_manual_playlist(playlist_type: &PlaylistType, operation: &str) -> Result<(), String> {
    if matches!(playlist_type, PlaylistType::Manual) {
        Ok(())
    } else {
        Err(format!(
            "Tracks can only be {operation} in manual playlists"
        ))
    }
}
fn validate_smart_rules(rules: &Option<Vec<SmartPlaylistRule>>) -> Result<(), String> {
    for rule in rules.as_deref().unwrap_or(&[]) {
        match rule {
            SmartPlaylistRule::ByArtist { artist } if artist.trim().is_empty() => {
                return Err("ByArtist rule requires an artist value".to_string());
            }
            SmartPlaylistRule::ByAlbum { album } if album.trim().is_empty() => {
                return Err("ByAlbum rule requires an album value".to_string());
            }
            SmartPlaylistRule::ByGenre { genre } if genre.trim().is_empty() => {
                return Err("ByGenre rule requires a genre value".to_string());
            }
            SmartPlaylistRule::ByYear {
                start_year,
                end_year,
            } if start_year > end_year => {
                return Err("ByYear rule start year cannot exceed end year".to_string());
            }
            _ => {}
        }
    }
    Ok(())
}

fn to_entry(track: &DbTrack, position: usize) -> PlaylistEntry {
    PlaylistEntry {
        track_id: track.id.clone(),
        position,
        available: Path::new(&track.file_path).exists(),
        title: Some(track.title.clone()),
        artist: Some(track.artist.clone()),
        album: Some(track.album.clone()),
        duration: Some(track.duration),
        file_path: Some(track.file_path.clone()),
        has_cover_art: track.has_cover_art,
        cover_art_hash: track.cover_art_hash.clone(),
        blurhash: track.blurhash.clone(),
    }
}

fn to_summary_from_detail(detail: &PlaylistDetail) -> PlaylistSummary {
    detail.summary.clone()
}

fn track_matches_rule(track: &DbTrack, rule: &SmartPlaylistRule, now_ms: i64) -> bool {
    match rule {
        SmartPlaylistRule::RecentlyAdded { days } => {
            let cutoff = now_ms - (*days as i64 * 24 * 60 * 60 * 1000);
            track.date_added >= cutoff
        }
        SmartPlaylistRule::MostPlayed { min_plays } => track.play_count >= *min_plays as i32,
        SmartPlaylistRule::TopRated { min_rating } => {
            track.rating.unwrap_or(0) >= *min_rating as i32
        }
        SmartPlaylistRule::ByArtist { artist } => {
            let needle = artist.trim().to_lowercase();
            !needle.is_empty() && track.artist.to_lowercase().contains(&needle)
        }
        SmartPlaylistRule::ByAlbum { album } => {
            let needle = album.trim().to_lowercase();
            !needle.is_empty() && track.album.to_lowercase().contains(&needle)
        }
        SmartPlaylistRule::ByGenre { genre } => {
            let needle = genre.trim().to_lowercase();
            !needle.is_empty()
                && track
                    .genre
                    .as_deref()
                    .unwrap_or_default()
                    .to_lowercase()
                    .contains(&needle)
        }
        SmartPlaylistRule::ByYear {
            start_year,
            end_year,
        } => track
            .year
            .map(|year| year >= *start_year as i32 && year <= *end_year as i32)
            .unwrap_or(false),
        SmartPlaylistRule::LongerThan { seconds } => track.duration >= *seconds as f64,
        SmartPlaylistRule::ShorterThan { seconds } => track.duration <= *seconds as f64,
    }
}

#[cfg(test)]
fn resolve_smart_tracks(
    all_tracks: &[DbTrack],
    rules: &[SmartPlaylistRule],
) -> (Vec<DbTrack>, Option<String>) {
    let now_ms = to_i64(now_millis_u64().unwrap_or(0));

    let filtered = all_tracks
        .iter()
        .filter(|track| {
            rules
                .iter()
                .all(|rule| track_matches_rule(track, rule, now_ms))
        })
        .cloned()
        .collect::<Vec<_>>();

    (filtered, None)
}

fn folder_track_matches(track: &DbTrack, normalized_folder: &str) -> bool {
    if normalized_folder.is_empty() {
        return false;
    }
    let track_path = normalize_path_for_folder_match(&track.file_path);
    track_path == normalized_folder || track_path.starts_with(&format!("{}/", normalized_folder))
}

#[cfg(test)]
fn resolve_folder_tracks(all_tracks: &[DbTrack], folder_path: &str) -> Vec<DbTrack> {
    let normalized_folder = normalize_path_for_folder_match(folder_path)
        .trim_end_matches('/')
        .to_string();
    if normalized_folder.is_empty() {
        return Vec::new();
    }

    all_tracks
        .iter()
        .filter(|track| folder_track_matches(track, &normalized_folder))
        .cloned()
        .collect()
}

fn collect_library_tracks_matching<F>(
    db: &SharedDatabase,
    mut matches: F,
) -> Result<Vec<DbTrack>, String>
where
    F: FnMut(&DbTrack) -> bool,
{
    let mut restart_count = 0_usize;

    loop {
        let mut cursor = None;
        let mut resolved = Vec::new();

        loop {
            let page = db
                .get_tracks_cursor_page(
                    cursor.as_ref(),
                    PLAYLIST_TRACK_PAGE_SIZE,
                    "dateAdded",
                    "desc",
                )
                .map_err(|error| error.to_string())?;

            if page.status == TrackCursorPageStatus::RestartRequired {
                restart_count += 1;
                break;
            }

            resolved.extend(page.tracks.into_iter().filter(|track| matches(track)));

            let Some(next_cursor) = page.next_cursor else {
                return Ok(resolved);
            };
            cursor = Some(next_cursor);
        }

        if restart_count >= MAX_PLAYLIST_TRACK_PAGE_RESTARTS {
            return Err(
                "The library changed repeatedly while resolving this playlist. Try again."
                    .to_string(),
            );
        }
    }
}

fn build_detail_from_record(
    db: &SharedDatabase,
    record: &DbPlaylist,
) -> Result<PlaylistDetail, String> {
    let playlist_type = PlaylistType::from_db_value(&record.playlist_type);
    let smart_rules = deserialize_rules(&record.smart_rules);

    let (track_ids, entries, computed_sync_error): (
        Vec<String>,
        Vec<PlaylistEntry>,
        Option<String>,
    ) = match playlist_type {
        PlaylistType::Manual => {
            let track_rows = db
                .get_playlist_track_entries(&record.id)
                .map_err(|e| e.to_string())?;
            let track_ids = track_rows
                .iter()
                .map(|entry| entry.track_id.clone())
                .collect::<Vec<_>>();
            let tracks = db
                .get_tracks_by_ids(&track_ids)
                .map_err(|e| e.to_string())?;
            let track_map: HashMap<String, DbTrack> = tracks
                .into_iter()
                .map(|track| (track.id.clone(), track))
                .collect();
            let entries = track_rows
                .iter()
                .enumerate()
                .map(|(idx, row)| {
                    let position = if row.position > 0 {
                        row.position as usize
                    } else {
                        idx + 1
                    };

                    if let Some(track) = track_map.get(&row.track_id) {
                        to_entry(track, position)
                    } else {
                        let snapshot_file_path = row
                            .snapshot_file_path
                            .clone()
                            .map(|value| normalize_path(&value));
                        PlaylistEntry {
                            track_id: row.track_id.clone(),
                            position,
                            available: false,
                            title: row
                                .snapshot_title
                                .clone()
                                .or_else(|| Some("Unavailable track".to_string())),
                            artist: row.snapshot_artist.clone(),
                            album: row.snapshot_album.clone(),
                            duration: row.snapshot_duration,
                            file_path: snapshot_file_path,
                            has_cover_art: row.snapshot_has_cover_art,
                            cover_art_hash: row.snapshot_cover_art_hash.clone(),
                            blurhash: row.snapshot_blurhash.clone(),
                        }
                    }
                })
                .collect::<Vec<_>>();
            (track_ids, entries, None)
        }
        PlaylistType::Smart => {
            let rules = smart_rules.clone().unwrap_or_default();
            let now_ms = to_i64(now_millis_u64().unwrap_or(0));
            let resolved = collect_library_tracks_matching(db, |track| {
                rules
                    .iter()
                    .all(|rule| track_matches_rule(track, rule, now_ms))
            })?;
            let sync_error = None;
            let entries = resolved
                .iter()
                .enumerate()
                .map(|(idx, track)| to_entry(track, idx + 1))
                .collect::<Vec<_>>();
            (
                entries.iter().map(|entry| entry.track_id.clone()).collect(),
                entries,
                sync_error,
            )
        }
        PlaylistType::FolderSync => {
            let folder_path = record.folder_path.clone().unwrap_or_default();
            if folder_path.is_empty() {
                (
                    Vec::new(),
                    Vec::new(),
                    Some("Folder path is missing.".to_string()),
                )
            } else {
                let normalized_folder = normalize_path_for_folder_match(&folder_path)
                    .trim_end_matches('/')
                    .to_string();
                let resolved = collect_library_tracks_matching(db, |track| {
                    folder_track_matches(track, &normalized_folder)
                })?;
                let sync_error = if Path::new(&folder_path).is_dir() {
                    None
                } else {
                    Some("Folder is not available on disk.".to_string())
                };
                let entries = resolved
                    .iter()
                    .enumerate()
                    .map(|(idx, track)| to_entry(track, idx + 1))
                    .collect::<Vec<_>>();
                (
                    entries.iter().map(|entry| entry.track_id.clone()).collect(),
                    entries,
                    sync_error,
                )
            }
        }
    };

    let missing_count = entries.iter().filter(|entry| !entry.available).count();
    let summary = PlaylistSummary {
        id: record.id.clone(),
        name: record.name.clone(),
        playlist_type,
        track_count: entries.len(),
        missing_count,
        smart_rules,
        folder_path: record.folder_path.clone(),
        created_at: to_u64(record.created_at),
        updated_at: to_u64(record.updated_at),
        is_pinned: record.is_pinned,
        pinned_at: record.pinned_at.map(to_u64),
        last_synced_at: record.last_synced_at.map(to_u64),
        sync_error: computed_sync_error.or_else(|| record.sync_error.clone()),
    };

    Ok(PlaylistDetail {
        summary,
        track_ids,
        entries,
    })
}

fn get_playlist_detail_internal(
    db: &SharedDatabase,
    playlist_id: &str,
) -> Result<PlaylistDetail, String> {
    let record = db
        .get_playlist_by_id(playlist_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Playlist not found".to_string())?;
    build_detail_from_record(db, &record)
}

pub fn bootstrap_playlist_storage(app: tauri::AppHandle, db: SharedDatabase) -> Result<(), String> {
    if db
        .playlist_migration_completed(LEGACY_PLAYLIST_MIGRATION_KEY)
        .map_err(|e| e.to_string())?
    {
        return Ok(());
    }

    let path = get_playlists_path(&app);
    if !path.exists() {
        return Ok(());
    }

    let (legacy_data, status) = load_legacy_playlists_data(&app);
    emit_playlist_load_event(&app, &status);

    if legacy_data.playlists.is_empty() {
        return Ok(());
    }

    let backup_name = format!("playlists.migrated.{}.json", now_millis_u64()?);
    let backup_path = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(backup_name);
    fs::copy(&path, &backup_path)
        .map_err(|e| format!("Failed to back up legacy playlists before migration: {}", e))?;

    let playlists = legacy_data
        .playlists
        .into_iter()
        .map(|playlist| {
            let record = DbPlaylist {
                id: playlist.id.clone(),
                name: playlist.name.clone(),
                playlist_type: playlist.playlist_type.as_db_value().to_string(),
                folder_path: playlist.folder_path.clone(),
                smart_rules: serialize_rules(&playlist.smart_rules),
                created_at: to_i64(playlist.created_at),
                updated_at: to_i64(playlist.updated_at),
                is_pinned: playlist.is_pinned,
                pinned_at: playlist.pinned_at.map(to_i64),
                last_synced_at: None,
                sync_error: None,
            };
            let track_ids = if matches!(playlist.playlist_type, PlaylistType::Manual) {
                playlist.track_ids
            } else {
                Vec::new()
            };
            (record, track_ids)
        })
        .collect::<Vec<_>>();

    if let Err(error) = db.import_legacy_playlists(&playlists, LEGACY_PLAYLIST_MIGRATION_KEY) {
        let err = error.to_string();
        emit_playlist_load_event(
            &app,
            &PlaylistLoadStatus::Corrupt {
                reason: err.clone(),
                attempted_recovery: false,
                recovered_from: None,
            },
        );
        return Err(err);
    }

    emit_playlist_load_event(
        &app,
        &PlaylistLoadStatus::Recovered {
            source: backup_path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "legacy-migration-backup".to_string()),
            message: "Migrated legacy playlists.json to SQLite storage.".to_string(),
        },
    );

    Ok(())
}

#[tauri::command]
pub fn get_playlists(db: tauri::State<'_, SharedDatabase>) -> Result<Vec<PlaylistSummary>, String> {
    let records = db.get_all_playlists().map_err(|e| e.to_string())?;
    let mut summaries = Vec::with_capacity(records.len());
    for record in records {
        let detail = build_detail_from_record(db.inner(), &record)?;
        summaries.push(to_summary_from_detail(&detail));
    }
    Ok(summaries)
}

#[tauri::command]
pub fn get_playlist_detail(
    playlist_id: String,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<PlaylistDetail, String> {
    get_playlist_detail_internal(db.inner(), &playlist_id)
}

#[tauri::command]
pub fn create_playlist(
    guard: tauri::State<'_, SharedPlaylistGuard>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
    name: String,
    playlist_type: PlaylistType,
    smart_rules: Option<Vec<SmartPlaylistRule>>,
    folder_path: Option<String>,
) -> Result<PlaylistDetail, String> {
    let _lock = guard.lock.lock();

    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Playlist name is required".to_string());
    }
    validate_smart_rules(&smart_rules)?;
    let mut folder_path = folder_path;
    if playlist_type == PlaylistType::FolderSync {
        let path = folder_path
            .as_deref()
            .filter(|path| !path.trim().is_empty())
            .ok_or_else(|| "A folder-synced playlist requires a folder path".to_string())?;
        let roots = roots_state.read().roots.clone();
        let canonical =
            ensure_existing_path_allowed(Path::new(path), &roots, "create folder playlist")?;
        folder_path = Some(path_to_public_string(&canonical));
    }

    let now = now_millis_u64()?;
    let db_row = DbPlaylist {
        id: next_playlist_id()?,
        name: trimmed_name.to_string(),
        playlist_type: playlist_type.as_db_value().to_string(),
        folder_path,
        smart_rules: serialize_rules(&smart_rules),
        created_at: to_i64(now),
        updated_at: to_i64(now),
        is_pinned: false,
        pinned_at: None,
        last_synced_at: None,
        sync_error: None,
    };

    db.create_playlist(&db_row).map_err(|e| e.to_string())?;
    get_playlist_detail_internal(db.inner(), &db_row.id)
}

#[tauri::command]
pub fn update_playlist(
    guard: tauri::State<'_, SharedPlaylistGuard>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
    request: UpdatePlaylistRequest,
) -> Result<PlaylistDetail, String> {
    let _lock = guard.lock.lock();
    let UpdatePlaylistRequest {
        playlist_id,
        name,
        playlist_type,
        track_ids,
        smart_rules,
        folder_path,
    } = request;

    let mut playlist = db
        .get_playlist_by_id(&playlist_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Playlist not found".to_string())?;

    if let Some(next_name) = name {
        let trimmed = next_name.trim();
        if trimmed.is_empty() {
            return Err("Playlist name is required".to_string());
        }
        playlist.name = trimmed.to_string();
    }

    if let Some(next_type) = playlist_type {
        playlist.playlist_type = next_type.as_db_value().to_string();
        if next_type != PlaylistType::Smart {
            playlist.smart_rules = None;
        }
        if next_type != PlaylistType::FolderSync {
            playlist.folder_path = None;
        }
    }

    if let Some(next_rules) = smart_rules {
        validate_smart_rules(&Some(next_rules.clone()))?;
        playlist.smart_rules = serialize_rules(&Some(next_rules));
    }

    if let Some(next_folder) = folder_path {
        let trimmed = next_folder.trim();
        playlist.folder_path = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }

    if PlaylistType::from_db_value(&playlist.playlist_type) == PlaylistType::FolderSync {
        let path = playlist
            .folder_path
            .as_deref()
            .filter(|path| !path.trim().is_empty())
            .ok_or_else(|| "A folder-synced playlist requires a folder path".to_string())?;
        let roots = roots_state.read().roots.clone();
        let canonical =
            ensure_existing_path_allowed(Path::new(path), &roots, "update folder playlist")?;
        playlist.folder_path = Some(path_to_public_string(&canonical));
    }

    playlist.updated_at = to_i64(now_millis_u64()?);
    playlist.sync_error = None;
    db.replace_playlist(&playlist).map_err(|e| e.to_string())?;

    if let Some(ids) = track_ids {
        db.set_playlist_tracks(&playlist_id, &ids, playlist.updated_at)
            .map_err(|e| e.to_string())?;
    }

    get_playlist_detail_internal(db.inner(), &playlist_id)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlaylistRequest {
    playlist_id: String,
    name: Option<String>,
    playlist_type: Option<PlaylistType>,
    track_ids: Option<Vec<String>>,
    smart_rules: Option<Vec<SmartPlaylistRule>>,
    folder_path: Option<String>,
}

#[tauri::command]
pub fn delete_playlist(
    guard: tauri::State<'_, SharedPlaylistGuard>,
    db: tauri::State<'_, SharedDatabase>,
    playlist_id: String,
) -> Result<(), String> {
    let _lock = guard.lock.lock();
    db.delete_playlist(&playlist_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_playlist_pinned(
    guard: tauri::State<'_, SharedPlaylistGuard>,
    db: tauri::State<'_, SharedDatabase>,
    playlist_id: String,
    is_pinned: bool,
) -> Result<PlaylistDetail, String> {
    let _lock = guard.lock.lock();

    let playlist = db
        .get_playlist_by_id(&playlist_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Playlist not found".to_string())?;

    let now = to_i64(now_millis_u64()?);
    let pinned_at = if is_pinned {
        playlist.pinned_at.or(Some(now))
    } else {
        None
    };

    db.set_playlist_pinned(&playlist_id, is_pinned, pinned_at, now)
        .map_err(|e| e.to_string())?;

    get_playlist_detail_internal(db.inner(), &playlist_id)
}

#[tauri::command]
pub fn add_tracks_to_playlist(
    guard: tauri::State<'_, SharedPlaylistGuard>,
    db: tauri::State<'_, SharedDatabase>,
    playlist_id: String,
    track_ids: Vec<String>,
    mutation_id: String,
) -> Result<PlaylistDetail, String> {
    let _lock = guard.lock.lock();
    let key = mutation_key("add", &playlist_id, &mutation_id)?;
    if let Some(detail) = guard.mutation_result(&key) {
        return Ok(detail);
    }
    if let Some(detail) = load_persisted_mutation_result(db.inner(), &key)? {
        guard.store_mutation_result(key, detail.clone());
        return Ok(detail);
    }

    let playlist = db
        .get_playlist_by_id(&playlist_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Playlist not found".to_string())?;

    let playlist_type = PlaylistType::from_db_value(&playlist.playlist_type);
    ensure_manual_playlist(&playlist_type, "added")?;

    db.add_tracks_to_playlist_idempotent(&playlist_id, &track_ids, &key)
        .map_err(|e| e.to_string())?;

    let detail = get_playlist_detail_internal(db.inner(), &playlist_id)?;
    persist_mutation_result(db.inner(), &key, &detail)?;
    guard.store_mutation_result(key, detail.clone());
    Ok(detail)
}

#[tauri::command]
pub fn remove_tracks_from_playlist(
    guard: tauri::State<'_, SharedPlaylistGuard>,
    db: tauri::State<'_, SharedDatabase>,
    playlist_id: String,
    track_ids: Vec<String>,
) -> Result<PlaylistDetail, String> {
    let _lock = guard.lock.lock();

    let playlist = db
        .get_playlist_by_id(&playlist_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Playlist not found".to_string())?;
    let playlist_type = PlaylistType::from_db_value(&playlist.playlist_type);
    ensure_manual_playlist(&playlist_type, "removed")?;

    db.remove_tracks_from_playlist(&playlist_id, &track_ids)
        .map_err(|e| e.to_string())?;

    get_playlist_detail_internal(db.inner(), &playlist_id)
}

#[tauri::command]
pub fn relink_playlist_track(
    guard: tauri::State<'_, SharedPlaylistGuard>,
    db: tauri::State<'_, SharedDatabase>,
    playlist_id: String,
    old_track_id: String,
    new_track_id: String,
) -> Result<PlaylistDetail, String> {
    let _lock = guard.lock.lock();
    let playlist = db
        .get_playlist_by_id(&playlist_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Playlist not found".to_string())?;
    let playlist_type = PlaylistType::from_db_value(&playlist.playlist_type);
    ensure_manual_playlist(&playlist_type, "relinked")?;

    db.relink_playlist_track(
        &playlist_id,
        &old_track_id,
        &new_track_id,
        to_i64(now_millis_u64()?),
    )
    .map_err(|e| e.to_string())?;
    get_playlist_detail_internal(db.inner(), &playlist_id)
}

#[tauri::command]
pub fn reorder_playlist_tracks(
    guard: tauri::State<'_, SharedPlaylistGuard>,
    db: tauri::State<'_, SharedDatabase>,
    playlist_id: String,
    track_ids: Vec<String>,
    mutation_id: String,
) -> Result<PlaylistDetail, String> {
    let _lock = guard.lock.lock();
    let key = mutation_key("reorder", &playlist_id, &mutation_id)?;
    if let Some(detail) = guard.mutation_result(&key) {
        return Ok(detail);
    }
    if let Some(detail) = load_persisted_mutation_result(db.inner(), &key)? {
        guard.store_mutation_result(key, detail.clone());
        return Ok(detail);
    }

    let playlist = db
        .get_playlist_by_id(&playlist_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Playlist not found".to_string())?;
    let playlist_type = PlaylistType::from_db_value(&playlist.playlist_type);
    ensure_manual_playlist(&playlist_type, "reordered")?;
    let now = to_i64(now_millis_u64()?);
    db.set_playlist_tracks_idempotent(&playlist_id, &track_ids, now, &key)
        .map_err(|e| e.to_string())?;

    let detail = get_playlist_detail_internal(db.inner(), &playlist_id)?;
    persist_mutation_result(db.inner(), &key, &detail)?;
    guard.store_mutation_result(key, detail.clone());
    Ok(detail)
}

#[tauri::command]
pub fn sync_playlist(
    guard: tauri::State<'_, SharedPlaylistGuard>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
    playlist_id: String,
) -> Result<PlaylistDetail, String> {
    let _lock = guard.lock.lock();

    let playlist = db
        .get_playlist_by_id(&playlist_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Playlist not found".to_string())?;

    let playlist_type = PlaylistType::from_db_value(&playlist.playlist_type);
    let mut sync_error: Option<String> = None;

    if matches!(playlist_type, PlaylistType::FolderSync) {
        match playlist.folder_path.clone() {
            Some(path) => {
                let roots = roots_state.read().roots.clone();
                match ensure_existing_path_allowed(Path::new(&path), &roots, "sync folder playlist")
                {
                    Err(_) => {
                        sync_error = Some(
                            "Folder access is missing. Reauthorize the library source, then sync again."
                                .to_string(),
                        );
                    }
                    Ok(open_path) if open_path.is_dir() => {
                        let track_ids = db
                            .get_track_ids_by_folder(&path)
                            .map_err(|e| e.to_string())?;
                        let supported_file_count = WalkDir::new(&open_path)
                            .follow_links(false)
                            .into_iter()
                            .filter_map(Result::ok)
                            .filter(|entry| {
                                entry.file_type().is_file()
                                    && crate::library::is_supported_audio_path(entry.path())
                            })
                            .count();
                        db.set_playlist_tracks(&playlist_id, &track_ids, to_i64(now_millis_u64()?))
                            .map_err(|e| e.to_string())?;
                        let not_indexed = supported_file_count.saturating_sub(track_ids.len());
                        if not_indexed > 0 {
                            sync_error = Some(format!(
                            "{not_indexed} supported file(s) are not indexed. Scan this library folder, then sync again."
                        ));
                        }
                    }
                    Ok(_) => {
                        sync_error = Some("The synced folder is no longer available.".to_string());
                    }
                }
            }
            None => {
                sync_error = Some("Folder path is missing.".to_string());
            }
        }
    }

    let now = to_i64(now_millis_u64()?);
    db.set_playlist_sync_state(&playlist_id, Some(now), sync_error.as_deref(), now)
        .map_err(|e| e.to_string())?;

    get_playlist_detail_internal(db.inner(), &playlist_id)
}

#[tauri::command]
pub fn remove_missing_from_playlist(
    guard: tauri::State<'_, SharedPlaylistGuard>,
    db: tauri::State<'_, SharedDatabase>,
    playlist_id: String,
) -> Result<PlaylistDetail, String> {
    let _lock = guard.lock.lock();

    let detail = get_playlist_detail_internal(db.inner(), &playlist_id)?;
    ensure_manual_playlist(&detail.summary.playlist_type, "removed")?;
    let unavailable_ids = detail
        .entries
        .iter()
        .filter(|entry| !entry.available)
        .map(|entry| entry.track_id.clone())
        .collect::<Vec<_>>();

    if !unavailable_ids.is_empty() {
        db.remove_tracks_from_playlist(&playlist_id, &unavailable_ids)
            .map_err(|e| e.to_string())?;
    }

    get_playlist_detail_internal(db.inner(), &playlist_id)
}

#[tauri::command]
pub fn reset_playlists_data(
    app: tauri::AppHandle,
    guard: tauri::State<'_, SharedPlaylistGuard>,
    db: tauri::State<'_, SharedDatabase>,
) -> Result<(), String> {
    let _lock = guard.lock.lock();
    db.clear_playlists().map_err(|e| e.to_string())?;
    let _ = app.emit(
        "playlists-recovered",
        PlaylistRecoveredEvent {
            source: "user-reset".to_string(),
            message: "Playlist storage was reset.".to_string(),
        },
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_detail(id: &str) -> PlaylistDetail {
        PlaylistDetail {
            summary: PlaylistSummary {
                id: id.to_string(),
                name: "Playlist".to_string(),
                playlist_type: PlaylistType::Manual,
                track_count: 0,
                missing_count: 0,
                smart_rules: None,
                folder_path: None,
                created_at: 1,
                updated_at: 1,
                is_pinned: false,
                pinned_at: None,
                last_synced_at: None,
                sync_error: None,
            },
            track_ids: Vec::new(),
            entries: Vec::new(),
        }
    }

    #[test]
    fn derived_playlist_mutations_are_rejected() {
        for playlist_type in [PlaylistType::Smart, PlaylistType::FolderSync] {
            let error = ensure_manual_playlist(&playlist_type, "removed")
                .expect_err("derived playlist mutation should be rejected");
            assert_eq!(error, "Tracks can only be removed in manual playlists");
        }

        assert!(ensure_manual_playlist(&PlaylistType::Manual, "removed").is_ok());
    }
    #[test]
    fn playlist_mutation_cache_returns_the_original_result_for_a_retry() {
        let guard = create_playlist_guard();
        let key = mutation_key("add", "playlist-1", "mutation-1").expect("valid key");
        let detail = sample_detail("playlist-1");

        guard.store_mutation_result(key.clone(), detail);

        assert_eq!(
            guard
                .mutation_result(&key)
                .expect("cached mutation result")
                .summary
                .id,
            "playlist-1"
        );
        assert!(mutation_key("add", "playlist-1", "").is_err());
        assert!(mutation_key("add", "playlist-1", &"x".repeat(129)).is_err());
    }

    fn sample_track(
        id: &str,
        artist: &str,
        album: &str,
        year: Option<i32>,
        duration: f64,
        play_count: i32,
        rating: Option<i32>,
    ) -> DbTrack {
        DbTrack {
            id: id.to_string(),
            title: id.to_string(),
            artist: artist.to_string(),
            album_artist: None,
            album: album.to_string(),
            year,
            duration,
            file_path: format!("/tmp/{}.mp3", id),
            has_cover_art: false,
            cover_art_hash: None,
            blurhash: None,
            date_added: 100,
            play_count,
            last_played: None,
            rating,
            track_number: None,
            disc_number: None,
            file_format: Some("MP3".to_string()),
            bitrate: None,
            sample_rate: None,
            file_size: None,
            genre: None,
        }
    }

    #[test]
    fn smart_rule_filters_by_artist_and_duration() {
        let tracks = vec![
            sample_track("a", "Nassif", "One", Some(2020), 260.0, 10, Some(5)),
            sample_track("b", "Other", "Two", Some(2021), 180.0, 1, Some(2)),
        ];

        let rules = vec![
            SmartPlaylistRule::ByArtist {
                artist: "nass".to_string(),
            },
            SmartPlaylistRule::LongerThan { seconds: 200 },
        ];

        let (resolved, _) = resolve_smart_tracks(&tracks, &rules);
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].id, "a");
    }

    #[test]
    fn cursor_playlist_resolution_handles_more_than_one_track_page() {
        let db = std::sync::Arc::new(
            crate::database::Database::in_memory_for_tests().expect("create in-memory database"),
        );
        let tracks = (0..5_001)
            .map(|index| {
                let mut track = sample_track(
                    &format!("page-{index:04}"),
                    "Artist",
                    "Album",
                    Some(2024),
                    180.0,
                    0,
                    None,
                );
                track.file_path = format!("/tmp/playlist-page-{index:04}.mp3");
                track.id = track.file_path.clone();
                track
            })
            .collect::<Vec<_>>();
        db.upsert_tracks_batch(&tracks)
            .expect("seed large playlist library");

        let resolved =
            collect_library_tracks_matching(&db, |_| true).expect("resolve large playlist library");

        assert_eq!(resolved.len(), 5_001);
        assert_eq!(resolved[0].file_path, "/tmp/playlist-page-0000.mp3");
        assert_eq!(resolved[5_000].file_path, "/tmp/playlist-page-5000.mp3");
    }

    #[test]
    fn folder_resolution_matches_prefix() {
        let mut track = sample_track("a", "Artist", "Album", Some(2022), 200.0, 1, None);
        track.file_path = "/Music/Arab/Track.mp3".to_string();

        let mut other = sample_track("b", "Artist", "Album", Some(2022), 200.0, 1, None);
        other.file_path = "/Music/Other/Track.mp3".to_string();

        let resolved = resolve_folder_tracks(&[track, other], "/Music/Arab");
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].id, "a");
    }

    #[cfg(windows)]
    #[test]
    fn folder_resolution_is_case_insensitive_on_windows() {
        let mut track = sample_track("a", "Artist", "Album", Some(2022), 200.0, 1, None);
        track.file_path = "C:/Music/Arab/Track.mp3".to_string();

        let resolved = resolve_folder_tracks(&[track], "c:/music/arab");

        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].id, "a");
    }

    #[test]
    fn by_genre_rule_matches_case_insensitive_metadata() {
        let mut classical =
            sample_track("classical", "Artist", "Album", Some(2024), 200.0, 1, None);
        classical.genre = Some("Classical".to_string());

        let mut rock = sample_track("rock", "Artist", "Album", Some(2024), 200.0, 1, None);
        rock.genre = Some("Rock".to_string());

        let rules = vec![SmartPlaylistRule::ByGenre {
            genre: "class".to_string(),
        }];

        let (resolved, sync_error) = resolve_smart_tracks(&[classical, rock], &rules);
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].id, "classical");
        assert_eq!(sync_error, None);
    }

    #[test]
    fn genre_rule_validation_accepts_non_empty_values() {
        let rules = Some(vec![SmartPlaylistRule::ByGenre {
            genre: "Classical".to_string(),
        }]);

        assert!(validate_smart_rules(&rules).is_ok());
    }

    #[test]
    fn genre_rule_validation_rejects_empty_values() {
        let rules = Some(vec![SmartPlaylistRule::ByGenre {
            genre: "  ".to_string(),
        }]);

        assert!(validate_smart_rules(&rules).is_err());
    }

    #[test]
    fn missing_track_entry_is_marked_unavailable() {
        let mut track = sample_track("x", "Artist", "Album", Some(2022), 180.0, 0, None);
        track.file_path = "/__tarab_missing__/track-does-not-exist.mp3".to_string();

        let entry = to_entry(&track, 1);
        assert!(!entry.available);
        assert_eq!(entry.track_id, "x");
        assert_eq!(entry.position, 1);
    }
}
