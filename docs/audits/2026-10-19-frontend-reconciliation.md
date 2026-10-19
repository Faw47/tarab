# Merged frontend reconciliation and residual corrections

Branch: `chatgpt/remediation-frontend-reconciliation`, stacked on PR [#27](https://github.com/Faw47/tarab/pull/27)
head `5f844a8e987019651628daf51fff6e58adc6e5e4`. All five CI jobs passed on that head
(run [39193327400](https://github.com/Faw47/tarab/actions/runs/39193327400)). This follow-up changes
frontend code and documentation only. Native source is unchanged from the validated baseline.
No merge or release; the release verdict remains NO-GO.

## Corrections found during independent reconciliation

- FE-16: both Home controls could hide their slider 300 ms after pointer leave while it retained
  keyboard focus. A separate focus-within ref now prevents collapse until focus leaves. Superseded
  timers are cleared. Both theme regressions failed before the fix and pass afterward, including
  collapse after external blur. The reviewer's original external reproduction also passes now.
- FE-22: library list metadata, neo album headings, queue labels, full-player metadata and neo
  search lacked direction attributes needed by the spacing safeguard. They now resolve their own
  direction; queue artist and album values are isolated separately. The old RTL-only reset still
  tracked Arabic in Latin-leading values such as `Live أهواك`; neo dynamic metadata/query text
  now uses normal spacing regardless of its first strong character. Static labels retain tracking.
  Seven list/header tests and the mixed-script CSS guard fail before their fixes and pass after.

## Older merged evidence, freshly checked

Production files were temporarily replaced one at a time with their recorded pre-fix revision;
all originals were restored in finally blocks with byte-hash assertions. The targeted checks fail
for the actual former symptoms and pass on the restored candidate:

| ID | Pre-fix source | Failing evidence |
| --- | --- | --- |
| FE-08 | AppLayouts at 173683b parent | Persistent rail drag/Back strip missing: 1 failure |
| FE-17 | PlayerContent at 3e2fab1 parent | Neo blurred backdrops lack hidden marker in both layouts: 2 failures |
| FE-26 | PlaylistsView at d19d470 parent | Row Play button and bounded playlist list absent: 2 failures |
| FE-30 | index.css at 70494ae parent | Fade rule escapes the no-preference media query: 1 failure |

The restored four-file focused suite passes. The current 2,000-entry playlist regression renders
an actual nonempty bounded DOM window. Static text-size, visible-label, reduced-motion and theme
checks pass. Independent source review found no remaining objection in FE-08/16/17/22/26/30 after
the two residual corrections. This evidence supports code remediation, not native appearance.

## Final candidate checks

| Check | Result |
| --- | --- |
| Frontend suite | 418 tests in 96 files passed |
| TypeScript / Biome | Passed; one existing unrelated noConfusingVoidType warning |
| IPC / production build / initial bundle guard | 118 contracts and build checks passed |
| Storybook / Knip / release configuration | Passed |
| Rust | Unchanged subtree; PR #27 passed tests/check/strict Clippy on Windows, macOS and Linux |
| Independent review | Final FE-16 and FE-22 corrections approved; no unresolved source objection |
| Follow-up latest-head CI | Requires the new published draft's run |
| Browser validation | Blocked: originating browser context is unavailable |
| Native desktop/audio/WebView acceptance | Not performed |

Browser returned: “Browser access requires the originating browser context.” No browser screenshot,
computed layout, Arabic shaping or native window behavior is claimed. Renderer tests use jsdom;
they verify attributes and interactions, while the stylesheet guard verifies the unconditional
spacing rule. Existing jsdom scrollTo noise and Vite large-chunk advisories remain unrelated.

## Remaining native acceptance and open architecture

FE-08/16/17/22/26/30 require supported-OS acceptance: drag the exposed rail strip and use Back
without blocking album controls; hear slider/mute restoration across surfaces; inspect both neo
full-player layouts; check Arabic/Latin punctuation, shaping, truncation and karaoke fill; scroll
long playlists and play a row; verify text readability and reduced motion. These rows are
NATIVE_VALIDATION_REQUIRED, not FIXED_VERIFIED.

FE-18 remains PENDING. Shared Home data and improved parity do not replace the separate theme
view/controller trees. In particular, liquid album rows implement long-press selection
that the neo album component still lacks. The optional track-details interface is also only in
the liquid component, though the main router currently supplies no track-details callback. Do not treat this reconciliation as theme-wide parity.
