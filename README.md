# Tarab

**Tarab** is a local-first desktop music player built with **Tauri 2**, **React 19**, **TypeScript**, and **Rust**. It combines a high-performance native backend with a polished, modern React frontend to deliver fast library browsing, seamless playback control, rich lyrics support, and deep desktop-native integration.

## Key Features

### Playback & Audio
- **Gapless playback** with configurable crossfade
- **Seamless next-track preloading** via Rust `rodio` backend
- **Multiple audio output device** support with hot-switching
- **Media session sync** with OS (now-playing metadata, playback controls)
- **Global media key handling** (play/pause/next/prev) on macOS and Windows

### Desktop Integration
- **Native status icon** (tray on Windows, menu bar on macOS) with playback controls and quick access
- **Always-on-top mini player** window (320×92, transparent, undecorated)
- **App menu integration** with keyboard accelerators for key actions
- **Graceful degradation**: all desktop features are optional and best-effort; app remains fully functional if any integration fails

### Library & Playback
- **Fast tag-based library browsing** with albums, artists, playlists, and custom tags
- **Full-screen lyrics** with time-synced line highlighting
- **Queue management** and playback history
- **Shuffle and repeat modes**
- **Auto-watching file changes** for live library updates

### Persistence & State
- **Local-first design**: all data lives in user-controlled files
- **Player state persistence** via Tauri store (`tarab-player.dat`)
- **Settings storage** for audio device, UI theme, and feature toggles
- **Legacy session migration** from older formats

### UI & Theming
- **Multiple theme modes**: standard themes + strict Neobrutalism variant
- **WebGL-enhanced glass effect** in liquid layout (aurora header strip, metaball background, scan particles)
- **Reduced-motion and reduced-effects awareness** for accessibility
- **Dynamic accent foreground color** with luminance-based readability guards

## Project Structure

```
tarab/
├── src/                              # React + TypeScript frontend
│   ├── main.tsx                      # Main window entry
│   ├── mini-player.tsx               # Mini player window entry
│   ├── components/                   # UI components (TopBar, Player, Library, etc.)
│   ├── features/                     # Feature modules (playback, library, settings)
│   ├── store/                        # Zustand stores (player state, settings, library)
│   ├── styles/                       # App theme stylesheets
│   └── graphics/                     # WebGL shader assets
│
├── src-tauri/                        # Rust backend & Tauri shell
│   ├── src/
│   │   ├── main.rs                   # Native app entry
│   │   ├── lib.rs                    # Tauri app setup & IPC command exports
│   │   ├── audio.rs                  # Audio playback engine (rodio-based)
│   │   ├── library.rs                # File scanning, tag reading, DB
│   │   ├── desktop_integration.rs    # Tray, menu, media keys, media session
│   │   ├── lyrics.rs                 # Lyrics parsing & time-sync
│   │   └── taskbar.rs                # Windows taskbar integration
│   │
│   ├── vendor/tauri-plugin-media/    # Vendored + patched media plugin
│   ├── Cargo.toml
│   └── tauri.conf.json               # Window declarations (main, mini), features, icons
│
├── docs/                             # Design language, QA checklists, architecture notes
└── package.json, pnpm-lock.yaml      # Node dependencies & pnpm lockfile
```

## Architecture Overview

### Main Window as Source of Truth
The main window (`index.html` → `src/main.tsx`) holds all playback, queue, library, and settings state. Desktop surfaces (tray, mini window) are **controlled, read-only snapshots** that send intent back to the main window via typed IPC.

### Rust Backend (`src-tauri/src/`)
- **Playback**: `rodio::Sink`-based streaming with gapless support, device switching, and duration tracking
- **Library**: Fast tag-based scanning and metadata extraction (ID3, Vorbis, etc.)
- **Audio devices**: Enumeration and hot-switching via native OS APIs
- **Desktop shell**: Tray, app menu, global media key registration, media session metadata updates
- **Lyrics**: LRC/inline parsing and time-synced line caching
- **IPC**: Strongly typed command exports to React frontend

