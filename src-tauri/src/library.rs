use parking_lot::Mutex;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;

use crate::file_ops::{
    ensure_existing_path_allowed, is_path_allowed, path_to_public_string, SharedLibraryRoots,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MediaFormatRegistry {
    audio_extensions: Vec<String>,
}

pub static SUPPORTED_AUDIO_EXTENSIONS: LazyLock<Box<[String]>> = LazyLock::new(|| {
    let registry: MediaFormatRegistry =
        serde_json::from_str(include_str!("../../media-formats.json"))
            .expect("media-formats.json must contain a valid format registry");
    assert!(
        !registry.audio_extensions.is_empty()
            && registry
                .audio_extensions
                .iter()
                .enumerate()
                .all(|(index, extension)| {
                    !extension.is_empty()
                        && extension
                            .bytes()
                            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
                        && !registry.audio_extensions[..index].contains(extension)
                }),
        "media-formats.json extensions must be unique lowercase ASCII values"
    );
    registry.audio_extensions.into_boxed_slice()
});
const MAX_SCAN_DEPTH: usize = 64;
const MAX_SCAN_ENTRIES: usize = 1_000_000;
const MAX_SCAN_AUDIO_BYTES: u64 = 10 * 1024 * 1024 * 1024 * 1024;
const SCAN_PATH_CHUNK_SIZE: usize = 500;
const SCAN_PATH_CHUNK_EVENT: &str = "library-scan-path-chunk";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryScanPathChunk {
    scan_id: String,
    paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScanStreamSummary {
    scan_id: String,
    path_count: usize,
}

#[derive(Default)]
pub struct LibraryScanControl {
    scans: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl LibraryScanControl {
    fn start(&self, scan_id: &str) -> Arc<AtomicBool> {
        let cancellation = Arc::new(AtomicBool::new(false));
        self.scans
            .lock()
            .insert(scan_id.to_string(), Arc::clone(&cancellation));
        cancellation
    }

    pub fn cancellation(&self, scan_id: &str) -> Result<Arc<AtomicBool>, String> {
        self.scans
            .lock()
            .get(scan_id)
            .cloned()
            .ok_or_else(|| "Library scan is no longer active".to_string())
    }

    fn cancel(&self, scan_id: &str) -> Result<(), String> {
        let cancellation = self.cancellation(scan_id)?;
        cancellation.store(true, Ordering::Release);
        Ok(())
    }

    fn finish(&self, scan_id: &str) {
        self.scans.lock().remove(scan_id);
    }
}

pub type SharedLibraryScanControl = Arc<LibraryScanControl>;

pub fn create_library_scan_control() -> SharedLibraryScanControl {
    Arc::new(LibraryScanControl::default())
}

fn ensure_scan_folder_allowed(folder_path: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let path = Path::new(folder_path);

    if !path.exists() {
        return Err(format!("Folder does not exist: {}", folder_path));
    }

    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", folder_path));
    }

    ensure_existing_path_allowed(path, roots, "scan library folder")
}

pub(crate) fn is_supported_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            SUPPORTED_AUDIO_EXTENSIONS
                .iter()
                .any(|supported| supported.eq_ignore_ascii_case(ext))
        })
        .unwrap_or(false)
}

fn allowed_scan_file(path: &Path, roots: &[PathBuf]) -> Result<String, String> {
    match ensure_existing_path_allowed(path, roots, "scan library file") {
        Ok(canonical) => Ok(path_to_public_string(&canonical)),
        Err(error) => Err(format!("Library traversal is incomplete: {error}")),
    }
}

fn validate_scan_entry(
    path: &Path,
    path_is_symlink: bool,
    roots: &[PathBuf],
) -> Result<bool, String> {
    match ensure_existing_path_allowed(path, roots, "scan library entry") {
        Ok(_) => Ok(true),
        Err(error) => {
            // Only a resolved symlink outside every grant is safe to prune from a complete scan.
            let is_out_of_root_link = path_is_symlink
                && std::fs::canonicalize(path)
                    .map(|canonical| !is_path_allowed(&canonical, roots))
                    .unwrap_or(false);
            if is_out_of_root_link {
                Ok(false)
            } else {
                Err(format!("Library traversal is incomplete: {error}"))
            }
        }
    }
}

