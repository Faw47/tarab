use parking_lot::Mutex;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::desktop_integration::{DesktopControlAction, MAIN_WINDOW_LABEL};

const QUIT_SAVE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
struct QuitStatus {
    sequence: u64,
    pending: Option<u64>,
    approved: bool,
}

impl QuitStatus {
    fn begin(&mut self) -> Option<u64> {
        if self.approved || self.pending.is_some() {
            return None;
        }
        self.sequence += 1;
        self.pending = Some(self.sequence);
        self.pending
    }

    fn cancel(&mut self) {
        self.pending = None;
    }

    fn approve(&mut self) {
        self.pending = None;
        self.approved = true;
    }

    fn approve_timeout(&mut self, request: u64) -> bool {
        if self.pending != Some(request) {
            return false;
        }
        self.approve();
        true
    }
}

#[derive(Clone, Default)]
pub struct QuitState(Arc<Mutex<QuitStatus>>);

pub fn exit_approved<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.state::<QuitState>().inner().0.lock().approved
}

pub fn approve_exit<R: Runtime>(app: &AppHandle<R>) {
    app.state::<QuitState>().inner().0.lock().approve();
}

/// Keep the main renderer alive long enough to capture a fresh session. An unavailable
/// renderer must not trap the application forever; explicit save failures cancel this timer.
pub fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<QuitState>().inner().clone();
    let Some(request) = state.0.lock().begin() else {
        return;
    };
    if app.get_webview_window(MAIN_WINDOW_LABEL).is_none()
        || app
            .emit_to(
                MAIN_WINDOW_LABEL,
                "desktop-control-action",
                DesktopControlAction::Quit,
            )
            .is_err()
    {
        state.0.lock().approve();
        app.exit(0);
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_SAVE_TIMEOUT);
        let timed_out = state.0.lock().approve_timeout(request);
        if timed_out {
            eprintln!("Session save timed out while quitting; using the last persisted session");
            app.exit(0);
        }
    });
}

#[tauri::command]
pub fn desktop_cancel_quit(state: tauri::State<'_, QuitState>) {
    state.inner().0.lock().cancel();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_quit_requests_share_one_pending_save() {
        let mut state = QuitStatus::default();
        assert_eq!(state.begin(), Some(1));
        assert_eq!(state.begin(), None);
        assert!(!state.approved);
    }

    #[test]
    fn cancelled_save_allows_retry_without_an_old_timeout_exiting() {
        let mut state = QuitStatus::default();
        let first = state.begin().expect("first quit");
        state.cancel();
        let second = state.begin().expect("retry quit");
        assert!(!state.approve_timeout(first));
        assert!(!state.approved);
        assert!(state.approve_timeout(second));
        assert!(state.approved);
    }

    #[test]
    fn explicit_save_failure_cancels_the_exit_timeout() {
        let mut state = QuitStatus::default();
        let request = state.begin().expect("quit");
        state.cancel();
        assert!(!state.approve_timeout(request));
        assert!(!state.approved);
    }

    #[test]
    fn approved_exit_does_not_start_another_save() {
        let mut state = QuitStatus::default();
        let request = state.begin().expect("quit");
        state.approve();
        assert!(state.approved);
        assert!(state.begin().is_none());
        assert!(!state.approve_timeout(request));
    }
}
