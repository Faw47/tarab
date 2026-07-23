<p align="center">
  <img src="src-tauri/icons/app-icon-source.png" width="128" height="128" alt="Tarab app icon">
</p>

<h1 align="center">Tarab</h1>

<p align="center">
  A private desktop music player with a serious library, a lyrics-first player, and a designed interface.
</p>

Tarab gives your local music the care of a premium music app. You get album-first browsing, smart and folder-synced playlists, full-screen timed lyrics, native desktop controls, and two complete visual systems in one app.

Your files and library data stay on your computer. Tarab runs on macOS, Windows, and Linux. It needs no account and ships without analytics, crash reporting, or error telemetry.

![Tarab Home view in the Liquid Glass theme](docs/screenshots/tarab-home-liquid-glass.jpg)

## The Tarab combination

Other local players excel at library maintenance, audio tools, or customization. Tarab brings collection depth, playback, lyrics, desktop control, and interface design into one coherent product.

### Your library has structure

Tarab turns folders into an album and artist library. Search covers track metadata and lyric text. You can fix tags, rate tracks, inspect play counts, and keep missing files visible until you resolve them.

Three playlist types cover different jobs:

- **Manual playlists** give you full control over selection and order.
- **Smart playlists** use rules to build a collection from your metadata.
- **Folder Sync playlists** follow the contents of a folder.

Tarab watches approved folders and refreshes the library when files change.

### Lyrics belong in the player

Tarab reads embedded lyrics and local sidecar files. The full-screen player highlights timed lines and lets artwork shape the background. You control lyric size, alignment, blur, and background motion.

You can enable LRCLIB lookup for tracks with no local lyrics. Tarab keeps that network option off until you choose it.

### Playback reaches the whole desktop

The Rust audio engine supports gapless playback, next-track preloading, crossfade, speed control, and audio output selection.

You can control Tarab through hardware media keys, custom global shortcuts, the app menu, or the system status icon. The compact always-on-top player keeps transport controls above your work. File associations and `tarab://` links can send a track or library search into the app.

### The interface has two complete identities

Liquid Glass uses artwork color, soft depth, restrained WebGL motion, and glass controls. Neobrutalism rebuilds the same product with hard borders, mechanical controls, paper textures, and high-contrast signals.

These themes change navigation, cards, dialogs, settings, the player, and motion. Tarab also respects Reduced Effects and the operating system motion preference.

### Privacy controls the architecture

The native backend grants access to folders you select. Renderer code cannot grant itself a path. File-association requests use bounded **Play once**, **Import folder**, and **Cancel** choices.

Tarab stores its database, playlists, settings, and player session on your computer. Offline playback and library work make no network request. Auto-fetch lyrics sends track metadata to LRCLIB after you enable it.

## The actual interface

These screenshots come from the running macOS app.

### Album-first library

The library combines artwork, facets, sorting, search, tag tools, and a persistent player bar.

![Tarab album library in the Liquid Glass theme](docs/screenshots/tarab-library-liquid-glass.jpg)

### Neobrutalism

Neobrutalism changes the full visual system while it keeps the same library and playback model.

![Tarab Home view in the Neobrutalism theme](docs/screenshots/tarab-home-neobrutalism.jpg)

## Where Tarab fits

| Player | Product focus | Choose Tarab for |
| --- | --- | --- |
| **Tarab** | A private local library with a designed player on macOS, Windows, and Linux. | Collection tools, timed lyrics, native desktop control, and two full interfaces in one app. |
| [MusicBee](https://getmusicbee.com/) | Windows library maintenance, auto-tagging, CD tools, DSP, and audio-driver support. | The same product model across three desktop systems, plus a lyrics-first player and two first-party visual systems. |
| [foobar2000](https://www.foobar2000.org/) | Codec depth, tagging, ReplayGain, conversion, DSP, and a component ecosystem. | A complete experience that needs no component stack for lyrics, smart playlists, desktop controls, or interface design. |
| [Strawberry](https://www.strawberrymusicplayer.org/) | Collection management, tag sources, radio, Subsonic servers, and device transfer. | A focused local workflow with native desktop integration, a full-screen player, and a stronger visual identity. |

MusicBee gives Windows users more audio-driver and CD tools. foobar2000 gives power users more codecs and extensions. Strawberry gives collectors more tag sources, server inputs, and device tools. Tarab combines the library depth most listeners need with a player built around artwork, lyrics, privacy, and desktop use.

## Feature reference

### Library and playlists

- Album, artist, track, playlist, and tag views
- Search across tracks, albums, artists, and lyrics
- Manual, smart, and folder-sync playlists
- Tag editing, ratings, play counts, and missing-file handling
- Native folder grants and file watching
- Session migration from older Tarab storage

### Playback and lyrics

- Gapless playback with next-track preloading
- Crossfade from 0 to 12 seconds
- Queue, smart shuffle, shuffle history, and repeat modes
- Speed, volume, booster, and output-device controls
- Embedded lyrics, sidecar lyrics, and timed line highlighting
- Optional LRCLIB lookup

### Desktop and appearance

- Hardware media keys and operating-system transport actions
- Custom global shortcuts and app-menu commands
- System status icon and hide-on-close support
- Always-on-top 320 × 92 mini player
- Open at login, audio file associations, and deep links
- Liquid Glass and Neobrutalism themes

### Privacy and security

- On-device library, playlist, setting, and session storage
- No account or telemetry client
- Native-controlled library access
- Main-window checks for custom Rust commands
- Production Content Security Policy
- No automatic updater

## Supported audio files

Tarab scans these file types:

`MP3` · `FLAC` · `WAV` · `OGG` · `M4A` · `AAC` · `AIFF` · `ALAC` · `WMA`

## Install

Check [GitHub Releases](https://github.com/Faw47/tarab/releases) for an installer. Build Tarab from source if the release page has no package for your system.

### Source build requirements

- Node.js 22.18.0 from `.nvmrc`
- pnpm 9.15.2
- Rust 1.92.0 from `rust-toolchain.toml`
- The Tauri system dependencies for your operating system

### Run the desktop app

```bash
nvm use
pnpm install --frozen-lockfile
pnpm dev:app
```

### Create an app bundle

```bash
pnpm build:app
```

Tarab targets macOS 12 or newer, Windows 10 22H2 or newer, Ubuntu 22.04, Debian 12, and compatible newer Linux systems.

## Development checks

Run the standard code gate:

```bash
pnpm verify
cargo check --manifest-path src-tauri/Cargo.toml
```

Run the release gate before you create a release:

```bash
pnpm verify:release
```

The release gate checks TypeScript, Biome, Vitest, the production web build, Storybook, unused code, release configuration, Rust formatting, Rust tests, and Clippy.

## Architecture

Tarab uses Tauri 2, React 19, TypeScript, and Rust.

```text
src/
  components/        interface and player surfaces
  features/          playback, library, playlists, and settings
  store/             local interface and player state
  graphics/          Liquid Glass WebGL effects

src-tauri/src/
  audio.rs            playback engine
  library.rs          folder scanning
  database.rs         library database
  playlist.rs         playlist storage and rules
  lyrics.rs           local and LRCLIB lyric lookup
  desktop_integration.rs
                      status icon, menus, shortcuts, and media controls
```

The main window owns playback and library state. The mini player receives typed snapshots and sends control requests to the main window. The native command boundary rejects custom command calls from other windows.

Read [the frontend architecture](docs/frontend-architecture.md), [the security review](docs/security-review.md), and [the release hardening guide](docs/release-hardening.md) for implementation details.

## License

Tarab uses the [MIT License](LICENSE).
