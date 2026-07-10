# Tarab Release Hardening

This file is the release-readiness checklist for the Tauri shell. Keep it updated when commands, windows, capabilities, updater behavior, or desktop integrations change.

## Window and capability matrix

| Capability | Windows | Purpose | Release stance |
| --- | --- | --- | --- |
| `core-main` | `main` | Main-window event listen/unlisten/emit-to routing, startup show, Windows window controls, and liquid-glass support/effect access. | Main only. Avoid `core:default` and `core:event:default`; add exact core permissions when a reviewed renderer API needs them. |
| `core-mini` | `mini-player` | Snapshot/control events plus mini-window drag and minimize. | Mini only. No app/menu/tray/image/path/webview defaults and no direct backend/library ownership. |
| `opener` | `main` | Reveal files in the system file manager from reviewed main-window flows. | Main only and reveal-only. Do not add open-url/open-path permission unless a reviewed user-facing flow needs it. |
| `dialog` | `main` | Native open dialogs for folder/audio/image selection. | Main only and `dialog:allow-open` only. Do not add save/message/confirm/ask permissions unless a reviewed flow uses them. |
| `store` | `main` | Player session persistence in `tarab-player.dat`. | Main only with load/get-store/get/set/save. No renderer delete, clear, reset, list, values, entries, length, or reload permissions. Mini gets snapshots from main, not persistent ownership. |
| `deep-link` | `main` | Rust handles `tarab://open` and forwards events; renderer deep-link commands are not exposed. | Main only with empty deep-link command permissions; event listen permission comes from `core-main`. |
| `shortcuts` | `main` | Register, unregister, clear, and check custom global shortcuts. | Main only, exact global-shortcut permissions, and best-effort. Registration failure must log, not abort. |
| `autostart` | `main` | Read and update open-at-login state from settings. | Main only with explicit is-enabled/enable/disable permissions. Mini player must not read or change login startup state. |
| `clipboard` | `main` | Write a plain-text metadata summary from tag editor copy actions. | Main only and write-text only. Do not add clipboard read permission unless a reviewed user-facing paste/import flow needs it. |
| `tray` | `main` | Status icon/menu integration is Rust-owned. | Renderer tray permissions are empty. Tray actions emit `desktop-control-action` from Rust. |
| `notifications` | `main` | Scan-complete notifications with permission check/request and notify only. | Main only. Do not add action listeners, channels, cancel, batch, or active-notification management unless a reviewed notification workflow needs them. |
| `window-state` | `main` | Persist main window state. | Main only with filename/restore/save permissions. Mini window placement is controlled by desktop integration. |
| `log` | `main`, `mini-player` | Diagnostics. | Shared `allow-log` only. |

## Command inventory summary

The current invoke handler exposes these groups from `src-tauri/src/lib.rs`:

- Audio: playback, seek, volume, speed, crossfade, booster, output devices, gapless preload.
- Library and metadata: scan, batch metadata, cover art, palettes, image data.
- Lyrics: read/fetch/write/search/sync.
- Playlists: read/create/update/delete/pin/add/remove/reorder/sync/repair/data-path.
- Tag editor: read/write/batch-write/remove cover art.
- Database: track pagination/search/stats/play stats/ratings/delete/path updates/folder deletes/smart shuffle.
- Image cache and waveform cache: generate/read/stats/clear/cancel.
- File operations: rename/move/delete/reveal/set library roots.
- Session: load/save playback session.
- Desktop integration: mini window open/close/toggle, focus main, quit, native UI state, media session sync.
- Watcher/taskbar/media controls: library path watching, Windows taskbar progress, media metadata.

Release rule: main-window code may call these as needed; mini-player code should only consume main-window snapshots and send playback/control intents. Do not add direct mini-player calls to scan, tag, playlist, database mutation, library watching, dialog, or opener commands.

## Filesystem and IPC stance

- Renderer filesystem permission is not enabled. Library watching uses the Rust `watch_library_paths` command, which validates paths against configured library roots before starting the watcher.
- File reads/writes/deletes should stay behind Rust commands that validate paths against configured library roots or app-owned data locations.
- Artwork/image reads must stay bounded by the allowed-root checks in Rust.
- Library watcher setup failure should report/log and degrade gracefully; it must not crash startup.
- IPC payloads should stay typed on both sides. Avoid ad-hoc JSON blobs for new commands.

## Vendored and git dependencies

- `src-tauri/vendor/tauri-plugin-media` is intentionally patched locally and wired through `[patch.crates-io]`. Preserve local safety patches when upgrading.
- `tauri-plugin-liquid-glass` remains a git dependency but is pinned to revision `cc549cbc04fe9339266f6b740cf4437ff5e9fb9b` for reproducible builds. Review and update the revision explicitly; do not return it to a floating branch.
- Run `cargo tree -d` before release to inspect duplicate dependency versions.
- Run `cargo audit` if available in the release environment; if unavailable, record that it was not run.

## Updater and distribution

- The updater and process plugins are not linked. Add them back only with a reviewed update UI, relaunch flow, signing plan, and update endpoint plan.
- `bundle.createUpdaterArtifacts` is currently `false`; enable it only when the distribution channel, signing keys, update endpoint, updater plugin, process/relaunch flow, and capabilities are selected together.
- Release QA must cover: clean install, upgrade install, offline launch, first-run library selection, file association open, close-to-tray, media keys unavailable, custom shortcuts unavailable, and mini-player disabled/enabled. If updater support is reintroduced, add failed update checks and interrupted update downloads to the QA pass.

## macOS private API

- `macOSPrivateApi` is enabled for the current transparent/overlay shell behavior.
- This can affect App Store-style distribution. If targeting a channel that rejects private APIs, create a separate release profile or disable the dependent visual/window features for that build.
- Optional macOS integrations must degrade gracefully. Objective-C class lookup or media integration failure must log and continue startup.

## Manual release checklist

1. `pnpm verify` passes: TypeScript, Biome check, Vitest, and production UI build.
2. `pnpm verify:release` passes: standard verify, Storybook build, Knip, Rust tests, and Rust check.
3. If desktop shell/capability/window behavior changed, `cargo run --manifest-path src-tauri/Cargo.toml` launches without panic.
4. Reduced effects disables the app-shell WebGL canvas.
5. Mini player reflects main-window state and does not own queue/playback/library state.
6. Tray/menu/media-key actions route through `desktop-control-action` and keep UI state synchronized.
7. If release dependencies changed, run `pnpm audit --prod` and `cargo audit` when available; record unavailable audit tooling explicitly.