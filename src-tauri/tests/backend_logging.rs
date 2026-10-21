// Backend startup diagnostics must reach the configured logger or a persistent fallback log.
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
];


fn direct_stderr_locations() -> Vec<String> {
    RUNTIME_SOURCES
        .iter()
        .flat_map(|(path, source)| {
            source
                .lines()
                .enumerate()
                .filter(|(_, line)| line.contains("eprintln!("))
                .map(move |(line_number, _)| format!("{path}:{}", line_number + 1))
        })
        .collect()
}

#[test]
fn backend_diagnostics_do_not_write_directly_to_stderr() {
    let direct_stderr = direct_stderr_locations();
    assert!(
        direct_stderr.is_empty(),
        "backend diagnostics must use the configured logger or startup fallback log: {}",
        direct_stderr.join(", ")
    );
}

#[test]
fn migration_warnings_are_queued_before_logger_initialization() {
    let migrations = include_str!("../src/database/migrations.rs");
    assert_eq!(
        migrations.matches("queue_early_diagnostic(").count(),
        1,
        "migration warnings should be queued until Tauri installs its logger"
    );
    assert!(
        migrations.contains("Duplicate playlist memberships were collapsed during migration"),
        "the duplicate-membership warning must be preserved"
    );
}

#[test]
fn startup_failures_preserve_early_diagnostics_in_the_fallback_log() {
    let startup_failure = include_str!("../src/startup_failure.rs");
    assert!(
        startup_failure.contains("queue_early_diagnostic(")
            && startup_failure.contains("Failed to prepare Tarab data directory before startup"),
        "early data-directory failures should be queued for later logging"
    );
    assert_eq!(
        startup_failure
            .matches("startup_diagnostics_text(\n        take_early_diagnostics(),")
            .count(),
        2,
        "both pre-Tauri failure paths should persist queued diagnostics with the primary error"
    );
}

#[test]
fn successful_startup_flushes_early_diagnostics_after_logger_setup() {
    let lib = include_str!("../src/lib.rs");
    let flush = lib
        .find("startup_failure::flush_early_diagnostics();")
        .expect("successful startup flushes early diagnostics");
    let run = lib.find("app.run(").expect("Tauri app run");
    assert!(
        flush < run,
        "early diagnostics must flush after app construction installs the logger and before run"
    );
}

#[test]
fn runtime_cache_fallback_uses_the_configured_logger() {
    assert!(
        include_str!("../src/database.rs")
            .contains("log::warn!(\"Could not prepare preferred app directory; using fallback\")"),
        "cache fallback diagnostics should use the configured logger"
    );
}

#[test]
fn configured_tauri_logger_remains_installed() {
    assert!(
        include_str!("../src/lib.rs").contains("tauri_plugin_log::Builder"),
        "the configured Tauri log plugin must remain installed"
    );
}
