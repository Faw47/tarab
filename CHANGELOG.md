# Changelog

All notable changes to Tarab are recorded in this file.

## Unreleased - 2026-09-05

### Added

- Cursor-based library loading, cancellable large-library shuffle planning, virtualized keyboard navigation, and progressive Tag Manager hydration.
- Retryable loading and recovery states across library, playlists, scans, imports, output devices, and file restoration.
- Storybook review states for shared controls, navigation, player surfaces, playlists, Tag Manager, and both visual themes.

### Changed

- Navigation now shares one view and label model across the top bar, sidebar, dock, search, and album views.
- Playback and session restore reject stale generations and preserve queue, position, and playback settings more reliably.
- Error, warning, success, loading, and destructive surfaces use theme-aware semantic tokens.
- Playlist validation exposes accessible field errors and associates them with the relevant controls.
- Optional desktop integrations degrade gracefully when media keys, shortcuts, or output devices are unavailable.
- Release checks now cover typed IPC parity, capabilities, dependency audits, Storybook, packaging configuration, and current Windows artifact hashes.

### Fixed

- Missing Queue and Shuffle settings icon.
- Context-menu focus, keyboard navigation, typeahead, collision positioning, and focus restoration.
- Windows-compatible atomic metadata and lyric replacement behavior.
- Library search races, stale playlist mutations, file-association authority, and app-owned artwork fallback behavior.


## 1.0.0 - 2026-07-23

### Added

- Native-owned library folder grants with persistent opaque identifiers.
- File-association prompts for Play once, Import folder, and Cancel.
- Deep links for bounded library search and opaque local-track playback.
- Genre-aware smart-playlist filters backed by indexed library metadata.
- Cross-platform release automation for macOS, Windows, and Linux.
- Release checksums and GitHub build-provenance attestations.

### Changed

- Library scans, metadata, playback, tags, lyrics, and file operations now use native filesystem authority.
- Online lyrics requests use strict time, redirect, endpoint, field, and response-size limits.
- Artwork cache reads reject symlinks and oversized files.
- Windows tag and lyric writes use recovery-preserving atomic replacement and work with ordinary read handles.
- Error telemetry and its network permissions were removed.

### Security

- Sidecar lyrics cannot read through or write through symlinks.
- Root-like database folder deletion requests are rejected.
- Custom Rust commands remain restricted to the main window.
