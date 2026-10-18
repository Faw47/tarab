# Corrective stabilization implementation plan

**Goal:** Stabilize corrective PRs #20, #23 and #24, reconcile #25, and establish evidence for the next security/data-integrity phase.

**Architecture:** Keep the existing Tauri/Rust and React architecture. Extend PlaybackCoordinator's existing intervention guard to invalidate queued adjacent intents and stale failures. Do not claim to serialize native commands already in flight.

**Spec:** `docs/audits/tarab-remediation-ledger.md`, original audit and `AGENTS.md`.

## Constraints and review focus

- Preserve the verified GitHub noreply identity, existing public interfaces and unrelated changes.
- Test two queued Next commands interrupted by Stop, Play or preview, including before callbacks start.
- Preserve two uninterrupted Next commands and recovery after a current command fails.
- Stale successes and stale failures must not change newer UI state or produce obsolete failure notifications.
- Verify stalled hydration, unmount and StrictMode cleanup without changing minimized/tray semantics.
- Keep native GUI/audio and release qualification separate from frontend and cross-platform CI evidence.

## Task 1: Playback cancellation

Files: `src/lib/playback-actions.ts`, `src/lib/__tests__/playback-actions.test.ts`, `src/features/app/usePlaybackLifecycle.ts` and its tests.

- [x] Add regressions for queued Next interrupted by a newer intervention and observe failure before modifying implementation.
- [x] Use an adjacent-request batch with the existing intervention epoch so preceding adjacent commands remain ordered but direct interventions cancel the old batch.
- [x] Add delayed-rejection tests, observe failure, then suppress only superseded command failures; retain active-operation errors.
- [x] Run focused tests, TypeScript, Biome and full frontend verification. Commit and push one cohesive follow-up on #20.

## Task 2: Startup and Help

Files: startup hook and tests on #23; capability, release-check script and native-menu tests on #24.

- [x] Review exact PR deltas independently.
- [x] Exercise stalled-hydration unmount in addition to the existing ordinary-launch teardown test.
- [x] Validate actual capability JSON, denied opener handling, and release guard negative cases.
- [ ] Require final-head CI before any merge. Record required native smoke tests as outstanding.

## Task 3: Integration and evidence

Files: #25 audit reports and remediation ledger.

- [x] Integrate accepted corrective branches locally and run combined frontend release checks.
- [x] Record G1/G2/G3 evidence by actual tested commit, not historical branch results.
- [x] Correct the QA-18 plan: the unresolved decision concerns generated IPC types and missing tests, not an already agreed coverage percentage.
- [x] Reconcile current PR references and dispositions without marking untested native behaviors verified.
- [ ] Merge only when applicable gates are satisfied; no release tag or publication.

## Execution decisions

The user has already authorized continuing the implementation and previously authorized merging ready corrective PRs. This plan is executed inline; independent review uses a separate reviewer. The fresh clone is isolated from any pre-existing user checkout. Native tests require a supported desktop host; an unavailable host does not count as a pass.

## Observed evidence

- #20 candidate `afe4559`: independent renderer G3 pass; 13 additional cases, with queued and stale-failure defects observed red before correction.
- #23 candidate `87a0c59`: five added lifecycle cases, 13 startup tests pass; native acceptance remains open.
- Combined candidate tree: 384 tests/89 files and frontend, Storybook, Knip, release-config gates pass.
- Four release-guard mutations rejected.
- Cargo/native testing unavailable locally. Never infer native acceptance from CI.
