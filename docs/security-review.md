# Security Review Notes

## Trust Boundaries

Tarab has three primary boundaries:

- Renderer UI: trusted for presentation and user intent, but not for arbitrary filesystem reads or writes.
- Tauri/Rust commands: trusted boundary for scanning, metadata extraction, cache maintenance, database mutation, and path validation.
- External services and OS integrations: LRCLIB/network calls, autostart, global shortcuts, and the Rust library watcher.

Custom application commands are main-window-only except the exact mini-player control, seek, and
snapshot-request bridge. The invoke handler grants those three commands only to `mini-player`, and
their native handlers require the enabled mini setting in Rust state. Disabled state retains only
idempotent `hide-mini` cleanup. The mini can listen for main-owned snapshots and drag its own window,
but cannot emit arbitrary events, minimize itself, or invoke backend/library commands. The
main-window opener scope permits only the exact Tarab Help URL. Filesystem reveals are native
commands that validate library paths or compute app-owned paths without renderer input.

## Filesystem Policy

Renderer filesystem access is not enabled. Rust native pickers create persistent library grants and read cover art selected through their own dialogs; arbitrary renderer image paths are not accepted. Renderer paths cannot add or widen grants. Library watching runs through `watch_library_paths` after folders are validated against the native grant store. Text reads, text writes, directory creation, directory listing, stat, exists, watch, and unwatch permissions must stay out of renderer capabilities.

Desktop media-session artwork is treated as untrusted IPC input. Rust applies the 8 MiB encoded-byte
boundary, sniffs JPEG/PNG/WebP, and completes a bounded image decode before forwarding bytes to the
OS media plugin.

Embedded artwork is preflighted from container declarations before Lofty 0.21.1 may materialize it.
The preflight covers ID3 APIC/PIC (MP3, AAC, leading FLAC tags, WAV, and AIFF), MP3 APE cover items,
native FLAC pictures and Vorbis-comment pictures, OGG Vorbis `METADATA_BLOCK_PICTURE`/`COVERART`,
and MP4 `covr` data used by M4A and ALAC. A file may materialize at most 25 MiB of cumulative image
payload across 32 pictures; per-picture text/wrapper metadata is limited to 64 KiB and to 1 MiB
cumulatively. The 37,399,212-byte auxiliary limit applies only to a metadata item/container that
Lofty buffers (not to the audio stream or total media-file size).

Format limitations are fail-closed. Cover-art materialization and tag mutation are rejected for
tag-level-unsynchronized ID3v2 tags, ID3v2.3 extended-header tags, and compressed or encrypted ID3
picture frames because Lofty does not expose a trustworthy decoded-picture bound for those cases.
Metadata-only tag reads use Lofty's `read_cover_art(false)` and conservatively report possible art
for the two opaque ID3 tag layouts. Canonical `.ogg` files are limited to Vorbis streams; Opus stored
under an `.ogg` extension is rejected because pinned Lofty dispatches that extension as Vorbis.

File mutation should continue to run through Rust commands that validate the selected library root before deleting database records, writing cache files, or touching local paths. Removing a library folder removes indexed records only and must not delete music files from disk.

Authorized filesystem commands operate on the canonical path they validated while preserving the
logical track path at the renderer boundary. Rename, move, Trash, and restore claim destinations
without replacement. Cross-volume transfers use synced staging files, and restore recovery records
are retained until both the file and database snapshot are restored.

File associations enter a bounded native pending-intent queue. The renderer sees an opaque request
ID and display names. A Play once decision issues a separate opaque capability bound to the selected
file identity. It allows at most one metadata attempt and one playback attempt, is consumed before
source preparation even when decoding fails, and cannot transfer to a replacement at the same path.
An Import folder decision creates a persistent native folder grant.

## Privacy and network access

Tarab has no analytics, crash-reporting, or error-telemetry client. The production CSP does not allow third-party network hosts.

LRCLIB is the only application data service. It is disabled by default and requires explicit opt-in. Requests disclose title, artist, album, and duration. The Rust client rejects redirects and enforces the configured HTTPS endpoint, bounded fields, short timeouts, and a bounded response body.

## Dependency Audit Status

Run `pnpm audit:dependencies` for the reviewed production audit gate. The lockfile now uses `wayland-scanner 0.31.11`, which depends on `quick-xml >=0.41` and removes the two previously reported high RustSec findings. It also uses `event-listener 5.4.2` and `chacha20 0.10.2` to avoid the reported unsound and yanked versions. Keep the Rust audit unfiltered so new vulnerabilities fail the gate. The current full audit reported zero vulnerabilities and 18 allowed non-vulnerability warnings covering transitive maintenance/runtime notices; review those warnings when their upstream dependency paths change.

## Current Validation Commands

Run these before release-oriented changes:

```sh
pnpm verify:release
pnpm audit --prod
cargo audit
```

`pnpm verify:release` covers TypeScript, Biome, Vitest, the IPC contract, the production build, Storybook, Knip, Rust formatting, Rust tests, and strict Clippy. `pnpm audit:dependencies` runs the JavaScript production audit and an unfiltered RustSec audit; the current release evidence was produced with cargo-audit 0.22.1 and reported zero vulnerabilities. A release runner must provide the audit tool and must record any unavailable audit as an explicit release gap.
