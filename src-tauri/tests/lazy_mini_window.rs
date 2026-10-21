#[test]
fn mini_player_is_not_declared_as_a_startup_window() {
    let config = include_str!("../tauri.conf.json");
    assert!(
        !config.contains(r#""label": "mini-player""#),
        "the mini-player webview should not be created from startup configuration"
    );
}

#[test]
fn mini_player_remains_available_through_a_lazy_window_builder() {
    assert!(
        include_str!("../src/desktop_integration.rs").contains("WebviewWindowBuilder::new"),
        "the mini-player window should be created on first use"
    );
}

fn command_body(name: &str) -> &'static str {
    let source = include_str!("../src/desktop_integration.rs");
    let signature = format!("pub async fn {name}(");
    let sync_signature = format!("pub fn {name}(");
    let start = source
        .find(&signature)
        .or_else(|| source.find(&sync_signature))
        .expect("mini-window command");
    let command = &source[start..];
    let end = command
        .find("\n#[tauri::command]")
        .unwrap_or(command.len());
    &command[..end]
}

#[test]
fn mini_window_mutations_are_async_and_toggle_is_serialized() {
    let source = include_str!("../src/desktop_integration.rs");
    assert!(
        source.contains("mini_window_creation_lock: AsyncMutex<()>"),
        "mini-window operations must use an async lock so synchronous UI commands never block the main thread"
    );

    let open = command_body("desktop_open_mini_window");
    assert!(
        open.find(".mini_window_creation_lock.lock().await")
            < open.find("open_mini_window_locked"),
        "opening must hold the async gate before checking or creating the webview"
    );

    let close = command_body("desktop_close_mini_window");
    assert!(
        close.contains(".mini_window_creation_lock.lock().await")
            && close.contains("hide_mini_window_locked"),
        "closing must serialize with in-progress creation"
    );

    let toggle = command_body("desktop_toggle_mini_window");
    assert!(
        toggle.find(".mini_window_creation_lock.lock().await")
            < toggle.find(".is_visible()"),
        "toggle must read visibility and apply its transition under the same gate"
    );
    assert!(
        toggle.contains("open_mini_window_locked")
            && toggle.contains("hide_mini_window_locked"),
        "toggle must call lock-aware helpers instead of recursively acquiring the gate"
    );

    let update = command_body("desktop_set_native_ui_state");
    assert!(
        update.contains(".mini_window_creation_lock.lock().await")
            && update.contains("hide_mini_window_locked"),
        "disabling the mini window must wait asynchronously for creation before hiding it"
    );
}
