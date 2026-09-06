# Tarab Release Hardening

This file is the release-readiness checklist for the Tauri shell. Keep it updated when commands, windows, capabilities, updater behavior, or desktop integrations change.

The current 1.0.0 proof matrix is in `docs/release-evidence-1.0.0.md`.

## Window and capability matrix

| Capability | Windows | Purpose | Release stance |
| --- | --- | --- | --- |
| `core-main` | `main` | Main-window event listen/unlisten/emit-to routing, Windows window controls, and liquid-glass support/effect access. | Main only. Avoid `core:default` and `core:event:default`; add exact core permissions when a reviewed renderer API needs them. |
| `core-mini` | `mini-player` | Snapshot event listening, the narrow typed native control/seek/snapshot bridge, and mini-window drag. | Mini only. No event emission, minimize, app/menu/tray/image/path/webview defaults, or direct backend/library ownership. Native bridge handlers also require the enabled mini setting, except idempotent hide cleanup. |
| `opener` | `main` | Open the exact Tarab Help URL. | Main only. URL scope is limited to `https://github.com/Faw47/tarab#readme`; renderer path opens and reveals remain denied. App-owned and library reveals use validated custom Rust commands. |
| `dialog` | `main` | Native open dialogs for playlist folders and audio selection. | Main only and `dialog:allow-open` only. Library grants and cover art use Rust-owned picker commands rather than renderer-returned paths. |
| `store` | none | Renderer store access is disabled. | Fixed main-window Rust commands own `settings.json` and `tarab-player.dat`. Mini gets snapshots from main, not persistent ownership. |
| `deep-link` | `main` | Rust reads cold-start URLs and forwards running-instance events. | Main only with empty plugin command permissions. The custom startup command returns only URLs registered for the `tarab` scheme. |
| `shortcuts` | `main` | Register, unregister, and check custom global shortcuts. | Main only and best-effort. Cleanup unregisters only renderer-owned bindings; `unregister-all` is denied so native media keys cannot be removed accidentally. On Linux, the native app menu exclusively owns the default Next/Previous chords; custom alternatives remain renderer-owned. |
| `autostart` | `main` | Read and update open-at-login state from settings. | Main only with explicit is-enabled/enable/disable permissions. Native setup owns initial window visibility, and `--minimized` login launches remain hidden. Mini player must not read or change login startup state. |
| `clipboard` | `main` | Write a plain-text metadata summary from tag editor copy actions. | Main only and write-text only. Do not add clipboard read permission unless a reviewed user-facing paste/import flow needs it. |
| `tray` | `main` | Status icon/menu integration is Rust-owned. macOS uses a transparent template headphone glyph so AppKit supplies the correct light/dark foreground. | Renderer tray permissions are empty. Ordinary tray actions emit `desktop-control-action`; Quit enters native retention/fallback coordination first. |
| `notifications` | `main` | Scan-complete notifications with permission check/request and notify only. | Main only. Do not add action listeners, channels, cancel, batch, or active-notification management unless a reviewed notification workflow needs them. |
| `window-state` | `main` | Persist main window state. | Main only with filename/restore/save permissions. Mini window placement is controlled by desktop integration. |
| `log` | `main`, `mini-player` | Diagnostics. | Shared `allow-log` only. |

## Command inventory summary

The current invoke handler exposes these groups from `src-tauri/src/lib.rs`:

- Audio: playback, seek, volume, speed, crossfade, booster, output devices, gapless preload.
- Library and metadata: bounded scan-path streaming, transactional reconciliation, batch metadata,
  cover art, palettes, and image data. Scan path chunks go only to the main window.
- Lyrics: read/fetch/write/search/sync.
- Playlists: read/create/update/delete/pin/add/remove/reorder/sync/repair/native data-folder reveal. Folder playlist
  creation, edits, and sync require an active native library grant.
- Tag editor: read/write/batch-write/remove cover art.
- Database: track pagination/search/stats/play stats/ratings/delete/path updates/folder deletes/smart shuffle,
  and the ID-only track query used to plan large-library shuffle without loading all metadata at once.
- Image cache and waveform cache: generate/read/stats/clear/cancel.
- File operations: rename/move/recoverable Trash/restore/permanent delete/reveal,
  list/select/revoke native library grants, and resolve native file-open intents. Recoverable
  Trash uses bounded persistent records. Restore validates the token, stored file name, original
  library root, destination conflict, and database update before it removes the recovery record.
  Cross-volume copies are synced to a staging file and claimed without replacement; a persistent
  restore marker resumes safely after interruption.
- Session: load/save playback session.
- Desktop integration: mini window open/close/toggle, the mini-only control/seek/snapshot bridge, focus main, renderer-ready/quit coordination, native UI state, and typed bounded media-session sync.
- Watcher/taskbar/media controls: library path watching, Windows taskbar progress, media metadata.

