# Tarab post-merge release-readiness audit — 2026-10-18

**Decision: NO-GO for a public 1.0.0 release.** This is a documented evidence review, not an assertion that all release tests were run.

**Original snapshot source revision:** `main` at `496fd54ae6097c8bae58fb97d14ee9d6cc19850e` immediately after PRs #21 and #22.
**Source of truth for finding names and dispositions:** `docs/audits/tarab-remediation-ledger.md` (160 entries).  
**Historical original audit:** `docs/audits/2026-10-17-tarab-comprehensive-audit.md`.  
**Release artifacts reference:** `docs/release-evidence-1.0.0.md` (dated 2026-07-28; not proof of October revision or signed distribution).  
**Review method:** GitHub contents/diffs, CI status and logs, repository permissions, release definitions, release metadata, and audit ledger. Native app GUI/audio/device tests were **not** executed in this chat. The initial review had no local checkout. The continuation below records the now-available local checkout and actual frontend checks; Rust/native tests remain unavailable locally.

## Original merge record and CI snapshot

- **Merged:** #21 deep-link startup mirror / rapid repeats, #22 globally ordered LRC offset metadata; each passed JavaScript, three Rust platforms, and dependency audit on its reviewed PR head.
- **Open:** #20 playback races, #23 minimized startup hydration failure, #24 Help URL capability, #25 audit review/report; each must pass current-head CI and obtain the applicable independent and native reviews before merging.
- The latest combined `main` CI after #22 had not completed when this audit began. Passing PR checks is not equivalent to combined-main acceptance.
- The normal `.github/workflows/ci.yml` runs `pnpm verify` (TypeScript, Biome, Vitest, IPC contract, Vite build), Storybook, Knip, Rust fmt/test/check/Clippy on Linux/macOS/Windows, and production dependency audits. It does **not** run `pnpm verify:release`, signed installers, native desktop GUI smoke tests, or the release workflow.
- No public GitHub release was returned. `main` reported `protected:false` and no enforced required checks; this is a release-process defect even when CI is green.

## Original release-gate evidence matrix

| Gate | Evidence observed | Outcome |
|---|---|---|
| Original audit source coverage | 160 ledger findings; 61 FIXED_VERIFIED, 1 ALREADY_RESOLVED, 1 DUPLICATE | Historical evidence; requires latest-revision reconciliation |
| Open findings | 86 PENDING, 10 NATIVE_VALIDATION_REQUIRED, 1 DECISION_REQUIRED | **Not closed** |
| PR #21 / #22 CI | Five checks passed on both reviewed PR heads | **Pass for those changes** |
| Latest combined main CI | GitHub run queued/in progress at audit time | **Not yet established** |
| Full frontend release gate | `pnpm verify:release` is configured; no completed October run of that composite gate was verified | **Unverified** |
| Native Windows/macOS/Linux UX | No current post-remediation smoke run for actual device failures, tray, menus, file associations, playback or deep links | **Unverified** |
| Security posture | SEC-05–19 (except already closed findings) include permissions, path races, consent, logging, symlinks, outdated native dependencies, and CI action policy | **Release review required** |
| Distribution artifacts | No GitHub releases; July proof matrix reports no validated Developer ID + notarized or Authenticode-signed distribution | **Not proven** |
| Check enforcement | GitHub `main` unprotected, no required status checks | **Release process blocker** |
| Release automation | Tag-driven release.yml configures validation, packages and attestations; `gh release upload --clobber` remains in publish job | **Not exercised; rerun immutability risk** |

The July release-evidence file's local test counts and DMG proof **do not** validate the October code. Absence of published assets does not establish that signing credentials are unavailable: account secrets were not readable.

## Corrective stabilization continuation

The independently reviewed candidate set is #20 `afe4559`, #23 `87a0c59`, #24 `6c14bd7`, and this audit branch, integrated over `main` at `496fd54` in a separate local worktree. The combined frontend gate passes **384 tests in 89 files**, TypeScript, Biome, 116 IPC contracts, production build/bundle check, Storybook, Knip and release configuration. Four malformed Help/startup configuration mutations are correctly rejected.

#20 now invalidates queued adjacent requests after newer source interventions and suppresses stale command errors at the synchronous commit boundary. Thirteen regressions were added; the independent reviewer found and rechecked the queued-request and rejection-settlement defects. #23 adds five hydration/unmount/StrictMode cases. #24's exact main-only Help capability passed code and mutation review. See the companion remediation review for evidence and nonfatal warning details.

Local Rust verification was attempted and blocked by `cargo: command not found`. Neither native audio/OS tests nor signed package checks were performed. The composite `pnpm verify:release` is therefore **not passed**. Latest-head GitHub CI must complete before a code merge. Native acceptance remains outstanding even after merging code; no finding becomes FIXED_VERIFIED merely because its PR merges.

