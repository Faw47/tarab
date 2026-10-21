use serde_json::Value;

#[test]
fn main_window_can_read_the_installed_app_version() {
    let capability: Value =
        serde_json::from_str(include_str!("../capabilities/core.json")).expect("valid capability");
    let permissions = capability["permissions"]
        .as_array()
        .expect("permissions array");

    assert!(
        permissions
            .iter()
            .any(|permission| permission.as_str() == Some("core:app:allow-version")),
        "the main-window capability must allow Tauri's app version command"
    );
}
