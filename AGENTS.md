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
3. Discrete desktop-originated actions (tray/app menu/media keys) route through
   `desktop-control-action` to main. Value-bearing OS timeline/volume intents use typed desktop
   events and are still validated/applied by main.
4. Keep IPC payloads typed on both sides (avoid ad-hoc JSON blobs).
5. Custom Rust commands are main-window-only at the invoke-handler boundary except the exact
   `desktop_mini_control`, `desktop_mini_seek`, and `desktop_mini_request_snapshot` bridge. Those
   commands are mini-window-only and must verify native `mini_window_enabled` state; only
   idempotent `hide-mini` cleanup may remain available after disablement.
6. Frontend playback actions route through `PlaybackCoordinator` in `src/lib/playback-actions.ts`. Source-changing native commands return a monotonic generation. Renderer event handlers must reject events from older generations.
7. `media-formats.json` is the authoritative audio-extension registry. Scanner, watcher, frontend
   picker, and file associations must remain in parity; advertised formats require compiled decoders.
8. Cover-art browsing is a pathless custom Rust command that opens its own dialog and returns
   bounded, sniffed JPEG/PNG/WebP data. Do not restore renderer-supplied image-path reads or opener
   reveal permissions.
9. `player-store.currentTime` is coarse transport state, not a general React render signal. Visible
   time/progress surfaces use the imperative smooth clock (`src/contexts/smooth-time.tsx`) or its
   throttled state hook; do not add direct React subscriptions to `currentTime`.

## Persistence

- **Library authority**: Rust owns persistent folder grants in app data file **`library-grants.json`**. The renderer settings list is a display cache only. Library grant creation must use `select_library_folder`; do not restore a renderer command that accepts arbitrary root paths.
- Grant and fixed-store writes are atomic and recover valid `.bak`/`.tmp` interruption artifacts.
  Keep grant mutations serialized through persistence; never replace recovered state with an empty
  renderer snapshot.
- **File associations**: native launches create opaque pending intents. **Play once** issues an
  opaque file-identity-bound capability for one metadata attempt and one playback attempt; consume
  it before source preparation even when decode fails. **Import folder** creates a persistent native
  grant; **Cancel** discards the request.
- **Player session** (queue, position, speed, flags): fixed native store commands persist
  **`tarab-player.dat`**, key **`player-state`** (`src/features/app/player-state-store.ts`). The
  renderer cannot choose a store path. On first load, if that key is empty, the app migrates from
  legacy **`session.json`** using the Rust command `load_playback_session`.
- Player-state writes use a monotonic revision and one serialized latest-wins queue. Do not save
  before hydration completes. A native quit quiesces session producers, then flushes session,
  player-state, and settings queues with bounded waits. Native code retains quit requests until the
  renderer bridge is ready and has a bounded fallback when the renderer cannot respond.
- **Audio output**: the setting `outputDevice` in `settings-store` is an enumerated device ID and is
  applied with `set_audio_output_device` (see `list_audio_output_devices` /
  `enumerate_output_devices` in `audio.rs`). The command returns the exact installed ID or a typed
  system fallback that must be persisted. Migrate a legacy plain name only when it has one match.
  Switching device stops the current stream on the backend.
- **Gapless**: when `gapless` is on and `crossfadeSeconds` is 0, `playback-near-end` triggers `preload_next_track`, which appends the next decoded source to the current `rodio::Sink`. The backend emits `playback-ended` with `{ seamless: true }` on the first sample of the follow-on track; `usePlaybackLifecycle` advances the queue without calling `play_track` again.
- **Library scans**: the renderer sends one `ScanReconcileRequest` after traversal. Rust applies it
  in one transaction and deletes rows only after complete traversal proves they are missing.
  Native traversal sends paths to the main window in bounded 500-path events. Do not restore one
  unbounded path-array IPC response.
- **Mini player window**: declared in `tauri.conf.json` (`mini-player.html`, 320×92, transparent, undecorated, non-minimizable). `desktop_open_mini_window` shows it and moves it with `tauri-plugin-positioner` (`Position::BottomRight`). Close and `hide-mini` hide the pre-created window; they never destroy or conditionally toggle it. Control, seek, and snapshot bridge commands require both the exact mini label and enabled native setting state; only idempotent `hide-mini` cleanup remains available after disablement. The Vite build includes a second entry (`mini-player.html` → `src/mini-player.tsx`).
- **Library database/cache**: app-owned files use the `com.fawaz.tarab` directory. Existing `music-player` directories migrate in place on first access.
- **Recoverable file removal**: normal disk removal uses app-owned recoverable Trash with one
  persistent token per successful file. Restore must validate the token and original target,
  restore the database snapshot, and retain the recovery record after any partial failure. Keep
  cross-volume transfers staged/no-clobber and preserve the restore-pending marker until recovery
  completes.
- **Playlist retries**: add and reorder commands require a mutation ID. Repeated IDs must return
  the cached `PlaylistDetail` without applying the database mutation again.

## Desktop Integration Notes

- Feature toggles live in `src/store/settings-store.ts`:
  - `desktopStatusIconEnabled`
  - `desktopMediaKeysEnabled`
  - `desktopMiniWindowEnabled`
  - `hideToStatusIconOnClose`
- Media keys/global shortcut registration is best-effort; do not crash app on registration failure.
- Custom shortcut cleanup unregisters only shortcuts owned by the renderer manager. Never use plugin
  `unregister_all`; the plugin process may contain bindings owned by other integrations.
- On Linux, the native app menu owns the default `Ctrl+Alt+Right/Left` Next/Previous chords. The
  renderer global-shortcut manager must reserve those chords while still registering custom alternatives.
- The native media session is claimed lazily while media keys are enabled and released when disabled.
  Artwork bytes must remain bounded and pass a full sniffed JPEG/PNG/WebP decode before reaching the
  OS media plugin.
- Vendored media plugin exists at `src-tauri/vendor/tauri-plugin-media/` and contains local safety patches.
  Windows uses its SMTC implementation; macOS and Linux use one Souvlaki transport adapter for working
  remote-command/MPRIS dispatch. Do not add a second media-session owner.

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