QA-18 is a decision about generated IPC bindings and the original missing tests. The earlier plan's phrase "coverage requirement" did not accurately identify that decision. A numeric coverage threshold would be a separate release-engineering choice.

The next implementation scope is security and data integrity: **SEC-05** must reject filesystem roots and the bare home directory in both grant creation and reauthorization, show the full import-folder path, and preserve exact-file Play once. **QA-29** must bound reads/writes, sync staged contents before replacement, and preserve recoverability if replacement fails, including Windows. **PB-20** must capture a fresh session before flushing through all native quit paths, without treating hide-to-tray as a quit. Existing broad grants or user files must not be silently revoked or rewritten while implementing those changes.

## Priority and execution plan

The original Claude workflow is preserved: one tracked finding or tightly coupled root-cause group per branch/PR, no unrelated refactors, traceable G1 (failing regression before + passing after), G2 (targeted and full checks), G3 (independent adversarial review), and native OS check when required. Keep the `main` branch out of release until the last acceptance gate.

1. **Stabilize newest corrective PRs.** Resolve every CI failure at its latest SHA. Complete independent review of #20 (which still does not serialize all native source changes), and review/real-device checks for #23/#24; update the ledger only with observed evidence. Merge proven small PRs, rerun combined `main` CI and avoid racing a release tag.
2. **Close security/data-loss blockers before cosmetic work.** Start with SEC-05/06/07/08/09/12/13/14/15/16/17/18/19; PB-20 quit-state flushing, PB-16/17 retry/order integrity, LD-14 setting writes, QA-29 fixed-store atomicity/limits. Verify authority at native command boundaries and with malicious/path-race fixtures, not only frontend mocks. Require explicit product decisions for consent-sensitive behavior.
3. **Complete playback correctness and coordinator design.** Finish LD-04 editor preview source ownership and global source-action ordering, reconcile PB-28, then PB-21/22/23/24/25/26/32; test crossfade and gapless with rapid seek, device-switch, stop and queue transitions. Native smoke on available macOS/Windows/Linux audio devices required.
4. **Reconcile merged-but-pending results.** Evidence-based retest for FE-08/16/17/18/22/26/30, PB-27/29, QA-10/11/13, FE-42, SEC-03. Treat partial shared-theme architecture (FE-18) as open. Update PR references that still say draft after merges.
5. **Address UX, architecture, performance, and reliability backlog.** Complete all other `PENDING` rows listed below in severity and audit order; group only related tests and changes. Preserve the Tauri/React architecture and project-specific UX design documents.
6. **Native validation matrix.** Resolve all 10 `NATIVE_VALIDATION_REQUIRED` rows: macOS hidden playback/autostart/menu/permission, Windows output loss/SMTC/artwork/path canonicalization, Linux window menus, and real signing isolation. Record OS version and observed outcomes, never infer hardware success from CI compilation.
7. **Formal test and release engineering.** Resolve QA-18 generated Rust/TypeScript IPC binding and missing-test decisions; agree any numeric coverage threshold separately, then add CI enforcement, current release security action pinning and minimal permissions, eliminate `--clobber`-style nondeterministic publication, exercise `pnpm verify:release`/native smoke gates, require protected branch checks and reviewed releases.
8. **Release candidate only after closure.** Validate signed/notarized macOS DMG, Authenticode-signed Windows installers, x64/arm64 Linux packages, reproducible checked checksums and attestations, clean install/upgrade/file associations/offline startup on all supported hosts. Do not auto-tag or publish until these gates pass and release authorization is explicit.

## Full outstanding ledger — all 97 items

This enumeration is generated directly from the original ledger's current dispositions. **PENDING does not always mean no code exists:** 16 such rows already point to merged or drafted remediation commits and must be reconciled rather than reimplemented blindly.

### NATIVE VALIDATION REQUIRED (10)

#### P1 — 1 findings

| ID | Original finding | Ledger follow-up |
|---|---|---|
| PB-03 | Hidden or tray window may have its renderer suspended, and the renderer owns queue advance | #2; PASS / PASS / PASS |

#### P2 — 8 findings

