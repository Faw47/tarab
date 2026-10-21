use crate::desktop_integration::MAIN_WINDOW_LABEL;
use crate::file_ops::{ensure_existing_path_allowed, SharedLibraryRoots};
use crate::library::SUPPORTED_EXTENSIONS;
use notify::event::{CreateKind, ModifyKind, RemoveKind, RenameMode};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// A path is reported once it has been quiet this long, so the final write of a copy or tag
/// edit is the one the renderer sees.
const QUIET_PERIOD: Duration = Duration::from_millis(1500);
/// Pending paths are flushed early above this count (bulk copies), keeping the map bounded.
const MAX_PENDING_PATHS: usize = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WatchChange {
    Changed,
    Removed,
}

impl WatchChange {
    fn event_name(self) -> &'static str {
        match self {
            WatchChange::Changed => "library-files-changed",
            WatchChange::Removed => "library-file-removed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WatchedRoot {
    root_id: String,
    canonical_path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryWatchEventPayload {
    root_id: String,
    relative_path: String,
}

fn is_audio_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
}

/// True when the last segment ends in a short alphanumeric extension (`.jpg`, `.tmp`), as files do.
/// Album folders such as "Vol. 2" or "R.E.M. - Automatic" have a dot but no such extension.
fn has_file_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            (1..=5).contains(&ext.len()) && ext.chars().all(|c| c.is_ascii_alphanumeric())
        })
}

/// Maps a notify event to the library paths it affects. Audio files are reported for content
/// changes; folders (including names with dots, like "Vol. 2") for creation, removal and renames, which
/// the renderer rescans as folders.
fn classify_event(event: &Event) -> Vec<(PathBuf, WatchChange)> {
    let folder_kind = matches!(
        event.kind,
        EventKind::Create(CreateKind::Folder) | EventKind::Remove(RemoveKind::Folder)
    );
    let maybe_folder = matches!(
        event.kind,
        EventKind::Create(CreateKind::Any)
            | EventKind::Remove(RemoveKind::Any)
            | EventKind::Modify(ModifyKind::Name(_))
    );
    let relevant = |path: &Path| {
        is_audio_path(path)
            || folder_kind
            || (maybe_folder && (path.is_dir() || !has_file_extension(path)))
    };

    let changes: Vec<(PathBuf, WatchChange)> = match event.kind {
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() == 2 => vec![
            (event.paths[0].clone(), WatchChange::Removed),
            (event.paths[1].clone(), WatchChange::Changed),
        ],
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) | EventKind::Remove(_) => event
            .paths
            .iter()
            .map(|path| (path.clone(), WatchChange::Removed))
            .collect(),
        EventKind::Create(_) | EventKind::Modify(_) => event
            .paths
            .iter()
            .map(|path| (path.clone(), WatchChange::Changed))
            .collect(),
        _ => Vec::new(),
    };
    changes
        .into_iter()
        .filter(|(path, _)| relevant(path))
        .collect()
}

/// Trailing-edge debouncer: each path is reported once, after it stops changing, with its latest
/// change. Reported paths leave the map.
#[derive(Default)]
struct TrailingDebouncer {
    pending: HashMap<PathBuf, (WatchChange, Instant)>,
}

impl TrailingDebouncer {
    fn record(&mut self, path: PathBuf, change: WatchChange, now: Instant) {
        self.pending.insert(path, (change, now));
    }

    fn drain_ready(&mut self, now: Instant) -> Vec<(PathBuf, WatchChange)> {
        let flush_all = self.pending.len() > MAX_PENDING_PATHS;
        let ready: Vec<PathBuf> = self
            .pending
            .iter()
            .filter(|(_, (_, at))| flush_all || now.duration_since(*at) >= QUIET_PERIOD)
            .map(|(path, _)| path.clone())
            .collect();
        ready
            .into_iter()
            .filter_map(|path| {
                let (change, _) = self.pending.remove(&path)?;
                Some((path, change))
            })
            .collect()
    }
}

pub struct WatcherTask {
    stop_tx: mpsc::Sender<()>,
    handle: JoinHandle<()>,
}

impl WatcherTask {
    fn stop(self) {
        let _ = self.stop_tx.send(());
        let _ = self.handle.join();
    }
}