Release rule: main-window code may call these as needed; mini-player code only consumes main-window
snapshots and sends typed intents through `desktop_mini_control`, `desktop_mini_seek`, and
`desktop_mini_request_snapshot`. The invoke handler grants those three commands only to the mini
window and grants every other custom command only to main. Each mini handler also checks native
`mini_window_enabled` state; disabled state permits only idempotent hide cleanup. Do not widen this
exception when adding commands.

## Filesystem and IPC stance

- Renderer filesystem permission is not enabled. Persistent grants are stored in the app data directory as `library-grants.json`. The Rust native picker is the only normal grant-creation path.
- Settings and player persistence use fixed native store names. The renderer cannot select a store
  path.
- Renderer settings contain a display cache of granted paths. They are not an authority source. Startup replaces that cache from the native grant store.
- Fixed stores and the native grant store recover valid interrupted-write backups instead of
  silently resetting state. Grant mutations remain serialized through persistence.
- File associations create opaque pending intents. **Play once** returns a file-identity-bound
  capability for at most one metadata attempt and one playback attempt; playback consumes it before
  source preparation, including failed decodes. **Import folder** creates a persistent native grant.
  **Cancel** removes the pending intent.
- Drag-and-drop cannot create grants. Files outside current grants are rejected and the user must add their folder through Library settings.
- Library watching uses `watch_library_paths`, which validates paths against native grants before it starts.
- File reads/writes/deletes should stay behind Rust commands that validate paths against configured library roots or app-owned data locations.
- Artwork selection uses a pathless Rust command that opens its own dialog. It bounds the selected
  file, sniffs JPEG/PNG/WebP from bytes, and validates a full thumbnail-pipeline decode; renderer-supplied
  image paths are not accepted.
- Windows tag and lyric replacements use `ReplaceFileW` with write-through and merge-error handling,
  while validation handles allow delete sharing. This keeps atomic recovery behavior compatible with
  normal Windows file access instead of failing with `Access is denied`.
- Cover-art protocol requests validate the hash and size. Cached files must be regular WebP files
  within the size and dimension limits. Source images have encoded-byte and decoded-pixel limits.
- Audio decoding rejects invalid sample rates and unreasonable packet sample allocations.
- Library watcher setup failure should report/log and degrade gracefully; it must not crash startup.
- Smart and folder-synced playlist detail resolution walks indexed tracks in bounded cursor pages rather than materializing the entire library. A cursor restart is retried on concurrent library churn and fails with an actionable sync error after bounded retries.
- File logging preflights the app log file; if an existing log file is not writable, the optional file target is disabled and stdout logging keeps startup alive.
- IPC payloads should stay typed on both sides. Avoid ad-hoc JSON blobs for new commands.
- Media artwork IPC is limited to 8 MiB after base64 decoding, and native code sniffs and completes a
  bounded decode of only JPEG, PNG, or WebP before passing bytes to the OS plugin. The native media
  session is initialized only while media keys are enabled and is released when the setting is
  disabled. Linux/macOS media artwork uses
  unique private temporary files created atomically without following or replacing an existing path;
  replacement, native update failure, clear/disable, and controller drop remove files owned by the adapter.
- Main, tray, Linux app-menu, media-session, and OS close Quit requests are retained natively until the
  renderer action listener is ready. Quit quiesces new session saves, uses bounded persistence waits,
  and has a native fallback if the renderer cannot complete coordination.

## Vendored and git dependencies

- `src-tauri/vendor/tauri-plugin-media` is intentionally patched locally and wired through `[patch.crates-io]`. Preserve local safety patches when upgrading.
- The vendored media plugin owns one transport per platform: Windows SMTC directly, and a Souvlaki
  adapter for macOS remote commands and Linux MPRIS. Do not initialize a parallel media backend.
  Linux CI/release hosts require `libdbus-1-dev` for that transport.
- `tauri-plugin-liquid-glass` remains a git dependency but is pinned to revision `cc549cbc04fe9339266f6b740cf4437ff5e9fb9b` for reproducible builds. Review and update the revision explicitly; do not return it to a floating branch.
- `@tauri-apps/cli` is pinned to `2.11.4`, matching the Rust Tauri 2.11 toolchain. Keep both versions aligned so Tauri can patch bundle-type metadata during packaging.
- Run `cargo tree -d` before release to inspect duplicate dependency versions.
- Run `pnpm audit:dependencies`. The Rust audit is intentionally unfiltered; dependency updates must not add advisory suppressions.
- The CI and release workflows install `cargo-audit 0.22.1`. Update that version deliberately after reviewing its release and lockfile compatibility.
- CI, release verification, and native packaging forward Cargo's `--locked` flag so the checked-in `Cargo.lock` is the dependency resolution used by every gate and installer build.
- Rust 1.92.0 is pinned in `rust-toolchain.toml`; update it deliberately and keep CI aligned.
- pnpm 9 does not consume dependency lifecycle allowlists from `pnpm-workspace.yaml`. Release jobs
  install with all lifecycle scripts disabled, then rebuild only the exact reviewed lockfile versions
  `esbuild@0.27.3` and `@swc/core@1.15.18`. Update the workflow, lockfile, and release checker together.

