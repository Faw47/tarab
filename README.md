<p align="center">
  <img src="src-tauri/icons/app-icon-source.png" width="128" height="128" alt="Tarab app icon">
</p>

<h1 align="center">Tarab</h1>

<p align="center">
  A private desktop music player for the collection you own.
</p>

Tarab plays music from folders you choose. It scans your tags, organizes your collection, restores your queue, and sends audio through a Rust playback engine. Your library, playlists, settings, and play history stay on your computer.

Tarab runs on macOS, Windows, and Linux. It needs no account and includes no analytics, crash reporter, or error telemetry client.

## Why choose Tarab

### Hear albums as one recording

Tarab supports gapless playback and track preloading. You can set a crossfade from 0 to 12 seconds, change playback speed, and choose an audio output device from the app.

### Work with a collection, not a file list

Tarab groups tracks by album and artist. Search covers track data and lyrics. You can create manual playlists, rule-based smart playlists, or playlists that follow a folder. The tag editor lets you correct metadata without leaving the player.

### Keep the player within reach

Use hardware media keys, custom global shortcuts, the app menu, or the system status icon. A 320 × 92 always-on-top mini player gives you transport controls without covering your work. Tarab can hide to the status icon when you close the main window.

### Read lyrics in time with the music

Tarab reads embedded lyrics and local sidecar files. The full-screen player highlights timed lines during playback. You can opt in to LRCLIB lookup when a track has no local lyrics.

### Choose a visual system

The Liquid Glass theme uses album color, restrained WebGL motion, and glass controls. The Neobrutalism theme uses hard edges, high contrast, and mechanical controls. Tarab removes motion-heavy effects when you enable Reduced Effects or when the operating system requests less motion.

## Tarab and other desktop players

Choose a player based on the jobs you need. Use each product link to confirm its current features.

| Player | Good fit | Product strengths | Tarab gives you |
| --- | --- | --- | --- |
| **Tarab** | You want a focused local player with a modern interface on macOS, Windows, or Linux. | Native playback, timed lyrics, three playlist types, desktop controls, two complete themes, and on-device data. | The full Tarab feature set with no account or telemetry client. |
| [MusicBee](https://getmusicbee.com/) | You use Windows and want broad library maintenance tools. | Auto-tagging, CD ripping, equalizers, DSP effects, WASAPI, ASIO, podcasts, and web radio. | One interface across three desktop systems, a compact mini player, and timed lyrics. |
| [foobar2000](https://www.foobar2000.org/) | You want format depth, DSP tools, and a component system. | Broad codec support, advanced tagging, ReplayGain, conversion, interface customization, and third-party components. | A complete interface with lyrics, smart playlists, and desktop controls in the base app. |
| [Strawberry](https://www.strawberrymusicplayer.org/) | You manage a large collection and use radio or music servers. | Tag editing, MusicBrainz lookup, CD playback, device transfer, Subsonic support, and audio analysis. | A local-library workflow with opt-in network access and two distinct interface styles. |

Choose Tarab if you want strong library tools in a complete interface. Choose MusicBee for more Windows audio tools. Choose foobar2000 for more codecs and extensions. Choose Strawberry for more tag sources, device tools, and streaming inputs.

## Feature guide

### Playback

- Gapless playback with next-track preloading
- Crossfade from 0 to 12 seconds
- Queue, shuffle history, repeat modes, speed, volume, and booster controls
- Audio output device selection
- Session restore for the current track, queue, position, volume, speed, shuffle, and repeat mode

### Library

- The native backend controls folder grants
- Album, artist, track, playlist, and tag views
- Search across tracks, albums, artists, and lyrics
- Manual, smart, and folder-sync playlists
- Tag editing, ratings, play counts, and missing-file handling
- File watching for collection changes

### Lyrics

- Embedded and sidecar lyric support
- Timed line highlighting
- Full-screen lyric view
- Optional LRCLIB lookup after local lookup finds no lyrics

### Desktop controls

- System status icon with playback actions
- Hardware media keys and operating-system transport actions
- Custom global shortcuts
- Always-on-top mini player
- Open at login and hide on close
- Audio file associations and `tarab://` deep links

### Privacy and security

- No account
- No analytics, crash reports, or error telemetry
- No automatic updater
- Native folder grants instead of renderer-supplied library paths
- Main-window checks for custom Rust commands
- A production Content Security Policy that blocks third-party network hosts

## Supported audio files

Tarab scans these file types:

`MP3` · `FLAC` · `WAV` · `OGG` · `M4A` · `AAC` · `AIFF` · `ALAC` · `WMA`

## Network access

Playback and library work need no network connection. Tarab makes a network request after you enable **Auto-fetch lyrics** and a track has no local lyrics. The request sends the track title, artist, album, and duration to [LRCLIB](https://lrclib.net/).

The lyrics client accepts responses from the configured HTTPS host. It rejects redirects and limits request time, field size, and response size.

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
