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
6. Frontend playback actions route through `PlaybackCoordinator` in `src/lib/playback-actions.ts`. Source-changing native commands return a monotonic generation. Renderer event handlers must reject events from older generations.

## Persistence

- **Library authority**: Rust owns persistent folder grants in app data file **`library-grants.json`**. The renderer settings list is a display cache only. Library grant creation must use `select_library_folder`; do not restore a renderer command that accepts arbitrary root paths.
- **File associations**: native launches create opaque pending intents. **Play once** grants one exact file until playback opens it; **Import folder** creates a persistent native grant; **Cancel** discards the request.
- **Player session** (queue, position, speed, flags): fixed native store commands persist
  **`tarab-player.dat`**, key **`player-state`** (`src/features/app/player-state-store.ts`). The
  renderer cannot choose a store path. On first load, if that key is empty, the app migrates from
  legacy **`session.json`** using the Rust command `load_playback_session`.
- Player-state writes use a monotonic revision and one serialized latest-wins queue. Do not save
  before hydration completes. Flush queued writes before a native quit.
- **Audio output**: the setting `outputDevice` in `settings-store` is applied to the engine with `set_audio_output_device` (see `list_audio_output_devices` / `enumerate_output_devices` in `audio.rs`). Switching device stops the current stream on the backend.
- **Gapless**: when `gapless` is on and `crossfadeSeconds` is 0, `playback-near-end` triggers `preload_next_track`, which appends the next decoded source to the current `rodio::Sink`. The backend emits `playback-ended` with `{ seamless: true }` on the first sample of the follow-on track; `usePlaybackLifecycle` advances the queue without calling `play_track` again.
- **Library scans**: the renderer sends one `ScanReconcileRequest` after traversal. Rust applies it
  in one transaction and deletes rows only after complete traversal proves they are missing.
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
