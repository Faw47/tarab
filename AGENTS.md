# AGENTS.md

Guidance for contributors and coding agents working in this repository.

## Scope

This project is a Tauri desktop app with a React frontend and Rust backend.

- Frontend: `src/`
- Backend: `src-tauri/src/`
- Desktop integration shell: `src-tauri/src/desktop_integration.rs`

## Toolchain

- Use the repo-pinned Node runtime from `.nvmrc` (`v22.18.0`) before JS dependency changes:
  - `nvm use`
- Package manager is `pnpm` (see `packageManager` in `package.json`).

## Core Architecture Rules

1. Main window state is the source of truth.
2. Mini window is a controlled surface (snapshot + control intents), not a state owner.
3. Desktop-originated actions (tray/app menu/media keys) should route through `desktop-control-action` to main window.
4. Keep IPC payloads typed on both sides (avoid ad-hoc JSON blobs).
5. All custom Rust commands are main-window-only at the invoke-handler boundary. Mini-player behavior must use typed snapshot/control events, not direct custom command calls.
6. Frontend playback actions route through `PlaybackCoordinator` in `src/lib/playback-actions.ts`. Source-changing native commands return a monotonic generation. Renderer event handlers must reject events from older generations. Commands that replace or stop the source (play, stop, adjacent track, editor preview) call `notePlaybackIntervention()`; a crossfade the renderer requested before the latest intervention is stale. Seek and device switches do not, because the backend applies them to the incoming crossfade source.

## Persistence

- **Library authority**: Rust owns persistent folder grants in app data file **`library-grants.json`**. The renderer settings list is a display cache only. Library grant creation must use `select_library_folder`; do not restore a renderer command that accepts arbitrary root paths.
- **File associations**: native launches create opaque pending intents. **Play once** grants one exact file until playback opens it; **Import folder** creates a persistent native grant; **Cancel** discards the request.
- **Player session** (queue, position, speed, flags): fixed native store commands persist the
  small state in **`tarab-player.dat`**, key **`player-state`**, and the queue IDs in
  **`tarab-player-queue.dat`**, key **`queue`** (`src/features/app/player-state-store.ts`). The
  queue is written only when it changes, so position saves stay small; sessions saved before the
  split keep the queue inline and move it on the next save. The renderer cannot choose a store
  path. On first load, if that key is empty, the app migrates from
  legacy **`session.json`** using the Rust command `load_playback_session`.
- Player-state writes use a monotonic revision and one serialized latest-wins queue. Do not save
  before hydration completes. On quit, call the session hook's fresh save, then drain queued writes
  before `desktop_quit_application`. An explicit save failure cancels native quit and shows the
  main window for retry. `shutdown.rs` keeps the renderer alive for native exits and real window
  closes; hide-to-tray is not a quit. A stalled renderer has a ten-second native exit fallback.
  Retried requests must use the latest session-save callback, including navigation and album state.
- Fixed stores cap reads and serialized writes at 64 MiB, use the shared synced atomic replacement
  helper, and read a legacy Windows `.bak` only when the primary is missing.
- New library selections and reauthorization reject filesystem roots and the bare home directory
  after canonicalization. Existing grants remain intact. File-open consent shows the full parent
  path; a rejected Import folder must leave Play once available.
- **Online lyrics**: every LRCLIB request checks the persisted native `tarab-settings.state.autoLyrics` boolean under the fixed-store lock. Missing/invalid settings fail closed. Local sidecars do not require network consent. Automatic lookup waits for pending settings writes; reqwest errors must omit request URLs containing track metadata.
- **File manager actions**: renderer opener permission covers only the exact Help URL. Track reveal validates native library grants. Playlist repair uses `reveal_playlists_data_folder`, which derives the app-owned directory and accepts no renderer path. Do not restore renderer reveal/open-path permissions.
- **Audio output**: the setting `outputDevice` in `settings-store` is applied to the engine with `set_audio_output_device` (see `list_audio_output_devices` / `enumerate_output_devices` in `audio.rs`). Switching device stops the current stream on the backend. The audio thread reopens output the same way (`RecoverOutput`) when the sample counter stops for 2 s while playing (device removed) and, on Windows while following the system default, when the default device name changes. If that reopen fails, the backend stops playback and drops the stream, so the next Play opens a fresh one.
- **Gapless**: when `gapless` is on and `crossfadeSeconds` is 0, `playback-near-end` triggers `preload_next_track`, which appends the next decoded source to the current `rodio::Sink`. The backend emits `playback-ended` with `{ seamless: true }` on the first sample of the follow-on track; `usePlaybackLifecycle` advances the queue without calling `play_track` again.
- **Library scans**: the renderer sends one `ScanReconcileRequest` after traversal. Rust applies it
  in one transaction and deletes rows only after complete traversal proves they are missing.
  Unreadable entries below the scan root are skipped and reported (`traversalErrors`); the
  renderer then sends `traversalComplete: false`.
  Native traversal sends paths to the main window in bounded 500-path events. Do not restore one
  unbounded path-array IPC response.
