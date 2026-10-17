# Tarab remediation ledger

This ledger is the source of truth for remediating the findings in
[`2026-10-17-tarab-comprehensive-audit.md`](2026-10-17-tarab-comprehensive-audit.md) (audit branch
`claude/exciting-bell-6nri74`, commit `b455833`, audited revision `2dbe638`). It has one row per
original unique finding (160). IDs that the audit merged into another finding are listed in the
audit's Section 4.0 and are tracked under the surviving ID.

## How to resume

1. Fetch all `claude/remediation-*` branches and read the newest ledger (the highest-numbered
   remediation branch carries the cumulative ledger).
2. Check open PRs on `Faw47/tarab` whose head branch starts with `claude/remediation-`.
3. Continue with the first `PENDING` row in table order (severity, then audit order), unless a
   dependency note says otherwise.
4. Each remediation branch is stacked on the previous one; do not commit fixes to the audit
   branch.

## Verification gates

- **G1:** the defect is reproduced where feasible, and a targeted regression test fails before the
  fix and passes after it. `n/a` means a regression test is not feasible (for example pure
  configuration or deletion of dead code); the reason is given in the notes.
- **G2:** relevant checks pass after the change: `pnpm -s tsc --noEmit`, `npx biome check .`,
  `npx vitest run`, `cargo check`, `cargo clippy --all-targets --all-features -- -D warnings`,
  `cargo test`, `cargo fmt --check`, plus `node scripts/check-ipc-contract.mjs` and
  `pnpm exec vite build` where the change affects them.
- **G3:** an independent adversarial review by a separate subagent found no unresolved
  substantiated objection.
- `PASS`, `FAIL`, `n/a` or `-` (not yet run) are recorded per gate.

## Dispositions

- **FIXED_VERIFIED:** fixed, and all applicable gates passed.
- **ALREADY_RESOLVED:** fixed before remediation started or by another finding's change.
- **FALSE_POSITIVE:** re-verification against the code showed the finding is wrong.
- **DUPLICATE:** the same root cause as another row, which carries the fix.
- **NATIVE_VALIDATION_REQUIRED:** code change made and cloud gates passed, but the behavior can only
  be confirmed on a native desktop host (audio device, OS integration, platform WebView). The
  native check is described in the notes.
- **DECISION_REQUIRED:** a product or design decision is needed before a fix is justified.
- **BLOCKED:** cannot proceed; the blocker is described.
- **PENDING:** not yet processed.

## Status summary

| Disposition | Count |
|---|---|
| FIXED_VERIFIED | 20 |
| ALREADY_RESOLVED | 0 |
| FALSE_POSITIVE | 0 |
| DUPLICATE | 1 |
| NATIVE_VALIDATION_REQUIRED | 4 |
| DECISION_REQUIRED | 0 |
| BLOCKED | 0 |
| PENDING | 135 |
| **Total** | **160** |

## Findings

