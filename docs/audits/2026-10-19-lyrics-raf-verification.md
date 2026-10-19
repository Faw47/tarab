# Enhanced lyric gaps and RAF lifecycle verification

Branch: `chatgpt/remediation-lyrics-gaps`, stacked on PR [#29](https://github.com/Faw47/tarab/pull/29)
head `58f10e32e681635f240417058bf48788a5a322b5`. This candidate changes only the parser, parser
regressions and documentation. Native source, dependencies and scheduler source are unchanged.

## PB-27: enhanced instrumental gaps

Prior merged fixes covered offset sign/global placement, colon fractions, long fractions and
plain timed empty lines. Independent review reproduced a remaining case: an enhanced empty line
`[00:15.00]<00:15.00>` or a word-only `<00:15.00>` was discarded. At 16 seconds the current-line
resolver still selected the preceding Verse instead of the instrumental interval.

The parser now retains these markers with empty words. When no sung words exist, marker times
supply the real line start; the existing offset, ordering, end-time and normalization paths apply.
No dummy karaoke word is introduced. Four new tests failed before correction and passed after:
both marker forms, whitespace-only markers with late offsets, and repeated line timestamps.
Current-line resolution and normalized empty runs are covered.

A fresh independent parser reviewer found no blocker, ran all 11 parser tests, compared 90
nonempty enhanced/prefix fixtures against baseline without output changes, and checked 12
additional blank-marker/offset cases for finite timing and empty words/runs. These comparisons
were reviewer supplemental checks, not 102 new committed tests. The deterministic parser finding
is FIXED_VERIFIED. Native lyric appearance and audio synchronization remain unperformed.

## FE-42: existing scheduling fix reconciled

Temporarily substituting `smooth-time.tsx` from the parent of 13ff91c made all six current
lifecycle regressions fail, including an unwanted RAF with no subscribers. The production file
was restored in a finally block and its bytes checked. Current tests pass: unused/paused loops
stay stopped, pause/seek notifications work, active playback schedules frames, final unsubscribe
cancels the loop, and imperative reads work without subscribing.

Independent review also checked the production useSmoothTime path, StrictMode, current callbacks
and stale cancelled callbacks; no source objection remains. FE-42 is FIXED_VERIFIED for this
resource lifecycle contract. Visibility throttling, visual smoothness and audio synchronization
are not asserted. Hidden playing subscribers may still have an active RAF, which was outside the
original paused-or-unused finding.

## Candidate gates

| Check | Result |
| --- | --- |
| Focused parser/provider tests | 17 passed |
| Complete frontend suite | 450 tests in 96 files passed |
| TypeScript / Biome | Passed; existing unrelated noConfusingVoidType warning remains |
| IPC / production build / initial bundle | 118 contracts and build checks passed |
| Knip / release configuration | Passed |
| Storybook | Passed on the preceding album revision; not rerun for this parser-only change |
| Independent review | Parser and scheduler scope clean |
| Native checks | Native subtree unchanged; PR #28 all five CI jobs passed at 6707606 |
| New-head CI | Must be checked on the published draft's exact head |
| Native visual/audio acceptance | Not performed |

Ledger totals: 64 FIXED_VERIFIED, 20 NATIVE_VALIDATION_REQUIRED, 73 PENDING and three other
dispositions, preserving all 160 original IDs. FE-18 stays PENDING for broader theme parity.
No merge, release or installer-readiness claim.
