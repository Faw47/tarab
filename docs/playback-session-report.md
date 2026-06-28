# Playback Session Persistence Report

## 1. Expected Behavior
When the application is closed and reopened, the player should:
- Restore the last played track.
- Restore the playback position (timestamp).
- Restore the queue and other state (volume, loop mode, shuffle).
- Start in a PAUSED state (unless autoplay is actively enabled, but standard behavior is paused).
- Resume from the exact timestamp when "Play" is clicked.

## 2. What Was Broken (with code references)
- **Backend start position race**: `AudioCommand::Play` initialized playback state before the optional seek, which allowed the position emitter to publish `0.0` immediately (`src-tauri/src/audio.rs:140-199`).
- **Frontend store overwrite**: the `playback-position` listener updates `currentTime` from backend events, so an early `0.0` would overwrite the restored timestamp (`src/App.tsx:708-731`).
- **Resume logic depended on volatile `currentTime`**: several play toggles used store time for resume, which could already be reset by the `0.0` emit (e.g., `src/App.tsx:920-940`, `src/components/home/HomeView.tsx:580-598`, `src/components/queue/QueueView.tsx:86-101`, `src/components/player/PillMiniPlayer.tsx:30-44`).

## 3. What Changed (files)
- `src-tauri/src/audio.rs`: seek happens before playback starts; `is_playing` flips only after `start_position` is applied; seek failures log and fall back to `0.0`.
- `src/store/player-store.ts`: added `resumePositionSec` + `resumePositionTrackId` with accessors; cleared when playback becomes active.
- `src/App.tsx`: restore writes the resume position from the session; spacebar play uses resume position in `playTrack`.
- `src/components/player/PlayerControls.tsx`, `src/components/player/PlayerContent.tsx`, `src/components/player/MiniPlayer.tsx`, `src/components/player/SidebarMiniPlayer.tsx`, `src/components/player/PillMiniPlayer.tsx`, `src/components/home/HomeView.tsx`, `src/components/queue/QueueView.tsx`: all resume paths now pass the stable resume position into `playTrack` instead of using `currentTime` or a follow-up seek.

## 4. Why This Is Correct
- The backend now performs an atomic play-with-seek, so the first `playback-position` emit reflects the resume timestamp.
- Resume time comes from persisted session state and is insulated from early position events until playback is initialized.
- Both main player and mini players use the same stable resume source, keeping behavior consistent.

## 5. How to Test
1.  Open app, play a track, seek to `1:30`.
2.  Pause the track.
3.  Completely quit the app (Cmd+Q).
4.  Reopen the app. Verify UI shows `1:30`.
5.  Click **Play** on the main player. Verify audio resumes from `1:30` (not `0:00`).
6.  Repeat steps 1-4.
7.  Click **Play** on the **Pill MiniPlayer**. Verify audio resumes from `1:30`.
8.  Quit while playing, reopen, press Play, and verify it resumes near the last saved timestamp.
9.  Rapid Play then Pause: no jump to `0:00`.
10. Track missing: session points to deleted file, app should not crash.