fn watch_event_payload(
    changed_path: &Path,
    roots: &[WatchedRoot],
) -> Option<LibraryWatchEventPayload> {
    let (root, relative_path) = roots
        .iter()
        .filter_map(|root| {
            changed_path
                .strip_prefix(&root.canonical_path)
                .ok()
                .map(|relative_path| (root, relative_path))
        })
        .max_by_key(|(root, _)| root.canonical_path.components().count())?;

    Some(LibraryWatchEventPayload {
        root_id: root.root_id.clone(),
        relative_path: relative_path.to_string_lossy().into_owned(),
    })
}

fn start_watcher<R: Runtime>(
    app_handle: AppHandle<R>,
    roots: Vec<WatchedRoot>,
) -> Result<WatcherTask, String> {
    let (event_tx, event_rx) = mpsc::channel();
    let (stop_tx, stop_rx) = mpsc::channel();

    let mut watcher =
        RecommendedWatcher::new(event_tx, Config::default()).map_err(|e| e.to_string())?;

    // One folder that cannot be watched (for example the Linux inotify watch limit) must not
    // stop watching the others.
    let mut watched = 0;
    let mut first_error = None;
    for root in &roots {
        let path = &root.canonical_path;
        if !path.exists() {
            continue;
        }
        match watcher.watch(path, RecursiveMode::Recursive) {
            Ok(()) => watched += 1,
            Err(error) => {
                eprintln!(
                    "library watcher could not watch {}: {}",
                    root.root_id, error
                );
                first_error.get_or_insert_with(|| error.to_string());
            }
        }
    }
    if watched == 0 {
        if let Some(error) = first_error {
            return Err(error);
        }
    }

    let handle = thread::spawn(move || {
        // Keep watcher alive in this thread
        let _watcher = watcher;
        let mut debouncer = TrailingDebouncer::default();

        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            match event_rx.recv_timeout(Duration::from_millis(250)) {
                Ok(Ok(event)) => {
                    let now = Instant::now();
                    for (path, change) in classify_event(&event) {
                        debouncer.record(path, change, now);
                    }
                }
                Ok(Err(e)) => eprintln!("library watcher error: {:?}", e),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            for (path, change) in debouncer.drain_ready(Instant::now()) {
                let Some(payload) = watch_event_payload(&path, &roots) else {
                    continue;
                };
                let _ = app_handle.emit_to(MAIN_WINDOW_LABEL, change.event_name(), payload);
            }
        }
    });

    Ok(WatcherTask { stop_tx, handle })
}

fn validate_watch_paths(paths: Vec<String>, roots: &[PathBuf]) -> Result<Vec<WatchedRoot>, String> {
    let mut allowed_paths = Vec::with_capacity(paths.len());
    for path in paths {
        let canonical =
            ensure_existing_path_allowed(Path::new(&path), roots, "watch library folder")?;
        allowed_paths.push(WatchedRoot {
            root_id: path,
            canonical_path: canonical,
        });
    }
    Ok(allowed_paths)
}

