# Security Review Notes

## Trust Boundaries

Tarab has three primary boundaries:

- Renderer UI: trusted for presentation and user intent, but not for arbitrary filesystem reads or writes.
- Tauri/Rust commands: trusted boundary for scanning, metadata extraction, cache maintenance, database mutation, and path validation.
- External services and OS integrations: LRCLIB/network calls, desktop updater, autostart, global shortcuts, and filesystem watchers.

## Filesystem Policy

Renderer filesystem access is limited to watch/unwatch permissions for user library folders. Text reads, text writes, directory creation, directory listing, stat, and exists permissions should stay out of renderer capabilities unless an active UI flow requires them.

File mutation should continue to run through Rust commands that validate the selected library root before deleting database records, writing cache files, or touching local paths. Removing a library folder removes indexed records only and must not delete music files from disk.

## Current Validation Commands

Run these before release-oriented changes:

```sh
pnpm audit --prod
cargo audit
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

If `cargo audit` is not installed, install it with `cargo install cargo-audit` and rerun the audit.
