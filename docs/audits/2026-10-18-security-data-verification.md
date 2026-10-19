# Security and session durability continuation

Base: `f9058f82a49b357ccc186972ab98c58b8a6024ec`.
Implementation: `96296c900c46982de565eb9f789cfdb89f02886b`.
Branch: `chatgpt/remediation-security-data`, published after explicit approval.

SEC-05, QA-29 and PB-20 are implemented in this candidate. Their ledger entries remain PENDING
until cross-platform checks and relevant desktop acceptance pass. The release verdict is NO-GO.
The source branch is published; nothing has been merged or released.

## Changes

- SEC-05: reject canonical filesystem roots and bare-home selections at the native grant boundary
  and before reauthorization rebases tracks. Existing grants and exact-file Play once are intact.
  The import prompt shows full folder scope; rejected imports leave Play once/Cancel available.
- QA-29: cap actual reads and serialized writes at 64 MiB, including JSON escaping expansion.
  Buffered serialization uses exclusive staging and the existing synced replacement helper.
  The original stays in place until replacement succeeds. Recover the legacy Windows backup
  only if the primary is missing; corrupt primary or backup data reports an error.
- PB-20: capture a fresh hydrated session, cancel debounce and wait for writes before exit.
  Main close, native menu/tray Quit and ExitRequested keep the renderer alive for persistence.
  Hide-to-tray stays unchanged. Explicit save failures cancel quit and allow retry. Retry uses
  the latest navigation/album callback. An unavailable renderer gets a ten-second exit fallback.

## Fresh verification after workspace recovery

| Check | Result |
| --- | --- |
| Frontend suite | 397 tests in 91 files passed |
| Linux Rust suite | 150 tests passed; binary/doc suites empty and passed |
| TypeScript and Biome | Passed; one existing unrelated noConfusingVoidType warning |
| IPC contracts | 117 wrappers and invoke argument shapes passed |
| Production build and bundle guard | Passed; existing large-chunk advisory remains |
| Storybook and Knip | Passed |
| Release configuration | Passed |
| Pinned Rust 1.92 fmt/check/all-target/all-feature strict Clippy | Passed |
| Windows/macOS CI | Pending on the published PR head |
| Desktop/audio/close/quit/tray/logout acceptance | Not performed |
| Signed installers, clean install, upgrade and release assets | Not performed |

The renewed desktop launch built the binary but failed GTK initialization in this displayless
container. Unit tests and compiler checks do not substitute for supported-OS desktop use.

## Reproduction and independent review

The unchanged original fixed-store implementation was combined temporarily with the new tests
and restored in a finally block. Six tests fail against it: oversized read/write, encoded escaping
expansion, missing-primary backup recovery, corrupt missing-primary backup handling, and cleanup
after replacement failure. All eight Linux fixed-store tests pass on the fixed implementation.
Windows additionally has a gated locked-regular-file replacement test.

Grant consent and session-lifecycle tests cover full path, rejected-import Play once, cancellation,
fresh position, pending writes, duplicate quit, save failure/retry, hydration, timer cancellation
and unmount. Native tests cover canonical root/home, Unix home aliases and shutdown state;
Windows drive/UNC roots remain gated to Windows.

Independent review found an Important cancel/retry race. Its correction is preserved: window
focus does not block cleanup, and requests arriving during failed-save cancellation are replayed.
Two regressions cover cancellation and focus delays. Recovery review found no blocking source
omissions, but identified stale navigation in recursive retry. A further test failed before the
latest-callback ref and passed afterward. The full suite passed after that correction; no fresh
independent re-review of the final ref-only correction is claimed.

## Recovery evidence

The original unpublished checkout and local commits became inaccessible after the tool
environment changed. GitHub main remained f9058f8 and the unpublished branch returned 404.
The candidate was reconstructed from recorded changes, then freshly tested. Five critical files
matched previously recorded git blob hashes exactly before the latest-navigation follow-up:

| File | Recovered blob |
| --- | --- |
| file_ops.rs | f54d1a888423c74a4c7cd9679b85112313409ee6 |
| fixed_store.rs | bdd0d5722c7178556c8a8eb4768391823f15aa27 |
| lib.rs | 61acb532ab8a9f71d102503856ea947e7eb0bb8d |
| useSessionPersistence.ts | 51bd4fc9111951bd1f4957f7cdcddc0065646e71 |
| useDesktopIntegration.ts | 82f1c7daf5805ab74c1c13c75175cd5cd89b2ab8 |

The final quit coordinator intentionally differs by the latest-callback ref and its regression.
README, AGENTS, design language, release-hardening, plan and audit evidence were restored too.
No dependency manifest, lockfile, lint rule or test expectation was weakened. Checks use local
installed binaries; the official pinned Rust toolchain was hash-verified. Prior test results
were not substituted for the fresh results above.

## Decisions, deferred coverage and platform limits

- The ten-second native timeout bounds shutdown with an unavailable renderer, but very slow
  storage or a hung renderer can lose the latest position. Explicit save failure cancels it.
- Staged contents are synced by the existing helper; Unix directory sync is best-effort.
  Universal power-loss durability is not claimed.
- Deferred minor: deterministic fixture for a file growing between metadata inspection and read.
  The actual read uses Read::take and checks the resulting length.
- Still required: supported-OS menus/tray/Dock/window close, OS logout, startup before hydration,
  disconnected sources, aliases/UNC roots, read-only/locked stores, disk full and renderer stalls.

## Publication and next work

The user explicitly approved publishing the branch and opening a draft PR. Shell GitHub
credentials were unavailable, so the connected GitHub tools published the source as `96296c9`.
Every blob and the complete source tree match the locally tested implementation exactly
(tree `dc74a2ba519626835ec161ab9b8851720f695f4e`). Both author and committer use the configured
GitHub noreply identity. The earlier approval block is resolved.

Create the draft PR against main and run final-head CI on all three platforms. Do not merge based only on Linux results. After qualification, continue with
SEC-06 scoped file reveal, SEC-07 native online-lyrics consent/privacy, the remaining security/data
rows and native playback-command coordination. None of those later items is claimed implemented.
