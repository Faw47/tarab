// Direct stderr is kept only for bootstrap failures that occur before Tauri installs its
// logger. Runtime diagnostics should use the configured tauri-plugin-log target.
const RUNTIME_SOURCES: &[(&str, &str)] = &[
    ("audio.rs", include_str!("../src/audio.rs")),
    ("audio/device.rs", include_str!("../src/audio/device.rs")),
    ("audio/source.rs", include_str!("../src/audio/source.rs")),
    ("database.rs", include_str!("../src/database.rs")),
    (
        "database/migrations.rs",
        include_str!("../src/database/migrations.rs"),
    ),
    (
        "desktop_integration.rs",
        include_str!("../src/desktop_integration.rs"),
    ),
    (
        "launch_intents.rs",
        include_str!("../src/launch_intents.rs"),
    ),
    ("lib.rs", include_str!("../src/lib.rs")),
    ("library.rs", include_str!("../src/library.rs")),
    ("library_watcher.rs", include_str!("../src/library_watcher.rs")),
    ("metadata.rs", include_str!("../src/metadata.rs")),
    ("session.rs", include_str!("../src/session.rs")),
    ("shutdown.rs", include_str!("../src/shutdown.rs")),
    ("vibrancy.rs", include_str!("../src/vibrancy.rs")),
];

#[test]
fn runtime_diagnostics_use_the_configured_logger() {
    let direct_stderr: Vec<String> = RUNTIME_SOURCES
        .iter()
        .flat_map(|(path, source)| {
            source
                .lines()
                .enumerate()
                .filter(|(_, line)| line.contains("eprintln!("))
                .map(move |(line, _)| format!("{path}:{}", line + 1))
        })
        .collect();

    assert!(
        direct_stderr.is_empty(),
        "runtime diagnostics must use the configured logger instead of stderr: {}",
        direct_stderr.join(", ")
    );
    assert!(
        include_str!("../src/lib.rs").contains("tauri_plugin_log::Builder"),
        "the configured Tauri log plugin must remain installed"
    );
}
