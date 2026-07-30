# Tarab Release Hardening

This file is the release-readiness checklist for the Tauri shell. Keep it updated when commands, windows, capabilities, updater behavior, or desktop integrations change.

The current 1.0.0 proof matrix is in `docs/release-evidence-1.0.0.md`.

## Window and capability matrix

| Capability | Windows | Purpose | Release stance |
| --- | --- | --- | --- |
| `core-main` | `main` | Main-window event listen/unlisten/emit-to routing, startup show, Windows window controls, and liquid-glass support/effect access. | Main only. Avoid `core:default` and `core:event:default`; add exact core permissions when a reviewed renderer API needs them. |
| `core-mini` | `mini-player` | Snapshot/control events plus mini-window drag and minimize. | Mini only. No app/menu/tray/image/path/webview defaults and no direct backend/library ownership. |
| `opener` | `main` | Reveal files in the system file manager from reviewed main-window flows. | Main only and reveal-only. Do not add open-url/open-path permission unless a reviewed user-facing flow needs it. |
| `dialog` | `main` | Native open dialogs for library grants, playlist folders, audio, and image selection. | Main only and `dialog:allow-open` only. Library authority is created by the Rust picker command, not by a renderer path. |
| `store` | none | Renderer store access is disabled. | Fixed main-window Rust commands own `settings.json` and `tarab-player.dat`. Mini gets snapshots from main, not persistent ownership. |
| `deep-link` | `main` | Rust reads cold-start URLs and forwards running-instance events. | Main only with empty plugin command permissions. The custom startup command returns only URLs registered for the `tarab` scheme. |
| `shortcuts` | `main` | Register, unregister, clear, and check custom global shortcuts. | Main only, exact global-shortcut permissions, and best-effort. Registration failure must log, not abort. |
| `autostart` | `main` | Read and update open-at-login state from settings. | Main only with explicit is-enabled/enable/disable permissions. Mini player must not read or change login startup state. |
| `clipboard` | `main` | Write a plain-text metadata summary from tag editor copy actions. | Main only and write-text only. Do not add clipboard read permission unless a reviewed user-facing paste/import flow needs it. |
| `tray` | `main` | Status icon/menu integration is Rust-owned. macOS uses a transparent template headphone glyph so AppKit supplies the correct light/dark foreground. | Renderer tray permissions are empty. Tray actions emit `desktop-control-action` from Rust. |
| `notifications` | `main` | Scan-complete notifications with permission check/request and notify only. | Main only. Do not add action listeners, channels, cancel, batch, or active-notification management unless a reviewed notification workflow needs them. |
| `window-state` | `main` | Persist main window state. | Main only with filename/restore/save permissions. Mini window placement is controlled by desktop integration. |
| `log` | `main`, `mini-player` | Diagnostics. | Shared `allow-log` only. |

## Command inventory summary

The current invoke handler exposes these groups from `src-tauri/src/lib.rs`:

- Audio: playback, seek, volume, speed, crossfade, booster, output devices, gapless preload.
- Library and metadata: bounded scan-path streaming, transactional reconciliation, batch metadata,
  cover art, palettes, and image data. Scan path chunks go only to the main window.
- Lyrics: read/fetch/write/search/sync.
- Playlists: read/create/update/delete/pin/add/remove/reorder/sync/repair/data-path. Folder playlist
  creation, edits, and sync require an active native library grant.
- Tag editor: read/write/batch-write/remove cover art.
- Database: track pagination/search/stats/play stats/ratings/delete/path updates/folder deletes/smart shuffle.
- Image cache and waveform cache: generate/read/stats/clear/cancel.
- File operations: rename/move/recoverable Trash/restore/permanent delete/reveal,
  list/select/revoke native library grants, and resolve native file-open intents. Recoverable
  Trash uses bounded persistent records. Restore validates the token, stored file name, original
  library root, destination conflict, and database update before it removes the recovery record.
- Session: load/save playback session.
- Desktop integration: mini window open/close/toggle, focus main, quit, native UI state, media session sync.
- Watcher/taskbar/media controls: library path watching, Windows taskbar progress, media metadata.

