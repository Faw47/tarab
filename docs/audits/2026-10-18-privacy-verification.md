# File reveal and lyrics privacy continuation

Branch: `chatgpt/remediation-privacy`, stacked on published PR [#26](https://github.com/Faw47/tarab/pull/26)
(base `0d5184cce69de2f2ea84d8c1780be01160ef7f15`). This candidate addresses SEC-06 and SEC-07.
No merge or release is authorized by these verification results. Release verdict remains NO-GO.

## Behavior

- Renderer opener access is limited to the exact Help URL. Track reveal retains the native
  library-grant check. Playlist repair calls a parameterless main-window-only native command
  that derives and opens the app-data directory; it cannot receive a renderer-selected path.
- Both online lyrics entry points call the same native gate before constructing an HTTP request.
  Consent must be the boolean `true` in primary `settings.json` at
  `tarab-settings.state.autoLyrics`. Missing, wrong-type or corrupt primary settings block online
  lookup. A stale enabled `.bak` cannot resurrect network consent; ordinary store recovery remains.
- Local sidecar lyrics resolve before the network consent read. Optional online lookup waits for
  pending frontend settings writes and cancels if its effect is replaced while waiting.
- Reqwest errors strip the request URL containing title, artist, album and duration. Endpoint,
  redirect, timeout and response-size limits remain in place. README names the metadata sent.

## Verification

| Check | Result |
| --- | --- |
| Frontend | 403 tests in 93 files passed |
| Rust 1.92 Linux | 153 tests passed; binary/doc suites passed |
| TypeScript / Biome | Passed; existing unrelated noConfusingVoidType warning remains |
| IPC contract | 118 wrappers and argument shapes passed |
| Production build / initial bundle | Passed; existing large-chunk advisory remains |
| Storybook / Knip | Passed |
| Rust fmt / check / all-target all-feature strict Clippy | Passed |
| Release configuration | Passed |
| Permission mutations | 12 forbidden variants across opener, core and core-mini rejected |
| Independent review | Both substantiated findings corrected; final re-review has no objections |
| New branch Windows/macOS/Linux CI | All five jobs passed at 5f844a8 in PR #27, run 39193327400 |
| Native launch | Binary built; GTK initialization failed in displayless container |
| Native file-manager / live LRCLIB integration | Not performed |

Playlist-folder routing and consent-wait/cancellation regressions failed before their fixes and
passed afterward. Native consent fixtures cover strict boolean parsing and corrupt data. The
URL-scrubbing test fails with the original error formatter. Review reproduced a stale-backup
consent failure and a cross-capability permission-guard bypass; their regressions fail before
correction and pass afterward. No live LRCLIB HTTP request was required or performed.

The independent reviewer confirmed the shared native gate, local-first ordering, main-window
boundary and renderer-path-free folder action. Native desktop acceptance remains necessary;
unit/compiler checks do not establish supported-OS file-manager behavior.

Published draft: [#27](https://github.com/Faw47/tarab/pull/27), head `5f844a8e987019651628daf51fff6e58adc6e5e4`. SEC-06/07 are NATIVE_VALIDATION_REQUIRED after successful cross-platform CI and independent review; no native file-manager or live LRCLIB acceptance is claimed.
