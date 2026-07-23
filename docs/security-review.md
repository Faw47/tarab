# Security Review Notes

## Trust Boundaries

Tarab has three primary boundaries:

- Renderer UI: trusted for presentation and user intent, but not for arbitrary filesystem reads or writes.
- Tauri/Rust commands: trusted boundary for scanning, metadata extraction, cache maintenance, database mutation, and path validation.
- External services and OS integrations: LRCLIB/network calls, autostart, global shortcuts, and the Rust library watcher.

Custom application commands are main-window-only. The invoke handler rejects every custom command when the invoking window label is not `main`; the mini player uses snapshot/control events and its narrowly scoped plugin capabilities instead.

## Filesystem Policy

Renderer filesystem access is not enabled. The Rust native picker creates persistent library grants. Renderer paths cannot add or widen grants. Library watching runs through `watch_library_paths` after folders are validated against the native grant store. Text reads, text writes, directory creation, directory listing, stat, exists, watch, and unwatch permissions must stay out of renderer capabilities.

File mutation should continue to run through Rust commands that validate the selected library root before deleting database records, writing cache files, or touching local paths. Removing a library folder removes indexed records only and must not delete music files from disk.

File associations enter a bounded native pending-intent queue. The renderer sees an opaque request ID and display names. A Play once decision authorizes only the exact selected file and consumes that authority after playback starts. An Import folder decision creates a persistent native folder grant.

## Privacy and network access

Tarab has no analytics, crash-reporting, or error-telemetry client. The production CSP does not allow third-party network hosts.

LRCLIB is the only application data service. It is disabled by default and requires explicit opt-in. Requests disclose title, artist, album, and duration. The Rust client rejects redirects and enforces the configured HTTPS endpoint, bounded fields, short timeouts, and a bounded response body.

## Dependency Audit Exceptions

Run `pnpm audit:dependencies` for the reviewed production audit gate. The Rust audit currently ignores only `RUSTSEC-2026-0194` and `RUSTSEC-2026-0195` for `quick-xml 0.39.4`: that version is used exclusively by `wayland-scanner 0.31.10` to parse dependency-owned Wayland protocol XML during Linux builds. Tarab does not pass user-controlled XML to it, and no patched `wayland-scanner` release is currently available. Remove both ignores as soon as the upstream scanner moves to `quick-xml >=0.41`.

## Current Validation Commands

Run these before release-oriented changes:

```sh
pnpm verify:release
pnpm audit --prod
cargo audit
```

`pnpm verify:release` covers TypeScript, Biome, Vitest, the IPC contract, the production build, Storybook, Knip, Rust formatting, Rust tests, and strict Clippy. If `cargo audit` is not installed, install it with `cargo install cargo-audit` and rerun the audit, or record that the audit tool was unavailable for that pass.