Release rule: main-window code may call these as needed; mini-player code should only consume main-window snapshots and send playback/control intents. The application invoke handler enforces this by rejecting every custom command from non-main windows. Do not bypass that boundary when adding commands.

## Filesystem and IPC stance

- Renderer filesystem permission is not enabled. Persistent grants are stored in the app data directory as `library-grants.json`. The Rust native picker is the only normal grant-creation path.
- Settings and player persistence use fixed native store names. The renderer cannot select a store
  path.
- Renderer settings contain a display cache of granted paths. They are not an authority source. Startup replaces that cache from the native grant store.
- File associations create opaque pending intents. **Play once** authorizes one exact file until playback opens it. **Import folder** creates a persistent native grant. **Cancel** removes the pending intent.
- Drag-and-drop cannot create grants. Files outside current grants are rejected and the user must add their folder through Library settings.
- Library watching uses `watch_library_paths`, which validates paths against native grants before it starts.
- File reads/writes/deletes should stay behind Rust commands that validate paths against configured library roots or app-owned data locations.
- Artwork/image reads must stay bounded by the allowed-root checks in Rust.
- Cover-art protocol requests validate the hash and size. Cached files must be regular WebP files
  within the size and dimension limits. Source images have encoded-byte and decoded-pixel limits.
- Audio decoding rejects invalid sample rates and unreasonable packet sample allocations.
- Library watcher setup failure should report/log and degrade gracefully; it must not crash startup.
- IPC payloads should stay typed on both sides. Avoid ad-hoc JSON blobs for new commands.

## Vendored and git dependencies

- `src-tauri/vendor/tauri-plugin-media` is intentionally patched locally and wired through `[patch.crates-io]`. Preserve local safety patches when upgrading.
- `tauri-plugin-liquid-glass` remains a git dependency but is pinned to revision `cc549cbc04fe9339266f6b740cf4437ff5e9fb9b` for reproducible builds. Review and update the revision explicitly; do not return it to a floating branch.
- Run `cargo tree -d` before release to inspect duplicate dependency versions.
- Run `pnpm audit:dependencies`. Its two RustSec ignores are documented in `docs/security-review.md` and must not grow without an exploitability review and removal condition.
- The release workflow installs `cargo-audit 0.22.1`. Update that version deliberately after reviewing its release and lockfile compatibility.
- Rust 1.92.0 is pinned in `rust-toolchain.toml`; update it deliberately and keep CI aligned.

## Data and cache migration

- The library database and generated caches use the app-specific directory `com.fawaz.tarab`.
- On first launch after upgrading, an existing legacy `music-player` directory is renamed in place before the database or cache is opened.
- Release QA must verify that an existing library, artwork cache, and waveform cache remain available after this migration.
- Packaged-app QA must cold-launch the `.app`, open the full player, verify embedded art, restart,
  disconnect the source grant, and verify that the validated app-owned thumbnail remains visible.

## Privacy and outbound network policy

- Tarab has no analytics, crash-reporting, or error-telemetry client.
- The production CSP allows only same-origin connections.
- Online LRCLIB access is off by default. Upgrades from pre-1.0 settings reset this setting to off so that the user must opt in.
- The settings description identifies the metadata sent to LRCLIB: title, artist, album, and duration.
- LRCLIB requests use HTTPS, reject redirects, enforce endpoint, field, connection-time, total-time, content-length, and streamed-body limits.

## Updater and distribution

- The updater and process plugins are not linked. Add them back only with a reviewed update UI, relaunch flow, signing plan, and update endpoint plan.
- `bundle.createUpdaterArtifacts` is currently `false`; enable it only when the distribution channel, signing keys, update endpoint, updater plugin, process/relaunch flow, and capabilities are selected together.
- Release QA must cover: clean install, upgrade install, offline launch, first-run library selection, file association open, close-to-tray, media keys unavailable, custom shortcuts unavailable, and mini-player disabled/enabled. If updater support is reintroduced, add failed update checks and interrupted update downloads to the QA pass.

### Release targets