## Data and cache migration

- The library database and generated caches use the app-specific directory `com.fawaz.tarab`.
- On first launch after upgrading, an existing legacy `music-player` directory is renamed in place before the database or cache is opened.
- Release QA must verify that an existing library, artwork cache, and waveform cache remain available after this migration.
- The track metadata schema migration adds the nullable genre field transactionally, preserves existing track rows, and creates its index idempotently. Upgrade testing must exercise a pre-genre library before creating a genre-filtered smart playlist.
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

As of 2026-09-05, GitHub lists `ubuntu-22.04-arm` and `windows-11-arm` as hosted ARM64 labels; ARM hosted runners remain in public preview. Review the [GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) before each release because GitHub can change images, labels, availability, and installed tools.
The macOS verification uses BSD-compatible `base64 -D` and `find` predicates; do not replace them with GNU-only flags.

### Required release secrets

- Apple: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, and `KEYCHAIN_PASSWORD`.
- Windows: `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`, and the certificate-provider RFC 3161 endpoint in `WINDOWS_TIMESTAMP_URL`.

The workflow fails if required signing material is absent. It does not publish unsigned macOS or Windows packages.
Apple secrets are step-scoped: dependency installation and tests receive none. The temporary release
keychain is created only after those steps, its original search list is restored, and an `always()`
cleanup deletes the keychain immediately after the build attempt.
Windows secrets are scoped only to the signed-build step after dependency installation and tests.
The helper removes the decoded PFX in a `finally` block; an immediate secret-free `always()` cleanup
removes every certificate imported into `CurrentUser\My`, the cleanup manifest, generated signing
configuration, and temporary directory even when import or packaging fails.

### Release workflow guarantees

1. A `vX.Y.Z` tag must match `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. The production JavaScript and Rust dependency audits and the full release gate run before package jobs. Package jobs disable dependency lifecycle scripts, rebuild only the two exact reviewed native JavaScript dependencies, and pass Cargo's `--locked` flag to native packaging.
3. The packaged macOS app is mounted from the DMG. Its nested signatures, hardened-runtime flag, x86_64 and arm64 slices, static `tarab` URL registration, stapled notarization tickets, and Gatekeeper assessment are checked. The DMG signature, ticket, and Gatekeeper assessment are also checked.
4. The macOS and Windows packaging jobs run the Rust backend tests on their native operating systems.
5. The Windows application executable must have the expected x64 or arm64 PE machine type. The application and NSIS installer Authenticode statuses must be `Valid`, and both signatures must have trusted timestamps.
6. Linux AppImage and Debian package architectures must match the x64 or arm64 job. The AppImage must be executable, and `dpkg-deb` must accept the Debian package.
7. Each remote GitHub Action reference in CI and release uses an immutable commit. The release-configuration check rejects mutable tags and branches.
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
4. Reduced effects disables the app-shell WebGL canvas and cover-art backdrop, settles full-player, scan-complete, drag-overlay, and mobile-dock effects, and makes route and mini-player transitions immediate.
5. Mini player reflects main-window state, hides without minimize/destruction, rejects stale-generation seeks, and does not own queue/playback/library state.
6. Discrete tray/menu/media-key actions route through `desktop-control-action`; typed OS timeline and
   volume intents route to the same main coordinator and keep UI/native state synchronized.
7. If release dependencies changed, run `pnpm audit:dependencies`; record unavailable audit tooling explicitly.
8. Test Play once, Import folder, and Cancel from a file association on each platform, including a relative secondary-instance path where supported.
9. Test cold-start and running-instance `tarab://open/search?q=...` links, including reuse of the same link after the short duplicate-suppression window.
10. Test a valid and unknown `tarab://open/play?id=...` opaque track link.
11. Verify open-at-login starts with the main window hidden and rapid setting toggles settle on the latest choice.
12. Verify online lyrics remain off after a pre-1.0 settings upgrade until the user opts in.
13. Verify every release checksum and attestation after downloading the published assets.
14. Confirm that CI compiles and tests the Rust backend on Linux, macOS, and Windows.

The release-configuration check verifies version alignment, the static `tarab` desktop URL scheme,
exact parity with the canonical audio-format registry, absence of renderer reveal capability, the
no-updater policy, the restricted production CSP, Apple and Windows signing-secret scope and
unconditional cleanup, and immutable release-workflow action references.
A macOS bundle must also contain `CFBundleURLTypes`; configuration source alone is not sufficient proof.
