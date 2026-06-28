# Playlist v2 Manual QA Checklist

## Migration

- [ ] Start app with existing `playlists.json` data and empty DB playlists.
- [ ] Confirm playlists are migrated into SQLite with preserved IDs, names, types, order, and timestamps.
- [ ] Confirm legacy JSON backup file is created (`playlists.migrated.<timestamp>.json`).
- [ ] Corrupt `playlists.json` and verify `playlists-corrupt` event/recovery banner appears.

## Unified Picker

- [ ] Open Add-to-Playlist from full player, album details, tag manager, and app context menu.
- [ ] Confirm each entry point shows the same `PlaylistPickerDialog`.
- [ ] Search inside picker filters playlist list.
- [ ] Quick-create playlist from picker succeeds, then appears in picker list.
- [ ] Add selected tracks to an existing playlist from picker.

## End-to-End Playlist Flows

- [ ] Create manual playlist, add tracks, reorder tracks, and play.
- [ ] Pin and unpin playlists, then confirm pinned collections stay at the top of the playlist surface.
- [ ] Edit manual playlist name and verify list/detail update.
- [ ] Rename a playlist inline from the playlist surface and verify the name updates without opening a modal.
- [ ] Create smart playlist (preset + params), run sync, and verify resolved tracks.
- [ ] Create folder playlist, run sync, and verify resolved tracks.
- [ ] Delete playlist and confirm list/detail state updates cleanly.

## Missing Entries

- [ ] Make playlist track unavailable (file missing or removed from DB track catalog).
- [ ] Confirm unavailable row remains visible in playlist detail.
- [ ] Run "Remove unavailable" and confirm missing rows are cleaned.

## Keyboard Selection

- [ ] In playlist detail, use arrow keys to move selection focus between tracks.
- [ ] Use `Shift` + arrow keys and `Shift` + click to extend selection ranges.
- [ ] Use `Cmd/Ctrl + A` to select all visible entries, `Enter` to play the focused entry, and `Delete` to remove selected tracks from manual playlists.

## Sync + Status

- [ ] Verify startup dynamic playlist sync runs for smart/folder playlists.
- [ ] Trigger manual sync for smart/folder playlist from detail pane.
- [ ] Verify `lastSyncedAt`/`syncError` state updates in UI.