fn collect_audio_files(
    folder_path: &str,
    follow_links: bool,
    roots: &[PathBuf],
    force_parallel: bool,
    cancelled: &AtomicBool,
) -> Result<Vec<String>, String> {
    let path = ensure_scan_folder_allowed(folder_path, roots)?;

    let mut entries = Vec::new();
    let mut visited_entries = 0_usize;
    let mut audio_bytes = 0_u64;
    let mut walker = WalkDir::new(&path)
        .max_depth(MAX_SCAN_DEPTH)
        .follow_links(follow_links)
        .into_iter();
    while let Some(entry) = walker.next() {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Library scan cancelled before traversal completed".to_string());
        }
        let entry = entry.map_err(|error| format!("Library traversal is incomplete: {}", error))?;
        if entry.depth() > 0 && !validate_scan_entry(entry.path(), entry.path_is_symlink(), roots)?
        {
            if follow_links {
                let target_is_dir = entry
                    .path()
                    .metadata()
                    .map_err(|error| {
                        format!(
                            "Library traversal is incomplete: Failed to inspect pruned symlink {}: {error}",
                            entry.path().display()
                        )
                    })?
                    .is_dir();
                if target_is_dir {
                    walker.skip_current_dir();
                }
            }
            continue;
        }
        visited_entries += 1;
        if visited_entries > MAX_SCAN_ENTRIES {
            return Err(format!(
                "Library scan exceeded the {} entry limit",
                MAX_SCAN_ENTRIES
            ));
        }
        if entry.file_type().is_dir() && entry.depth() == MAX_SCAN_DEPTH {
            return Err(format!(
                "Library scan exceeded the {} level depth limit",
                MAX_SCAN_DEPTH
            ));
        }
        if !entry.file_type().is_file() {
            continue;
        }
        if is_supported_audio_path(entry.path()) {
            let bytes = entry
                .metadata()
                .map_err(|error| format!("Failed to inspect audio file: {}", error))?
                .len();
            audio_bytes = audio_bytes.saturating_add(bytes);
            if audio_bytes > MAX_SCAN_AUDIO_BYTES {
                return Err("Library scan exceeded the total audio byte limit".to_string());
            }
        }
        entries.push(entry);
    }

    let resolve_entry = |entry: &walkdir::DirEntry| -> Result<Option<String>, String> {
        if cancelled.load(Ordering::Relaxed) {
            return Err("Library scan cancelled before traversal completed".to_string());
        }
        if is_supported_audio_path(entry.path()) {
            allowed_scan_file(entry.path(), roots).map(Some)
        } else {
            Ok(None)
        }
    };

    let resolved: Result<Vec<Option<String>>, String> = if force_parallel || entries.len() >= 1_500
    {
        entries.par_iter().map(&resolve_entry).collect()
    } else {
        entries.iter().map(&resolve_entry).collect()
    };
    let mut files: Vec<String> = resolved?.into_iter().flatten().collect();
    files.sort();
    files.dedup();

    Ok(files)
}

fn validate_scan_id(scan_id: &str) -> Result<(), String> {
    if scan_id.is_empty()
        || scan_id.len() > 64
        || !scan_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("scanId must contain 1 to 64 safe characters".to_string());
    }
    Ok(())
}

fn emit_scan_paths(
    app: &AppHandle,
    scan_id: String,
    paths: Vec<String>,
) -> Result<LibraryScanStreamSummary, String> {
    let path_count = paths.len();
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is not available for scan results".to_string())?;
    for chunk in paths.chunks(SCAN_PATH_CHUNK_SIZE) {
        main.emit(
            SCAN_PATH_CHUNK_EVENT,
            LibraryScanPathChunk {
                scan_id: scan_id.clone(),
                paths: chunk.to_vec(),
            },
        )
        .map_err(|error| format!("Failed to stream library scan results: {error}"))?;
    }
    Ok(LibraryScanStreamSummary {
        scan_id,
        path_count,
    })
}

