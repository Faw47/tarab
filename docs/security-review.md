# Security Review Notes

## Trust Boundaries

Tarab has three primary boundaries:

- Renderer UI: trusted for presentation and user intent, but not for arbitrary filesystem reads or writes.
- Tauri/Rust commands: trusted boundary for scanning, metadata extraction, cache maintenance, database mutation, and path validation.
- External services and OS integrations: LRCLIB/network calls, autostart, global shortcuts, and the Rust library watcher.

## Filesystem Policy

Renderer filesystem access is not enabled. Library watching runs through the Rust `watch_library_paths` command after folders are validated against configured library roots. Text reads, text writes, directory creation, directory listing, stat, exists, watch, and unwatch permissions should stay out of renderer capabilities unless an active UI flow requires them.

File mutation should continue to run through Rust commands that validate the selected library root before deleting database records, writing cache files, or touching local paths. Removing a library folder removes indexed records only and must not delete music files from disk.

## Current Validation Commands

Run these before release-oriented changes:

```sh
pnpm verify:release
pnpm audit --prod
cargo audit
```

`pnpm verify:release` covers TypeScript, Biome, Vitest, production build, Storybook build, Knip, Rust tests, and Rust check. If `cargo audit` is not installed, install it with `cargo install cargo-audit` and rerun the audit, or record that the audit tool was unavailable for that pass.
