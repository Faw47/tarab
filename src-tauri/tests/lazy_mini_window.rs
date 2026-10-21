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
