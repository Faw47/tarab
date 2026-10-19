# Security and session durability remediation

Continue the original audit from main f9058f8, preserving Rust/Tauri and React patterns.

1. SEC-05: reject canonical filesystem-root and bare-home grants at native creation and before
   reauthorization rebases tracks. Keep existing grants and exact-file Play once. Show full folder
   scope and preserve the prompt after a rejected import. Test paths, aliases, consent and retry.
2. QA-29: cap actual reads and encoded writes at 64 MiB, create staging exclusively, sync and
   replace without removing the original first. Recover the old Windows backup only if the
   primary is missing. Test oversized input/output, escaping, replacement, backup and corruption.
3. PB-20: capture fresh session state and drain writes before quit, cancel pending debounce,
   preserve tray hiding and hold the renderer alive for native closes/exits. Cancel quit on save
   failure. Test pending writes, failure/retry, latest navigation, duplicate quit, hydration,
   unmount and native request/cancel/timeout/approve state transitions.

Verification: complete frontend and Linux Rust suites, TypeScript, Biome, IPC contract, production
build/bundle guard, Storybook, Knip, release guard, Rust fmt/check/strict Clippy and independent
review. Windows/macOS CI and desktop/audio/logout acceptance remain separate required gates.

Recovery: the original unpublished checkout became unavailable when the environment changed.
Rebuilt from recorded source changes against unchanged f9058f8. Five critical blob hashes matched
exactly before a deliberate additional latest-navigation correction. No prior test results are
being substituted for fresh verification. Source and audit changes are local only.

Review: the original Important cancel/retry race is retained as a correction and covered by two
regressions. Recovery review found stale view/album capture during a delayed cancellation retry;
a failing regression now drives a latest-callback ref. Other source wiring has no reported
blocking omissions. Documentation is restored alongside the candidate.

Ruling: keep a ten-second native timeout for an unavailable renderer. It bounds shutdown but may
lose the latest position on very slow storage or a hung renderer.
Ruling: reuse the existing staged-content sync/replacement helper. Directory sync remains
best-effort, so universal power-loss safety is not claimed.
Deferred minor: deterministic fixture for a file growing between metadata inspection and the
bounded read. Actual reading uses Read::take and checks its length afterward.

Publishing is blocked by the earlier automatic approval rejection. Do not use another route to
publish source. Prepare the branch and verification record for explicit approval, then run final
cross-platform CI and required acceptance before merging or closing these three ledger entries.


Completed locally on the rebuilt candidate: 397 frontend tests in 91 files, 150 Linux Rust tests,
TypeScript, Biome, 117 IPC contracts, production build/bundle guard, Storybook, Knip, release
configuration, Rust fmt/check and strict all-target/all-feature Clippy. Six storage regressions
failed against original code and pass after restoration. Latest-navigation regression also
failed before and passed after the callback correction. Desktop binary launch failed GTK setup.
All three ledger rows remain PENDING for platform CI and native acceptance. Publishing is blocked.


Publication authorized: the user approved the branch push and draft PR. Shell credentials are
unavailable, so the connected GitHub API published an identical source tree in commit 96296c9,
with verified noreply author and committer. Cross-platform PR checks are the next gate.
