# Queue History and deep-link lifecycle continuation

Base: `ecfe6462f647b05c7fe900a0064b1af9b6dbdfb4`, draft #32.
Findings: PB-29 and QA-13 in the comprehensive audit and remediation ledger.

## Constraints

- Preserve the two queue skins, queue-entry identity, parent-owned playback state and IPC contracts.
- Every post-subscription deep-link event is a separate intent. Deduplicate only the startup snapshot against events already received.
- Await listener registration before reading the snapshot. Dispose registration and pending work on unmount.
- Preserve parsing and avoid new dependencies or native changes.
- Use existing GitHub PR CI for actual red/green evidence.
- Keep native acceptance separate and do not merge or publish a release.

## Tasks

1. Reproduce rendered History replay/removal after removing middle, final and duplicate playing entries; cover duplicate entries inside History and the Played count.
2. Correct History indexes using the actual played prefix and derive summary counts from the displayed slices.
3. Reproduce startup registration order, rapid repeats, snapshot/event overlap, startup failure, callback replacement and pending-work cleanup.
4. Replace timing-based suppression with an effect-scoped subscription, startup overlap set and immediate disposal guards.
5. Obtain independent review, address substantiated issues with regression evidence, run the full CI gates and update the global ledger only to the supported disposition.

## Progress

- Final tests-only commit `1290879`: CI run 39493591993 reproduced all 30 expected assertions; 490 frontend tests passed.
- Production changes fix queue History identity/indexing and startup deep-link lifecycle, with regressions for both themes and asynchronous cleanup.
- An earlier validation attempt was based on the pre-Opus branch and is superseded. The current restack onto `ecfe6462` is awaiting its own full CI run.
- Independent source review found no remaining code blocker. Native rapid Next/History playback and repeated deep-link acceptance remain open.

## Rulings

Use an isolated remote branch with the existing PR CI because this session has no usable local execution environment. Do not infer post-fix G2 from source inspection or a previous branch.
Snapshot deduplication covers URLs already observed while the snapshot is pending. Events delivered after the snapshot remain intents; URL equality alone cannot identify a delayed native mirror.
