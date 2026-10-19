# Theme controller parity implementation plan

> Execute inline with superpowers:executing-plans and test-driven-development.

**Goal:** remove the remaining album interaction divergence and share Home transport/statistics behavior for FE-18.

**Architecture:** keep both visual skins and the existing parent-owned selection/playback state. A shared album controller owns row intents, selection, long press and keyboard navigation. A shared Home controller owns transport failure handling and statistics fallback. Native commands and public component props stay intact.

**Tech stack:** React, TypeScript, Vitest, Testing Library, existing Zustand playback coordinator.

**Spec:** FE-18 in docs/audits/2026-10-17-tarab-comprehensive-audit.md; AGENTS.md.

## Constraints and review focus

- Preserve liquid/neo presentation; no dependency or native command changes.
- Enter/double click requests playback, including the current track, through the supplied parent callback.
- Plain click opens optional track details in either skin; selection mode and modifier clicks select instead.
- A completed hold must not also open details or select twice through the release click.
- Keyboard input on nested controls stays with the control; Space selects in selection mode and activates otherwise.
- Missing aggregate statistics use loaded tracks consistently. Failed transports report once.
- No claim that a currently unused optional details callback provides an app-wide details surface.

## Task 1: album controller

- [x] Add rendered cross-theme tests for optional details, modifier/selection clicks, playback activation, Space, and a complete hold/release/click sequence. Run and observe failures.
- [x] Create src/components/shared/useAlbumTrackController.ts using the existing selection, hold and focus helpers. Wire both skins to the same row intent handlers.
- [x] Run all album tests and frontend suite; preserve cancellation and focus behavior.

## Task 2: Home controller

- [x] Reproduce missing neo statistics without aggregate metadata, and test transport failures in both themes.
- [x] Create src/components/home/useHomeController.ts and share statistics and transport callbacks between skins.
- [x] Run the focused tests and complete frontend gates, Storybook, Knip and release guard.

## Task 3: review and publication

- [x] Obtain a fresh independent branch review and address substantiated blockers with regression tests.
- [x] Record exact gates and remaining native acceptance, update documentation/ledger and prepare the stacked draft.

Task 1: complete. Nine initial album regressions and two nested-control regressions reproduced, then corrected. Final independent touch objection reproduced in both skins and corrected; parent-controlled selection and fresh physical gestures pass.

Task 2: complete. Two Home statistics failures reproduced and corrected. Both skins now cover all three rejected transports exactly once, loading and empty states.

Task 3: code review PASS. Final whole frontend suite 490/490; tsc, Biome, build/bundle, Storybook, Knip, release/IPC guards pass. Existing jsdom scroll advisory, Biome warning and Vite chunk advisory recorded. No native acceptance or local Cargo claim. Publication follows this commit.

Ruling: use the established docs/plans directory and manual progress entries because cloud skill helper scripts are not available as executable local files. The user's instruction authorizes continued inline execution and draft publication. Pre-flight: both controllers consume existing parent callbacks; neither creates playback or selection state outside those owners.
