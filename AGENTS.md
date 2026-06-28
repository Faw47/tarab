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

## Persistence

- **Player session** (queue, position, speed, flags): the main window persists via `@tauri-apps/plugin-store` file **`tarab-player.dat`**, key **`player-state`** (`src/features/app/player-state-store.ts`). On first load, if that key is empty, the app migrates from legacy **`session.json`** using the Rust command `load_playback_session`.
- **Audio output**: the setting `outputDevice` in `settings-store` is applied to the engine with `set_audio_output_device` (see `list_audio_output_devices` / `enumerate_output_devices` in `audio.rs`). Switching device stops the current stream on the backend.
- **Gapless**: when `gapless` is on and `crossfadeSeconds` is 0, `playback-near-end` triggers `preload_next_track`, which appends the next decoded source to the current `rodio::Sink`. The backend emits `playback-ended` with `{ seamless: true }` on the first sample of the follow-on track; `usePlaybackLifecycle` advances the queue without calling `play_track` again.
- **Mini player window**: declared in `tauri.conf.json` (`mini-player.html`, 320×92, transparent, undecorated). `desktop_open_mini_window` shows it and moves it with `tauri-plugin-positioner` (`Position::BottomRight`). The Vite build includes a second entry (`mini-player.html` → `src/mini-player.tsx`).

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
- **Exceptions:** [`TiltAlbumArt`](src/components/player/TiltAlbumArt.tsx) and the mini-player HTML entry keep separate canvases / no shell layer.
- [`LiquidBg`](src/components/ui/liquid-glass.tsx) remains a **standalone** full-viewport option (second context) for demos or embeds; the main window uses the shell instead.
- Respect **`reducedEffects`**, **`usePrefersReducedMotion`**, and **`document.visibilityState`** (shader time pauses when hidden; reduced motion / effects unmount the shell canvas). Drag uses `data-tauri-drag-region` above the WebGL layer (`TopBar` content stays `z-10` over `z-0`).
- **Do not** add full-window post chains or render-target refraction of HTML here without an explicit product decision (cost and maintenance).

## Validation Checklist (before handing off)

Run:

```bash
pnpm -s tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
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
- this `AGENTS.md` when workflow or architecture expectations change.