### React Frontend (`src/`)
- **Playback UI**: Now playing view with album art, time scrubber, playback controls
- **Library UI**: Grid/list views for albums, artists, playlists, tracks, tags
- **Search & filtering**: Case-insensitive search with scope filters
- **Mini player**: Compact floating window with transport controls
- **Settings**: Theme selection, feature toggles (status icon, media keys, mini window), audio device picker
- **State management**: Zustand for player state, library metadata, settings, UI routing

### WebGL Enhancements (Optional)
The **liquid-glass** layout mounts a single `Canvas` in the app shell with Three.js (R3F) to render:
- Full-window metaball background
- Aurora light strip in the header
- Scan-line particles
- Respects `reducedEffects`, `prefersReducedMotion`, and tab visibility

## Development

### Prerequisites
- **Node.js 22.18.0** (use `nvm use` with the repo `.nvmrc`)
- **pnpm** (see `packageManager` in `package.json`)
- **Rust toolchain** (latest stable)
- **Tauri CLI** (`cargo install tauri-cli`)
- **Platform SDKs**: Xcode (macOS), Visual Studio or MinGW (Windows)

### Setup
```bash
# Use repo-pinned Node version
nvm use

# Install JS dependencies
pnpm install

# Check Rust toolchain
cargo --version
```

### Running

**Desktop app (dev mode with hot reload):**
```bash
pnpm tauri dev
```

**Web UI only (for isolated component development):**
```bash
pnpm dev
```

### Building
```bash
# Build Rust backend and bundle UI
pnpm build:app

# Or separately:
# pnpm build         # Build UI only
# cargo build --manifest-path src-tauri/Cargo.toml
```

### Scripts

- `pnpm test` — Run tests in watch mode

- `pnpm test:run` — Run tests once

- `pnpm tsc --noEmit` — Type-check TypeScript

- `pnpm check:ci` — Run Biome without writing changes

- `pnpm verify` — Run TypeScript, Biome, Vitest, and the production UI build

- `pnpm verify:release` — Run the full release gate: verify, Storybook build, Knip, Rust tests, and Rust check

- `cargo check --manifest-path src-tauri/Cargo.toml` — Type-check Rust

- `pnpm clean` — Remove build/cache artifacts

- `pnpm clean:deep` — Full clean including Cargo target

## Validation Checklist

Before handing off changes:

```bash
# Standard code gate
pnpm verify

# Full release-oriented gate
pnpm verify:release

# Manual startup check when desktop shell, capability, or window behavior changed
cargo run --manifest-path src-tauri/Cargo.toml
```

**Expected behavior:**
- App launches without panic
- If media keys unavailable, a warning is logged but app continues
- Liquid WebGL canvas renders (when reduced-effects is off)
- Status icon, mini window, and menu integrations work as configured

## Design & Theming

- **Standard themes**: Follow `docs/design/design_language.md` for spacing, motion, contrast, glass behavior
- **Neobrutalism theme**: Follow `docs/design/neobrutalism_design.md` for strict high-contrast mechanical style
- **Accent colors**: Use luminance logic to guard readability of dynamic foreground colors
- **WebGL shaders**: Pause animation when tab is hidden; respect reduced-effects and prefersReducedMotion

See `docs/` for detailed design system documentation.

## Known Runtime Notes

- **Vendored media plugin**: `src-tauri/vendor/tauri-plugin-media/` contains local safety patches; do not update without testing
- **Media key best-effort**: On some macOS hosts, global shortcut watcher registration may fail gracefully (warning logged)
- **Audio device switching**: Stops current stream; UI reflects available devices from backend enumeration
- **Startup stability**: All desktop integrations are optional; setup failures do not crash the app


## QA & Documentation

- **Playlist QA checklist**: `docs/playlist-v2-manual-qa.md`
- **Agent guidance**: `AGENTS.md` (for contributors and coding agents)
- **Design language**: `docs/design/design_language.md` and `docs/design/neobrutalism_design.md`