| ID | Original finding | Ledger follow-up |
|---|---|---|
| PB-13 | No handling of output-device loss or system default-device changes | #4; G1 pass (unit) / G2 pass / G3 approve after fixes, re-review pending |
| AR-12 | Windows runs two media-control (SMTC) integrations; one bypasses the renderer and emits events nobody listens to | #4; G1 pass / G2 pass (Windows CI compiles) / G3 approve |
| AR-07 | Audio thread exits permanently if no output device exists at startup | #2; PASS / PASS / PASS |
| LD-06 | Database initialization failure exits silently with no user-visible message | #6; G1 pass (unit) / G2 pass / G3 approve (after 2 objections) |
| QA-05 | Cover art over the `cover-art://` custom protocol likely fails on Windows, falling back to slower IPC | #6; G1 pass (unit) / G2 pass / G3 approve |
| QA-06 | Windows canonical paths keep the `\\?\` prefix | #6; G1 pass (unit) / G2 pass / G3 approve after 1 objection |
| AR-13 | Linux applies the full app menu to every window, including the 320x92 mini player | #6; G1 n/a (platform) / G2 pass / G3 approve |
| SEC-04 | Release signing secrets are readable by dependency install and build scripts | #8; G1 pass (config check) / G2 pass / G3 approve |

#### P3 — 1 findings

| ID | Original finding | Ledger follow-up |
|---|---|---|
| AR-26 | macOS builds two app menus; label updates go to the replaced one | #6; G1 n/a (platform) / G2 pass (macOS via CI) / G3 approve |


### DECISION REQUIRED (1)

#### P2 — 1 findings

| ID | Original finding | Ledger follow-up |
|---|---|---|
| QA-18 | Critical paths have no tests, and existing tests encode the wrong IPC payload | #9; G1 pass / G2 pass / G3 pending |


### PENDING (86)

#### P2 — 7 findings

| ID | Original finding | Ledger follow-up |
|---|---|---|
| FE-16 | Five separate volume implementations behave differently | #11; - |
| FE-17 | The neobrutalism full player is dark blurred glass | #11; - |
| FE-18 | Parallel liquid and neo component trees diverge in behavior, not only appearance | #11; - |
| FE-26 | Playlists view: no virtualization, raw type names, no per-track play | #11; - |
| FE-30 | Home and library styling contradicts the documented design language | #11; - |
| FE-22 | No RTL or bidirectional text handling for Arabic metadata and lyrics | #11; - |
| FE-08 | Liquid icon-rail mode has no window drag region; the liquid album view has no Back button | #11; - |

#### P3 — 79 findings

| ID | Original finding | Ledger follow-up |
|---|---|---|
| PB-21 | Playback speed changes pitch | - |
| PB-23 | Pausing during a crossfade lets the fade finish while paused | - |
| PB-24 | Seek while paused may briefly play audio; seek events carry no generation; every seek reopens the file | - |
| PB-25 | Decoder does not filter packets by track ID | - |
| PB-26 | Scanner accepts formats the decoder cannot play; Opus is not scanned | - |
| PB-32 | Volume booster hard-clips and is not persisted | - |
| LD-04 | `PlaybackCoordinator` contract is only partly enforced: generation setter is not monotonic and editor preview bypasses the current track | #19; partial G1 test / G2 - / G3 - |
| PB-28 | Two quick Next presses advance only one track | #17; G1 tests added / G2 - / G3 - |
| PB-29 | Removing the playing track from the queue makes Next skip a track | #12; G1 tests added / G2 CI pass / G3 - |
| PB-20 | Quit and window close do not save the latest state | - |
| PB-16 | Playlist reorder resets every entry's added date and rewrites the whole list from client state | - |
| PB-17 | Playlist mutation IDs never protect an actual retry | - |
| PB-27 | LRC parser edge cases | #11; G1 tests added / G2 CI pass / G3 - |
| PB-33 | Folder reconcile prefix match is case-insensitive | - |
| PB-19 | Watch events use canonical paths but are matched against folders as configured | - |
| AR-21 | Schema and index issues | - |
| AR-22 | Deep-link track resolution hashes every row | - |
| AR-34 | Shuffle-all and aggregates pull whole-library payloads into JavaScript | - |
| AR-35 | Smart-shuffle de-clustering is roughly quadratic in the worst case | - |
| LD-07 | Genre is editable in the tag editor but absent from the library schema | - |
| QA-04 | Legacy `music-player` data may not migrate on Linux | - |
| LD-19 | Backend diagnostics go to stderr instead of the configured log plugin | - |
| AR-32 | Hidden mini-player webview is created at startup even though the feature is off by default | - |
| QA-10 | Help > README menu item is broken | #13; G1 tests added / G2 - / G3 - |
| QA-11 | Autostart `--minimized` flag is never read | #15; G1 tests added / G2 - / G3 - |
| QA-13 | The same deep link clicked twice in one session does nothing the second time | #16; G1 tests added / G2 - / G3 - |
| QA-14 | "Play once" authority is consumed when playback starts, so artwork, palette and preload for that file fail | - |
| SEC-10 | macOS media plugin never releases its Objective-C objects and has no autorelease pool | - |
| LD-11 | Copy and pluralization defects | - |
| FE-34 | Hard-coded "TARAB V1.1" overlaps the neo Settings title | - |
| FE-35 | Command palette is limited and shows Mac-only glyphs everywhere | - |
| FE-36 | No keyboard-shortcut reference; Up/Down silently change volume | - |
| FE-38 | Desktop mini window seek target is 4 px tall and ignores the theme | - |
| FE-39 | "Lyric size" is labelled in px but is a 1 to 100 scale | - |
| FE-40 | Neo Home copy is jargon-heavy and its cards move despite the neo spec | - |
| FE-44 | Queue empty state has no call to action | - |
| FE-45 | Heavy stacked `backdrop-filter` in the liquid theme | - |
| LD-14 | Settings persistence skips validation on the current version and swallows write failures | - |
| FE-46 | Two settings behave inconsistently with their defaults or lifecycle | - |
| FE-37 | Collapsed pill player is not keyboard-operable and is mispositioned | - |
| FE-41 | Virtualized lists lack list semantics; queue drag-and-drop sees only rendered rows | - |
| FE-42 | `SmoothTimeProvider` runs a requestAnimationFrame loop even when paused or unused | #14; G1 tests added / G2 - / G3 - |
| AR-20 | A single `Mutex<Connection>` serializes every read behind long write transactions | - |
| AR-30 | Initial bundle is about 955 KB of JavaScript (292 KB gzip) and the size check has no byte budget | - |
| AR-31 | Redundant UI dependencies | - |
| AR-33 | `App.tsx` is a god component; large view files carry most of the complexity | - |
| AR-36 | Errors are untyped strings and behavior depends on message text | - |
| AR-25 | Dead code, dead dependencies and unused IPC surface | - |
| AR-28 | Image cache: dead in-memory LRU, mtime-based "LRU", possible size underflow, renderer-only enforcement | - |
| AR-29 | Waveform cache is keyed by path, unbounded on disk, and goes stale after edits | - |
| PB-22 | `rubato` dependency unused; sample-rate conversion uses rodio's linear converter | - |
| AR-37 | Minor reliability items | - |
| SEC-03 | Waveform generator sizes a buffer from an unvalidated sample rate | #18; G1 tests added / G2 - / G3 - |
| SEC-05 | Library grants accept `/` or the home folder; "Import folder" grants the launched file's parent with only a base-name prompt | - |
| SEC-06 | `opener:allow-reveal-item-in-dir` has no path scope | - |
| SEC-07 | The online-lyrics opt-in is enforced only in the renderer, and request errors carry metadata | - |
| SEC-08 | The mini window may emit any event name to the main window | - |
| SEC-09 | Linux media plugin writes artwork to a fixed `/tmp` path following symlinks | - |
| SEC-12 | Several commands check one path and then operate on another (time-of-check to time-of-use) | - |
| SEC-13 | Reconcile deletes rows based on renderer-reported traversal completeness | - |
| SEC-14 | `db_rename_track_path` and `db_delete_tracks*` perform no library-root check | - |
| SEC-15 | `tarab://open/play` starts playback without confirmation and IDs are unsalted path hashes | - |
| SEC-16 | Full file paths reach persisted logs unredacted | - |
| SEC-17 | Bundled SQLite (rusqlite 0.31 / libsqlite3-sys 0.28) and glib 0.18 are behind upstream advisories | - |
| SEC-18 | CI workflow uses mutable action tags and default token permissions | - |
| SEC-19 | No navigation guard on the webviews | - |
| QA-12 | Tag editor cover picker only accepts images inside a library root, and writes WebP covers with a JPEG MIME type | - |
| QA-17 | A delete test exercises a test-only helper instead of the shipped command path | - |
| QA-29 | `fixed_store` writes without fsync and has no size limit | - |
| QA-19 | No coverage thresholds; coverage not run in CI; Linux release jobs run no Rust tests | - |
| QA-20 | CI has no Rust cache, runs a redundant `cargo check`, and installs the legacy appindicator package | - |
| QA-21 | Release re-runs use `gh release upload --clobber` | - |
| QA-22 | The repository's knip configuration disables the rules that would find dead code | - |
| FE-32 | Dead UI code and unused CSS | - |
| FE-33 | Duplicated and conflicting CSS | - |
| QA-30 | Visual baselines are orphaned and Storybook coverage is thin | - |
| QA-23 | Vendored `tauri-plugin-media` has no patch record | - |
| QA-24 | Dependency weight and duplicate versions | - |
| QA-25 | Documentation drift | - |


## Release decision and exit criteria

**NO-GO** until current-head CI on every approved change and combined `main` is green; all release-blocking correctness/security findings are resolved or explicitly risk-accepted by the owner; native tests recorded across supported platforms; `pnpm verify:release` and all relevant release workflow jobs pass; protected-branch checks exist; and signed release artifacts/checksums/attestations are verified. The remaining P3 design/copy/performance decisions may be deferred **only** after review establishes they do not undermine safety, function, release promises, or accessibility.

No tests, signed builds, release tags, secret configuration changes, native smoke tests, or independent adversarial approvals are claimed as performed by this report.
