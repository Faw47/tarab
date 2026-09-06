use crate::file_ops::{ensure_existing_path_allowed, path_to_public_string, SharedLibraryRoots};
use crate::library::is_supported_audio_path;
use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};

fn relevant_event_name(kind: &notify::EventKind) -> Option<&'static str> {
    match kind {
        notify::EventKind::Create(_) | notify::EventKind::Modify(_) => {
            Some("library-files-changed")
        }
        notify::EventKind::Remove(_) => Some("library-file-removed"),
        _ => None,
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

pub fn start_watcher<R: Runtime>(
    app_handle: AppHandle<R>,
    paths: Vec<String>,
) -> Result<WatcherTask, String> {
    let (event_tx, event_rx) = mpsc::channel();
    let (stop_tx, stop_rx) = mpsc::channel();

    // The user requested a debounce duration of 2 seconds.
    // notify v6 RecommendedWatcher is immediate; we'll implement simple debouncing in the handler thread.
    let mut watcher =
        RecommendedWatcher::new(event_tx, Config::default()).map_err(|e| e.to_string())?;

    for path in paths {
        let p = Path::new(&path);
        if p.exists() {
            watcher
                .watch(p, RecursiveMode::Recursive)
                .map_err(|e| e.to_string())?;
        }
    }

    let handle = thread::spawn(move || {
        // Keep watcher alive in this thread
        let _watcher = watcher;

        let mut debounce_map: HashMap<String, Instant> = HashMap::new();
        let debounce_duration = Duration::from_secs(2);

        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            match event_rx.recv_timeout(Duration::from_millis(250)) {
                Ok(Ok(event)) => {
                    let Some(event_name) = relevant_event_name(&event.kind) else {
                        continue;
                    };

                    for path in event.paths {
                        if is_supported_audio_path(&path) {
                            let path_str = path_to_public_string(&path);
                            let now = Instant::now();

                            if let Some(last_event) = debounce_map.get(&path_str) {
                                if now.duration_since(*last_event) < debounce_duration {
                                    continue;
                                }
                            }
                            debounce_map.insert(path_str.clone(), now);

                            let _ = app_handle.emit(event_name, path_str);
                        }
                    }
                }
                Ok(Err(e)) => eprintln!("library watcher error: {:?}", e),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Ok(WatcherTask { stop_tx, handle })
}

fn validate_watch_paths(paths: Vec<String>, roots: &[PathBuf]) -> Result<Vec<String>, String> {
    let mut allowed_paths = Vec::with_capacity(paths.len());
    for path in paths {
        let canonical =
            ensure_existing_path_allowed(Path::new(&path), roots, "watch library folder")?;
        allowed_paths.push(canonical.to_string_lossy().to_string());
    }
    Ok(allowed_paths)
}

#[tauri::command]
pub fn watch_library_paths(
    app: AppHandle,
    paths: Vec<String>,
    state: tauri::State<'_, Mutex<Option<WatcherTask>>>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<(), String> {
    let mut watcher_handle = state.lock().map_err(|e| e.to_string())?;
    if paths.is_empty() {
        let previous = watcher_handle.take();
        drop(watcher_handle);
        if let Some(existing) = previous {
            existing.stop();
        }
        return Ok(());
    }

    let roots = roots_state.read().roots.clone();
    let allowed_paths = validate_watch_paths(paths, &roots)?;
    let replacement = start_watcher(app, allowed_paths)?;
    let previous = (*watcher_handle).replace(replacement);
    drop(watcher_handle);
    if let Some(existing) = previous {
        existing.stop();
    }

    Ok(())
}
#[cfg(test)]
mod tests {
    use super::{relevant_event_name, validate_watch_paths};
    use crate::library::{is_supported_audio_path, SUPPORTED_AUDIO_EXTENSIONS};
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
        assert_eq!(allowed, vec![roots[0].to_string_lossy().to_string()]);

        let blocked =
            validate_watch_paths(vec![outside_root.to_string_lossy().to_string()], &roots);
        assert!(blocked.is_err());

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn non_mutating_events_do_not_start_debounce() {
        assert_eq!(
            relevant_event_name(&notify::EventKind::Access(notify::event::AccessKind::Read)),
            None
        );
        assert_eq!(
            relevant_event_name(&notify::EventKind::Modify(notify::event::ModifyKind::Any)),
            Some("library-files-changed")
        );
        assert_eq!(
            relevant_event_name(&notify::EventKind::Remove(notify::event::RemoveKind::Any)),
            Some("library-file-removed")
        );
    }
    #[test]
    fn watcher_uses_every_canonical_audio_extension() {
        for extension in SUPPORTED_AUDIO_EXTENSIONS.iter() {
            assert!(is_supported_audio_path(std::path::Path::new(&format!(
                "track.{extension}"
            ))));
        }
        assert!(!is_supported_audio_path(std::path::Path::new("track.opus")));
        assert!(!is_supported_audio_path(std::path::Path::new("track.wma")));
    }
}