#[tauri::command]
pub async fn scan_library(
    app: AppHandle,
    scan_id: String,
    folder_path: String,
    follow_links: Option<bool>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
    scan_control: tauri::State<'_, SharedLibraryScanControl>,
) -> Result<LibraryScanStreamSummary, String> {
    validate_scan_id(&scan_id)?;
    let roots = roots_state.inner().read().roots.clone();
    let scan_control = scan_control.inner().clone();
    let cancellation = scan_control.start(&scan_id);
    let paths = match spawn_blocking(move || {
        collect_audio_files(
            &folder_path,
            follow_links.unwrap_or(false),
            &roots,
            false,
            &cancellation,
        )
    })
    .await
    {
        Ok(Ok(paths)) => paths,
        Ok(Err(error)) => {
            scan_control.finish(&scan_id);
            return Err(error);
        }
        Err(error) => {
            scan_control.finish(&scan_id);
            return Err(error.to_string());
        }
    };
    match emit_scan_paths(&app, scan_id.clone(), paths) {
        Ok(summary) => Ok(summary),
        Err(error) => {
            scan_control.finish(&scan_id);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn scan_library_parallel(
    app: AppHandle,
    scan_id: String,
    folder_path: String,
    follow_links: Option<bool>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
    scan_control: tauri::State<'_, SharedLibraryScanControl>,
) -> Result<LibraryScanStreamSummary, String> {
    validate_scan_id(&scan_id)?;
    let roots = roots_state.inner().read().roots.clone();
    let scan_control = scan_control.inner().clone();
    let cancellation = scan_control.start(&scan_id);
    let paths = match spawn_blocking(move || {
        collect_audio_files(
            &folder_path,
            follow_links.unwrap_or(false),
            &roots,
            true,
            &cancellation,
        )
    })
    .await
    {
        Ok(Ok(paths)) => paths,
        Ok(Err(error)) => {
            scan_control.finish(&scan_id);
            return Err(error);
        }
        Err(error) => {
            scan_control.finish(&scan_id);
            return Err(error.to_string());
        }
    };
    match emit_scan_paths(&app, scan_id.clone(), paths) {
        Ok(summary) => Ok(summary),
        Err(error) => {
            scan_control.finish(&scan_id);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn cancel_library_scan(
    scan_id: String,
    scan_control: tauri::State<'_, SharedLibraryScanControl>,
) -> Result<(), String> {
    validate_scan_id(&scan_id)?;
    scan_control.cancel(&scan_id)
}

#[tauri::command]
pub fn finish_library_scan(
    scan_id: String,
    scan_control: tauri::State<'_, SharedLibraryScanControl>,
) -> Result<(), String> {
    validate_scan_id(&scan_id)?;
    scan_control.finish(&scan_id);
    Ok(())
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
        let dir = std::env::temp_dir().join(format!("tarab-library-{}-{}", name, nonce));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn scan_cancellation_is_isolated_by_scan_id() {
        let control = LibraryScanControl::default();
        let first = control.start("first");
        let second = control.start("second");

        control.cancel("first").expect("cancel first scan");

        assert!(first.load(Ordering::Acquire));
        assert!(!second.load(Ordering::Acquire));
        control.finish("first");
        assert!(control.cancellation("first").is_err());
        assert!(control.cancellation("second").is_ok());
    }

    #[test]
    fn scan_rejects_folders_outside_library_roots() {
        let allowed_root = temp_dir("allowed");
        let outside_root = temp_dir("outside");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let result = collect_audio_files(
            &outside_root.to_string_lossy(),
            false,
            &roots,
            false,
            &AtomicBool::new(false),
        );

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("outside configured library roots"));

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn scan_stream_ids_reject_event_name_injection() {
        assert!(validate_scan_id("scan-0123_abcd").is_ok());
        assert!(validate_scan_id("").is_err());
        assert!(validate_scan_id("../scan").is_err());
        assert!(validate_scan_id("scan:event").is_err());
        assert!(validate_scan_id(&"a".repeat(65)).is_err());
        assert_eq!(SCAN_PATH_CHUNK_SIZE, 500);
    }

    #[test]
    fn scan_returns_supported_files_inside_library_roots() {
        let allowed_root = temp_dir("allowed");
        let mut expected = Vec::new();
        for (index, extension) in SUPPORTED_AUDIO_EXTENSIONS.iter().enumerate() {
            let track = allowed_root.join(format!("track-{index}.{extension}"));
            fs::write(&track, b"not audio").expect("write track");
            expected.push(path_to_public_string(&track));
        }
        let ignored = allowed_root.join("cover.jpg");
        fs::write(&ignored, b"not audio").expect("write ignored");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let files = collect_audio_files(
            &allowed_root.to_string_lossy(),
            false,
            &roots,
            false,
            &AtomicBool::new(false),
        )
        .expect("scan allowed root");

        expected.sort();
        assert_eq!(files, expected);

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[test]
    fn canonical_audio_formats_have_compiled_symphonia_support() {
        use symphonia::core::codecs::{
            CODEC_TYPE_AAC, CODEC_TYPE_ALAC, CODEC_TYPE_FLAC, CODEC_TYPE_MP3, CODEC_TYPE_PCM_S16BE,
            CODEC_TYPE_PCM_S16LE, CODEC_TYPE_VORBIS,
        };
        use symphonia::core::probe::QueryDescriptor;

        let extensions = SUPPORTED_AUDIO_EXTENSIONS
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>();
        assert_eq!(
            extensions,
            ["mp3", "flac", "wav", "ogg", "m4a", "aac", "aiff", "alac"]
        );
        assert!(!extensions.contains(&"opus"));
        assert!(!extensions.contains(&"wma"));

        let codecs = symphonia::default::get_codecs();
        for codec in [
            CODEC_TYPE_AAC,
            CODEC_TYPE_ALAC,
            CODEC_TYPE_FLAC,
            CODEC_TYPE_MP3,
            CODEC_TYPE_PCM_S16BE,
            CODEC_TYPE_PCM_S16LE,
            CODEC_TYPE_VORBIS,
        ] {
            assert!(codecs.get_codec(codec).is_some(), "missing codec {codec:?}");
        }

        let supports_extension = |descriptors: &[symphonia::core::probe::Descriptor], extension| {
            descriptors
                .iter()
                .any(|descriptor| descriptor.extensions.contains(&extension))
        };
        assert!(supports_extension(
            symphonia::default::formats::MpaReader::query(),
            "mp3"
        ));
        assert!(supports_extension(
            symphonia::default::formats::FlacReader::query(),
            "flac"
        ));
        assert!(supports_extension(
            symphonia::default::formats::WavReader::query(),
            "wav"
        ));
        assert!(supports_extension(
            symphonia::default::formats::OggReader::query(),
            "ogg"
        ));
        assert!(supports_extension(
            symphonia::default::formats::AdtsReader::query(),
            "aac"
        ));
        assert!(supports_extension(
            symphonia::default::formats::AiffReader::query(),
            "aiff"
        ));
        assert!(supports_extension(
            symphonia::default::formats::IsoMp4Reader::query(),
            "m4a"
        ));
    }

    #[test]
    fn unresolved_in_root_entry_marks_traversal_incomplete() {
        let allowed_root = temp_dir("unresolved-entry");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let missing_entry = allowed_root.join("vanished");

        let error = validate_scan_entry(&missing_entry, false, &roots)
            .expect_err("unresolved entry must fail traversal");

        assert!(error.contains("Library traversal is incomplete"));
        assert!(error.contains("Failed to resolve path"));
        let _ = fs::remove_dir_all(allowed_root);
    }

    #[cfg(unix)]
    #[test]
    fn scan_fails_for_unresolved_in_root_symlink() {
        use std::os::unix::fs::symlink;

        let allowed_root = temp_dir("broken-link");
        symlink(
            allowed_root.join("missing-target"),
            allowed_root.join("broken-link"),
        )
        .expect("create broken link");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let error = collect_audio_files(
            &allowed_root.to_string_lossy(),
            false,
            &roots,
            false,
            &AtomicBool::new(false),
        )
        .expect_err("broken in-root link must fail traversal");

        assert!(error.contains("Library traversal is incomplete"));
        let _ = fs::remove_dir_all(allowed_root);
    }

    #[cfg(unix)]
    #[test]
    fn scan_follow_links_does_not_traverse_outside_the_granted_root() {
        use std::os::unix::fs::symlink;

        let allowed_root = temp_dir("follow-links-allowed");
        let outside_root = temp_dir("follow-links-outside");
        let allowed_track = allowed_root.join("inside.mp3");
        fs::write(&allowed_track, b"inside").expect("write allowed track");
        fs::write(outside_root.join("outside.mp3"), b"outside").expect("write outside track");
        symlink(&outside_root, allowed_root.join("linked-outside")).expect("link outside root");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];

        let files = collect_audio_files(
            &allowed_root.to_string_lossy(),
            true,
            &roots,
            false,
            &AtomicBool::new(false),
        )
        .expect("scan granted root");

        assert_eq!(files, vec![path_to_public_string(&allowed_track)]);
        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn cancelled_scan_returns_before_reconciliation_input_is_created() {
        let allowed_root = temp_dir("cancelled");
        fs::write(allowed_root.join("track.mp3"), b"not audio").expect("write track");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let cancelled = AtomicBool::new(true);

        let result = collect_audio_files(
            &allowed_root.to_string_lossy(),
            false,
            &roots,
            false,
            &cancelled,
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("cancelled"));
        let _ = fs::remove_dir_all(allowed_root);
    }
}