/// Async so stopping the previous watcher (a thread join of up to 250 ms) and the recursive
/// watch setup run off the main thread.
#[tauri::command]
pub async fn watch_library_paths(
    app: AppHandle,
    paths: Vec<String>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<(), String> {
    let roots = roots_state.read().roots.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Mutex<Option<WatcherTask>>>();
        let mut watcher_handle = state.lock().map_err(|e| e.to_string())?;

        if let Some(existing) = watcher_handle.take() {
            existing.stop();
        }

        if paths.is_empty() {
            return Ok(());
        }

        let allowed_paths = validate_watch_paths(paths, &roots)?;
        *watcher_handle = Some(start_watcher(app.clone(), allowed_paths)?);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("tarab-{name}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn validates_watch_paths_against_library_roots() {
        let allowed_root = temp_path("watch-allowed");
        let outside_root = temp_path("watch-outside");
        fs::create_dir_all(&allowed_root).expect("create allowed root");
        fs::create_dir_all(&outside_root).expect("create outside root");

        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let allowed =
            validate_watch_paths(vec![allowed_root.to_string_lossy().to_string()], &roots)
                .expect("allowed path");
        assert_eq!(
            allowed,
            vec![WatchedRoot {
                root_id: allowed_root.to_string_lossy().to_string(),
                canonical_path: roots[0].clone(),
            }]
        );

        let blocked =
            validate_watch_paths(vec![outside_root.to_string_lossy().to_string()], &roots);
        assert!(blocked.is_err());

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[cfg(unix)]
    #[test]
    fn validation_preserves_a_symlinked_configured_root_id() {
        let real_root = temp_path("watch-real");
        let alias_root = temp_path("watch-alias");
        fs::create_dir_all(&real_root).expect("create real root");
        std::os::unix::fs::symlink(&real_root, &alias_root).expect("create symlink");

        let canonical_root = fs::canonicalize(&real_root).expect("canonical root");
        let configured_root = alias_root.to_string_lossy().into_owned();
        let roots = validate_watch_paths(
            vec![configured_root.clone()],
            std::slice::from_ref(&canonical_root),
        )
        .expect("validate symlinked root");

        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].root_id, configured_root);
        assert_eq!(roots[0].canonical_path, canonical_root);

        let _ = fs::remove_file(alias_root);
        let _ = fs::remove_dir_all(real_root);
    }

    #[test]
    fn canonical_watcher_event_keeps_the_configured_root_identity() {
        let roots = vec![WatchedRoot {
            root_id: "/var/music".to_string(),
            canonical_path: PathBuf::from("/private/var/music"),
        }];

        assert_eq!(
            watch_event_payload(Path::new("/private/var/music/Artist/Album/01.flac"), &roots),
            Some(LibraryWatchEventPayload {
                root_id: "/var/music".to_string(),
                relative_path: "Artist/Album/01.flac".to_string(),
            })
        );
    }

    #[test]
    fn canonical_watcher_event_uses_the_most_specific_configured_root() {
        let roots = vec![
            WatchedRoot {
                root_id: "/music".to_string(),
                canonical_path: PathBuf::from("/real/music"),
            },
            WatchedRoot {
                root_id: "/music/Jazz".to_string(),
                canonical_path: PathBuf::from("/real/music/Jazz"),
            },
        ];

        assert_eq!(
            watch_event_payload(Path::new("/real/music/Jazz/song.flac"), &roots),
            Some(LibraryWatchEventPayload {
                root_id: "/music/Jazz".to_string(),
                relative_path: "song.flac".to_string(),
            })
        );
    }

    fn event(kind: EventKind, paths: &[&str]) -> Event {
        let mut event = Event::new(kind);
        for path in paths {
            event = event.add_path(PathBuf::from(path));
        }
        event
    }

    #[test]
    fn reports_the_last_change_after_writes_stop() {
        // Regression for AR-19: the first event was emitted and later ones in the next two
        // seconds were dropped, so the final write of a file could be missed.
        let start = Instant::now();
        let mut debouncer = TrailingDebouncer::default();
        let song = PathBuf::from("/music/a/song.flac");

        debouncer.record(song.clone(), WatchChange::Changed, start);
        assert!(debouncer.drain_ready(start).is_empty());
        debouncer.record(
            song.clone(),
            WatchChange::Changed,
            start + Duration::from_secs(1),
        );
        assert!(debouncer
            .drain_ready(start + Duration::from_millis(2000))
            .is_empty());
        debouncer.record(
            song.clone(),
            WatchChange::Removed,
            start + Duration::from_secs(2),
        );

        let ready = debouncer.drain_ready(start + Duration::from_secs(4));
        assert_eq!(ready, vec![(song, WatchChange::Removed)]);
        assert!(debouncer.pending.is_empty());
    }

    #[test]
    fn classifies_audio_files_and_folder_level_events() {
        let renamed = classify_event(&event(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &["/music/Old Album", "/music/New Album"],
        ));
        assert_eq!(
            renamed,
            vec![
                (PathBuf::from("/music/Old Album"), WatchChange::Removed),
                (PathBuf::from("/music/New Album"), WatchChange::Changed),
            ]
        );

        let written = classify_event(&event(
            EventKind::Modify(ModifyKind::Any),
            &["/music/a/song.FLAC", "/music/a/cover.jpg", "/music/a"],
        ));
        assert_eq!(
            written,
            vec![(PathBuf::from("/music/a/song.FLAC"), WatchChange::Changed)]
        );

        let temp = classify_event(&event(
            EventKind::Create(CreateKind::Any),
            &["/music/a/.song.flac.0123.tarab.tmp"],
        ));
        assert!(temp.is_empty());

        // Dots in album folder names do not make them files.
        let moved_in = classify_event(&event(
            EventKind::Modify(ModifyKind::Name(RenameMode::To)),
            &["/music/Vol. 2", "/music/R.E.M. - Automatic for the People"],
        ));
        assert_eq!(moved_in.len(), 2);
        let removed = classify_event(&event(
            EventKind::Remove(RemoveKind::Folder),
            &["/music/St. Vincent"],
        ));
        assert_eq!(
            removed,
            vec![(PathBuf::from("/music/St. Vincent"), WatchChange::Removed)]
        );
    }
}
