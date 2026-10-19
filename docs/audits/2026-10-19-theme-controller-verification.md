# Theme controllers and pending evidence review

Base: published PR #30, commit `0f5a971c2af86f308462ba0cb0198c9591aa8bd1`. All five exact-base
CI jobs passed. Candidate branch: `chatgpt/remediation-theme-controllers`.

## FE-18 changes and regressions

The prior Home data/controller work already corrected the always-present neo hero, missing View
all/statistics, unhandled transport promises, missing liquid scroll notification and empty rail.
Album rows still differed in details, selection clicks, Space and current-track activation.

Both album skins now use one controller for row intents, selection, focus, hold and parent-owned
playback. Nine new rendered regressions failed before correction. Two nested-control double-click
regressions then reproduced playback bubbling and passed after excluding interactive targets.
Two Home tests reproduced missing accessible/shared fallback statistics. Home skins now share
transport callbacks and statistics derivation, while retaining presentation and error source names.

Independent review found one Important defect: touch compatibility mousedown cleared the completed
hold marker, so release-click selected twice. Both theme cases failed before correction. Physical
pointerdown now resets suppression; compatibility mouse events preserve it. Full touch sequences,
controlled parent selection and a fresh physical mouse gesture pass. Independent focused review
reports 90 tests across four files passing and no unresolved Critical/Important renderer finding.
The initial minor Home test-matrix gap was filled for both skins/all transports, empty and loading.

The app does not currently supply the optional details callback; this change makes its contract
consistent without claiming a new app-wide details surface. FE-18 requires native WebView mouse,
touch and keyboard plus audible playback acceptance, so it is NATIVE_VALIDATION_REQUIRED.

## Candidate gates

- Frontend: 490 tests in 96 files pass. Existing jsdom window.scrollTo advisory also appears on
  prior album/lyrics baselines; no failed test is omitted.
- TypeScript and Biome pass; one pre-existing noConfusingVoidType warning remains.
- Production build, initial bundle guard, 118 IPC contracts, Storybook, Knip and release guard pass.
- Storybook/Knip were repeated successfully after the final touch handler/test correction.
- Native source and dependencies are unchanged. No local Cargo or native app run is claimed.
- Published candidate CI must still be checked on its exact head; this is a draft, not a merge.

## Independent reconciliation of earlier fixes

A second read-only reviewer checked the published baseline, excluding this candidate's changes.
Existing focused tests passed: playback-actions 24, player-store 19, deep-link parser 8, deep-link
hook 3, startup 13, native menu 6; total 73 across six files. IPC and release guards passed.
Historical fail-before evidence was not recreated for these earlier fixes.

| Finding | Result |
| --- | --- |
| PB-28 | Original rapid-Next serialization reviewed clean; native rapid Next/Stop/audio acceptance remains. Concurrent queue edits during native IPC remain broader LD-04 work. |
| PB-29 | Still PENDING: History indices are wrong after removing the active entry, causing wrong/no removal or replay. |
| QA-10 | Main-only exact Help URL and failure reporting reviewed clean; native Help and mini-window denial remain. |
| QA-11 | All 13 startup cases pass; native login/tray behavior remains. Cleanup after unmount stays bounded by hydration or three seconds. |
| QA-13 | Still PENDING: a genuine repeat inside the startup window is dropped when no mirror arrives. |
| SEC-03 | Verified source arithmetic and exact-base three-platform Rust CI. Maximum chunk 307200 f32 values, 1228800 bytes. One Rust test contains seven assertions; no malformed-file decode or local Cargo claim. |

Ledger: 65 FIXED_VERIFIED, 24 NATIVE_VALIDATION_REQUIRED, 68 PENDING, one decision, one already
resolved and one duplicate, preserving all 160 original IDs. The PB-29/QA-13 objections require
code changes in the next focused continuation.
