# Post-merge review of assistant-authored remediation

Review date: 2026-10-18  
Baseline: `main` at `7b6ef3913630f7c7e0a04ae6f2529f03978e76cc` (after PRs #1–#19).  
Scope: assistant-authored changes in PRs **#11–#19**, especially the additional fixes in #13–#19.  
Source of finding definitions: [2026-10-17 comprehensive audit](2026-10-17-tarab-comprehensive-audit.md).  
Status: **post-merge review with follow-up corrections**, not release approval or a claim of independent verification. PRs #21 and #22 were merged after all five checks passed; the other corrective PRs require current-head verification and review.

## Review method and limitations

Inspected the merged production code, its tests, original audit definitions and GitHub PR/CI metadata. Compared intended behavior to control flow, including error paths and out-of-order events. Reproductions below are code-path analyses and regression tests written on review branches, **not claims of actual audio hardware or native UI testing**. GitHub CI for individual review branches must be consulted at their latest heads. The initial review did not include an independent pass. A subsequent independent adversarial review of #20, #23, #24 and #25 is recorded below. Native macOS/Windows/Linux interactive smoke testing remains unperformed.

The audit ledger's disposition counts must not be advanced to `FIXED_VERIFIED` merely because a PR was merged or a mocked test passed. Treat its `PENDING` counts as **unreconciled**, not as a current count of unimplemented fixes.

## Per-PR review

| Merged PR | Audit finding | Code reviewed and evidence | Defect / remaining gap | Follow-up |
| --- | --- | --- | --- | --- |
| #11 | PB-27 | Timestamp fractions, colon format, signed offsets and instrumental markers; five parser regressions | Offset was applied in file order, incorrectly leaving earlier timestamped lines unshifted when the global `[offset]` tag appears later | #22: pre-scan global offset; standard and enhanced lyrics tests |
| #12 | PB-29 | Store cursor, unique queue-entry IDs, queue display and four queue removal regressions | No additional reproducible defect identified in the reviewed remove-current scenarios; real shuffle, duplicate and drag interactions still need native/interactive tests | No speculative patch |
| #13 | QA-10 | Linux native menu event routing and frontend opener mock | **Original audit's confirmed root cause was missed:** Tauri opener capability had no `open-url` grant. Frontend test mocked away permission enforcement. Windows does not install a native app menu in current architecture, so this is not a Windows Help-menu feature | #24: exact URL capability scoped to main, denial handling, tests against real capability JSON, release guard |
| #14 | FE-42 | Demand-driven smooth-time RAF and tests | Paused seek changes were initially missed; clock mock was not reset across tests | Corrected before merge: subscribe to `currentTime`, notify paused subscribers once; reset mock and add seek regression. Native frame behavior still untested |
| #15 | QA-11 | Startup Rust flag, tray availability, persisted settings, hidden initial WebView, tests | Tray construction failure could leave a hidden inaccessible window (corrected before merge). Persist hydration could also wait forever (discovered afterward). Release configuration check used an undefined `errors` array on failure | #23: bounded 3s hydration fallback, effect cleanup tests and docs. #24: fix `errors.push` to `failures.push` |
| #16 | QA-13 | `useDeepLinkBridge` de-duplication and tests | A global 1s same-URL suppression window also discarded legitimate rapid repeated clicks | #21: only suppress first replay of initial launch URL. Event identity is still not available; initial replay vs immediate intentional click inside the small window remains inherently ambiguous |
| #17 | PB-28 | Sequential Next/Previous promise queue and rapid-next tests | Only adjacent commands are queued; a separately initiated Play/Stop or editor preview can overtake a pending Next and a stale completion can commit obsolete UI state. Delayed automatic Next also could be recorded as a successful advance | #20: source intervention guards, late pause/seek/preview/stop tests, canceled auto-advance check. Native source commands are **still not globally serialized** |
| #18 | SEC-03 | Waveform sample-rate/channel validation and boundary tests | Bounded chunk allocation is present. No further concrete error identified here; malformed-decoder fuzzing, cache integrity and native resource testing have not been performed | No speculative patch |
| #19 | LD-04 | Strictly increasing source generation setter and regression | This corrects only one part of LD-04. Editor-preview UI ownership and complete single-coordinator native source ordering are **still unresolved**. Monotonic generation alone does not reject stale UI mutations | #20 guards some stale completions; LD-04 stays pending |

## Review correction PRs

- [#20](https://github.com/Faw47/tarab/pull/20): guard stale async playback/UI completions, handle null canceled auto-advance. Includes focused interleaving tests; **not** a complete native serialization solution.
- [#21](https://github.com/Faw47/tarab/pull/21): limit deep-link de-duplication to the initial URL mirror, keep subsequent rapid opens.
- [#22](https://github.com/Faw47/tarab/pull/22): apply LRC offset globally, including when metadata appears later in the file.
- [#23](https://github.com/Faw47/tarab/pull/23): fail open on stalled persisted-settings hydration, cancel delayed window shows, update startup docs.
- [#24](https://github.com/Faw47/tarab/pull/24): enable and narrowly scope Help URL opener permissions, report failures, assert real capability in tests, repair release-configuration failure path.

These corrections were created as independent draft PRs against `main`. #21 and #22 have merged; remaining fixes should only be merged after checking latest-head CI, reviewing each change and obtaining applicable native evidence.

## Continuation: corrective stabilization

An isolated local checkout is now available. The tested candidate set is `main` at `496fd54` plus #20 `afe4559`, #23 `87a0c59`, #24 `6c14bd7` and this documentation branch. All changes preserve the existing coordinator, intervention epoch and native grant ownership. No release is approved.

- Independent review found that a queued second Next survived a newer Stop or Play. The correction tracks adjacent-request batches using the existing intervention epoch. Old requests cancel; an intentional fresh Next still executes.
- Review also found that guarding only successful results left stale failures visible. Settled native results now reach a synchronous epoch check before committing state or throwing. Both success and rejection microtask gaps were reproduced as failing tests before correction.
- #20 adds 14 cases beyond its previous head. The final renderer review found no unresolved blocker. Current-operation failures and uninterrupted rapid Next behavior remain covered.
- #23 adds five lifecycle cases. All 13 startup tests pass, including stalled hydration, both tray settings, unmount and StrictMode. The bounded hydration listener lifetime after unmount is retained; no stale window show occurs.
- #24 passed independent review. The actual capability and release guard reject missing/broadened Help permission, mini-player URL access and an initially visible main window. Native opener enforcement is still untested.
- Combined candidate verification on Node 22.18.0 / pnpm 9.15.2 passes: 89 files, 384 tests, TypeScript, Biome, 116 IPC contracts, production build and bundle check, Storybook, Knip and release configuration. Nonfatal output includes the pre-existing confusing-void mock type warning, jsdom `window.scrollTo` warning and Vite chunk-size warnings; these were not hidden or waived test failures.
- Local `cargo check --manifest-path src-tauri/Cargo.toml` could not run: Cargo is not installed. Cross-platform CI results must be read at each final candidate SHA. Actual desktop playback/startup/Help checks remain release gates.

**Still unresolved:** native commands already in flight can execute outside a unified source order; editor preview ownership remains partial (LD-04). Nothing in this correction establishes complete playback coordination or current installer readiness.

**Code merge record:** #24 (`6c14bd7`), #20 (`afe4559`) and #23 (`87a0c59`) each passed all five checks on their final heads and independent code review before merging. Source changes on `main` at `a3a8f5a` match the tested combined candidate for `src/`, `src-tauri/`, `scripts/`, package manifest and lockfile. Combined-main CI remains a separate check. Native desktop acceptance and release qualification remain open.

## Mandatory validation before release

1. **Automated:** `pnpm verify`, `pnpm verify:release-config`, `cargo fmt --all -- --check`, full Rust cross-platform tests and `pnpm verify:release` where feasible. Inspect the *latest* commit, not an older green run.
2. **Real playback:** rapid Next/Previous; selecting an album track during an unresolved Next; queued automatic advance interrupted by another Play; Stop/Seek/Pause racing with Play; crossfade/gapless and shuffle; verify backend audio and displayed track agree. Mock-only tests do **not** prove native command ordering.
3. **Windows/macOS/Linux startup:** ordinary launch displays main; autostart with `--minimized` hides only when the status icon actually exists; disabled/missing tray and failed settings hydration show an accessible window; reopen on second-instance launch. Keep macOS native menu and Linux menu differences explicit; Windows currently installs no traditional native app menu.
4. **Help:** click Help > Tarab Help on supported native menu platforms, confirm it opens the exact README URL; a denied opener must be surfaced. Confirm mini-player cannot open URLs or paths.
5. **Lyrics and queue:** test real LRC files with late offsets, colon fractional tags and blank instrumental markers; test removing current entry (first, middle, last, duplicate) in repeat and shuffle modes, then Next.
6. **Resource limits:** malformed waveform sample rates/channels, very long files, memory usage, and audio decode errors; do not imply all media parser safety from a bounded chunk check.
7. **Documentation:** reconcile individual audit IDs only after recording reproduced failure, targeted regression, full check results, independent review, and native validation when needed.

## Process improvements

- Diagnose against the **original finding text** before changing any code. A UI mock that proves the handler was called does not prove the backend/OS authorized the action.
- Reconstruct fault paths that cross frontend ↔ native capabilities rather than just patching the first suspicious line.
- Add tests for repeated input, out-of-order completion, storage failure, cancellation, unmount/StrictMode and denied permission where relevant.
- Prefer one coherent change and commit per reviewed defect, rather than repeatedly updating every stacked descendant branch. Avoid treating reviewable commits and passing CI as complete desktop acceptance tests.
- Preserve valid architecture decisions and leave partially solved findings pending with a concrete remaining-work statement.