- **Mini player window**: declared in `tauri.conf.json` (`mini-player.html`, 320×92, transparent, undecorated). `desktop_open_mini_window` shows it and moves it with `tauri-plugin-positioner` (`Position::BottomRight`). The Vite build includes a second entry (`mini-player.html` → `src/mini-player.tsx`).
- **Library database/cache**: app-owned files use the `com.fawaz.tarab` directory. Existing `music-player` directories migrate in place on first access.
- **Recoverable file removal**: normal disk removal uses app-owned recoverable Trash with one
  persistent token per successful file. Restore must validate the token and original target,
  restore the database snapshot, and retain the recovery record after any partial failure.
- **Playlist retries**: add and reorder commands require a mutation ID. Repeated IDs must return
  the cached `PlaylistDetail` without applying the database mutation again.

## Desktop Integration Notes

- Feature toggles live in `src/store/settings-store.ts`:
  - `desktopStatusIconEnabled`
  - `desktopMediaKeysEnabled`
  - `desktopMiniWindowEnabled`
  - `hideToStatusIconOnClose`
- Media keys/global shortcut registration is best-effort; do not crash app on registration failure.
- The main window sets `backgroundThrottling: "disabled"` because its renderer owns queue advance, media-key handling and tray quit while hidden to the status icon. Keep it; `scripts/check-release-config.mjs` enforces it (effective on macOS 14+, unsupported by Tauri on Windows and Linux).
- The main window starts with `visible: false` to avoid flashing on login. `useAppStartupEffects` shows ordinary launches after checking the native `--minimized` flag; autostart stays hidden only if the persisted status icon is enabled. If settings hydration stalls for 3 s or the native status icon is unavailable, show the window rather than trapping the user in a hidden app. Secondary launches focus the existing window. Do not restore an unconditional startup show.
- Vendored media plugin exists at `src-tauri/vendor/tauri-plugin-media/` and contains local safety patches.

## When Editing Rust Desktop Shell Code

- Preserve startup stability: setup failures for optional integrations should degrade gracefully.
- Avoid panics from Objective-C class lookups in macOS media handling.
- Prefer logging + fallback over failing app bootstrap.

## When Editing UI

- Follow `docs/design/design_language.md` for spacing, motion, contrast, and glass behavior in standard themes.
- Follow `docs/design/neobrutalism_design.md` for the Neobrutalism theme to maintain strict high-contrast and mechanical standards.
- For dynamic accent foreground colors, guard readability with luminance logic.
- Maintain reduced-effects behavior gates where present.

## Liquid app-shell WebGL (single canvas)

- In the **liquid-glass** layout only, [`AppShellLiquidWebGL`](src/components/shell/AppShellLiquidWebGL.tsx) mounts **one** fixed, orthographic R3F `Canvas` (`pointer-events: none`, `z-0`): full-viewport metaball background plus the top-bar aurora strip and scan particles in the same GL context. [`TopBar`](src/components/navigation/TopBar.tsx) no longer embeds its own canvas; it feeds normalized header pointer + search focus into the shell via props/refs from [`App`](src/App.tsx). CSS `backdrop-filter` on the header remains the primary glass; shaders add motion (not DOM refraction).
- **Exception:** The mini-player HTML entry keeps its separate rendering surface.
- [`LiquidBg`](src/components/ui/liquid-glass.tsx) remains a **standalone** full-viewport option (second context) for demos or embeds; the main window uses the shell instead.
- The shell renders on demand at 30 fps (`ShellFrameTicker`, `frameloop="demand"`) and DPR 1, with no frames while paused. The camera has an explicit -1..1 frustum (R3F's default orthographic frustum is in pixels), and palette colors reach the shaders unlinearized (`shaderColor`). When **Animated background** is on, `LiquidHomeAmbientBackdrop` sits above the canvas without its opaque base (`overShell`), so the metaballs show through it.
- Respect **`reducedEffects`**, **`usePrefersReducedMotion`**, and **`document.visibilityState`** (shader time pauses when hidden; reduced motion / effects unmount the shell canvas). Drag uses `data-tauri-drag-region` above the WebGL layer (`TopBar` content stays `z-10` over `z-0`).
- **Do not** add full-window post chains or render-target refraction of HTML here without an explicit product decision (cost and maintenance).

## Validation Checklist (before handing off)

Run:

```bash
pnpm -s tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
```

If settings primitives, shared UI states, or theme tokens changed, also run:

```bash
pnpm build:storybook
```

If desktop shell changes were made, also run:

```bash
cargo run --manifest-path src-tauri/Cargo.toml
```

Expected startup behavior:

- App should launch without panic.
- If media keys are unavailable, a warning may be logged but app must continue running.

Liquid shell WebGL (optional manual check):

- With **Reduced effects** off: full-window liquid background plus header aurora; search focus and scroll slightly change the header; finishing a library scan can trigger a short particle burst.
- With **Reduced effects** or system **reduce motion** on: no app-shell WebGL canvas (CSS glass / solid fallback only).
- Window backgrounded: shader time should not advance while `document.hidden`.

## Documentation Hygiene

If behavior changes (desktop controls, window lifecycle, settings, motion/contrast standards), update:

- `README.md`
- `docs/design/design_language.md`
- `docs/release-hardening.md` for release permissions, updater, dependency, or desktop-shell risk changes.
- this `AGENTS.md` when workflow or architecture expectations change.
