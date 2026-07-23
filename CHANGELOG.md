# Changelog

All notable changes to Tarab are recorded in this file.

## 1.0.0 - 2026-07-23

### Added

- Native-owned library folder grants with persistent opaque identifiers.
- File-association prompts for Play once, Import folder, and Cancel.
- Deep links for bounded library search and opaque local-track playback.
- Cross-platform release automation for macOS, Windows, and Linux.
- Release checksums and GitHub build-provenance attestations.

### Changed

- Library scans, metadata, playback, tags, lyrics, and file operations now use native filesystem authority.
- Online lyrics requests use strict time, redirect, endpoint, field, and response-size limits.
- Artwork cache reads reject symlinks and oversized files.
- Error telemetry and its network permissions were removed.

### Security

- Sidecar lyrics cannot read through or write through symlinks.
- Root-like database folder deletion requests are rejected.
- Custom Rust commands remain restricted to the main window.