| Platform | Runner | Output | Minimum supported system |
| --- | --- | --- | --- |
| macOS Universal 2 | `macos-15` | Signed and notarized DMG | macOS 12 |
| Windows x64 | `windows-2022` | Signed NSIS installer | Windows 10 22H2 |
| Windows arm64 | `windows-11-arm` | Signed NSIS installer | Windows 10 22H2 on arm64 |
| Linux x64 | `ubuntu-22.04` | AppImage and Debian package | Ubuntu 22.04 or Debian 12 |
| Linux arm64 | `ubuntu-22.04-arm` | AppImage and Debian package | Ubuntu 22.04 or Debian 12 |

The arm64 Linux and Windows labels are standard GitHub-hosted runner labels. Review the current GitHub-hosted runner reference before each release because GitHub can change images, labels, and installed tools.

### Required release secrets

- Apple: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, and `KEYCHAIN_PASSWORD`.
- Windows: `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`, and the certificate-provider RFC 3161 endpoint in `WINDOWS_TIMESTAMP_URL`.

The workflow fails if required signing material is absent. It does not publish unsigned macOS or Windows packages.

### Release workflow guarantees

1. A `vX.Y.Z` tag must match `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. The production JavaScript and Rust dependency audits and the full release gate run before package jobs.
3. The packaged macOS app is mounted from the DMG. Its nested signatures, hardened-runtime flag, x86_64 and arm64 slices, static `tarab` URL registration, stapled notarization tickets, and Gatekeeper assessment are checked. The DMG signature, ticket, and Gatekeeper assessment are also checked.
4. The macOS and Windows packaging jobs run the Rust backend tests on their native operating systems.
5. The Windows application executable must have the expected x64 or arm64 PE machine type. The application and NSIS installer Authenticode statuses must be `Valid`, and both signatures must have trusted timestamps.
6. Linux AppImage and Debian package architectures must match the x64 or arm64 job. The AppImage must be executable, and `dpkg-deb` must accept the Debian package.
7. Each remote GitHub Action reference uses an immutable commit. The release-configuration check rejects mutable tags and branches.
8. Each installer and package is uploaded as a workflow artifact.
9. The publish job rejects duplicate asset names, stages one flat release directory, creates and verifies `SHA256SUMS.txt`, creates GitHub build-provenance attestations, and uploads the same staged files to the GitHub release.

## macOS private API

- `macOSPrivateApi` is enabled for the current transparent/overlay shell behavior.
- This can affect App Store-style distribution. If targeting a channel that rejects private APIs, create a separate release profile or disable the dependent visual/window features for that build.
- Optional macOS integrations must degrade gracefully. Objective-C class lookup or media integration failure must log and continue startup.

## Manual release checklist

1. `pnpm verify` passes: TypeScript, Biome check, Vitest, and production UI build.
2. `pnpm verify:release` passes: standard verify, Storybook build, Knip, release configuration, Rust formatting, Rust tests, and strict Clippy.
3. If desktop shell/capability/window behavior changed, `cargo run --manifest-path src-tauri/Cargo.toml` launches without panic.
4. Reduced effects disables the app-shell WebGL canvas.
5. Mini player reflects main-window state and does not own queue/playback/library state.
6. Tray/menu/media-key actions route through `desktop-control-action` and keep UI state synchronized.
7. If release dependencies changed, run `pnpm audit:dependencies`; record unavailable audit tooling explicitly.
8. Test Play once, Import folder, and Cancel from a file association on each platform.
9. Test cold-start and running-instance `tarab://open/search?q=...` links.
10. Test a valid and unknown `tarab://open/play?id=...` opaque track link.
11. Verify online lyrics remain off after a pre-1.0 settings upgrade until the user opts in.
12. Verify every release checksum and attestation after downloading the published assets.
13. Confirm that CI compiles and tests the Rust backend on Linux, macOS, and Windows.

The release-configuration check verifies version alignment, the static `tarab` desktop URL scheme, all supported audio file associations, the no-updater policy, the restricted production CSP, and immutable release-workflow action references. A macOS bundle must also contain `CFBundleURLTypes`; configuration source alone is not sufficient proof.
