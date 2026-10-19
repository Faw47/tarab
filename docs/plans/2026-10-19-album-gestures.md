# Album hold-selection parity implementation plan

Goal: both album themes select a track after a 500 ms primary mouse or touch hold.
Architecture: one shared album-row hold controller used by both existing skins; selection
ownership stays in the existing controller and parent callbacks. Preserve playback, row focus,
context-menu and short-click behavior. No dependencies or visual redesign.
Spec: FE-18 in the comprehensive audit; AGENTS.md; design language consistency contract.
Base: PR #28 head 6707606c1898f279ac21ad15d8bb0f23da6ed0fc (all five CI jobs passed).

Review focus: nested buttons must not select a track while held; right mouse button must not
start a hold; touch move/cancel must cancel selection; unmount/album replacement must cancel
pending work; callbacks changing during a hold must not invoke stale parent state.

## Task 1: shared album-row hold selection

- [x] Add rendered parity tests to AlbumTrackRows.test.tsx. A 500 ms hold selects once in both
  themes without playback; release, leave, touch move/cancel and nested buttons do not select.
- [x] Run tests and record expected failures against the published baseline.
- [x] Add useAlbumTrackLongPress in src/components/shared; accept current tracks and an onHold
  callback, return start/cancel handlers. Use one cancellable timer and latest callback; cancel
  on unmount or track-list replacement. Ignore secondary mouse and nested interactive controls.
- [x] Replace the liquid-only timer/ref implementation; wire both row skins to the shared hook.
  Bind start to mouse down/touch start and cancellation to mouse up/leave, touch end/move/cancel.
- [x] Add focused lifecycle regressions for unmount, album replacement, latest callback and
  cancellation. Run all frontend tests, TypeScript, Biome, IPC, build, Storybook, Knip and release guard.
- [x] Independent whole-branch review; correct substantiated defects with failing tests.
- [x] Update behavior docs and ledger, preserving FE-18 PENDING for broader architecture.
  Publish a focused stacked draft; keep native touch/WebView acceptance explicit.

Execution: continue the already-authorized inline workflow, with one fresh final reviewer.
The repository is an isolated checkout on chatgpt/remediation-album-gestures. Native source
remains identical to the cross-platform validated baseline; record unavailable native checks.

Results: 11 failures against the baseline, then 37 album tests passed. Final self-review reproduced a context-menu cancellation omission (2 further failures); corrected and verified with the complete 446-test suite. Independent whole-branch reviewer found no scoped blocker before that two-line correction. Storybook fixtures added for both skins; interactive acceptance remains blocked and unclaimed. Publication status and CI belong to the focused draft.
