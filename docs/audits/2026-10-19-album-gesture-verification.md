# Album hold-selection parity continuation

Branch: `chatgpt/remediation-album-gestures`, stacked on PR [#28](https://github.com/Faw47/tarab/pull/28)
head `6707606c1898f279ac21ad15d8bb0f23da6ed0fc`. Its five CI jobs passed in run
[39194273197](https://github.com/Faw47/tarab/actions/runs/39194273197).

## Change and scope

Both album skins now consume `useAlbumTrackLongPress` rather than a liquid-only local timer.
A 500 ms primary mouse or touch hold activates parent-owned single-track selection without
requesting playback. Release, leave, touch movement/cancellation, context menu opening,
unmount and track-list replacement cancel pending work. Secondary mouse presses and nested
interactive controls do not start selection. A callback replacement uses the current parent.
One album owns one timer; a newer row hold supersedes the previous one.

Existing click/double-click, keyboard activation and focus behavior is preserved. FE-18 stays
PENDING: neo still toggles an already-current track on activation while liquid requests playback,
and separate view/action controllers remain. This is a focused parity correction, not a claim
that all theme behavior and architecture now match. No merge or release is justified here.

## Evidence

The added renderer tests produced 11 expected failures against the published source, then passed
after the shared handler was installed. Independent whole-branch review found no scoped blocking
regression. A subsequent self-review reproduced pending selection surviving context-menu opening
in both skins (2 failures); cancellation was added and the full suite rerun successfully.

| Check | Final result |
| --- | --- |
| Album row tests | 39 passed; 28 added cases across both skins |
| Complete frontend suite | 446 tests in 96 files passed |
| Node / package manager | Pinned Node 22.18.0 and pnpm 9.15.2; frozen lockfile, no dependency changes |
| TypeScript / Biome | Passed; one existing noConfusingVoidType warning remains |
| IPC | 118 wrappers and argument shapes passed |
| Production build / initial bundle | Passed; existing large-chunk advisory remains |
| Storybook / Knip / release configuration | Passed; both album skin fixtures included |
| Independent review | Scoped source clean; final context-menu correction verified by failing tests and green suite |
| Native subtree | Byte-identical to PR #28; local Rust toolchain unavailable in restored environment |
| New published head CI | Must be checked on the draft's exact head |
| Interactive browser / native touch | Not completed |

The browser connected, but navigation failed with HTTP 401. Storybook's dev server also hit an
`uv_interface_addresses` restriction; a static preview connection was refused. The static Storybook build and synthetic event tests passed. No screenshot, actual
WebView touch, compatibility mouse-event or native context-menu behavior is claimed. Existing
jsdom scrollTo noise is unrelated. Timer tests do not assert one callback for an entire browser
gesture: neo's normal post-release click can repeat the parent's idempotent selection assignment.

Native acceptance: hold/select/release in both skins using mouse and touch, scroll cancellation,
context menus, nested controls and album switching; confirm selection and playback remain distinct.
All 160 ledger IDs and current disposition totals remain intact.
