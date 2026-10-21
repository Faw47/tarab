// Direct stderr is reserved for bootstrap diagnostics emitted before Tauri installs its
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
    (
        "library_watcher.rs",
        include_str!("../src/library_watcher.rs"),
    ),
    ("metadata.rs", include_str!("../src/metadata.rs")),
    ("session.rs", include_str!("../src/session.rs")),
    (
        "startup_failure.rs",
        include_str!("../src/startup_failure.rs"),
    ),
    (
        "vendor/tauri-plugin-media/src/desktop.rs",
        include_str!("../vendor/tauri-plugin-media/src/desktop.rs"),
    ),
    ("shutdown.rs", include_str!("../src/shutdown.rs")),
    ("vibrancy.rs", include_str!("../src/vibrancy.rs")),
];

#[test]
fn runtime_diagnostics_use_the_configured_logger() {
    let direct_stderr: Vec<(String, usize, String)> = RUNTIME_SOURCES
        .iter()
        .flat_map(|(path, source)| {
            source
                .lines()
                .enumerate()
                .filter(|(_, line)| line.contains("eprintln!("))
                .map(move |(line_number, line)| {
                    (path.to_string(), line_number + 1, line.trim().to_string())
                })
        })
        .collect();

    let bootstrap_diagnostics = [
        (
            "database/migrations.rs",
            "Duplicate playlist memberships were collapsed during migration",
        ),
        (
            "startup_failure.rs",
            "Failed to prepare Tarab data directory before startup",
        ),
        ("startup_failure.rs", "{database_error}"),
    ];
    let cache_fallbacks = direct_stderr
        .iter()
        .filter(|(path, _, line)| {
            path.as_str() == "database.rs"
                && line.contains("Could not prepare preferred app directory; using fallback")
        })
        .count();
    let migration_warnings = direct_stderr
        .iter()
        .filter(|(path, _, line)| {
            path.as_str() == "database/migrations.rs"
                && line.contains("Duplicate playlist memberships were collapsed during migration")
        })
        .count();
    let unexpected_stderr: Vec<String> = direct_stderr
        .iter()
        .filter(|(path, _, line)| {
            !bootstrap_diagnostics.iter().any(|(allowed_path, marker)| {
                path.as_str() == *allowed_path && line.contains(*marker)
            })
        })
        .map(|(path, line_number, _)| format!("{path}:{line_number}"))
        .collect();

    assert_eq!(
        cache_fallbacks, 0,
        "runtime cache fallback diagnostics must not write to stderr"
    );
    assert!(
        include_str!("../src/database.rs")
            .contains("log::warn!(\"Could not prepare preferred app directory; using fallback\")"),
        "cache fallback diagnostics should use the configured logger"
    );
    assert_eq!(
        migration_warnings, 1,
        "the pre-logger database migration should retain one generic bootstrap diagnostic"
    );
    assert!(
        unexpected_stderr.is_empty(),
        "runtime diagnostics must use the configured logger instead of stderr: {}",
        unexpected_stderr.join(", ")
    );
    assert!(
        include_str!("../src/lib.rs").contains("tauri_plugin_log::Builder"),
        "the configured Tauri log plugin must remain installed"
    );
}