| ID | Sev | Finding | Disposition | Gates (G1 / G2 / G3) | Evidence, tests and notes | Commit | PR |
|---|---|---|---|---|---|---|---|
| PB-01 | P0 | Position events changed to an object, but the main position handler still treats them as a number | FIXED_VERIFIED | PASS / PASS / PASS | G1: new usePlaybackPositionEvents.test.tsx failed 4/4 before (currentTime held the object), passes after; Chromium harness showed 0:00 before and 1:01 after for {generation:1, position:61.5}. Seek events now carry a generation. G3 approved (no other consumers; edge cases checked). | a84ca8b | #2 |
| PB-02 | P1 | Audio thread deadlocks when opening the output device fails | FIXED_VERIFIED | PASS / PASS / PASS | playback_identity() reads generation and file under one lock; unit test proves the lock is free before emitting; grep finds no remaining inline lock() arguments. The device-failure trigger itself cannot be exercised without an audio device. | c77d54d | #2 |
| PB-03 | P1 | Hidden or tray window may have its renderer suspended, and the renderer owns queue advance | NATIVE_VALIDATION_REQUIRED | PASS / PASS / PASS | backgroundThrottling disabled on main; release-config check fails without it. Documented in AGENTS.md and docs/release-hardening.md. Native check (macOS 14+): hide to tray for 10 min with a 2-track queue; track 2 must start and media keys must work. Tauri does not support this setting on Windows/Linux. | e8cb826, 37394f1 | #2 |
| PB-06 | P1 | Gapless handoff re-picks the next track, so the UI can show a different track than the one playing | FIXED_VERIFIED | PASS / PASS / PASS | Two lifecycle tests (shuffle re-pick; queue edit before handoff) failed before, pass after. Rust sends nextPath. Limitation: a source already appended to the rodio sink cannot be withdrawn, so a queue edit inside the 0.25 s preload window still plays the preloaded track; the UI now follows it. Residual (review note): the seamless branch's early return on a path mismatch can leave the old generation active; narrow. | 25993e7, 37394f1 | #2 |
| LD-02 | P1 | Library sort by title, artist or album only sorts the tracks already loaded | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve (after 1 objection) | Sorted lists are fetched from the database with the selected sort (per-sort query key); loaded pages are no longer re-sorted client-side. Tests useLibraryData.test.tsx (fail before). Found during the fix: tracksQuery.data ?? [] created a new array per render and looped the hook in tests (EMPTY_TRACKS). G3 objection: track-refresh and useTrackOperations still used the bare prefix key, so tag edits did not reach the sorted list; fixed in 84759a5 with trackCache.ts and track-refresh.test.ts. Limitations: COLLATE NOCASE folds ASCII only; NOCASE sorts cannot use the existing indexes; an edited title keeps its row position until the next refetch. | d6d91ba, 84759a5 | #3 |
| PB-04 | P1 | Scan reconcile is quadratic while holding the database lock and an open write transaction | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve | Reproduced: 20k-track rescan reconcile took 16 s (quadratic preserved count). Fix: HashSet of incoming paths. Test reconcile_folder_scan_rescan_of_large_folder_is_not_quadratic (fails before: 16 s > 8 s bound; passes after). Limitation: wall-clock bound may be slow-CI sensitive. | c6f5e14 | #3 |
| PB-18 | P1 | Any watched file change triggers a full rescan of the whole library root, including Tarab's own tag writes | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve | Watcher events now rescan the changed folder (file -> parent), collapsed per root, root fallback when >16 folders or the subfolder scan fails. Tests in useLibraryScan.watch.test.tsx (fail before: whole root scanned). Limitations: Tarab's own tag writes still trigger a rescan, now of one album folder only; directory renames still emit no event (pre-existing); each subfolder scan still runs a full lyrics index sync. | e09ac79 | #3 |
| AR-04 | P1 | Playlist commands are synchronous (run on the main thread) and load the whole tracks table per smart or folder playlist | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve | All 14 playlist commands are async and run their work via spawn_blocking; the mutation guard and mutation-ID cache are unchanged. Smart/folder playlist listing loads the tracks table once per call. Test listing_playlists_resolves_smart_and_folder_playlists_from_one_track_load. Limitation (reviewer note): back-to-back reorders from a stale detail can now apply out of order; that lost update pre-exists in PlaylistsView.moveEntry. | 3ee10cc | #3 |
| PB-07 | P2 | Seek reports the requested time, not the decoder's actual position; MP3 coarse seek is inaccurate for VBR | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve (after 1 objection) | Accurate seek plus decoded-frame skipping to the exact target. A WAV seek to 0.5123 s started at frame 3456 (0.432 s) before the fix (test seeking_starts_at_the_requested_frame_not_the_packet_boundary). Review: skip counts were in time-base units; converted to frames for Matroska and MP4 (af7e60a, test timestamp_deltas_convert_to_frames_for_millisecond_time_bases). Limitations: MP3 accurate seek parses frame headers from the start (O(file size) on the audio thread); Vorbis overshoots by one block after a reset. | 8ab471d, af7e60a | #4 |
| PB-08 | P2 | A failed seek restarts the track at 0:00; files without a known frame count get no gapless or crossfade | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve (after 1 objection) | A failed seek skips packets from the start instead of restarting at 0:00 (test a_failed_seek_skips_packets_instead_of_restarting_at_zero, with injected seek failure). A seek or resume past the real end ends the track so the queue advances (af7e60a). Files without a frame count use the lofty duration estimate for near-end detection. Also fixed: decoder duration divided the fractional second by the time-base denominator. Limitations: the duration fallback branch has no MP3-without-Xing fixture; any read error during packet skipping is treated as end of track. | 8ab471d, af7e60a | #4 |
| PB-09 | P2 | Real-time mixer path locks shared state per sample while other threads hold that lock across IPC emits | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve | Booster gain is an atomic; Pause/Resume/SourceRenamed release the lock before emit; the gapless handoff callback posts its IPC emits to the audio thread; packet conversion reuses buffers. Test source_produces_samples_while_the_playback_lock_is_held times out before the fix. Limitations: decoding and file I/O still run inside the source's next() on the mixer thread; a Seek or Pause queued between a handoff and its message emits events the renderer drops; the loop holds its own sender, so dropping AudioManager no longer stops its threads. | 2495a61 | #4 |
| PB-12 | P2 | Interrupted crossfade leaves stale pending state; a later end of that file is ignored and playback halts | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve (after 1 objection) | Pending crossfade ends when the backend reports it started; generations then filter the outgoing source. Commands that replace or stop the source mark an intervention epoch; a crossfade requested earlier is discarded. Review objection: seek and device switch must not mark it (they apply to the incoming source); fixed in 9bd2c1f. Tests in usePlaybackLifecycle.test.tsx and playback-actions.test.ts fail before. | 5241ca6, 9bd2c1f | #4 |
| PB-13 | P2 | No handling of output-device loss or system default-device changes | NATIVE_VALIDATION_REQUIRED | G1 pass (unit) / G2 pass / G3 approve after fixes, re-review pending | Output watch: a sample counter stalled for 2 s while playing triggers RecoverOutput, which reopens output at the current position (falling back to the system default) with backoff to 30 s; on Windows a changed default device name also triggers it. A failed automatic reopen stops backend playback and drops the stream (d165a6b). Unit tests for OutputWatch. Needs a native check: unplug a USB/Bluetooth output while playing on each platform, and change the Windows default device. Limitations: devices are still identified by display name; a replugged preferred device is not switched back to automatically. | ee6402f, d165a6b | #4 |
| PB-14 | P2 | Missing, corrupt or unsupported tracks stop the queue instead of being skipped | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve (after 1 objection) | Automatic advance skips a track that cannot start or fails to decode, with a toast, up to 5 in a row and never more than the rest of the queue; stream/device failures and user commands stop the chain. Review fixes (9bd2c1f): the attempted entry is the previewed one (shuffle), activating an entry clears the error banner, Repeat One does not retry a failed file. Limitations: a queue edit during the playTrack await can activate the wrong entry (pre-existing); a decode error event that arrives before the play_track reply is dropped as stale; the skip banner remains only in the full player (FE-10). | 2e526b2, 9bd2c1f | #4 |
| PB-10 | P2 | Shuffle with Repeat Off never ends | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve (after 2 objections) | Shuffle tracks the queue entries played in the current pass (uncapped, pruned to the queue); with Repeat Off it ends after one pass, with Repeat All a new pass avoids recent tracks. Review fixes: only forward moves start a new pass (9bd2c1f); a Repeat One replay compares with the current entry (af7e60a). Tests in player-store.test.ts fail before. Limitation: shuffle pass is not persisted across restarts (restore starts a pass at the current entry). | 55341a8, 9bd2c1f, af7e60a | #4 |
| PB-11 | P2 | Shuffle Previous follows list order; "Play Next" is ignored under shuffle; manual Next with Repeat One restarts the song | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve (after 1 objection) | Previous under shuffle walks back through the shuffle pass; Play Next under shuffle gets priority (newest first, matching the list order of a multi-track Play Next); a user-initiated Next leaves a Repeat One track while the automatic advance repeats it. Tests in player-store.test.ts fail before. Limitation: Next after Previous picks a random unplayed entry instead of moving forward through the pass. | 55341a8, 9bd2c1f | #4 |
| PB-05 | P2 | One failed session write disables all later saves and makes tray/menu Quit fail | FIXED_VERIFIED | PASS / PASS / PASS | player-state-store test: a failed write rejects only its caller, the next save persists, flush resolves; both quit paths call desktopQuitApplication in finally. Reviewer confirmed the only caller awaits inside try/catch. | 59c95c2 | #2 |
| PB-15 | P2 | A failed track lookup during restore still enables saving, so an empty queue overwrites the stored one | FIXED_VERIFIED | PASS / PASS / PASS | Lookup failure leaves the store unhydrated so an empty queue cannot overwrite the saved one; restoredQueueIndex() shifts the saved index past dropped entries, keeps duplicates at their saved position, and the fallback current track uses the same index. Two review rounds raised objections (duplicate entries; index/track disagreement); both fixed with tests that failed before. Final review approved. | 3356937, 37394f1, 8d56484 | #2 |
| AR-11 | P2 | Lyrics index sync re-sorts the whole table for every page: 41 s at 100k tracks, after every scan | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-08 | P2 | Scans decode full-resolution embedded artwork two or three times per track | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-09 | P2 | Thumbnails are lossless WebP, so the default 200 MB cache holds roughly 1,000 albums | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-08 | P2 | One unreadable directory entry fails the whole scan | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-09 | P2 | Tag and lyrics writes are in place, not atomic | PENDING | - | Audit confidence LIKELY. | - | - |
| AR-19 | P2 | Watcher uses leading-edge throttling, has an unbounded debounce map, broadcasts to all windows and sets up recursively on the main thread | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-12 | P2 | Windows runs two media-control (SMTC) integrations; one bypasses the renderer and emits events nobody listens to | NATIVE_VALIDATION_REQUIRED | G1 pass / G2 pass (Windows CI compiles) / G3 approve | Removed the duplicate souvlaki SMTC integration (media_controls.rs, update_media_metadata, unused tray-* broadcasts); Windows SMTC now goes only through tauri-plugin-media and desktop-control-action. Review found the SMTC Stop button mapped to nothing; Stop now pauses (test os_stop_button_pauses_playback). Needs a manual Windows check: the media flyout shows metadata and its buttons work with the plugin as sole SMTC owner (the plugin calls CommandManager.SetIsEnabled(true)). | fa5b788, 767880e | #4 |
| AR-07 | P2 | Audio thread exits permanently if no output device exists at startup | NATIVE_VALIDATION_REQUIRED | PASS / PASS / PASS | Audio loop stays alive without a device and opens the stream on demand (ensure_output_stream tests). Seek opens the device only when a sink exists. The requested device is remembered; on-demand reopen falls back to the system default if it fails. Review approved. Native check: launch with no output device, connect one, press Play; expect audio without restart. | c2731a2, 37394f1, 8d56484 | #2 |
| LD-06 | P2 | Database initialization failure exits silently with no user-visible message | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-05 | P2 | Cover art over the `cover-art://` custom protocol likely fails on Windows, falling back to slower IPC | PENDING | - | Audit confidence LIKELY. | - | - |
| QA-06 | P2 | Windows canonical paths keep the `\\?\` prefix | PENDING | - | Audit confidence POSSIBLE. | - | - |
| AR-10 | P2 | `cover-art://` handler reads disk synchronously on the webview thread | PENDING | - | Audit confidence LIKELY. | - | - |
| AR-05 | P2 | Media-session sync re-sends full-resolution base64 artwork every two seconds to a main-thread command | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve (after 3 objection rounds) | Repeat syncs send metadataUnchanged and skip the artwork fetch; the command returns whether the OS session holds the metadata. Review rounds added: key includes filePath and hasCoverArt; per-sync sequence drops stale artwork syncs; the key is cleared while a full sync is pending (A-B-A track change); the redundant renderer mini-window close was removed. Tests in useDesktopIntegration.test.tsx fail before each fix. Limitations: the command is still synchronous on the main thread; artwork is still full resolution, not a 512 px thumbnail; albumArtist is null and hasPrevious is true for any non-empty queue; Linux MPRIS serves no metadata (plugin bug, pre-existing). | 8a7e351, 09fb788, 767880e, 09e5b5f | #4 |
| AR-13 | P2 | Linux applies the full app menu to every window, including the 320x92 mini player | PENDING | - | Audit confidence LIKELY. | - | - |
| FE-24 | P2 | Native menu items do less than their labels say | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-01 | P2 | The liquid WebGL shell renders continuously but is always covered by an opaque layer | PENDING | - | Audit confidence CONFIRMED. | - | - |
| LD-01 | P2 | All three liquid-shell post-processing shaders fail to compile | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-02 | P2 | Unused full-window blur passes and a per-frame layout loop feeding a store nothing reads | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-07 | P2 | At the minimum window size the floating dock covers player controls; its labels clip and the search bar overflows | PENDING | - | Audit confidence CONFIRMED. | - | - |
| LD-08 | P2 | Neobrutalism album grid columns expand to fit long titles | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-09 | P2 | Selection pills highlight the wrong navigation item | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-04 | P2 | Search shortcuts focus the hidden mobile search input | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-05 | P2 | Liquid Home Mute button changes the icon but not the audio | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-06 | P2 | "Hide cover art" in the full player removes every transport control | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-03 | P2 | Passing `reportError` directly to `.catch` can replace the whole UI with the error boundary | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-10 | P2 | Playback-failure recovery actions exist only inside the full player | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-11 | P2 | Compact full player's seek bar is never visible or mouse-usable | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-12 | P2 | Full player shows no elapsed/total time and no volume in the default layout | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-13 | P2 | Neobrutalism ignores the collapsed mini-player state and shows an empty bar | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-14 | P2 | Mini Player settings describe the wrong surface | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-16 | P2 | Five separate volume implementations behave differently | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-17 | P2 | The neobrutalism full player is dark blurred glass | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-18 | P2 | Parallel liquid and neo component trees diverge in behavior, not only appearance | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-19 | P2 | Library says "Your library is empty" for empty facets of a non-empty library | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-20 | P2 | Clear queue has no confirmation or undo | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-25 | P2 | Tag editor discards unsaved edits on Escape; inside the full player, Escape closes both | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-26 | P2 | Playlists view: no virtualization, raw type names, no per-track play | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-31 | P2 | Errors appear twice and use internal wording | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-30 | P2 | Home and library styling contradicts the documented design language | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-22 | P2 | No RTL or bidirectional text handling for Arabic metadata and lyrics | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-23 | P2 | Mini-player lyric line freezes during playback | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-08 | P2 | Liquid icon-rail mode has no window drag region; the liquid album view has no Back button | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-21 | P2 | Nested interactive controls in album tiles (source of the React DOM-nesting warning) | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-15 | P2 | Home album card Play button cannot be used by keyboard; controls and titles appear only on hover | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-27 | P2 | Album track rows: unlabeled "More" button, hover-only controls, wrong ARIA roles | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-28 | P2 | Neo theme forces black focus outlines and uses below-AA grey text | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-29 | P2 | framer-motion animations ignore Reduced Effects and OS Reduce Motion | PENDING | - | Audit confidence CONFIRMED. | - | - |
| LD-05 | P2 | 42 other synchronous commands run on the main thread, several with blocking I/O | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-16 | P2 | Persisted react-query cache has no filter or buster and keeps search keys and aggregates for 24 hours | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-17 | P2 | Every session save reads and rewrites the whole player store over IPC | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-01 | P2 | Release builds abort on any panic while parsing untrusted media in-process | PENDING | - | Audit confidence LIKELY. | - | - |
| SEC-02 | P2 | Image size limits are checked after decoding | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-04 | P2 | Release signing secrets are readable by dependency install and build scripts | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-01 | P2 | Files moved to "Tarab Trash" cannot be found or purged after the undo dialog closes | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-02 | P2 | Trash and move fail for libraries on a different volume from app data | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-18 | P2 | Critical paths have no tests, and existing tests encode the wrong IPC payload | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-31 | P2 | The IPC contract check validates names only | PENDING | - | Audit confidence CONFIRMED. | - | - |
| PB-21 | P3 | Playback speed changes pitch | PENDING | - | Audit confidence CONFIRMED. | - | - |
| PB-23 | P3 | Pausing during a crossfade lets the fade finish while paused | PENDING | - | Audit confidence CONFIRMED. | - | - |
| PB-24 | P3 | Seek while paused may briefly play audio; seek events carry no generation; every seek reopens the file | PENDING | - | Audit confidence CONFIRMED. | - | - |
| PB-25 | P3 | Decoder does not filter packets by track ID | PENDING | - | Audit confidence POSSIBLE. | - | - |
| PB-26 | P3 | Scanner accepts formats the decoder cannot play; Opus is not scanned | PENDING | - | Audit confidence LIKELY. | - | - |
| PB-32 | P3 | Volume booster hard-clips and is not persisted | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-27 | P3 | Track duration underestimated by up to one second | PENDING | - | Audit confidence CONFIRMED. | - | - |
| LD-04 | P3 | `PlaybackCoordinator` contract is only partly enforced: generation setter is not monotonic and editor preview bypasses the current track | PENDING | - | Audit confidence CONFIRMED. | - | - |
| PB-28 | P3 | Two quick Next presses advance only one track | PENDING | - | Audit confidence LIKELY. | - | - |
| PB-29 | P3 | Removing the playing track from the queue makes Next skip a track | PENDING | - | Audit confidence CONFIRMED. | - | - |
| PB-20 | P3 | Quit and window close do not save the latest state | PENDING | - | Audit confidence CONFIRMED. | - | - |
| PB-30 | P3 | In development builds, session restore never completes and saving never starts | FIXED_VERIFIED | PASS / PASS / PASS | StrictMode test hydrates after the fix (failed before); a completed restore never re-runs (test). | 3356937 | #2 |
| PB-16 | P3 | Playlist reorder resets every entry's added date and rewrites the whole list from client state | PENDING | - | Audit confidence CONFIRMED. | - | - |
| PB-17 | P3 | Playlist mutation IDs never protect an actual retry | PENDING | - | Audit confidence CONFIRMED. | - | - |
| PB-31 | P3 | Media-session and mini-window sync resend full artwork every two seconds and jump the mini progress bar | DUPLICATE | - | Merged into AR-05 by the audit; see AR-05. The mini progress bar still jumps every 2 s (no interpolation), not addressed. | - | - |
| PB-27 | P3 | LRC parser edge cases | PENDING | - | Audit confidence CONFIRMED. | - | - |
| PB-33 | P3 | Folder reconcile prefix match is case-insensitive | PENDING | - | Audit confidence POSSIBLE. | - | - |
| PB-19 | P3 | Watch events use canonical paths but are matched against folders as configured | PENDING | - | Audit confidence POSSIBLE. | - | - |
| AR-21 | P3 | Schema and index issues | PENDING | - | Audit confidence CONFIRMED. | - | - |
| LD-15 | P3 | Paginated queries order by non-unique columns without a tiebreaker | FIXED_VERIFIED | G1 pass / G2 pass / G3 approve | Paginated ORDER BY adds id as a tiebreaker. Rust test paginated_tracks_sort_case_insensitively_with_a_stable_tiebreaker proves no repeated or skipped rows across page boundaries. | d6d91ba | #3 |
| AR-22 | P3 | Deep-link track resolution hashes every row | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-34 | P3 | Shuffle-all and aggregates pull whole-library payloads into JavaScript | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-35 | P3 | Smart-shuffle de-clustering is roughly quadratic in the worst case | PENDING | - | Audit confidence LIKELY. | - | - |
| LD-07 | P3 | Genre is editable in the tag editor but absent from the library schema | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-04 | P3 | Legacy `music-player` data may not migrate on Linux | PENDING | - | Audit confidence LIKELY. | - | - |
| LD-19 | P3 | Backend diagnostics go to stderr instead of the configured log plugin | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-26 | P3 | macOS builds two app menus; label updates go to the replaced one | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-32 | P3 | Hidden mini-player webview is created at startup even though the feature is off by default | PENDING | - | Audit confidence LIKELY. | - | - |
| QA-10 | P3 | Help > README menu item is broken | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-11 | P3 | Autostart `--minimized` flag is never read | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-13 | P3 | The same deep link clicked twice in one session does nothing the second time | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-14 | P3 | "Play once" authority is consumed when playback starts, so artwork, palette and preload for that file fail | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-10 | P3 | macOS media plugin never releases its Objective-C objects and has no autorelease pool | PENDING | - | Audit confidence LIKELY. | - | - |
| LD-11 | P3 | Copy and pluralization defects | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-34 | P3 | Hard-coded "TARAB V1.1" overlaps the neo Settings title | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-35 | P3 | Command palette is limited and shows Mac-only glyphs everywhere | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-36 | P3 | No keyboard-shortcut reference; Up/Down silently change volume | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-38 | P3 | Desktop mini window seek target is 4 px tall and ignores the theme | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-39 | P3 | "Lyric size" is labelled in px but is a 1 to 100 scale | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-40 | P3 | Neo Home copy is jargon-heavy and its cards move despite the neo spec | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-44 | P3 | Queue empty state has no call to action | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-45 | P3 | Heavy stacked `backdrop-filter` in the liquid theme | PENDING | - | Audit confidence CONFIRMED. | - | - |
| LD-14 | P3 | Settings persistence skips validation on the current version and swallows write failures | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-46 | P3 | Two settings behave inconsistently with their defaults or lifecycle | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-37 | P3 | Collapsed pill player is not keyboard-operable and is mispositioned | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-41 | P3 | Virtualized lists lack list semantics; queue drag-and-drop sees only rendered rows | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-42 | P3 | `SmoothTimeProvider` runs a requestAnimationFrame loop even when paused or unused | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-20 | P3 | A single `Mutex<Connection>` serializes every read behind long write transactions | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-30 | P3 | Initial bundle is about 955 KB of JavaScript (292 KB gzip) and the size check has no byte budget | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-31 | P3 | Redundant UI dependencies | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-33 | P3 | `App.tsx` is a god component; large view files carry most of the complexity | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-36 | P3 | Errors are untyped strings and behavior depends on message text | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-25 | P3 | Dead code, dead dependencies and unused IPC surface | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-28 | P3 | Image cache: dead in-memory LRU, mtime-based "LRU", possible size underflow, renderer-only enforcement | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-29 | P3 | Waveform cache is keyed by path, unbounded on disk, and goes stale after edits | PENDING | - | Audit confidence CONFIRMED. | - | - |
| PB-22 | P3 | `rubato` dependency unused; sample-rate conversion uses rodio's linear converter | PENDING | - | Audit confidence CONFIRMED. | - | - |
| AR-37 | P3 | Minor reliability items | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-03 | P3 | Waveform generator sizes a buffer from an unvalidated sample rate | PENDING | - | Audit confidence LIKELY. | - | - |
| SEC-05 | P3 | Library grants accept `/` or the home folder; "Import folder" grants the launched file's parent with only a base-name prompt | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-06 | P3 | `opener:allow-reveal-item-in-dir` has no path scope | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-07 | P3 | The online-lyrics opt-in is enforced only in the renderer, and request errors carry metadata | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-08 | P3 | The mini window may emit any event name to the main window | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-09 | P3 | Linux media plugin writes artwork to a fixed `/tmp` path following symlinks | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-11 | P3 | `desktop_sync_media_session` takes untyped JSON, logs the raw payload on failure and reports success | FIXED_VERIFIED | PASS / PASS / PASS | Typed command parameter; Rust tests: object position rejected, renderer shape accepted, oversized artwork ignored. Raw payload no longer logged. Reviewer confirmed lowercase repeat-mode casing matches. | 0414e58 | #2 |
| SEC-12 | P3 | Several commands check one path and then operate on another (time-of-check to time-of-use) | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-13 | P3 | Reconcile deletes rows based on renderer-reported traversal completeness | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-14 | P3 | `db_rename_track_path` and `db_delete_tracks*` perform no library-root check | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-15 | P3 | `tarab://open/play` starts playback without confirmation and IDs are unsalted path hashes | PENDING | - | Audit confidence SUBJECTIVE. | - | - |
| SEC-16 | P3 | Full file paths reach persisted logs unredacted | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-17 | P3 | Bundled SQLite (rusqlite 0.31 / libsqlite3-sys 0.28) and glib 0.18 are behind upstream advisories | PENDING | - | Audit confidence LIKELY. Related: new RustSec advisories for quinn-proto and rustls fixed by lockfile update ae1783a (PR #2); rusqlite/libsqlite3-sys and glib not yet evaluated. | - | - |
| SEC-18 | P3 | CI workflow uses mutable action tags and default token permissions | PENDING | - | Audit confidence CONFIRMED. | - | - |
| SEC-19 | P3 | No navigation guard on the webviews | PENDING | - | Audit confidence SUBJECTIVE. | - | - |
| QA-12 | P3 | Tag editor cover picker only accepts images inside a library root, and writes WebP covers with a JPEG MIME type | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-17 | P3 | A delete test exercises a test-only helper instead of the shipped command path | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-29 | P3 | `fixed_store` writes without fsync and has no size limit | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-19 | P3 | No coverage thresholds; coverage not run in CI; Linux release jobs run no Rust tests | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-20 | P3 | CI has no Rust cache, runs a redundant `cargo check`, and installs the legacy appindicator package | PENDING | - | Audit confidence POSSIBLE. | - | - |
| QA-21 | P3 | Release re-runs use `gh release upload --clobber` | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-22 | P3 | The repository's knip configuration disables the rules that would find dead code | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-32 | P3 | Dead UI code and unused CSS | PENDING | - | Audit confidence CONFIRMED. | - | - |
| FE-33 | P3 | Duplicated and conflicting CSS | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-30 | P3 | Visual baselines are orphaned and Storybook coverage is thin | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-23 | P3 | Vendored `tauri-plugin-media` has no patch record | PENDING | - | Audit confidence CONFIRMED. | - | - |
| QA-24 | P3 | Dependency weight and duplicate versions | PENDING | - | Audit confidence SUBJECTIVE. | - | - |
| QA-25 | P3 | Documentation drift | PENDING | - | Audit confidence CONFIRMED. | - | - |

## Environment notes

- Cloud container: Ubuntu 24.04, no display server, no audio device, no GPU. Native app launch,
  audio output, OS media controls, tray, global shortcuts and platform WebViews cannot be
  exercised here.
- Frontend behavior is additionally checked with the audit's mocked-IPC Chromium harness where
  useful; that harness is not the native WebView.
