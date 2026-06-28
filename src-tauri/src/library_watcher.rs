use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{mpsc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};

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

        let extensions = ["mp3", "flac", "aiff", "wav", "ogg", "m4a", "aac"];
        let mut debounce_map: HashMap<String, Instant> = HashMap::new();
        let debounce_duration = Duration::from_secs(2);

        loop {
            if stop_rx.try_recv().is_ok() {
                break;
            }

            match event_rx.recv_timeout(Duration::from_millis(250)) {
                Ok(Ok(event)) => {
                    for path in event.paths {
                        if let Some(ext) = path
                            .extension()
                            .and_then(|e| e.to_str())
                            .map(|s| s.to_lowercase())
                        {
                            if extensions.contains(&ext.as_str()) {
                                let path_str = path.to_string_lossy().to_string();
                                let now = Instant::now();

                                // Check debounce
                                if let Some(last_event) = debounce_map.get(&path_str) {
                                    if now.duration_since(*last_event) < debounce_duration {
                                        continue;
                                    }
                                }
                                debounce_map.insert(path_str.clone(), now);

                                use notify::EventKind;
                                match event.kind {
                                    EventKind::Create(_) | EventKind::Modify(_) => {
                                        let _ = app_handle.emit("library-files-changed", path_str);
                                    }
                                    EventKind::Remove(_) => {
                                        let _ = app_handle.emit("library-file-removed", path_str);
                                    }
                                    _ => {}
                                }
                            }
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

#[tauri::command]
pub fn watch_library_paths(
    app: AppHandle,
    paths: Vec<String>,
    state: tauri::State<'_, Mutex<Option<WatcherTask>>>,
) -> Result<(), String> {
    let mut watcher_handle = state.lock().map_err(|e| e.to_string())?;

    if let Some(existing) = watcher_handle.take() {
        existing.stop();
    }

    *watcher_handle = Some(start_watcher(app, paths)?);

    Ok(())
}
