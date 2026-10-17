# Tarab comprehensive audit and GPUI evaluation

- **Date:** 2026-10-17
- **Audited revision:** `2dbe638` ("feat: update desktop shell integrations, player controls, and library components"), branch `claude/exciting-bell-6nri74` created from `main` at the same commit
- **Scope:** the complete repository: React/TypeScript frontend (`src/`), Rust backend (`src-tauri/src/`), vendored media plugin, configuration, capabilities, CI/release workflows, scripts, tests and documentation
- **Method:** source inspection across subsystem boundaries by a lead auditor and five parallel investigations (frontend/UX, playback/state, security/QA, architecture/performance, GPUI research), followed by lead verification of every P0/P1 claim and spot checks of P2 claims; static checks and the existing test suites; a production bundle build; synthetic SQLite and Rust micro-benchmarks; and rendering the real React UI in headless Chromium with a mocked Tauri IPC layer
- **What this is not:** a native runtime test. The native app, audio output, OS media controls and the platform WebViews were not executed (see Section 3)

## Contents

1. Executive assessment and GPUI verdict
2. Architecture and technology stack inventory
3. Audit coverage map and verification limitations
4. Findings inventory (summary table, then detailed findings by category)
5. Detailed analysis of critical and high-severity issues
6. UI/UX and product-quality assessment
7. GPUI comparison: KEEP vs PARTIAL vs FULL
8. Final GPUI recommendation
9. Prioritized improvement roadmap
10. Validation results, unresolved questions and unverified areas
11. Evidence references and external sources

**How to read findings.** Each finding has a unique ID whose prefix records where it was first found: `LD` lead auditor, `PB` playback/state investigation, `FE` frontend/UX, `SEC`/`QA` security and QA, `AR` architecture and performance. Duplicates found by more than one investigation were merged under one ID and the others are named in the entry ("Merges …"), so ID numbers have gaps. Confidence uses the requested scale: **CONFIRMED** (shown by code, a test, a reproduction or equally direct evidence), **LIKELY**, **POSSIBLE**, **SUBJECTIVE**. Where an entry lists two labels (for example "CONFIRMED in code; impact LIKELY"), the first applies to the mechanism and the second to the user-visible effect; counts use the first label. Severity: **P0** critical, **P1** high, **P2** medium, **P3** low. File references are `path:line` at `2dbe638`.

## 1. Executive assessment and GPUI verdict

### Overall verdict

Tarab is an ambitious, carefully hardened desktop shell with a large amount of genuine product and design work: two complete visual systems, an LRC editor, a tag editor, smart and folder-synced playlists, recoverable trash, typed IPC wrappers, strict capabilities and a strict CSP. Its security posture is better than most hobby or early-stage Tauri apps: the main-window command gate, root-scoped filesystem authority, bounded network client and absence of HTML injection sinks all checked out.

The current revision is **not release-ready**, for three reasons:

1. **A P0 regression at HEAD.** The latest commit changed the `playback-position` event to `{ generation, position }`, but the main listener still treats it as a number (PB-01). Time display, the seek bar, Previous-restart, resume-after-restart, the OS media session and, very likely, synchronized lyrics are broken on every platform. The UI harness reproduced the broken time display directly. The test suite passed because its fixtures emit plain numbers, and the IPC contract check only compares command names (QA-18, QA-31).
2. **The library pipeline does not scale to the "serious library" the README targets.** A single file change rescans the whole root (PB-18). The reconcile step is quadratic under the database lock (PB-04: about 1 s at 10k files and 3.7 to 8.8 s at 20k to 30k, measured in this container). Lyrics re-indexing takes about 41 s at 100k tracks (AR-11). Playlist commands load the entire tracks table on the main thread (AR-04). Library sorting only sorts the first loaded pages (LD-02).
3. **Playback state has several ways to diverge from what is actually playing.** Under shuffle, gapless handoff can activate a different track than the one decoded (PB-06). A device-open failure deadlocks the audio thread (PB-02). The queue is advanced by renderer JavaScript that the OS may suspend while the window is hidden in the tray (PB-03).

Most fixes are small: all eight P0/P1 items have S or M fixes, and none needs an architectural rewrite. The roadmap in Section 9 lists a two-week stabilization batch that removes every P0 and P1.

### Findings at a glance

160 distinct findings after deduplication (summary table in Section 4):

| Severity | Total | CONFIRMED | LIKELY | POSSIBLE | SUBJECTIVE |
|---|---|---|---|---|---|
| P0 Critical | 1 | 1 | 0 | 0 | 0 |
| P1 High | 7 | 6 | 1 | 0 | 0 |
| P2 Medium | 67 | 59 | 6 | 1 | 1 |
| P3 Low | 85 | 68 | 10 | 4 | 3 |
| **Total** | **160** | **134** | **17** | **5** | **4** |

### The five most consequential findings

1. **PB-01 (P0, CONFIRMED):** the position-event payload mismatch described above. Small fix, but it breaks the product's headline experience today.
2. **PB-18 + PB-04 (P1, CONFIRMED and measured):** the watcher-triggered full-root rescan combined with the quadratic, lock-holding reconcile. Every tag edit, including Tarab's own writes, can freeze library queries for seconds to minutes on large libraries.
3. **AR-04 (P1, CONFIRMED):** all 14 playlist commands are synchronous, so they run on the main thread. `get_playlists` builds full details and loads every track for each smart or folder playlist. Opening Playlists on a large library blocks the whole window.
4. **PB-06 (P1, CONFIRMED):** gapless (on by default) plus shuffle shows and credits a different track than the one being heard.
5. **LD-02 (P1, CONFIRMED):** Title/Artist/Album sorting applies only to the 400+ tracks already loaded by date added. The primary browse view is wrong for any library over 400 tracks.

Next in line: PB-02 (audio deadlock on device failure), PB-03 (queue advance depends on a possibly suspended hidden renderer), PB-05 and PB-15 (session persistence failure modes).

### GPUI verdict: **KEEP** the current Tauri + React architecture

GPUI would not fix the problems this audit found:

- **The defects are not caused by the WebView.** They are in IPC typing, Rust algorithms, main-thread command placement and state ownership, and most would need re-implementing under GPUI.
- **The rendering waste is self-inflicted and cheap to fix.** It comes from an invisible always-rendering WebGL canvas (FE-01), unused blur passes (FE-02) and a broken shader (LD-01). These fixes take days.
- **GPUI can't reproduce Tarab's signature visuals.** It has no custom shaders, no per-element backdrop blur and no layout-animation library.
- **GPUI lacks desktop features Tarab already uses through Tauri:**
  - tray
  - media keys and OS media sessions
  - global shortcuts
  - autostart
  - updater
  - deep links on Windows and Linux
  - single instance
- **It isn't distributed as a stable library.** The official crate is frozen at 0.2.2 (2025-10-22), and main depends on unpublishable crates.
- **Its accessibility support is about five months old.**

A partial migration is technically possible only as a separate process (same-process coexistence with Tauri's event loop is not viable). It would double the UI stacks for a mini player that is not a bottleneck.

The decision should be revisited only if a measured, user-relevant resource gap exists after Tarab's own waste is removed. Section 8 defines that experiment and its acceptance thresholds.

## 2. Architecture and technology stack inventory

### 2.1 Platforms and shell

| Item | Value | Evidence |
|---|---|---|
| Application type | Tauri 2 desktop app: system WebView renders a React SPA; Rust process owns audio, database, filesystem and OS integration | `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` |
| Target OSes | macOS 12+ (Universal 2), Windows x64 and arm64 (NSIS), Linux x64 and arm64 (AppImage, deb) | `tauri.conf.json` `bundle`, `.github/workflows/release.yml` |
| WebViews | WKWebView (macOS), WebView2 (Windows), WebKitGTK 4.1 (Linux) via wry 0.55.1 / tao 0.35.3 | `src-tauri/Cargo.lock` |
| Windows | `main` (1200x800, min 800x600, transparent, overlay title bar) and `mini-player` (320x92, transparent, undecorated, always on top, created hidden) | `tauri.conf.json:12-58` |
| Release status | Version 1.0.0 in all manifests; README states no official binary release yet; `docs/release-evidence-1.0.0.md` records local macOS evidence only | `README.md`, `docs/release-evidence-1.0.0.md` |

### 2.2 Languages and size (non-test source at HEAD)

| Layer | Size |
|---|---|
| TypeScript/TSX (frontend, excluding tests and stories) | about 41.8k lines; 83 component `.tsx` files |
| CSS (hand-written) | about 3.6k lines (`index.css` 1047, `library-view.css` 1491, `neobrutalism.css` 726, `liquid-glass.css` 255) |
| GLSL | 266 lines (3 shader files plus 2 inline shaders) |
| Rust application (`src-tauri/src`) | about 14.8k lines |
| Rust vendored plugin (`src-tauri/vendor/tauri-plugin-media`) | about 2.0k lines |
| Tests | 53 Vitest files (about 4.2k lines, 170 tests); 87 Rust unit tests run on Linux |

### 2.3 Key dependencies

| Area | Frontend | Backend |
|---|---|---|
| UI framework | React 19.1, Tailwind 4, framer-motion 12, Radix (dialog, popover, slider, tabs), react-aria-components (one slider), cmdk, dnd-kit, lucide icons, sonner | n/a |
| State and data | zustand 5 (settings, player, library stores), TanStack Query 5 with IndexedDB persistence (idb-keyval), zod 4, react-hook-form, Fuse.js in a comlink worker | rusqlite 0.31 (bundled SQLite, WAL, FTS5), one `Mutex<Connection>` |
| Graphics | three 0.170 + @react-three/fiber 9 (liquid shell), blurhash | image 0.25 (thumbnails, lossless WebP), blurhash 0.2 |
| Audio | n/a | rodio 0.19 (output mixer, `Speed`), cpal 0.15, symphonia 0.5 (decoding), rubato 0.16 (declared, unused) |
| Metadata and lyrics | LRC parser (`src/lib/lyrics-parser.ts`) | lofty 0.21, reqwest 0.12 (LRCLIB), walkdir, notify 6, rayon |
| Desktop integration | `@tauri-apps/api` 2.11 and plugin bindings | 13 Tauri plugins (single-instance, autostart, window-state, log, notification, deep-link, clipboard, positioner, opener, dialog, global-shortcut, media (vendored), liquid-glass (git pin)), souvlaki 0.7 (Windows SMTC), window-vibrancy 0.5 (unused), `windows` 0.58 |

### 2.4 Runtime architecture

- **Ownership model (AGENTS.md):** the main-window renderer is the source of truth for queue and player state. The mini window renders snapshots and sends control intents. Desktop actions route through `desktop-control-action`. Custom commands are main-window-only (`src-tauri/src/lib.rs:453-464`).
- **IPC surface:**
  - 117 commands in `generate_handler!` on Windows, 115 elsewhere; the two Windows-only ones are the taskbar commands. These are the lead's count; the architecture investigation counted 116/114.
  - 113 typed frontend wrappers in `src/lib/tauri-commands.ts`.
  - About 20 Rust-to-renderer event types plus 3 window-to-window events.
  - 56 commands are synchronous and therefore run on the main thread (lead count; LD-05, AR-04).
- **Audio engine (`src-tauri/src/audio.rs` and `audio/`):**
  - a command thread with a 20 ms poll
  - a 100 ms position thread that emits `playback-position`
  - symphonia decoding inside the rodio source on the mixer thread
  - crossfade by dual sinks
  - gapless by appending the preloaded source to the current sink
  - every source change returns a monotonic generation
- **Library pipeline:**
  - Rust streams discovered paths in 500-path events (`library.rs`).
  - The renderer batches metadata and cover-art hashing through IPC, then sends one `ScanReconcileRequest` with every track (`useLibraryScan.ts`).
  - Rust applies it in one transaction (`database/tracks.rs`).
  - Afterwards the lyrics index is resynced (`lyrics.rs`).
  - A recursive `notify` watcher triggers a root rescan on changes.
- **Artwork:**
  - Thumbnails are cached under app data, keyed by content hash.
  - They are served through the `cover-art://` custom protocol (`lib.rs:124-160`), with an IPC blob fallback in the renderer (`CoverArtImage.tsx`).
- **Persistence:**
  - `library-grants.json`: native folder grants.
  - SQLite library database.
  - `settings.json` and `tarab-player.dat`: fixed native stores (`fixed_store.rs`).
  - Legacy `session.json` migration.
  - IndexedDB query cache.
  - App-owned recoverable trash.
- **Frontend composition:**
  - Render tree: `main.tsx` → `AppProviders` → `App.tsx`. `App.tsx` wires about 35 hooks from `src/features/app` into `AppLayouts` and the lazily loaded views in `AppViewRenderer`.
  - Views: Home, Library (albums, songs, artists, recent, most played, search), Queue, Playlists, Tags (tag manager), Settings, Album detail, full player, lyrics editor, tag editor, command palette.
  - Two visual systems, liquid glass and neobrutalism, partly implemented as parallel component trees (FE-18).

### 2.5 Major user workflows traced

- First run → add folder (native picker grant) → scan → browse
- Play album or track → queue → next/previous/seek → gapless or crossfade transition → end of queue
- Shuffle and repeat modes
- Pause → hide to tray → media keys
- Quit → relaunch → session restore
- Edit tags or lyrics → watcher → rescan
- Playlists: create, add, reorder, smart rules, folder sync
- Remove to trash → undo
- File association launch: Play once, Import folder, Cancel
- Deep links: search and play

## 3. Audit coverage map and verification limitations

### 3.1 Environment

- **Execution environment:** Claude Code cloud container.
  - System: Ubuntu 24.04.5, Linux 6.18 x86_64, 4 vCPU, 15 GB RAM, no GPU, no display server.
  - Toolchain: Node 22.22.0 (the repo pins 22.18.0; `dev-doctor` warned but passed), pnpm 9.15.2, Rust 1.92.0 (the pinned toolchain).
- **Installed for the audit (outside version control):**
  - JS dependencies via `pnpm install --frozen-lockfile`.
  - Tauri Linux build dependencies via apt: webkit2gtk-4.1, gtk3, ayatana-appindicator, librsvg, alsa, xdo, dbus.
  - Playwright 1.56.1 in a scratchpad directory, used to drive the preinstalled Chromium.
- **Network:** outbound HTTPS through a proxy. crates.io, GitHub raw content and git clones worked. Some hosts (zed.dev, gpui.rs, news.ycombinator.com, codeberg.org) were unreachable, and claims from them are marked secondhand.

### 3.2 What could and could not be tested

| Capability | Status | Notes |
|---|---|---|
| TypeScript typecheck, Biome lint, Vitest | **Executed** | All pass (Section 10) |
| `cargo check`, `cargo clippy -D warnings`, `cargo test`, `cargo fmt --check` | **Executed** on Linux | All pass |
| Production Vite build and bundle measurement | **Executed** (output in scratchpad) | Section 10, AR-30 |
| React UI rendering | **Executed in headless Chromium with a mocked Tauri IPC layer** | Real app code via `vite` dev server; 64 synthetic tracks; both themes at 1200x800 and 800x600; home, library, queue, playlists, settings, playing state, mini-player entry. **Not** the native WebView: WebKitGTK, WKWebView and WebView2 may differ in CSS, compositing and WebGL. |
| Synthetic performance benchmarks | **Executed** | SQLite queries on a 100k-track synthetic database (Python sqlite 3.45); Rust micro-benchmark of the reconcile loop (`rustc -O`); WebP thumbnail size test. Container numbers indicate algorithmic shape, not desktop latency. |
| Native app launch (`cargo run`) | **Not executed** | No display server or audio device; the AGENTS.md startup check could not be performed |
| Audio playback, seeking, gapless, crossfade, device switching | **Not executed** | Source analysis plus third-party source reading (rodio 0.19, symphonia 0.5.5) only |
| OS media controls, tray, global shortcuts, notifications, file associations, deep links, autostart | **Not executed** | Source analysis only; no Windows or macOS host |
| Screen readers, keyboard navigation in native WebViews | **Not executed** | Source analysis plus two jsdom probes |
| Memory, CPU and GPU of the running app | **Not measured** | No native runtime; no GPU |
| Release workflows, signing, notarization | **Not executed** | Workflow files inspected only |
| `cargo audit` | **Not executed** | Not installed; dependency advisories assessed from `Cargo.lock` and repo docs |

### 3.3 Coverage inventory

| Area | Coverage | Basis |
|---|---|---|
| `src-tauri/src/lib.rs`, `tauri.conf.json`, all 13 capability files | Fully inspected, tested (cargo) | Lead and security review |
| Audio engine (`audio.rs`, `audio/*`) | Fully inspected (all 1424 lines of `audio.rs`), statically tested; not run | Playback review, architecture review |
| Database (`database.rs`, `database/*`) and migrations | Fully inspected; benchmarked synthetically | Architecture review |
| Library scan, watcher, metadata, image cache, waveform, lyrics | Fully or largely inspected; partially benchmarked | Architecture, playback, security reviews |
| File operations, launch intents, fixed store, session, tag editor | Fully inspected | Security review |
| Desktop integration, media controls, macOS menu, taskbar, vibrancy | Fully inspected; not run | Lead, architecture review |
| Vendored media plugin | Linux and macOS files inspected; Windows file partially | Security and architecture reviews |
| Frontend app shell (`App.tsx`, `features/app/*`, stores, providers, hooks) | Fully inspected; rendered | Lead, frontend, playback reviews |
| Views: Home, Library, Queue, Settings, full player, mini player, navigation | Inspected and rendered (Home, Library, Queue, Playlists, Settings, mini-player entry) | Frontend review, harness |
| Album overlays, playlists view, tag manager, tag editor, lyrics display | Partially inspected | Frontend review |
| Lyrics editor, library list subcomponents, file-info modal, cache settings, settings primitives, playlist editor/picker dialogs | **Not examined in depth** | Coverage gap |
| Shaders | Compile behavior observed; GLSL logic not reviewed | Lead |
| CSS and design docs | Inspected; the 2560-line neobrutalism spec read in its main sections only | Frontend review |
| CI and release workflows, scripts | Fully inspected; local scripts run | Security/QA review |
| Tests | Inventory and representative bodies read; suites executed | QA review |
| Liquid-glass git plugin source | **Not examined** | Coverage gap |
| `3d-liquid-glass-design-language.md`; 11 of 16 visual baselines | **Not examined** | Coverage gap |

### 3.4 Limitations that affect conclusions

- **Windows-only and macOS-only findings are code-derived.** AR-12, QA-05, QA-06, AR-26, SEC-10 and PB-03 (macOS 14+) are marked LIKELY or POSSIBLE accordingly.
- **Harness screenshots are a proxy.** They come from Chromium, not from the shipping WebViews. Layout findings (FE-07, LD-08) depend on standard CSS grid/flex behavior and should reproduce in WebKit. WebGL compile behavior (LD-01) is mandated by the GLSL ES specification.
- **Audio-quality findings are inferred from code and library source, not listening tests.** These are PB-09 dropouts, PB-22 resampling, PB-32 clipping and PB-07 seek offset.
- **Benchmark numbers come from a cloud container.** Use them for scaling shape and order of magnitude only.

## 4. Findings inventory

### 4.0 Summary table

All 160 findings, sorted by severity, then section. Detailed entries follow in Sections 4.1 to 4.10.

**Merged IDs.** These IDs appear in cross-references but were merged into another entry:

| Merged ID | Merged into |
|---|---|
| AR-01, QA-03 | PB-04 |
| AR-02 | PB-18 |
| AR-03 | PB-01 |
| AR-06 | PB-09 |
| AR-14 | QA-02 |
| AR-15 | SEC-01 |
| AR-18 | FE-01 |
| AR-23, AR-24, QA-07 | LD-05 |
| AR-27 | SEC-11 |
| LD-03, PB-L1, PB-L2, QA-15, QA-16 | AR-12 |
| FE-43 | QA-30 |
| PB-31 | AR-05 |
| PB-34 | QA-18 |
| QA-26 | AR-19 |
| QA-28 | AR-28, AR-29 |

| ID | Severity | Confidence | Category | Finding | Section |
|---|---|---|---|---|---|
| PB-01 | P0 | CONFIRMED | Correctness, IPC contract regression | Position events changed to an object, but the main position handler still treats them as a number | 4.1/4.2 |
| PB-02 | P1 | CONFIRMED | Concurrency | Audio thread deadlocks when opening the output device fails | 4.1/4.2 |
| PB-03 | P1 | LIKELY | Background lifecycle | Hidden or tray window may have its renderer suspended, and the renderer owns queue advance | 4.1/4.2 |
| PB-06 | P1 | CONFIRMED | State divergence | Gapless handoff re-picks the next track, so the UI can show a different track than the one playing | 4.1/4.2 |
| LD-02 | P1 | CONFIRMED | Correctness, large-library UX | Library sort by title, artist or album only sorts the tracks already loaded | 4.3 |
| PB-04 | P1 | CONFIRMED | Performance, scalability | Scan reconcile is quadratic while holding the database lock and an open write transaction | 4.3 |
| PB-18 | P1 | CONFIRMED | Performance, architecture | Any watched file change triggers a full rescan of the whole library root, including Tarab's own tag writes | 4.3 |
| AR-04 | P1 | CONFIRMED | Responsiveness, scalability | Playlist commands are synchronous (run on the main thread) and load the whole tracks table per smart or folder playlist | 4.7 |
| PB-05 | P2 | CONFIRMED | Persistence | One failed session write disables all later saves and makes tray/menu Quit fail | 4.1/4.2 |
| PB-07 | P2 | CONFIRMED | Accuracy | Seek reports the requested time, not the decoder's actual position; MP3 coarse seek is inaccurate for VBR | 4.1/4.2 |
| PB-08 | P2 | CONFIRMED | Correctness | A failed seek restarts the track at 0:00; files without a known frame count get no gapless or crossfade | 4.1/4.2 |
| PB-09 | P2 | CONFIRMED | Real-time safety | Real-time mixer path locks shared state per sample while other threads hold that lock across IPC emits | 4.1/4.2 |
| PB-10 | P2 | CONFIRMED | Queue semantics | Shuffle with Repeat Off never ends | 4.1/4.2 |
| PB-11 | P2 | SUBJECTIVE | Queue semantics | Shuffle Previous follows list order; "Play Next" is ignored under shuffle; manual Next with Repeat One restarts the song | 4.1/4.2 |
| PB-12 | P2 | LIKELY | State machine | Interrupted crossfade leaves stale pending state; a later end of that file is ignored and playback halts | 4.1/4.2 |
| PB-13 | P2 | CONFIRMED | Device robustness | No handling of output-device loss or system default-device changes | 4.1/4.2 |
| PB-14 | P2 | CONFIRMED | Error recovery | Missing, corrupt or unsupported tracks stop the queue instead of being skipped | 4.1/4.2 |
| PB-15 | P2 | CONFIRMED | Data loss | A failed track lookup during restore still enables saving, so an empty queue overwrites the stored one | 4.1/4.2 |
| AR-08 | P2 | CONFIRMED | Scan performance | Scans decode full-resolution embedded artwork two or three times per track | 4.3 |
| AR-09 | P2 | CONFIRMED | Disk and performance | Thumbnails are lossless WebP, so the default 200 MB cache holds roughly 1,000 albums | 4.3 |
| AR-11 | P2 | CONFIRMED | Scalability | Lyrics index sync re-sorts the whole table for every page: 41 s at 100k tracks, after every scan | 4.3 |
| AR-19 | P2 | CONFIRMED | Reliability, responsiveness | Watcher uses leading-edge throttling, has an unbounded debounce map, broadcasts to all windows and sets up recursively on the main thread | 4.3 |
| QA-08 | P2 | CONFIRMED | Robustness | One unreadable directory entry fails the whole scan | 4.3 |
| QA-09 | P2 | LIKELY | Data integrity | Tag and lyrics writes are in place, not atomic | 4.3 |
| AR-05 | P2 | CONFIRMED | Performance, energy | Media-session sync re-sends full-resolution base64 artwork every two seconds to a main-thread command | 4.4 |
| AR-07 | P2 | CONFIRMED | Reliability | Audio thread exits permanently if no output device exists at startup | 4.4 |
| AR-10 | P2 | LIKELY | Responsiveness | `cover-art://` handler reads disk synchronously on the webview thread | 4.4 |
| AR-12 | P2 | CONFIRMED | Architecture rule violation, platform behavior | Windows runs two media-control (SMTC) integrations; one bypasses the renderer and emits events nobody listens to | 4.4 |
| AR-13 | P2 | LIKELY | Platform UX | Linux applies the full app menu to every window, including the 320x92 mini player | 4.4 |
| FE-24 | P2 | CONFIRMED | Disconnected UI | Native menu items do less than their labels say | 4.4 |
| LD-06 | P2 | CONFIRMED | Reliability, UX | Database initialization failure exits silently with no user-visible message | 4.4 |
| QA-05 | P2 | LIKELY | Platform compatibility | Cover art over the `cover-art://` custom protocol likely fails on Windows, falling back to slower IPC | 4.4 |
| QA-06 | P2 | POSSIBLE | Platform compatibility | Windows canonical paths keep the `\\?\` prefix | 4.4 |
| FE-01 | P2 | CONFIRMED | Performance, visual design | The liquid WebGL shell renders continuously but is always covered by an opaque layer | 4.5 |
| FE-02 | P2 | CONFIRMED | Performance, dead code, AGENTS.md rule | Unused full-window blur passes and a per-frame layout loop feeding a store nothing reads | 4.5 |
| FE-03 | P2 | CONFIRMED | Robustness | Passing `reportError` directly to `.catch` can replace the whole UI with the error boundary | 4.5 |
| FE-04 | P2 | CONFIRMED | Keyboard UX | Search shortcuts focus the hidden mobile search input | 4.5 |
| FE-05 | P2 | CONFIRMED | Disconnected UI | Liquid Home Mute button changes the icon but not the audio | 4.5 |
| FE-06 | P2 | CONFIRMED | Workflow | "Hide cover art" in the full player removes every transport control | 4.5 |
| FE-07 | P2 | CONFIRMED | Responsiveness | At the minimum window size the floating dock covers player controls; its labels clip and the search bar overflows | 4.5 |
| FE-08 | P2 | CONFIRMED | Desktop UX | Liquid icon-rail mode has no window drag region; the liquid album view has no Back button | 4.5 |
| FE-09 | P2 | CONFIRMED | Navigation state | Selection pills highlight the wrong navigation item | 4.5 |
| FE-10 | P2 | CONFIRMED | Error state | Playback-failure recovery actions exist only inside the full player | 4.5 |
| FE-11 | P2 | CONFIRMED | Interaction | Compact full player's seek bar is never visible or mouse-usable | 4.5 |
| FE-12 | P2 | CONFIRMED | Information design | Full player shows no elapsed/total time and no volume in the default layout | 4.5 |
| FE-13 | P2 | CONFIRMED | Theme divergence | Neobrutalism ignores the collapsed mini-player state and shows an empty bar | 4.5 |
| FE-14 | P2 | CONFIRMED | Copy, wiring | Mini Player settings describe the wrong surface | 4.5 |
| FE-16 | P2 | CONFIRMED | Duplication, consistency | Five separate volume implementations behave differently | 4.5 |
| FE-17 | P2 | CONFIRMED | Theme consistency | The neobrutalism full player is dark blurred glass | 4.5 |
| FE-18 | P2 | CONFIRMED | Architecture, consistency | Parallel liquid and neo component trees diverge in behavior, not only appearance | 4.5 |
| FE-19 | P2 | CONFIRMED | Copy | Library says "Your library is empty" for empty facets of a non-empty library | 4.5 |
| FE-20 | P2 | CONFIRMED | Safety | Clear queue has no confirmation or undo | 4.5 |
| FE-22 | P2 | CONFIRMED | Internationalization | No RTL or bidirectional text handling for Arabic metadata and lyrics | 4.5 |
| FE-23 | P2 | CONFIRMED | Disconnected UI | Mini-player lyric line freezes during playback | 4.5 |
| FE-25 | P2 | CONFIRMED | Safety | Tag editor discards unsaved edits on Escape; inside the full player, Escape closes both | 4.5 |
| FE-26 | P2 | CONFIRMED | UX, scale | Playlists view: no virtualization, raw type names, no per-track play | 4.5 |
| FE-30 | P2 | CONFIRMED | Design compliance | Home and library styling contradicts the documented design language | 4.5 |
| FE-31 | P2 | CONFIRMED | Error UX | Errors appear twice and use internal wording | 4.5 |
| LD-01 | P2 | CONFIRMED | Correctness | All three liquid-shell post-processing shaders fail to compile | 4.5 |
| LD-08 | P2 | CONFIRMED | Layout | Neobrutalism album grid columns expand to fit long titles | 4.5 |
| FE-15 | P2 | CONFIRMED | Accessibility | Home album card Play button cannot be used by keyboard; controls and titles appear only on hover | 4.6 |
| FE-21 | P2 | CONFIRMED | Accessibility, invalid DOM | Nested interactive controls in album tiles (source of the React DOM-nesting warning) | 4.6 |
| FE-27 | P2 | CONFIRMED | Accessibility | Album track rows: unlabeled "More" button, hover-only controls, wrong ARIA roles | 4.6 |
| FE-28 | P2 | CONFIRMED | Contrast, focus visibility | Neo theme forces black focus outlines and uses below-AA grey text | 4.6 |
| FE-29 | P2 | CONFIRMED | Motion accessibility | framer-motion animations ignore Reduced Effects and OS Reduce Motion | 4.6 |
| AR-16 | P2 | CONFIRMED | Performance, robustness | Persisted react-query cache has no filter or buster and keeps search keys and aggregates for 24 hours | 4.7 |
| AR-17 | P2 | CONFIRMED | Scalability | Every session save reads and rewrites the whole player store over IPC | 4.7 |
| LD-05 | P2 | CONFIRMED | Responsiveness | 42 other synchronous commands run on the main thread, several with blocking I/O | 4.7 |
| SEC-01 | P2 | LIKELY | Reliability, denial of service | Release builds abort on any panic while parsing untrusted media in-process | 4.8 |
| SEC-02 | P2 | CONFIRMED | Resource exhaustion | Image size limits are checked after decoding | 4.8 |
| SEC-04 | P2 | CONFIRMED | Supply chain | Release signing secrets are readable by dependency install and build scripts | 4.8 |
| QA-01 | P2 | CONFIRMED | Data management | Files moved to "Tarab Trash" cannot be found or purged after the undo dialog closes | 4.9/4.10 |
| QA-02 | P2 | CONFIRMED | Reliability | Trash and move fail for libraries on a different volume from app data | 4.9/4.10 |
| QA-18 | P2 | CONFIRMED | Test coverage | Critical paths have no tests, and existing tests encode the wrong IPC payload | 4.9/4.10 |
| QA-31 | P2 | CONFIRMED | Tooling gap | The IPC contract check validates names only | 4.9/4.10 |
| LD-04 | P3 | CONFIRMED | Architecture rule violation | `PlaybackCoordinator` contract is only partly enforced: generation setter is not monotonic and editor preview bypasses the current track | 4.1/4.2 |
| PB-16 | P3 | CONFIRMED | Data integrity | Playlist reorder resets every entry's added date and rewrites the whole list from client state | 4.1/4.2 |
| PB-17 | P3 | CONFIRMED | Design gap (AGENTS.md persistence rule) | Playlist mutation IDs never protect an actual retry | 4.1/4.2 |
| PB-20 | P3 | CONFIRMED | Persistence | Quit and window close do not save the latest state | 4.1/4.2 |
| PB-21 | P3 | CONFIRMED | Feature quality | Playback speed changes pitch | 4.1/4.2 |
| PB-23 | P3 | CONFIRMED | Correctness | Pausing during a crossfade lets the fade finish while paused | 4.1/4.2 |
| PB-24 | P3 | CONFIRMED | Correctness | Seek while paused may briefly play audio; seek events carry no generation; every seek reopens the file | 4.1/4.2 |
| PB-25 | P3 | POSSIBLE | Decoder robustness | Decoder does not filter packets by track ID | 4.1/4.2 |
| PB-26 | P3 | LIKELY | Library/decoder mismatch | Scanner accepts formats the decoder cannot play; Opus is not scanned | 4.1/4.2 |
| PB-27 | P3 | CONFIRMED | Lyrics correctness | LRC parser edge cases | 4.1/4.2 |
| PB-28 | P3 | LIKELY | Concurrency | Two quick Next presses advance only one track | 4.1/4.2 |
| PB-29 | P3 | CONFIRMED | Queue state | Removing the playing track from the queue makes Next skip a track | 4.1/4.2 |
| PB-30 | P3 | LIKELY | Developer lifecycle | In development builds, session restore never completes and saving never starts | 4.1/4.2 |
| PB-31 | P3 | CONFIRMED | Performance / UX | Media-session and mini-window sync resend full artwork every two seconds and jump the mini progress bar | 4.1/4.2 |
| PB-32 | P3 | CONFIRMED | Audio quality | Volume booster hard-clips and is not persisted | 4.1/4.2 |
| QA-27 | P3 | CONFIRMED | Correctness | Track duration underestimated by up to one second | 4.1/4.2 |
| AR-21 | P3 | CONFIRMED | Database performance | Schema and index issues | 4.3 |
| AR-22 | P3 | CONFIRMED | Performance | Deep-link track resolution hashes every row | 4.3 |
| AR-34 | P3 | CONFIRMED | Scalability | Shuffle-all and aggregates pull whole-library payloads into JavaScript | 4.3 |
| AR-35 | P3 | LIKELY | Performance | Smart-shuffle de-clustering is roughly quadratic in the worst case | 4.3 |
| LD-07 | P3 | CONFIRMED | Product gap | Genre is editable in the tag editor but absent from the library schema | 4.3 |
| LD-15 | P3 | LIKELY | Correctness | Paginated queries order by non-unique columns without a tiebreaker | 4.3 |
| PB-19 | P3 | POSSIBLE | Watcher correctness | Watch events use canonical paths but are matched against folders as configured | 4.3 |
| PB-33 | P3 | POSSIBLE | Data integrity edge case | Folder reconcile prefix match is case-insensitive | 4.3 |
| QA-04 | P3 | LIKELY | Upgrade path | Legacy `music-player` data may not migrate on Linux | 4.3 |
| AR-26 | P3 | CONFIRMED | Platform | macOS builds two app menus; label updates go to the replaced one | 4.4 |
| AR-32 | P3 | LIKELY | Memory, startup | Hidden mini-player webview is created at startup even though the feature is off by default | 4.4 |
| LD-19 | P3 | CONFIRMED | Observability | Backend diagnostics go to stderr instead of the configured log plugin | 4.4 |
| QA-10 | P3 | CONFIRMED | Disconnected UI | Help > README menu item is broken | 4.4 |
| QA-11 | P3 | CONFIRMED | Disconnected feature | Autostart `--minimized` flag is never read | 4.4 |
| QA-13 | P3 | CONFIRMED | Correctness | The same deep link clicked twice in one session does nothing the second time | 4.4 |
| QA-14 | P3 | CONFIRMED | Correctness | "Play once" authority is consumed when playback starts, so artwork, palette and preload for that file fail | 4.4 |
| SEC-10 | P3 | LIKELY | Resource leak | macOS media plugin never releases its Objective-C objects and has no autorelease pool | 4.4 |
| FE-34 | P3 | CONFIRMED | Visual, copy | Hard-coded "TARAB V1.1" overlaps the neo Settings title | 4.5 |
| FE-35 | P3 | CONFIRMED | Discoverability | Command palette is limited and shows Mac-only glyphs everywhere | 4.5 |
| FE-36 | P3 | CONFIRMED | Discoverability | No keyboard-shortcut reference; Up/Down silently change volume | 4.5 |
| FE-38 | P3 | CONFIRMED | Hit target | Desktop mini window seek target is 4 px tall and ignores the theme | 4.5 |
| FE-39 | P3 | CONFIRMED | Copy | "Lyric size" is labelled in px but is a 1 to 100 scale | 4.5 |
| FE-40 | P3 | CONFIRMED | Copy, design compliance | Neo Home copy is jargon-heavy and its cards move despite the neo spec | 4.5 |
| FE-44 | P3 | CONFIRMED | Empty state | Queue empty state has no call to action | 4.5 |
| FE-45 | P3 | CONFIRMED | Compositing cost | Heavy stacked `backdrop-filter` in the liquid theme | 4.5 |
| FE-46 | P3 | CONFIRMED | Settings wiring | Two settings behave inconsistently with their defaults or lifecycle | 4.5 |
| LD-11 | P3 | CONFIRMED | Copy | Copy and pluralization defects | 4.5 |
| LD-14 | P3 | CONFIRMED | Robustness | Settings persistence skips validation on the current version and swallows write failures | 4.5 |
| FE-37 | P3 | CONFIRMED | Accessibility | Collapsed pill player is not keyboard-operable and is mispositioned | 4.6 |
| FE-41 | P3 | CONFIRMED | Screen readers | Virtualized lists lack list semantics; queue drag-and-drop sees only rendered rows | 4.6 |
| FE-42 | P3 | CONFIRMED | Performance, energy | `SmoothTimeProvider` runs a requestAnimationFrame loop even when paused or unused | 4.6 |
| AR-20 | P3 | CONFIRMED | Architecture | A single `Mutex<Connection>` serializes every read behind long write transactions | 4.7 |
| AR-25 | P3 | CONFIRMED | Code quality, attack surface | Dead code, dead dependencies and unused IPC surface | 4.7 |
| AR-28 | P3 | CONFIRMED | Code quality, reliability | Image cache: dead in-memory LRU, mtime-based "LRU", possible size underflow, renderer-only enforcement | 4.7 |
| AR-29 | P3 | CONFIRMED | Correctness, disk | Waveform cache is keyed by path, unbounded on disk, and goes stale after edits | 4.7 |
| AR-30 | P3 | CONFIRMED | Startup | Initial bundle is about 955 KB of JavaScript (292 KB gzip) and the size check has no byte budget | 4.7 |
| AR-31 | P3 | CONFIRMED | Dependency weight | Redundant UI dependencies | 4.7 |
| AR-33 | P3 | CONFIRMED | Maintainability | `App.tsx` is a god component; large view files carry most of the complexity | 4.7 |
| AR-36 | P3 | CONFIRMED | Maintainability | Errors are untyped strings and behavior depends on message text | 4.7 |
| AR-37 | P3 | CONFIRMED | Miscellaneous | Minor reliability items | 4.7 |
| PB-22 | P3 | CONFIRMED | Audio quality, dead dependency | `rubato` dependency unused; sample-rate conversion uses rodio's linear converter | 4.7 |
| SEC-03 | P3 | LIKELY | Resource exhaustion | Waveform generator sizes a buffer from an unvalidated sample rate | 4.8 |
| SEC-05 | P3 | CONFIRMED | Authorization scope | Library grants accept `/` or the home folder; "Import folder" grants the launched file's parent with only a base-name prompt | 4.8 |
| SEC-06 | P3 | CONFIRMED | Capability scope | `opener:allow-reveal-item-in-dir` has no path scope | 4.8 |
| SEC-07 | P3 | CONFIRMED | Privacy | The online-lyrics opt-in is enforced only in the renderer, and request errors carry metadata | 4.8 |
| SEC-08 | P3 | CONFIRMED | Capability scope | The mini window may emit any event name to the main window | 4.8 |
| SEC-09 | P3 | CONFIRMED | Local file clobbering | Linux media plugin writes artwork to a fixed `/tmp` path following symlinks | 4.8 |
| SEC-11 | P3 | CONFIRMED | IPC typing (AGENTS.md rule 4), privacy | `desktop_sync_media_session` takes untyped JSON, logs the raw payload on failure and reports success | 4.8 |
| SEC-12 | P3 | CONFIRMED | Filesystem safety | Several commands check one path and then operate on another (time-of-check to time-of-use) | 4.8 |
| SEC-13 | P3 | CONFIRMED | Trust boundary | Reconcile deletes rows based on renderer-reported traversal completeness | 4.8 |
| SEC-14 | P3 | CONFIRMED | Defense in depth | `db_rename_track_path` and `db_delete_tracks*` perform no library-root check | 4.8 |
| SEC-15 | P3 | SUBJECTIVE | Design | `tarab://open/play` starts playback without confirmation and IDs are unsalted path hashes | 4.8 |
| SEC-16 | P3 | CONFIRMED | Privacy | Full file paths reach persisted logs unredacted | 4.8 |
| SEC-17 | P3 | LIKELY | Dependency hygiene | Bundled SQLite (rusqlite 0.31 / libsqlite3-sys 0.28) and glib 0.18 are behind upstream advisories | 4.8 |
| SEC-18 | P3 | CONFIRMED | Supply chain | CI workflow uses mutable action tags and default token permissions | 4.8 |
| SEC-19 | P3 | SUBJECTIVE | Defense in depth | No navigation guard on the webviews | 4.8 |
| FE-32 | P3 | CONFIRMED | Dead code | Dead UI code and unused CSS | 4.9/4.10 |
| FE-33 | P3 | CONFIRMED | CSS maintainability | Duplicated and conflicting CSS | 4.9/4.10 |
| QA-12 | P3 | CONFIRMED | Correctness | Tag editor cover picker only accepts images inside a library root, and writes WebP covers with a JPEG MIME type | 4.9/4.10 |
| QA-17 | P3 | CONFIRMED | Test validity | A delete test exercises a test-only helper instead of the shipped command path | 4.9/4.10 |
| QA-19 | P3 | CONFIRMED | CI | No coverage thresholds; coverage not run in CI; Linux release jobs run no Rust tests | 4.9/4.10 |
| QA-20 | P3 | POSSIBLE | CI efficiency | CI has no Rust cache, runs a redundant `cargo check`, and installs the legacy appindicator package | 4.9/4.10 |
| QA-21 | P3 | CONFIRMED | Release integrity | Release re-runs use `gh release upload --clobber` | 4.9/4.10 |
| QA-22 | P3 | CONFIRMED | Tooling | The repository's knip configuration disables the rules that would find dead code | 4.9/4.10 |
| QA-23 | P3 | CONFIRMED | Maintainability, supply chain | Vendored `tauri-plugin-media` has no patch record | 4.9/4.10 |
| QA-24 | P3 | SUBJECTIVE | Dependency hygiene | Dependency weight and duplicate versions | 4.9/4.10 |
| QA-25 | P3 | CONFIRMED | Documentation | Documentation drift | 4.9/4.10 |
| QA-29 | P3 | CONFIRMED | Durability | `fixed_store` writes without fsync and has no size limit | 4.9/4.10 |
| QA-30 | P3 | CONFIRMED | Testing | Visual baselines are orphaned and Storybook coverage is thin | 4.9/4.10 |

### 4.1 Playback engine and playback state

#### PB-01 · Position events changed to an object, but the main position handler still treats them as a number
- **Category / Severity / Confidence:** Correctness, IPC contract regression · **P0** · CONFIRMED (code, plus runtime reproduction in the browser harness)
- **Subsystem:** position display, synchronized lyrics, Previous, session resume, OS media session, desktop mini window
- **Issue:** The backend now emits `PlaybackPositionEvent { generation, position }` (`src-tauri/src/audio/events.rs:86-91`, emitted at `src-tauri/src/audio.rs:192-201`). `src/features/app/usePlaybackPositionEvents.ts:16-27` still declares `useTauriEvent<number>`, takes `const pos = event.payload` and calls `setCurrentTime(pos)`. `currentTime` therefore holds an object, and the handler performs no generation check.
- **Evidence and consequences:**
  - Time display: in the harness, emitting the real payload `{generation: 1, position: 61.5}` left the hero player at `0:00 / -0:00`; emitting the bare number `75.25` displayed `1:15 / -1:44`.
  - Lyrics timing: `src/hooks/useSmoothTime.ts:6-25` anchors on `currentTime * 1000`, which is `NaN` for an object. Line highlighting is therefore LIKELY frozen. Lyrics are Tarab's headline feature (`README.md` "Lyrics are part of the entire application").
  - Previous: `src/store/player-store.ts:423` `currentTime > 3` is always false, so Previous never restarts the current track.
  - Resume after restart: `useSessionPersistence` serializes `NaN` (stored as `null`); `usePlayerSessionRestore.ts:169` requires a number, so the resume position is lost.
  - OS media session: `useDesktopIntegration.ts:157` sends `position: player.currentTime`; `desktop_integration.rs:115-116` expects `f64`, and the parse failure at `:314-325` is logged and returns `Ok(())`, so Now Playing / MPRIS / SMTC stop updating.
  - Mini window: the snapshot (`useDesktopIntegration.ts:98`) sends the object, so its progress shows `NaN`.
  - Tests hide the regression: `src/features/app/__tests__/usePlaybackLifecycle.test.tsx:195,198` emits plain numbers.
- **Trigger:** play any track for more than 250 ms.
- **Impact:** core playback UI and the lyrics experience are broken at HEAD on every platform.
- **Fix:** parse `{ generation, position }`, reject stale generations, add a generation to `playback-seeked`, make `desktop_sync_media_session` return an error on parse failure, and generate shared payload types from Rust (see QA-31). **Effort:** S.

#### PB-02 · Audio thread deadlocks when opening the output device fails
- **Category / Severity / Confidence:** Concurrency · **P1** · CONFIRMED (code; the subagent reproduced the lock pattern in a standalone rustc program)
- **Subsystem:** `src-tauri/src/audio.rs` device switch path
- **Issue:** `src-tauri/src/audio.rs:937-944` calls `emit_playback_transition(&app, state_clone.lock().generation, …, state_clone.lock().current_file.clone(), …)`. Both `lock()` temporaries live until the end of the statement. `parking_lot::Mutex` is not reentrant, so the audio command thread blocks forever while holding the `PlaybackState` lock.
- **Knock-on effects:** the position thread (`audio.rs:159`) and the mixer callback (`audio/source.rs:245-248`, which locks state per sample) both block; later commands still return `Ok` because the command channel is unbounded, so the UI receives no error.
- **Trigger:** selecting a device that fails to open, "system" with no default device, or an enumeration error.
- **Impact:** audio freezes until the app is restarted.
- **Fix:** copy the needed fields into locals under one lock, release, then emit. **Effort:** S.

#### PB-03 · Hidden or tray window may have its renderer suspended, and the renderer owns queue advance
- **Category / Severity / Confidence:** Background lifecycle · **P1** (macOS 14+) · LIKELY (documented default, not observed)
- **Subsystem:** window lifecycle, queue advance
- **Issue:** close-to-tray hides the main window (`src-tauri/src/lib.rs:446-450`). No window in `src-tauri/tauri.conf.json` sets `backgroundThrottling`; tauri-utils documents the default "suspend" policy that throttles and can suspend hidden views after about five minutes (supported on macOS 14+). Track advance (`usePlaybackLifecycle.ts:239-307`), gapless preload, crossfade, media-key handling (`useDesktopIntegration.ts:269-339`), tray Quit (routed through the renderer, `desktop_integration.rs:704`) and the sleep timer (`useSleepTimer.ts:27-37`) all live in main-window JavaScript.
- **Impact:** a player left in the tray may stop at the end of the current track, ignore media keys, or fail to quit from the tray.
- **Fix:** set `"backgroundThrottling": "disabled"` on the main window; longer term, move queue advance into Rust (see Section 9). **Effort:** S (config) / L (native queue).

#### PB-06 · Gapless handoff re-picks the next track, so the UI can show a different track than the one playing
- **Category / Severity / Confidence:** State divergence · **P1** · CONFIRMED (code)
- **Subsystem:** gapless playback (on by default, `src/store/settings-store.ts:159`)
- **Issue:** the preload target is chosen with one `previewNext()` call (`usePlaybackLifecycle.ts:140-152`). At the seamless `playback-ended`, `previewNext()` is called again and that index is activated (`usePlaybackLifecycle.ts:258-273`). Under shuffle, `previewNext` is random (`player-store.ts:397`), so the second pick usually differs. Any queue, shuffle or repeat edit between preload and handoff has the same effect. The handoff payload carries only the outgoing path (`audio/events.rs:6-12`, `audio.rs:794-800`), and the preload generation is discarded (`usePlaybackLifecycle.ts:146`), so the renderer cannot detect the mismatch.
- **Impact:** wrong title, artwork and lyrics; play counts credited to the wrong track.
- **Fix:** store the preloaded queue entry (`_queueId`, path, generation) and activate exactly that entry; include the incoming path in the event; re-preload after queue edits. **Effort:** M.

#### PB-07 · Seek reports the requested time, not the decoder's actual position; MP3 coarse seek is inaccurate for VBR
- **Category / Severity / Confidence:** Accuracy · P2 · CONFIRMED (code and symphonia source)
- **Evidence:** `src-tauri/src/audio/source.rs:98-120` discards `SeekedTo { actual_ts }` and does not decode-and-discard to the target; the position becomes the requested seconds (`audio.rs:92-99`). symphonia-bundle-mp3 0.5.5 coarse seek assumes constant bitrate.
- **Impact:** persistent offset between displayed time and audio, which skews lyrics, resume position and near-end timing.
- **Fix:** use `actual_ts` and skip samples to the target, or use accurate seek for MP3. **Effort:** M.

#### PB-08 · A failed seek restarts the track at 0:00; files without a known frame count get no gapless or crossfade
- **Category / Severity / Confidence:** Correctness · P2 · CONFIRMED
- **Evidence:** on seek error (for example MP3 `Unseekable`), `audio/source.rs:72-84` reopens the file at position 0. Duration comes only from the frame count (`source.rs:48-55`); with 0, the near-end check (`audio.rs:179-183`, requires `duration > 0`) never fires.
- **Impact:** seeking or resuming restarts the song; gapless and crossfade silently do nothing for such files.
- **Fix:** fall back to accurate seek, use the database duration as fallback, surface errors. **Effort:** M.

#### PB-09 · Real-time mixer path locks shared state per sample while other threads hold that lock across IPC emits
- **Category / Severity / Confidence:** Real-time safety · P2 · CONFIRMED in code; audible glitches LIKELY (not runnable here)
- **Evidence:** `audio/source.rs:245-248` locks state for every sample to read the booster level; Pause (`audio.rs:599-616`), Resume (`:619-636`) and SourceRenamed (`:817-828`) hold the lock while calling `app.emit`; the gapless handoff callback runs on the mixer thread and performs locks plus two IPC emits (`:782-810`).
- **Also:** a per-packet `Vec` allocation and file I/O happen inside the source's `next()` on the mixer thread (`audio/source.rs:238-251, 296-306`). (Merges AR-06.)
- **Impact:** priority inversion and possible dropouts, precisely at the seamless transition.
- **Fix:** keep the booster in an atomic, never hold the lock across `emit`, move handoff notification to a channel. **Effort:** M.

#### PB-12 · Interrupted crossfade leaves stale pending state; a later end of that file is ignored and playback halts
- **Category / Severity / Confidence:** State machine · P2 · LIKELY (code path traced, not run)
- **Evidence:** pending crossfade clears only on `crossfadeCompleted`/`decodeFailed` (`usePlaybackLifecycle.ts:221-223`). Backend Play (`audio.rs:269-271`), Seek (`:504-506`), Stop (`:643-645`) and device switch (`:910-912`) cancel the crossfade without emitting a transition. A later `playback-ended` whose path matches the stale `outgoingPath` returns early (`usePlaybackLifecycle.ts:250-252`).
- **Impact:** queue stops (for example with Repeat One or when that track is replayed).
- **Fix:** clear pending crossfade in the coordinator on start/next/previous/seek/stop; emit `crossfadeCancelled`. **Effort:** S.

#### PB-13 · No handling of output-device loss or system default-device changes
- **Category / Severity / Confidence:** Device robustness · P2 · CONFIRMED absence; impact LIKELY
- **Evidence:** the output stream is opened once (`audio.rs:216-235`); stream errors are not observed; a saved device that disappeared silently falls back to default with a log line (`audio/device.rs:258-260`); devices are identified by display name.
- **Impact:** unplugging a USB DAC or Bluetooth headset freezes position with the UI still showing "playing"; Tarab does not follow OS default changes; two devices with the same name collide.
- **Fix:** watch for stalled sample counters or stream errors, reopen and resume at the last position; identify devices by a stable ID. **Effort:** M.

#### PB-14 · Missing, corrupt or unsupported tracks stop the queue instead of being skipped
- **Category / Severity / Confidence:** Error recovery · P2 · CONFIRMED
- **Evidence:** `play_track` rejection stops playback (`usePlaybackLifecycle.ts:288-300`); `playback-error` stops playback (`:313-358`); gapless preload failure is only logged (`audio.rs:767-770`); 64 consecutive bad packets end the track (`audio/source.rs:194-207`). Skip is manual from a banner that exists only in the full player (`PlayerContent.tsx:290-358`, see FE-10).
- **Fix:** auto-advance past a failed auto-advanced track with a retry cap and a non-blocking notice. **Effort:** S.

#### PB-21 · Playback speed changes pitch
- **Category / Severity / Confidence:** Feature quality · P3 · CONFIRMED (rodio 0.19 `Speed` multiplies the sample rate; used at `audio.rs:716-725`, `audio/source.rs:134`)
- **Impact:** 0.5x to 2x speed sounds like tape speed change; crossfade windows scale with speed.
- **Fix:** time-stretch (for example a WSOLA or rubberband binding) or label the control "speed and pitch". **Effort:** L.

#### PB-23 · Pausing during a crossfade lets the fade finish while paused
- **Category / Severity / Confidence:** Correctness · P3 · CONFIRMED (`audio/crossfade.rs:158-160` uses wall-clock progress; the 20 ms loop keeps stepping while paused, `audio.rs:1011-1027`)
- **Fix:** accumulate elapsed time only while playing. **Effort:** S.

#### PB-24 · Seek while paused may briefly play audio; seek events carry no generation; every seek reopens the file
- **Category / Severity / Confidence:** Correctness · P3 · CONFIRMED in code; audible blip POSSIBLE
- **Evidence:** seek builds an unpaused output then pauses it (`audio.rs:539-568`); `playback-seeked` has no generation (`:535`, `:574`); seek clears the gapless preload (`:492`); scrubbing reopens the file per event with no coalescing.
- **Fix:** create the output paused, add a generation, coalesce seeks. **Effort:** S.

#### PB-25 · Decoder does not filter packets by track ID
- **Category / Severity / Confidence:** Decoder robustness · P3 · POSSIBLE
- **Evidence:** `audio/source.rs:204-209` feeds every packet to the audio decoder; MP4 chapter/text tracks or extra Ogg streams can cause decode errors or noise.
- **Fix:** filter by the selected track ID. **Effort:** S.

#### PB-26 · Scanner accepts formats the decoder cannot play; Opus is not scanned
- **Category / Severity / Confidence:** Library/decoder mismatch · P3 · LIKELY
- **Evidence:** `src-tauri/src/library.rs:12-14` lists `wma` and `alac`; symphonia 0.5 has no WMA decoder and `.alac` is not a real container extension. `tauri.conf.json` also registers file associations for `wma` and `alac`.
- **Impact:** such files enter the library and then fail at playback (see PB-14).
- **Fix:** derive the scan list and associations from the enabled codecs; mark unplayable files at scan. **Effort:** S.

#### PB-32 · Volume booster hard-clips and is not persisted
- **Category / Severity / Confidence:** Audio quality · P3 · CONFIRMED (`audio/source.rs:249` clamps after gain up to 2x; booster level is absent from the session payload)
- **Fix:** add a limiter or soft clip; persist the level. **Effort:** S.

#### QA-27 · Track duration underestimated by up to one second
- **Category / Severity / Confidence:** Correctness · P3 · CONFIRMED (`audio/source.rs:51-52` divides symphonia's fractional seconds by the denominator a second time)
- **Fix:** use `time.seconds as f64 + time.frac`. **Effort:** S.

#### LD-04 · `PlaybackCoordinator` contract is only partly enforced: generation setter is not monotonic and editor preview bypasses the current track
- **Category / Severity / Confidence:** Architecture rule violation · P3 · CONFIRMED
- **Evidence:** `setActivePlaybackGeneration` assigns any positive value (`src/features/app/playback-generation.ts:7-11`), so an out-of-order resolution can move the active generation backwards. `startEditorPreview` (`src/lib/playback-actions.ts:105-112`) plays a file without setting `currentTrack`, so the player bar shows the previous track while the preview plays and the queue lifecycle treats the preview as the current track's playback. Callers import individual functions; the frozen `PlaybackCoordinator` object (`playback-actions.ts:164-177`) is not used as the single entry point AGENTS.md rule 6 describes.
- **Fix:** make the setter `max(current, next)`; give previews their own playback mode or set `currentTrack`; route callers through one coordinator with serialized source changes (also fixes PB-28). **Effort:** S.

#### PB-28 · Two quick Next presses advance only one track
- **Category / Severity / Confidence:** Concurrency · P3 · LIKELY
- **Evidence:** `playAdjacentTrack` chooses the target before awaiting `playTrack` and updates the store afterwards (`src/lib/playback-actions.ts:140-149`); only desktop actions are deduplicated (`useDesktopIntegration.ts:274-282`).
- **Fix:** serialize track changes or update the index optimistically. **Effort:** S.

### 4.2 Queue, shuffle, persistence and playlists

#### PB-10 · Shuffle with Repeat Off never ends
- **Category / Severity / Confidence:** Queue semantics · P2 · CONFIRMED (subagent repro: 20 plays from a 3-track queue with repeat off)
- **Evidence:** `src/store/player-store.ts:382-399` falls back to the whole pool once every track has been seen (`unseen.length > 0 ? unseen : pool`); end-of-queue `null` is reachable only for a one-track queue; history is capped at 50 IDs (`:134-138`), so long queues repeat early.
- **Fix:** generate a Fisher-Yates order once and end at its last entry when repeat is off. **Effort:** M.

#### PB-11 · Shuffle Previous follows list order; "Play Next" is ignored under shuffle; manual Next with Repeat One restarts the song
- **Category / Severity / Confidence:** Queue semantics · P2 (Previous, Play Next), P3 SUBJECTIVE (Repeat One) · CONFIRMED
- **Evidence:** `previewPrevious` ignores shuffle history (`player-store.ts:428-439`); Play Next inserts at `queueIndex + 1` (`:193-196`, `src/hooks/useContextMenuBuilder.tsx:68-75`) but shuffle picks randomly; manual Next returns the same track for Repeat One (`player-store.ts:380-381`).
- **Fix:** use the shuffle order from PB-10 for Previous; keep a priority "up next" list that overrides shuffle; skip Repeat One for user-initiated Next. **Effort:** M.

#### PB-29 · Removing the playing track from the queue makes Next skip a track
- **Category / Severity / Confidence:** Queue state · P3 · CONFIRMED (repro: queue a,b,c,d; play b; remove b; Next goes to d)
- **Evidence:** `player-store.ts:221-227` keeps the index on the removed slot; QueueView removals use the raw `queueIndex` (`src/components/queue/QueueView.tsx:165-170, 405`).
- **Fix:** step the index back when removing the current entry. **Effort:** S.

#### PB-05 · One failed session write disables all later saves and makes tray/menu Quit fail
- **Category / Severity / Confidence:** Persistence · P2 · CONFIRMED (code at `src/features/app/player-state-store.ts:48-63`; subagent repro test)
- **Issue:** `saveQueue = saveQueue.then(...)` has no rejection handler, so one rejection poisons the chain and every later save is skipped. `flushPlayerStateWrites` then rejects, so the quit paths (`useDesktopIntegration.ts:320-323`, `:357-367`) never reach `desktopQuitApplication`. The error is swallowed by `useSessionPersistence.ts:62-66`.
- **Fix:** `saveQueue = saveQueue.catch(() => {}).then(...)`; quit in `finally`. **Effort:** S.

#### PB-15 · A failed track lookup during restore still enables saving, so an empty queue overwrites the stored one
- **Category / Severity / Confidence:** Data loss · P2 · CONFIRMED
- **Evidence:** a `dbGetTracksByIds` failure is caught (`usePlayerSessionRestore.ts:65-71`), leaving an empty queue; `finally` marks the store hydrated (`:200-202`); mount effects (`useAppSessionPersistence.ts:42-55`) save. Because the load itself succeeded, `latestRevision` was raised to the stored revision (`player-state-store.ts:23`) and the next save wins. Dropped IDs also shift `queueIndex` (`usePlayerSessionRestore.ts:76-85`). Lead note: when the store read itself fails, `latestRevision` stays 0 and the revision guard at `player-state-store.ts:55` protects the stored queue, so the data-loss path is specifically the lookup failure.
- **Fix:** mark hydrated only on success or a genuinely empty store; keep unresolved IDs. **Effort:** S.

#### PB-20 · Quit and window close do not save the latest state
- **Category / Severity / Confidence:** Persistence · P3 · CONFIRMED
- **Evidence:** the flush awaits only already-queued writes and does not build a fresh payload or fire the pending 5 s timer (`useSessionPersistence.ts:69-90`); window close with hide-to-tray off, Dock Quit and OS logout have no handler (`lib.rs:441-451, 466-486`).
- **Fix:** build and save a fresh payload on quit; handle `RunEvent::ExitRequested`. **Effort:** S.

#### PB-30 · In development builds, session restore never completes and saving never starts
- **Category / Severity / Confidence:** Developer lifecycle · P3 (dev only) · LIKELY
- **Evidence:** StrictMode runs the restore effect twice; the second run exits on the "already restored" ref and the cancelled first run never marks hydration (`usePlayerSessionRestore.ts:48-56, 201, 207-209`; `src/main.tsx:39`).
- **Impact:** developers cannot reproduce persistence behavior in `pnpm dev:app`.
- **Fix:** reset the ref in the effect cleanup. **Effort:** S.

#### PB-16 · Playlist reorder resets every entry's added date and rewrites the whole list from client state
- **Category / Severity / Confidence:** Data integrity · P3 · CONFIRMED
- **Evidence:** reorder deletes all rows and reinserts with `added_at = updated_at` (`src-tauri/src/database/playlists.rs:280-281`) using the client's possibly stale list (`src/components/playlist/PlaylistsView.tsx:133-141`); `PRIMARY KEY (playlist_id, track_id)` (`database/migrations.rs:275`) silently drops duplicates; unknown track IDs insert rows with empty metadata.
- **Fix:** update `position` only and validate the ID set. **Effort:** S.

#### PB-17 · Playlist mutation IDs never protect an actual retry
- **Category / Severity / Confidence:** Design gap (AGENTS.md persistence rule) · P3 · CONFIRMED
- **Evidence:** a fresh `crypto.randomUUID()` per call (`src/lib/tauri-commands.ts:501-507, 524-530`); mutation hooks never pass one (`src/features/playlists/mutations.ts:121-131`); the backend cache is in-memory (256 entries) and its key ignores the payload (`src-tauri/src/playlist.rs:29-54`); remove has no ID.
- **Fix:** create the ID once per user action and include a payload hash in the key. **Effort:** S.

#### PB-31 · Media-session and mini-window sync resend full artwork every two seconds and jump the mini progress bar
- **Category / Severity / Confidence:** Performance / UX · P3 · CONFIRMED
- **Evidence:** while playing, full base64 artwork is re-sent every 2 s and re-applied (`useDesktopIntegration.ts:164-177, 250-257`; `desktop_integration.rs:337-351`); the mini window receives position every 2 s with no interpolation; `hasPrevious` is always true for a non-empty queue; `albumArtist` is always `null` (`useDesktopIntegration.ts:153`). The harness log also shows `desktop_close_mini_window` invoked on every native UI sync when the mini window is disabled (`useDesktopIntegration.ts:140-142`).
- **Fix:** send metadata on track change only; interpolate time in the mini window; skip redundant close calls. **Effort:** S.

#### PB-27 · LRC parser edge cases
- **Category / Severity / Confidence:** Lyrics correctness · P3 · CONFIRMED
- **Evidence:** `[offset:]` is added instead of subtracted (`src/lib/lyrics-parser.ts:49-53, 79, 107`); `[mm:ss:xx]` lines are dropped; fractions with four or more digits parse as 0 ms (`:17-23`); timed empty lines (instrumental gaps) are skipped (`:104-105`), so the previous line stays highlighted.
- **Fix:** subtract offset, accept both separators, scale any fraction length, keep empty timed lines. **Effort:** S.

### 4.3 Library, scanning, metadata and data integrity

#### LD-02 · Library sort by title, artist or album only sorts the tracks already loaded
- **Category / Severity / Confidence:** Correctness, large-library UX · **P1** · CONFIRMED (code)
- **Subsystem:** Library Songs view (`src/features/library/useLibraryData.ts`, `src/components/library/LibraryView.tsx`)
- **Issue:** the tracks query fetches the first 400 tracks ordered by `dateAdded desc` (`useLibraryData.ts:97-106`). Load-more appends pages of 300, also always `sortBy: 'dateAdded', sortOrder: 'desc'` (`LibraryView.tsx:906-943`). The user's sort is applied client-side to whatever is loaded (`useLibraryData.ts:23-38, 246-254`). The backend already supports sorted paging by title, artist, album, play count and duration (`src-tauri/src/database/tracks.rs:411-436`) but the frontend never passes the user's sort.
- **Trigger:** library larger than 400 tracks; choose Sort: Title.
- **Impact:** "A to Z" shows the A to Z of the 400 most recently added tracks; scrolling loads more by date and inserts them throughout the already-rendered list, shifting rows under the cursor. Tracks starting with "A" that were added long ago appear only after scrolling far enough. This is the primary browse surface for the "serious library" positioning in the README.
- **Fix:** include `sortBy`/`sortOrder` in the query key and pass them to `db_get_tracks_paginated`; reset pages when sort changes; use keyset pagination with a unique tiebreaker (see LD-15). **Effort:** S to M.

#### PB-04 · Scan reconcile is quadratic while holding the database lock and an open write transaction
- **Category / Severity / Confidence:** Performance, scalability · **P1** for large libraries · CONFIRMED (code plus two independent benchmarks)
- **Subsystem:** `src-tauri/src/database/tracks.rs` reconcile
- **Issue:** `preserved_count` runs `request.tracks.iter().any(|t| normalize_path(...) == path)` for every discovered path (`tracks.rs:222-231`), allocating a string per comparison, inside the transaction opened under `self.conn.lock()` (`:110-112`).
- **Measurements (Linux container, `rustc -O`, synthetic):** subagent A: 10k paths 0.95 s, 30k 8.8 s. Subagent B: 5k 0.21 s, 10k 1.0 s, 20k 3.65 s; extrapolated about 23 s at 50k and about 90 s at 100k. Both runs used the same algorithm, so the quadratic shape is consistent; absolute numbers will differ on desktop hardware.
- **Impact:** every other database command blocks for the duration; combined with PB-18 this happens after any file change. (Also reported as AR-01 and QA-03.)
- **Fix:** build a `HashSet` of normalized incoming paths once. **Effort:** S.

#### PB-18 · Any watched file change triggers a full rescan of the whole library root, including Tarab's own tag writes
- **Category / Severity / Confidence:** Performance, architecture · **P1** · CONFIRMED (code)
- **Evidence:** each watcher event leads to `scanFolder(root)` (`src/components/settings/useLibraryScan.ts:505-512`), which re-reads tags and blurhash for every file (`:151-185`), re-runs cover-art hashing when `downloadArtwork` is on (`:159-185`), sends all tracks in one reconcile request (`:223-253`, feeding PB-04) and then re-indexes lyrics (AR-11). There is no mtime/size skip. `autoWatch` and `downloadArtwork` default to true (`src/store/settings-store.ts:152,154`). Tag and lyrics writes fire Modify events. Track identity is the file path, so an external rename loses play count, rating and date added. (Also reported as AR-02.)
- **Impact:** editing one tag rescans everything; on large libraries this means minutes of CPU, multi-megabyte IPC and a held DB lock.
- **Fix:** reconcile only changed paths through a `refresh_tracks(paths)` command; store mtime/size and skip unchanged files; suppress self-writes; detect renames. **Effort:** M.

#### AR-11 · Lyrics index sync re-sorts the whole table for every page: 41 s at 100k tracks, after every scan
- **Category / Severity / Confidence:** Scalability · P2 · CONFIRMED (measured on synthetic SQLite)
- **Evidence:** `ORDER BY id COLLATE NOCASE LIMIT/OFFSET` without a matching index (`src-tauri/src/database/tracks.rs:463-478`) in a paging loop (`src-tauri/src/lyrics.rs:444-488`); five sidecar probes per track, two identical (`lyrics.rs:260-310`). Measured 40 ms per page at offset 0, 547 ms at offset 90k, 41.3 s for 100 pages.
- **Fix:** keyset pagination or one streaming query; metadata-only probes; incremental indexing. **Effort:** S.

#### AR-08 · Scans decode full-resolution embedded artwork two or three times per track
- **Category / Severity / Confidence:** Scan performance · P2 · CONFIRMED (code); costs indicative
- **Evidence:** blurhash from full-resolution `load_from_memory` for every file (`src-tauri/src/metadata.rs:199-201, 394-400`); `metadata.rs:713-757` rereads the file, makes thumbnails and computes blurhash again; three Lanczos3 resizes from full resolution (`src-tauri/src/image_cache.rs:124-152`). Pillow reference: 1400x1400 JPEG decode 13 ms, three resizes 62 ms.
- **Fix:** derive blurhash from the 64 px thumbnail; deduplicate by artwork hash before decoding; cascade resizes. **Effort:** M.

#### AR-09 · Thumbnails are lossless WebP, so the default 200 MB cache holds roughly 1,000 albums
- **Category / Severity / Confidence:** Disk and performance · P2 · CONFIRMED (code) and measured
- **Evidence:** the `image` 0.25 WebP encoder is lossless-only (`image-0.25.10/src/codecs/webp/encoder.rs:14`), used at `src-tauri/src/image_cache.rs:178`; default `cacheSizeLimitMb: 200` (`src/store/settings-store.ts:169`). Measured about 204 KB per album lossless vs about 20 KB at lossy quality 80.
- **Impact:** eviction churn on mid-size libraries forces regeneration from audio files (AR-08 cost).
- **Fix:** JPEG q80-85 or lossy WebP; evict per hash by access time. **Effort:** S.

#### QA-08 · One unreadable directory entry fails the whole scan
- **Category / Severity / Confidence:** Robustness · P2 · CONFIRMED (`src-tauri/src/library.rs:104` propagates the first walk error)
- **Impact:** drive roots containing `System Volume Information`, or volumes with `.Trashes`/`.Spotlight-V100`, can never be scanned.
- **Fix:** record per-entry errors in `ScanReconcileError` and continue; mark traversal incomplete so reconcile preserves rows. **Effort:** S.

#### QA-09 · Tag and lyrics writes are in place, not atomic
- **Category / Severity / Confidence:** Data integrity · P2 · LIKELY
- **Evidence:** lofty `save_to_path` in place (`src-tauri/src/tageditor.rs:343-345, 428-430`); lyrics use plain `fs::write` (`src-tauri/src/lyrics.rs:243`).
- **Impact:** a crash, power loss or full disk mid-write can corrupt user audio files. Batch tag edits multiply the exposure.
- **Fix:** write to a temporary sibling, fsync, rename; keep a backup for batch edits. **Effort:** M.

#### PB-33 · Folder reconcile prefix match is case-insensitive
- **Category / Severity / Confidence:** Data integrity edge case · P3 · POSSIBLE
- **Evidence:** `LIKE '<folder>/%'` (`src-tauri/src/database/tracks.rs:105-125`) is ASCII case-insensitive by default.
- **Impact:** on case-sensitive filesystems, rescanning `/Music/Rock` can select and delete index rows under `/music/rock` (index rows only, not files).
- **Fix:** exact `substr()` prefix comparison or a range predicate. **Effort:** S.

#### PB-19 · Watch events use canonical paths but are matched against folders as configured
- **Category / Severity / Confidence:** Watcher correctness · P3 · POSSIBLE
- **Evidence:** roots are canonicalized before watching (`src-tauri/src/library_watcher.rs:99-108`) but matched against stored `libraryFolders` (`useLibraryScan.ts:505-511`).
- **Impact:** symlinked roots, `/var` vs `/private/var`, or Windows path forms drop events.
- **Fix:** emit the matching configured root ID with each event. **Effort:** S.

#### AR-19 · Watcher uses leading-edge throttling, has an unbounded debounce map, broadcasts to all windows and sets up recursively on the main thread
- **Category / Severity / Confidence:** Reliability, responsiveness · P2 · CONFIRMED / LIKELY
- **Evidence:** the first event is emitted and later ones dropped, so final writes can be missed; the map is never pruned (`src-tauri/src/library_watcher.rs:45-87`); the sync command joins the old watcher thread (up to 250 ms) (`:110-131`); events go to all windows including the mini player (`:79, :82`); the watcher's extension list differs from `library.rs:12-14`; inotify watch-limit failures abort the whole watch. (Merges QA-26.)
- **Fix:** trailing-edge debouncer (`notify-debouncer-full`), async setup, shared extension list, `emit_to` main. **Effort:** S.

#### AR-21 · Schema and index issues
- **Category / Severity / Confidence:** Database performance · P3 · CONFIRMED (measured on synthetic data)
- **Evidence:** `idx_tracks_file_path` duplicates the UNIQUE autoindex (`src-tauri/src/database/migrations.rs:221`); the FTS update trigger fires on every UPDATE (1,000 play-count updates 37 ms vs 9.4 ms with a column-limited trigger); folder `LIKE … ESCAPE` cannot use the index; OFFSET title paging at 90k is 323 ms; the LIKE fallback runs on every no-hit keystroke (74 ms at 100k) (`src-tauri/src/database/tracks.rs:411-445, 601-627, 663-680`).
- **Fix:** drop the index, restrict the trigger to text columns, range predicates, keyset pagination, minimum-length guard. **Effort:** S.

#### LD-15 · Paginated queries order by non-unique columns without a tiebreaker
- **Category / Severity / Confidence:** Correctness · P3 · LIKELY
- **Evidence:** `ORDER BY {title|artist|album|date_added|…} {dir} LIMIT ?1 OFFSET ?2` with no secondary key (`src-tauri/src/database/tracks.rs:430-436`).
- **Impact:** when LD-02 is fixed and the frontend pages by title or artist, rows with equal keys can repeat or disappear across page boundaries (SQLite does not guarantee a stable order for ties).
- **Fix:** append `, id` to every ORDER BY and move to keyset pagination. **Effort:** S.

#### AR-22 · Deep-link track resolution hashes every row
- **Category / Severity / Confidence:** Performance · P3 · CONFIRMED (`src-tauri/src/database/tracks.rs:523-541`; about 92 ms at 100k rows)
- **Fix:** store an indexed `public_id` column. **Effort:** S.

#### AR-34 · Shuffle-all and aggregates pull whole-library payloads into JavaScript
- **Category / Severity / Confidence:** Scalability · P3 · CONFIRMED
- **Evidence:** `src/features/library/loadTracksForShuffle.ts:6-35` pages every track into JS; album and artist aggregates each carry a full `DbTrack` (`src-tauri/src/database/aggregates.rs`). The main list is virtualized and Fuse runs in a worker on at most 240 results, which is sound.
- **Fix:** shuffle IDs server-side and hydrate lazily; slim aggregate DTOs. **Effort:** M.

#### AR-35 · Smart-shuffle de-clustering is roughly quadratic in the worst case
- **Category / Severity / Confidence:** Performance · P3 · LIKELY (`src-tauri/src/database.rs:328-371`: up to 512 passes with nested scans and string clones)
- **Fix:** per-artist bucket interleave. **Effort:** S.

#### LD-07 · Genre is editable in the tag editor but absent from the library schema
- **Category / Severity / Confidence:** Product gap · P3 · CONFIRMED
- **Evidence:** `DbTrack` has no genre field (`src-tauri/src/database.rs:48-76`); the tag editor reads and writes genre (`src/components/tageditor/TagEditorModal.tsx:394`); the smart-playlist `ByGenre` rule type exists in `src/types.ts` and Rust but always returns "ByGenre rules are not supported by the current track schema." (`src-tauri/src/playlist.rs:13-14, 370-372`).
- **Impact:** no genre browsing, filtering, sorting or smart playlists, which most library-focused players offer.
- **Fix:** add a genre column (multi-value aware) populated at scan; enable the rule. **Effort:** M.

#### QA-04 · Legacy `music-player` data may not migrate on Linux
- **Category / Severity / Confidence:** Upgrade path · P3 (no public release yet) · LIKELY
- **Evidence:** the log plugin creates `data_local_dir/com.fawaz.tarab/logs` during plugin setup (`tauri-plugin-log-2.9.0/src/lib.rs:772-776`), before `create_database()` (`src-tauri/src/lib.rs:339`); `prepare_app_directory` (`src-tauri/src/database.rs:443-468`) skips migration when the new directory exists.
- **Impact:** users of the earlier build on Linux would see an empty library.
- **Fix:** decide migration by the presence of the database file, not the directory. **Effort:** S.

### 4.4 Desktop integration, OS behavior and startup

#### AR-12 · Windows runs two media-control (SMTC) integrations; one bypasses the renderer and emits events nobody listens to
- **Category / Severity / Confidence:** Architecture rule violation, platform behavior · P2 · CONFIRMED (code); user-visible symptoms LIKELY (not run on Windows)
- **Evidence:**
  - `src-tauri/src/lib.rs:192` initializes `tauri_plugin_media`, whose Windows backend creates its own `MediaPlayer` and uses that player's SMTC (`src-tauri/vendor/tauri-plugin-media/src/platform/windows.rs:93-99`).
  - `src-tauri/src/lib.rs:410-418` also initializes souvlaki, which attaches a second SMTC session to the main window HWND (`src-tauri/src/media_controls.rs:17-50`).
  - souvlaki Play/Pause/Stop call `audio_manager.resume/pause/stop` directly (`media_controls.rs:64-71, 87-88`), bypassing the main window, contrary to AGENTS.md rules 1 and 3.
  - Next/Previous emit `next-track` / `previous-track` (`media_controls.rs:79, 84`), and `emit_desktop_control_action` also broadcasts `tray-toggle-playback` / `tray-next-track` (`src-tauri/src/desktop_integration.rs:676-690`). None of these four events has a listener in `src/`.
  - `update_media_metadata` (the only way to give the souvlaki session metadata) is never invoked from the renderer.
  - Mitigation found: renderer-side dedupe of identical `desktop-control-action` payloads within a short window (`src/features/app/useDesktopIntegration.ts:274-282`) prevents some double toggles.
- **Impact:** LIKELY two "Tarab" entries in the Windows media flyout (one without metadata); pressing Pause on the souvlaki entry pauses audio while the UI still shows playing.
- **Fix:** remove souvlaki and `update_media_metadata`; keep one media-session owner routed through `desktop-control-action`; delete the legacy broadcasts. (Merges lead finding LD-03, PB-L1/L2, QA-15, QA-16.) **Effort:** S.

#### AR-07 · Audio thread exits permanently if no output device exists at startup
- **Category / Severity / Confidence:** Reliability · P2 · CONFIRMED (`src-tauri/src/audio.rs:215-235`: `if stream_bundle.is_none() { return; }`; recovery logic exists only inside the loop, `:830-952`)
- **Impact:** launching with no audio device (docked laptop, Bluetooth not yet connected) means playback never works until restart, with no error shown.
- **Fix:** keep the command loop alive and open the stream lazily on Play or device selection. **Effort:** S.

#### LD-06 · Database initialization failure exits silently with no user-visible message
- **Category / Severity / Confidence:** Reliability, UX · P2 · CONFIRMED (code)
- **Evidence:** `create_database()` failure returns `Err` from `setup` (`src-tauri/src/lib.rs:339-345`); `build()` then fails and the only output is `eprintln!("error while building Tauri application: …")` (`lib.rs:486`). On macOS and Windows a GUI launch has no visible stderr.
- **Trigger:** corrupted or locked database file, read-only or full app-data volume, failed migration.
- **Impact:** the app appears to do nothing when launched; users cannot recover or report the cause.
- **Fix:** show a native dialog (`rfd` or `tauri-plugin-dialog` blocking message) before exit, log to the log plugin, and offer "move database aside and start fresh". **Effort:** S.

#### LD-19 · Backend diagnostics go to stderr instead of the configured log plugin
- **Category / Severity / Confidence:** Observability · P3 · CONFIRMED
- **Evidence:** 34 `eprintln!` calls versus 3 `log::` macro uses in `src-tauri/src` (grep count at HEAD); `tauri_plugin_log` is initialized (`src-tauri/src/lib.rs:184`) but only receives renderer logs.
- **Impact:** startup timings, media-key registration failures, playlist bootstrap failures and similar messages are lost in packaged builds, which makes field diagnosis hard.
- **Fix:** replace `eprintln!` with `log::` macros. **Effort:** S.

#### QA-05 · Cover art over the `cover-art://` custom protocol likely fails on Windows, falling back to slower IPC
- **Category / Severity / Confidence:** Platform compatibility · P2 · LIKELY (not run on Windows)
- **Evidence:** URLs are hard-coded as `cover-art://localhost/{hash}/{size}` (`src/hooks/useCoverArt.ts:19-20`, `src/components/library/LibraryView.tsx:638, 1059`, `src/components/player/DesktopMiniWindowSurface.tsx:56`). On Windows (WebView2) Tauri 2 serves custom schemes as `http://<scheme>.localhost/…`, which the frontend never generates (no `convertFileSrc` use). The renderer already contains a rate-limited IPC blob fallback (`CoverArtImage.tsx:92-120`, `useCoverArt.ts:9-10, 120-124`), which suggests protocol failures were observed. Direct `<img>` uses in the mini window and the ambient backdrop have no fallback.
- **Impact:** on Windows every cover first fails, then loads through IPC (slower, more memory); mini window and backdrop art likely stay blank.
- **Fix:** build URLs with `convertFileSrc(path, 'cover-art')`, and accept both forms in the Rust parser (`lib.rs:110-117`). **Effort:** S.

#### QA-06 · Windows canonical paths keep the `\\?\` prefix
- **Category / Severity / Confidence:** Platform compatibility · P2 · POSSIBLE
- **Evidence:** canonicalized paths are stored and compared without stripping the verbatim prefix (`src-tauri/src/file_ops.rs:370-374, 420-428`).
- **Impact:** grant overlap and dedupe checks may never match, producing duplicate grants and duplicate tracks.
- **Fix:** use `dunce::canonicalize` or strip the prefix consistently. **Effort:** S.

#### AR-10 · `cover-art://` handler reads disk synchronously on the webview thread
- **Category / Severity / Confidence:** Responsiveness · P2 · LIKELY (`src-tauri/src/lib.rs:124-157` uses `register_uri_scheme_protocol`; `tauri-2.11.5/src/app.rs:2153-2154` provides an asynchronous variant)
- **Impact:** grid scrolling with a cold cache or slow disk can stall the UI thread.
- **Fix:** `register_asynchronous_uri_scheme_protocol` with a worker pool. **Effort:** S.

#### AR-05 · Media-session sync re-sends full-resolution base64 artwork every two seconds to a main-thread command
- **Category / Severity / Confidence:** Performance, energy · P2 · CONFIRMED
- **Evidence:** artwork via `getCoverArtData` (`src/features/app/useDesktopIntegration.ts:164-176`) on a 2 s interval while playing (`:243-257`); `desktop_sync_media_session` is synchronous, clones the untyped JSON and base64-decodes it (`src-tauri/src/desktop_integration.rs:314-345`); on Linux and macOS the vendored plugin writes the artwork to a temp file each time (`vendor/tauri-plugin-media/src/platform/linux.rs:286-290`, `macos.rs:178-181`). Also: mini-window position updates arrive every 2 s with no interpolation, `hasPrevious` is always true for a non-empty queue, `albumArtist` is always null, and `desktop_close_mini_window` is invoked on every native-UI sync when the mini window is disabled (`useDesktopIntegration.ts:140-142`; observed in the harness IPC log). (Merges PB-31.)
- **Fix:** send artwork once per track as a cover hash resolved in Rust to the 512 px thumbnail; send status and position separately; make the command async and typed. **Effort:** S to M.

#### AR-13 · Linux applies the full app menu to every window, including the 320x92 mini player
- **Category / Severity / Confidence:** Platform UX · P2 · LIKELY (not run on a Linux desktop)
- **Evidence:** non-Windows builds create the app menu and call `app.set_menu` (`src-tauri/src/desktop_integration.rs:159-169, 456`); on Linux, app menus attach to each window.
- **Fix:** build the app menu on macOS only, or attach a per-window menu to `main`. **Effort:** S.

#### AR-26 · macOS builds two app menus; label updates go to the replaced one
- **Category / Severity / Confidence:** Platform · P3 · CONFIRMED
- **Evidence:** the first menu is set at `desktop_integration.rs:159-187, 456`, replaced by `macos_menu::build_menu` (`src-tauri/src/lib.rs:429-432`, `src-tauri/src/macos_menu.rs:137`); `apply_native_ui_state` updates the detached handles (`desktop_integration.rs:560-571`); two `on_menu_event` handlers exist.
- **Impact:** the Play/Pause menu label LIKELY never updates on macOS; conflicting accelerators.
- **Fix:** one menu builder per platform. **Effort:** S.

#### AR-32 · Hidden mini-player webview is created at startup even though the feature is off by default
- **Category / Severity / Confidence:** Memory, startup · P3 · LIKELY
- **Evidence:** `mini-player` window declared with `visible: false` (`src-tauri/tauri.conf.json`); `desktopMiniWindowEnabled` defaults to false (`src/store/settings-store.ts:165`); the entry loads about 387 KB JS plus 207 KB CSS.
- **Fix:** create the window on first use with `WebviewWindowBuilder`. **Effort:** S.

#### QA-10 · Help > README menu item is broken
- **Category / Severity / Confidence:** Disconnected UI · P3 · CONFIRMED (`openUrl` in `src/features/app/useNativeMenuActions.ts:93-94` is denied by the opener capability, which grants only `reveal-item-in-dir` (`src-tauri/capabilities/opener.json:6`); the rejection is swallowed)
- **Fix:** grant a URL-scoped `opener:allow-open-url` for the project URL or open it from Rust. **Effort:** S.

#### QA-11 · Autostart `--minimized` flag is never read
- **Category / Severity / Confidence:** Disconnected feature · P3 · CONFIRMED (passed at `src-tauri/src/lib.rs:179-182`; no code reads it)
- **Impact:** login autostart opens the full window in front of the user.
- **Fix:** check the argument in setup and keep the main window hidden or minimized. **Effort:** S.

#### QA-13 · The same deep link clicked twice in one session does nothing the second time
- **Category / Severity / Confidence:** Correctness · P3 · CONFIRMED (`src/features/app/useDeepLinkBridge.ts:45-48` keeps a never-reset handled set)
- **Fix:** dedupe by delivery ID or a short time window instead. **Effort:** S.

#### QA-14 · "Play once" authority is consumed when playback starts, so artwork, palette and preload for that file fail
- **Category / Severity / Confidence:** Correctness · P3 · CONFIRMED (`src-tauri/src/audio.rs:1204-1205` consumes the grant; cover art, palette, crossfade and preload check library roots only)
- **Fix:** keep the one-file grant for the lifetime of that queue entry. **Effort:** S.

#### FE-24 · Native menu items do less than their labels say
- **Category / Severity / Confidence:** Disconnected UI · P2 · CONFIRMED (`src/features/app/useNativeMenuActions.ts:63-105`)
- **Evidence:** New Playlist only navigates to Playlists without opening the create dialog; Albums and Artists open Library without selecting the facet; Diagnostics opens generic Settings; Import fails for files outside granted folders and rescans whole folders rather than importing the chosen files.
- **Fix:** pass intents (open dialog, select facet); offer to add the folder on import. **Effort:** M.

#### SEC-10 · macOS media plugin never releases its Objective-C objects and has no autorelease pool
- **Category / Severity / Confidence:** Resource leak · P3 · LIKELY (`src-tauri/vendor/tauri-plugin-media/src/platform/macos.rs:131-155, 219-247`)
- **Impact:** memory grows with each Now Playing update; with AR-05's 2 s cadence this accumulates over long sessions.
- **Fix:** wrap updates in `autoreleasepool` and use retained wrappers (`objc2::rc::Retained`). **Effort:** S.

### 4.5 UI, visual quality and UX

Severity note: the frontend subagent rated FE-01 to FE-06 as P1. After verification the lead rates them P2. FE-01/02 cost GPU time and hide a feature but do not break playback; FE-03 needs a non-string rejection that Rust `Result<_, String>` commands rarely produce; FE-04, FE-05 and FE-06 each affect one entry point and have workarounds. They remain high on the quick-win list.

#### FE-01 · The liquid WebGL shell renders continuously but is always covered by an opaque layer
- **Category / Severity / Confidence:** Performance, visual design · P2 · CONFIRMED (stacking order in code; the harness screenshots show no metaballs or aurora)
- **Evidence:** `src/features/app/AppLayouts.tsx:198-215` mounts `AppShellLiquidWebGL` at `fixed z-0` and, when `backgroundEnabled` is on, `LiquidHomeAmbientBackdrop`, whose root is `fixed inset-0 z-[4]` with a fully opaque first child `bg-[#0d0b09]` (`src/components/shell/LiquidHomeAmbientBackdrop.tsx:25-26`). The canvas uses the default always-render frameloop and `dpr={[1, 2]}` (`src/components/shell/AppShellLiquidWebGL.tsx:198-220`); `pauseAnimation` freezes shader time but frames still render (AR-18).
- **Impact:** the README's "restrained WebGL motion" is never visible in the default configuration, while the GPU renders a full-window scene at display refresh rate and up to 2x resolution. This also explains why LD-01 went unnoticed.
- **Fix:** decide product intent: either remove the opaque base and verify the result, or delete the shell. In either case use `frameloop="demand"` with a low-rate ticker and `dpr` 1. **Effort:** S to M.

#### LD-01 · All three liquid-shell post-processing shaders fail to compile
- **Category / Severity / Confidence:** Correctness · P2 · CONFIRMED (rendered in headless Chromium/SwiftShader; root cause confirmed in three.js source)
- **Evidence:** `POST_VERT` and `BLIT_FRAG` start with `#version 300 es` (`src/components/shell/liquid-shell-render-pipeline.tsx:20, 33`), as do `src/graphics/glass/shaders/fragment-bg-hblur.glsl:1` and `fragment-bg-vblur.glsl:1`, and are used as `THREE.RawShaderMaterial` sources (`liquid-shell-render-pipeline.tsx:77-110`). three 0.170.0 prepends `#define SHADER_TYPE …` and `#define SHADER_NAME …` to raw shader sources (`node_modules/three/src/renderers/webgl/WebGLProgram.js:500-520`), which pushes `#version` to line 3. The browser log showed `ERROR: 0:3: 'version' : #version directive must occur before anything else` and `useProgram: program not valid`. The GLSL ES 3.00 specification requires `#version` first, so this is not specific to SwiftShader.
- **Impact:** the blur and blit passes never draw; the shell pipeline is non-functional on every platform.
- **Fix:** remove the inline `#version` lines and pass `glslVersion: THREE.GLSL3`. **Effort:** S.

#### FE-02 · Unused full-window blur passes and a per-frame layout loop feeding a store nothing reads
- **Category / Severity / Confidence:** Performance, dead code, AGENTS.md rule · P2 · CONFIRMED
- **Evidence:** each frame renders to a target, blurs horizontally and vertically into `blurB`, then blits the unblurred target; `blurB` is never sampled (`liquid-shell-render-pipeline.tsx:149-189`). `liquid-control-pill.frag.glsl` is never imported. `src/hooks/use-liquid-control-motion.ts:73-176` runs a rAF loop with `querySelector` and two `getBoundingClientRect` calls per frame and writes to `useLiquidControlGlassStore`, which has no subscribers; the "Debug liquid tab glass" switch (`src/features/settings/components/SettingsForms.tsx:439-446`) is therefore a no-op. AGENTS.md forbids full-window post chains without a product decision.
- **Fix:** delete the blur passes, the motion hook and the store. **Effort:** S.

#### FE-07 · At the minimum window size the floating dock covers player controls; its labels clip and the search bar overflows
- **Category / Severity / Confidence:** Responsiveness · P2 · CONFIRMED (rendered in the harness at 800x600 in both themes)
- **Evidence:** the dock is shown below `lg` (`src/features/app/AppTransientSurfaces.tsx:170-172`) at `fixed bottom-5 … z-50` (`src/components/navigation/FloatingDock.tsx:90`), above the mini player at `z-40` (`src/components/player/MiniPlayer.tsx:620`); the window `minWidth` is 800 (`tauri.conf.json`). Harness captures: liquid 800x600 shows dock labels clipped to "HOMI", "LIBRAF", "QUEUI", "PLAYLIS", "SETTIN" with mismatched icon tiles, and the search field running off the right edge with its shortcut hint and right-hand buttons hidden; neobrutalism 800x600 shows the dock sitting on top of the "Console Standby" play/previous controls. The top navigation stays visible, so the dock duplicates navigation.
- **Fix:** drop the dock on desktop widths (the top bar already provides navigation) or reserve layout space for it; give the search field a min/max width. **Effort:** M.

#### LD-08 · Neobrutalism album grid columns expand to fit long titles
- **Category / Severity / Confidence:** Layout · P2 · CONFIRMED (rendered in the harness and measured)
- **Evidence:** `VirtualizedGrid` uses `gridTemplateColumns: repeat(N, 1fr)` (`src/components/shared/VirtualizedGrid.tsx:225`); `1fr` has an `auto` minimum, and the neo card's title is a `truncate` (nowrap) block inside a flex column without `min-width: 0` (`src/components/library/LibraryResultsOrchestrator.tsx:288-342`). In the harness a long album title's element measured 532 px wide, producing one card about five columns wide and a neighbouring Arabic-titled card squeezed to about 100 px.
- **Fix:** `repeat(N, minmax(0, 1fr))` and `min-w-0` on the card. **Effort:** S.

#### FE-09 · Selection pills highlight the wrong navigation item
- **Category / Severity / Confidence:** Navigation state · P2 · CONFIRMED (harness: Settings view open while the top-nav pill stays on Home)
- **Evidence:** when no item matches the current view the index falls back to 0 (`src/components/navigation/Sidebar.tsx:197-205, 230-238`; `src/components/navigation/SlidingTabGroup.tsx:40-47`) and the pill is always opaque (`src/hooks/use-liquid-segmented-pill.ts:346-357`). In rail mode on Home, the Tags and Settings pills also light up. `FloatingDock.tsx:50` handles this correctly with `enabled: index >= 0`.
- **Fix:** pass `enabled: activeIndex >= 0` everywhere. **Effort:** S.

#### FE-04 · Search shortcuts focus the hidden mobile search input
- **Category / Severity / Confidence:** Keyboard UX · P2 · CONFIRMED (jsdom probe: active element was the `md:hidden` input)
- **Evidence:** two inputs share one `id` and one ref in `src/components/navigation/TopBar.tsx:37, 288, 727, 813`; the mobile one attaches last and wins; `focusSearchInput` (`:502-527`) serves `/`, the native Find menu, the rail Search icon and library auto-focus. The window is never narrower than 800 px, so the mobile input is always hidden.
- **Impact:** keyboard search entry points silently fail; duplicate `id` is invalid HTML.
- **Fix:** one input with responsive layout, or separate refs. **Effort:** S.

#### FE-05 · Liquid Home Mute button changes the icon but not the audio
- **Category / Severity / Confidence:** Disconnected UI · P2 · CONFIRMED (`src/components/home/HomeView.parts.tsx:192` calls only the store `setVolume`; nothing syncs store volume to the engine, `src/store/player-store.ts:307-308`; the neo version does call the engine, `HomeViewNeo.tsx:120-121`)
- **Impact:** shows muted while audio plays; a volume of 0 is persisted.
- **Fix:** route through one volume hook that updates engine and store (see FE-16). **Effort:** S.

#### FE-06 · "Hide cover art" in the full player removes every transport control
- **Category / Severity / Confidence:** Workflow · P2 · CONFIRMED (`src/components/player/PlayerContent.tsx:425-541` gates the whole left column, including seek bar and transport, on `!fullscreenHideCoverArt`; the setting persists)
- **Fix:** gate only the artwork element. **Effort:** S.

#### FE-03 · Passing `reportError` directly to `.catch` can replace the whole UI with the error boundary
- **Category / Severity / Confidence:** Robustness · P2 · CONFIRMED mechanism (jsdom probe), trigger POSSIBLE
- **Evidence:** `src/components/player/MiniPlayer.tsx:105, 109, 113, 120` use `.catch(reportError)`, so the rejection value becomes the banner message; `src/features/app/AppOverlayMessages.tsx:54` renders `{appError.message}`. An `Error` object there throws "Objects are not valid as a React child" and `AppErrorBoundary` replaces the app.
- **Trigger:** any rejection that is not a string (IPC failures, serialization errors, mocks).
- **Fix:** wrap each call and coerce `message` to a string inside `reportError`. **Effort:** S.

#### FE-10 · Playback-failure recovery actions exist only inside the full player
- **Category / Severity / Confidence:** Error state · P2 · CONFIRMED (main shell shows a 5 s toast and a dismissible banner with no actions, `usePlaybackLifecycle.ts:343-356`; Retry/Skip/Reveal/Remove only in `PlayerContent.tsx:323-358`; contradicts `docs/design/design_language.md:238-242`)
- **Fix:** surface the recovery banner in the main shell and mini player. **Effort:** M.

#### FE-11 · Compact full player's seek bar is never visible or mouse-usable
- **Category / Severity / Confidence:** Interaction · P2 · CONFIRMED (`HidingProgressBar.tsx:156-164` reveals on a `.group` ancestor; the compact card at `PlayerContent.tsx:844` lacks `group`; committed baseline `tests/visual-baselines/full-player/liquid-card-1200x800.png` shows only a dot)
- **Fix:** add `group` to the compact card. **Effort:** S.

#### FE-12 · Full player shows no elapsed/total time and no volume in the default layout
- **Category / Severity / Confidence:** Information design · P2 · CONFIRMED (`PlayerContent.tsx:425-541`; volume only in the compact layout at `lg`, `:892-894`; committed two-column baselines show neither)
- **Fix:** add a time readout and volume control. **Effort:** S.

#### FE-13 · Neobrutalism ignores the collapsed mini-player state and shows an empty bar
- **Category / Severity / Confidence:** Theme divergence · P2 · CONFIRMED (`MiniPlayer.tsx:140` returns null when collapsed; the neo layout `AppLayouts.tsx:164-181` has no pill branch)
- **Fix:** hide the option in neo or build a neo pill. **Effort:** S.

#### FE-14 · Mini Player settings describe the wrong surface
- **Category / Severity / Confidence:** Copy, wiring · P2 · CONFIRMED (`src/components/settings/sections/MiniPlayerSection.tsx:13-29` describes the always-on-top window, but only the in-app bottom bar reads these settings; "Collapse to sidebar" produces a floating pill, `MiniPlayer.tsx:344-352`)
- **Fix:** rename the section and toggles. **Effort:** S.

#### FE-16 · Five separate volume implementations behave differently
- **Category / Severity / Confidence:** Duplication, consistency · P2 · CONFIRMED
- **Evidence:** liquid mini range, neo segments, react-aria `PlayerVolume`, Home `VolumeControl`, `NeoVolumeControl` (`MiniPlayer.tsx:125-137, 234-295, 584-608`; `PlayerVolume.tsx`; `HomeView.parts.tsx:144-228`; `HomeViewNeo.tsx:74-168`; `useKeyboardShortcuts.ts:154-175`). Unmute restores 0.7, 0.5, 0.8 or the previous value depending on surface; neo segments are `role=button` divs; the neo popover does not close on outside click or Escape; Home's slider is hidden at `w-0` but focusable.
- **Fix:** one `useVolume` hook and one slider with per-theme skins. **Effort:** M.

#### FE-17 · The neobrutalism full player is dark blurred glass
- **Category / Severity / Confidence:** Theme consistency · P2 · CONFIRMED (`PlayerContent.tsx` has no neo branch and uses blur and pan animation, `:367-395, 836-842`; the neo spec prohibits blur, `docs/design/neobrutalism_design.md:110-117`; committed baselines `neo-two-column-1440x900.png`, `neo-card-800x600.png`)
- **Fix:** a neo skin for the full player. **Effort:** M.

#### FE-18 · Parallel liquid and neo component trees diverge in behavior, not only appearance
- **Category / Severity / Confidence:** Architecture, consistency · P2 · CONFIRMED
- **Evidence:** neo Home always shows the hero ("Console Standby"), has no `.catch` on transport calls (`HomeViewNeo.tsx:455-505`), shows at most 24 albums with no "View all" and no stats (`:341-353`); liquid Home ignores `onScrollChange` (`HomeView.tsx:78-86`); the neo layout ignores `reducedEffects` and `backgroundEnabled` (`AppLayouts.tsx:110-185`) and leaves an empty 80 px aside below `lg`; track details and long-press exist only in the liquid album overlay. Duplicate pairs: `HomeView`/`HomeViewNeo`, `TopBar`/`TopBarNeo`, `AlbumDetailsOverlay` (1282 lines)/`AlbumDetailsOverlayNeo` (750), `LibraryNeoLayout`.
- **Impact:** every feature and fix must be implemented twice, and the README claim "Both systems preserve the same library, playback, lyric, and editing features" is not true.
- **Fix:** shared view-models/controllers per view with presentational skins. **Effort:** L.

#### FE-19 · Library says "Your library is empty" for empty facets of a non-empty library
- **Category / Severity / Confidence:** Copy · P2 · CONFIRMED (`src/components/library/LibraryView.tsx:1408-1431`; committed screenshot shows "Most Played 0")
- **Fix:** facet-specific empty states. **Effort:** S.

#### FE-20 · Clear queue has no confirmation or undo
- **Category / Severity / Confidence:** Safety · P2 · CONFIRMED (`QueueView.tsx:231-238, 435-441`; contradicts "Destructive actions ask for confirmation" in `SettingsShell.tsx:139`)
- **Fix:** undo toast. **Effort:** S.

#### FE-25 · Tag editor discards unsaved edits on Escape; inside the full player, Escape closes both
- **Category / Severity / Confidence:** Safety · P2 · CONFIRMED (no dirty check, `TagEditorModal.tsx:578, 586-591, 636-643`); double close LIKELY (`AppTransientSurfaces.tsx:63-68`, `useKeyboardShortcuts.ts:186-191`)
- **Fix:** dirty tracking with confirm; scope Escape to the top layer. **Effort:** S.

#### FE-26 · Playlists view: no virtualization, raw type names, no per-track play
- **Category / Severity / Confidence:** UX, scale · P2 · CONFIRMED (`src/components/playlist/PlaylistsView.tsx:394-465` renders every entry; `:236-252` shows raw "FolderSync"; `:247` "1 tracks"; `:255-262` `aria-live` on the whole pane)
- **Fix:** `VirtualizedList`, friendly labels, row play. **Effort:** M.

#### FE-31 · Errors appear twice and use internal wording
- **Category / Severity / Confidence:** Error UX · P2 · CONFIRMED (`src/lib/report-error.ts:38-60` fires a toast and replaces the banner; strings like "toggle failed", "seek failed", `HomeView.tsx:144-162`; banner lacks `role="alert"`, `AppOverlayMessages.tsx:36-79`; in neo the banner scrolls away, `AppLayouts.tsx:153-161`)
- **Fix:** separate logging from user notification; curated copy. **Effort:** M.

#### FE-30 · Home and library styling contradicts the documented design language
- **Category / Severity / Confidence:** Design compliance · P2 · CONFIRMED
- **Evidence:** staggered `animationDelay` fade-ins (`HomeView.parts.tsx:282, 415`); album titles visible only on hover (`:495`), which in the harness made art-less Home tiles indistinguishable icons; text as small as `text-[9.5px]` (`HomeView.tsx:389`, `HomeView.parts.tsx:311`, `QueueView.tsx:686`) and 0.55 to 0.65 rem in `library-view.css:597, 694, 702, 808, 1085, 1377, 1437`; `.tarab-fade-up` is applied unconditionally and missing from the reduced-motion block (`index.css:897-932`). Spec: `docs/design/design_language.md:40-43, 207-214`.
- **Fix:** remove stagger, keep labels visible, enforce a 12 px floor, gate the fade. **Effort:** S.

#### FE-22 · No RTL or bidirectional text handling for Arabic metadata and lyrics
- **Category / Severity / Confidence:** Internationalization · P2 · CONFIRMED absence; rendering effects LIKELY
- **Evidence:** no `dir`, `<bdi>` or `unicode-bidi` anywhere in `src`; `index.html:2` is `lang="en"`; karaoke word fill runs left to right from a fixed origin (`src/components/player/LyricsLine.tsx:51-66, 141-148`); titles use uppercase and wide letter-spacing (`HomeViewNeo.tsx:318-323`). The harness rendered Arabic titles left-aligned within LTR containers; whether letter-spacing breaks joining in WebKit was not verified.
- **Impact:** for an app named Tarab with Arabic music as an obvious audience, mixed-direction titles reorder punctuation and truncate on the wrong side, and Arabic karaoke highlights against reading order.
- **Fix:** `dir="auto"` on metadata text, inputs and lyric lines; RTL-aware karaoke fill; no letter-spacing for Arabic script. **Effort:** M.

#### FE-23 · Mini-player lyric line freezes during playback
- **Category / Severity / Confidence:** Disconnected UI · P2 · CONFIRMED (`MiniPlayer.tsx:33-69` reads a non-reactive `timeSec` getter during render, `src/contexts/smooth-time.tsx:66-75`)
- **Fix:** subscribe with `useSmoothTimeSubscription`. **Effort:** S.

#### FE-08 · Liquid icon-rail mode has no window drag region; the liquid album view has no Back button
- **Category / Severity / Confidence:** Desktop UX · P2 · CONFIRMED (`AppLayouts.tsx:229-253` renders the only drag region only when search is open in rail mode; `Sidebar.tsx:317-384` has none; `AlbumDetailsOverlay.tsx:630` ignores `onClose`, `:934, 978` are empty placeholders)
- **Fix:** persistent drag strip; Back button. **Effort:** S.

#### LD-11 · Copy and pluralization defects
- **Category / Severity / Confidence:** Copy · P3 · CONFIRMED (rendered in the harness and in code)
- **Evidence:** Settings shows "1 sources" (`src/components/settings/UnifiedSettingsView.tsx:230`) and "Last scanned Not scanned yet" (`:341` combined with `formatScanTime`, `:79-80`); playlists show "1 tracks" (`PlaylistsView.tsx:247`); neo album cards say "8 FILES" (`LibraryResultsOrchestrator.tsx:336`) while liquid cards say "8 TRACKS"; neo settings hard-codes "TARAB V1.1" over the title while the app is 1.0.0 (`SettingsShell.tsx:110`, FE-34).
- **Fix:** an `Intl.PluralRules` helper and a copy pass. **Effort:** S.

#### FE-34 · Hard-coded "TARAB V1.1" overlaps the neo Settings title
- **Category / Severity / Confidence:** Visual, copy · P3 · CONFIRMED (`SettingsShell.tsx:110`; `neobrutalism.css:581-590`; harness neo settings captures)
- **Fix:** `getVersion()` and normal-flow placement. **Effort:** S.

#### FE-35 · Command palette is limited and shows Mac-only glyphs everywhere
- **Category / Severity / Confidence:** Discoverability · P3 · CONFIRMED / SUBJECTIVE (`GlobalCommandPalette.tsx:192, 203, 370`: 12 static commands, no track or album search, ⌘ glyphs on all platforms, ⌘K never advertised)
- **Effort:** M.

#### FE-36 · No keyboard-shortcut reference; Up/Down silently change volume
- **Category / Severity / Confidence:** Discoverability · P3 · CONFIRMED (`useKeyboardShortcuts.ts:79-199`)
- **Fix:** shortcuts sheet; modifier for volume. **Effort:** S.

#### FE-38 · Desktop mini window seek target is 4 px tall and ignores the theme
- **Category / Severity / Confidence:** Hit target · P3 · CONFIRMED (`DesktopMiniWindowSurface.tsx:213-270`; spec requires 20 px or more, `design_language.md:232-236`)
- **Effort:** S.

#### FE-39 · "Lyric size" is labelled in px but is a 1 to 100 scale
- **Category / Severity / Confidence:** Copy · P3 · CONFIRMED (default 50 shown as "50px" renders 32 px; `FullscreenPlayerSection.tsx:51-52`, `LyricsLine.tsx:49-50`)
- **Effort:** S.

#### FE-40 · Neo Home copy is jargon-heavy and its cards move despite the neo spec
- **Category / Severity / Confidence:** Copy, design compliance · P3 · CONFIRMED (code) / SUBJECTIVE (copy) (`HomeViewNeo.tsx:566-583` "COLD STORAGE / NO RECORDS FOUND … records ingestion", "MAP FOLDERS"; hover translate `:53`; ungated `animate-pulse` `:181`; spec `neobrutalism_design.md:2051-2057`)
- **Effort:** S.

#### FE-44 · Queue empty state has no call to action
- **Category / Severity / Confidence:** Empty state · P3 · CONFIRMED (`QueueView.tsx:463-475`; harness capture also shows a progress stub with 0 tracks)
- **Effort:** S.

#### FE-45 · Heavy stacked `backdrop-filter` in the liquid theme
- **Category / Severity / Confidence:** Compositing cost · P3 · CONFIRMED (counts) / POSSIBLE (impact) (65 blur usages in TSX; per-button blur in `LiquidGlassButton.tsx:457`; full-viewport animated grain with blend mode, `index.css:836-865`; Reduced Effects does not remove per-button blur)
- **Effort:** M.

#### LD-14 · Settings persistence skips validation on the current version and swallows write failures
- **Category / Severity / Confidence:** Robustness · P3 · CONFIRMED
- **Evidence:** zustand `migrate` (which holds the only `SettingsSchema.safeParse`) runs only when the stored version differs (`src/store/settings-store.ts:321-370`); on parse failure it returns the unvalidated object anyway (`:366-369`); `setItem` errors are only logged (`src/platform/tauri-zustand-storage.ts:22-27`); the `< 7` migration forces `autoLyrics: false` regardless of the stored choice (`:353-357`).
- **Impact:** a hand-edited or partially written `settings.json` (see QA-29) can load invalid values; users are not told when settings fail to save.
- **Fix:** validate in `merge` on every load; fall back per field; surface persistent write failures once. **Effort:** S.

#### FE-46 · Two settings behave inconsistently with their defaults or lifecycle
- **Category / Severity / Confidence:** Settings wiring · P3 · CONFIRMED
- **Evidence:** `navMode` defaults to `topNav` for new installs (`src/store/settings-store.ts:172`) while the v<3 migration defaults it to `iconRail` (`:337`), so upgraded and fresh installs differ; `autostartEnabled` is reconciled with the OS only while the Desktop settings page is mounted (`src/features/settings/components/SettingsForms.tsx:240-262`), so an external change is not reflected until that page opens. All other settings keys were checked and are consumed by behavior code (frontend subagent audit), with the exceptions listed in FE-02, FE-06, FE-13 and FE-14.
- **Effort:** S.

### 4.6 Accessibility

#### FE-21 · Nested interactive controls in album tiles (source of the React DOM-nesting warning)
- **Category / Severity / Confidence:** Accessibility, invalid DOM · P2 · CONFIRMED (React warned "`<button>` cannot contain a nested `<button>`" when the harness opened the Library view)
- **Evidence:** in the featured liquid album tile, a native `<button>` wraps the shared `<Button>` (`src/components/library/LibraryResultsOrchestrator.tsx:393-410`) inside an `<article role="button" tabIndex={0}>` with Enter/Space handling (`:357-372`); the inner shadow class `shadow-[0_6px_22_rgba(0,0,0,0.42)]` is invalid (missing `px`) and silently dropped. The neo album card is also an `<article role="button">` containing a Play `<button>` (`:288-331`).
- **Impact:** screen readers announce nested buttons inconsistently; keyboard Enter on the inner control can trigger the outer one.
- **Fix:** make open and play sibling controls; fix the shadow token. **Effort:** S.

#### FE-15 · Home album card Play button cannot be used by keyboard; controls and titles appear only on hover
- **Category / Severity / Confidence:** Accessibility · P2 · CONFIRMED
- **Evidence:** the card is `role="button"` and its keydown handler calls `preventDefault` on Enter/Space, so Enter on the inner Play button bubbles up and opens the album (`HomeView.parts.tsx:417-440`, `HomeViewNeo.tsx:269-283`); inner buttons are `opacity-0` until hover with no `:focus-within` reveal and `focus-visible:outline-none` (`HomeView.parts.tsx:516-529`); titles hidden until hover (`:495`).
- **Fix:** sibling controls, ignore keydown when `target !== currentTarget`, reveal on `:focus-within`. **Effort:** S.

#### FE-27 · Album track rows: unlabeled "More" button, hover-only controls, wrong ARIA roles
- **Category / Severity / Confidence:** Accessibility · P2 · CONFIRMED (`AlbumDetailsOverlay.tsx:604-612` More button without `aria-label`, opacity 0 even when focused; `:543-583` hover-only Play; `:455-459, 1130-1182` `aria-selected` inside `role="table"`; `:234` `role="status"` on each playing row's waveform)
- **Fix:** labels, `:focus-within` reveal, `role="grid"` or checkboxes. **Effort:** S.

#### FE-28 · Neo theme forces black focus outlines and uses below-AA grey text
- **Category / Severity / Confidence:** Contrast, focus visibility · P2 · CONFIRMED (`neobrutalism.css:115-118` `outline-color: #000 !important` on everything, invisible on dark surfaces; `:135-141` 11 px `#888` on white, about 3.5:1, fails WCAG AA for small text; the neo spec mandates this at `neobrutalism_design.md:312`; many neo labels are 10 to 11 px against the 12 px floor in `design_language.md:75, 213`)
- **Fix:** two-tone focus ring; darker 12 px+ labels; update the neo spec. **Effort:** S.

#### FE-29 · framer-motion animations ignore Reduced Effects and OS Reduce Motion
- **Category / Severity / Confidence:** Motion accessibility · P2 · CONFIRMED (no `MotionConfig` anywhere; `AppLayouts.tsx:164-181, 274-305` animate height and y/opacity; `TopBar.tsx:672-695`)
- **Impact:** contradicts the README claim that the system preference always wins.
- **Fix:** wrap the app in `MotionConfig reducedMotion` driven by the effective setting. **Effort:** S.

#### FE-37 · Collapsed pill player is not keyboard-operable and is mispositioned
- **Category / Severity / Confidence:** Accessibility · P3 · CONFIRMED (keyboard) / LIKELY (position) (`PillMiniPlayer.tsx:84-96` div `onClick` without role or tabindex; breathe animation ignores Reduced Effects; `fixed` element inside a transformed wrapper, `AppLayouts.tsx:293-303`)
- **Effort:** S.

#### FE-41 · Virtualized lists lack list semantics; queue drag-and-drop sees only rendered rows
- **Category / Severity / Confidence:** Screen readers · P3 · CONFIRMED / LIKELY (`VirtualizedList.tsx:93-124` no `role="list"` or `aria-setsize`/`aria-posinset`; `VirtualizedGrid.tsx:180` hard-codes `aria-label="Library items"`; queue virtualizes above 100 items, `QueueView.tsx:326-376`)
- **Effort:** S.

#### FE-42 · `SmoothTimeProvider` runs a requestAnimationFrame loop even when paused or unused
- **Category / Severity / Confidence:** Performance, energy · P3 · CONFIRMED (`src/contexts/smooth-time.tsx:22-52`)
- **Fix:** run only while playing and subscribed. **Effort:** S.

### 4.7 Architecture, performance and resource use

#### AR-04 · Playlist commands are synchronous (run on the main thread) and load the whole tracks table per smart or folder playlist
- **Category / Severity / Confidence:** Responsiveness, scalability · **P1** · CONFIRMED (code); freeze duration LIKELY
- **Evidence:** all 14 playlist commands are synchronous `#[tauri::command] fn` (lead count, `src-tauri/src/playlist.rs`); Tauri runs synchronous commands on the main thread (`tauri-macros-2.6.3/src/command/wrapper.rs:249-251`). `get_playlists` builds full details for every playlist to return summaries (`playlist.rs:697-706`); each smart or folder playlist calls `db.get_all_tracks()` (`:541-542, 556-566`), bypassing the 50k guard that exists only in `db_get_all_tracks` (`src-tauri/src/database.rs:510-526`); `sync_playlist` walks the folder on the main thread (`playlist.rs:974-1017`). A full-table select took 1,155 ms at 100k synthetic tracks (SQL only).
- **Impact:** opening Playlists with several smart playlists on a large library freezes the whole window (including the WebView event loop) for seconds.
- **Fix:** async commands with `spawn_blocking`; membership and counts in SQL; summaries without entries. **Effort:** M.

#### LD-05 · 42 other synchronous commands run on the main thread, several with blocking I/O
- **Category / Severity / Confidence:** Responsiveness · P2 · CONFIRMED (lead scripted count at HEAD: audio 16, desktop integration 7, file_ops 3, launch_intents 2, lib 2, session 2, waveform 4, taskbar 2 (Windows only), plus `cancel_library_scan`, `watch_library_paths`, `write_lyrics_for_track` and `update_media_metadata`; 56 synchronous commands in total with the 14 playlist commands. The architecture investigation's independent count was 55 synchronous of 116 registered; the lead counts 117 registered on Windows.)
- **Notable blocking work:** cpal device enumeration and switching (`src-tauri/src/audio.rs:1294-1311`); `get_library_health` (full-scan counts per grant) and `list_library_grants` (`src-tauri/src/file_ops.rs:255-309`); session load/save with fsync (`src-tauri/src/session.rs:55-83`); `write_lyrics_for_track` (`src-tauri/src/lyrics.rs:218`); waveform stats/clear walk directories (`src-tauri/src/waveform.rs:309-327`); `watch_library_paths` joins a thread; `canonicalize` in play/preload. Conversely, `select_library_folder` calls `blocking_pick_folder` inside an async command and `bootstrap_playlist_storage` runs blocking work inside `async_runtime::spawn` (`file_ops.rs:311-399`, `lib.rs:387-399`). (Merges QA-07, AR-23, AR-24.)
- **Fix:** default to `async` + `spawn_blocking` for anything touching disk, devices or the database. **Effort:** S per command.

#### AR-20 · A single `Mutex<Connection>` serializes every read behind long write transactions
- **Category / Severity / Confidence:** Architecture · P3 · CONFIRMED (`src-tauri/src/database.rs:204-247`: one connection, WAL enabled, no `busy_timeout`, no `PRAGMA optimize`)
- **Impact:** WAL's reader concurrency is unused; PB-04 and AR-11 block all UI queries.
- **Fix:** one writer connection plus a small read-only pool. **Effort:** M.

#### AR-16 · Persisted react-query cache has no filter or buster and keeps search keys and aggregates for 24 hours
- **Category / Severity / Confidence:** Performance, robustness · P2 · CONFIRMED (config) / LIKELY (cost)
- **Evidence:** `src/app/providers.tsx:43-71` sets no `shouldDehydrateQuery` and no `buster`, `maxAge`/`gcTime` 24 h; aggregates and per-search-string keys are persisted (`src/features/library/useLibraryData.ts:117-127, 157-166`); aggregates carry a full `DbTrack` per album.
- **Impact:** multi-megabyte `JSON.stringify` on the main thread after cache changes; stale shapes hydrate after upgrades.
- **Fix:** persist only small queries, exclude search, add a version buster. **Effort:** S.

#### AR-17 · Every session save reads and rewrites the whole player store over IPC
- **Category / Severity / Confidence:** Scalability · P2 · CONFIRMED (`src/features/app/player-state-store.ts:48-58` `fixedStoreGet` then `fixedStoreSet`; saves every 5 s while playing, including all queue IDs, `src/hooks/useSessionPersistence.ts:38, 69-88`; `src-tauri/src/fixed_store.rs:84-101` re-parses the file)
- **Impact:** with a large shuffled queue, megabytes move twice per save.
- **Fix:** compare revisions in memory; separate position from queue; write the queue only when it changes. **Effort:** S.

#### AR-30 · Initial bundle is about 955 KB of JavaScript (292 KB gzip) and the size check has no byte budget
- **Category / Severity / Confidence:** Startup · P3 · CONFIRMED (measured: `vite build` into the scratchpad, Linux container)
- **Evidence:** main 450 KB, react-runtime 203 KB, shared 140 KB, framer-motion 126 KB, icons 20 KB, tauri-api 16 KB; CSS 208 KB (29 KB gzip). zod enters eagerly through `src/store/settings-store.ts:4` and react-hook-form through the playlist form; framer-motion is used in two files. The three.js chunk (841 KB, 226 KB gzip) is correctly lazy; `scripts/check-initial-bundle.mjs` only checks that three.js is not preloaded. The mini-player entry loads about 387 KB JS and the full 207 KB stylesheet.
- **Context:** for a local WebView app these sizes parse in well under a second on desktop hardware; the issue is the missing budget rather than the current size.
- **Fix:** lazy-load forms and validation, replace framer-motion in two files with CSS, add byte budgets. **Effort:** S to M.

#### AR-31 · Redundant UI dependencies
- **Category / Severity / Confidence:** Dependency weight · P3 · CONFIRMED (`react-aria-components` is used only by `src/components/player/PlayerVolume.tsx` while Radix Slider is also a dependency; framer-motion only in `TopBar` and `AppLayouts`)
- **Effort:** S.

#### AR-33 · `App.tsx` is a god component; large view files carry most of the complexity
- **Category / Severity / Confidence:** Maintainability · P3 · CONFIRMED / SUBJECTIVE
- **Evidence:** `src/App.tsx` (595 lines) wires about 35 hooks and drills about 45 props into non-memoized `AppLayouts`; inline lambdas defeat the memoized `AppViewRenderer` (`App.tsx:463, 541, 568`); App re-renders on search keystrokes, scan progress, play state and scroll. Large files: `LibraryView.tsx` 1456 lines, `TagManagerView.tsx` 1407, `AlbumDetailsOverlay.tsx` 1282, `PlayerContent.tsx` 1072, `QueueView.tsx` 1020, `library-view.css` 1491. Positive: position updates use a rAF provider with leaf subscribers.
- **Fix:** split per-view controllers out of `App`; colocate state with views. **Effort:** L.

#### AR-36 · Errors are untyped strings and behavior depends on message text
- **Category / Severity / Confidence:** Maintainability · P3 · CONFIRMED (pattern) (commands return `Result<_, String>`; `error.contains("no library roots")` at `src-tauri/src/metadata.rs:555`; frontend `message.includes('cancel')` in `useLibraryScan.ts`)
- **Fix:** serializable `AppError { code, message, recoverable }`. **Effort:** M.

#### AR-25 · Dead code, dead dependencies and unused IPC surface
- **Category / Severity / Confidence:** Code quality, attack surface · P3 · CONFIRMED (scripted grep of handler names against `src/`, done independently by the lead and two subagents)
- **Evidence:**
  - Registered but never invoked by the renderer: `update_media_metadata`, `get_cover_art_with_blurhash`, `taskbar::update_progress`, `taskbar::clear_progress` (so the Windows taskbar progress feature is disconnected).
  - Wrapped but with no UI caller: `get_batch_cover_art`, `get_batch_metadata_with_art`, `cache_get_thumbnail`, `cache_generate_thumbnail`, `cache_has_thumbnail`, `db_get_all_tracks`, `get_playback_position`, `get_duration`, `set_volume_ramp`, `save_playback_session`, `desktop_open_mini_window`, `db_rename_track_path`, and the whole waveform module (the README lists waveforms as a feature).
  - `window-vibrancy` (`src-tauri/src/vibrancy.rs` is `#![allow(dead_code)]`) and `tauri-plugin-liquid-glass` (initialized at `lib.rs:193`, permissions granted in `capabilities/core.json:15-16`, never called).
  - `rubato` is a dependency but unused; resampling falls back to rodio's linear converter (PB-22).
  - Four emitted events without listeners (AR-12). `taskbar.rs` calls `CoInitializeEx` per call without `CoUninitialize`.
  - `scripts/check-ipc-contract.mjs` checks only that each wrapper maps to a registered command, not that anything calls it, and whitelists `update_media_metadata`.
- **Fix:** delete or wire; extend the contract script to flag unused commands. **Effort:** S.

#### AR-28 · Image cache: dead in-memory LRU, mtime-based "LRU", possible size underflow, renderer-only enforcement
- **Category / Severity / Confidence:** Code quality, reliability · P3 · CONFIRMED / POSSIBLE (underflow)
- **Evidence:** `memory_cache` serves only the unused base64 getter (`src-tauri/src/image_cache.rs:78-92, 195-240`); eviction by mtime deletes single sizes (`:362-409`); `current_size -= size` is not saturating (`:404`); `thumbnails_valid` opens three files per check (`:103-120`); the limit is enforced only when the renderer asks, with a 500 MB constant vs the 200 MB setting. (Merges part of QA-28.)
- **Effort:** S.

#### AR-29 · Waveform cache is keyed by path, unbounded on disk, and goes stale after edits
- **Category / Severity / Confidence:** Correctness, disk · P3 · CONFIRMED (`src-tauri/src/waveform.rs:50-200`; decodes up to 30 minutes per file; no in-flight dedupe; the cancel set only grows). Currently reachable only over IPC because no UI calls it. (Merges part of QA-28.)
- **Effort:** S.

#### PB-22 · `rubato` dependency unused; sample-rate conversion uses rodio's linear converter
- **Category / Severity / Confidence:** Audio quality, dead dependency · P3 · CONFIRMED (`src-tauri/Cargo.toml:68`; no `rubato::` use in `src-tauri/src`)
- **Impact:** 44.1 kHz material played on 48 kHz devices is resampled linearly, which aliases audibly on some material.
- **Fix:** use rubato (sinc) or remove the dependency. **Effort:** M.

#### AR-37 · Minor reliability items
- **Category / Severity / Confidence:** Miscellaneous · P3 · CONFIRMED
- **Evidence:** new reqwest client per LRCLIB request (`src-tauri/src/lyrics.rs:80-86`); playlist positions start at 1 in add and 0 in set (`src-tauri/src/database/playlists.rs:283-340`); the audio thread polls every 20 ms (`src-tauri/src/audio.rs:242`), 50 wakeups per second even when idle; uncleared timeout in `streamLibraryScan` (`src/lib/tauri-commands.ts:251-256`).
- **Effort:** S.

### 4.8 Security and privacy

**Threat model used:** (1) malicious media files and metadata arriving through downloads, shared drives or the folder watcher (primary); (2) malicious launch input from deep links, file associations and single-instance arguments; (3) a compromised renderer, treated as defense in depth because the CSP is strict and content is bundled; (4) supply chain (npm, crates, git dependencies, vendored plugin, CI secrets); (5) other local users on a shared machine.

**Controls verified as sound (not findings):**
- Custom commands are main-window-only at the invoke-handler boundary (`src-tauri/src/lib.rs:38-40, 453-464`); plugin commands go through capability ACLs; the mini window has no webview-creation permission.
- No SQL injection: only `?N` placeholders plus whitelisted ORDER BY columns (`src-tauri/src/database/tracks.rs:420-436`); FTS terms are filtered and quoted (`:597-605`).
- Path checks canonicalize and prefix-match against granted roots; symlinked mutation sources are rejected (`src-tauri/src/file_ops.rs:623-634`); undo tokens and stored names are validated (`:107-109, 976-994`); thumbnail hash and size are whitelisted for the custom protocol (`lib.rs:138`).
- LRCLIB client: HTTPS only, no redirects, 5 s/10 s timeouts, 1 MiB body cap, host re-check (`src-tauri/src/lyrics.rs:73-146`).
- Strict CSP without `unsafe-eval` (`tauri.conf.json`), `withGlobalTauri` off, no HTML injection sinks in `src/`.
- No `unwrap`/`expect`/`panic!` in production Rust paths; macOS class lookups use `Class::get`.
- Updater not linked (`createUpdaterArtifacts: false`); `pnpm audit --prod` reported no known vulnerabilities on 2026-10-17.
- The `RUSTSEC-2026-0194/0195` ignores in `package.json` affect `quick-xml 0.39.4`, used only by `wayland-scanner` at build time; `docs/security-review.md:29` documents this with a removal condition. The justification is credible; the advisory text was not re-read offline.

#### SEC-01 · Release builds abort on any panic while parsing untrusted media in-process
- **Category / Severity / Confidence:** Reliability, denial of service · P2 · LIKELY
- **Evidence:** `panic = "abort"` (`src-tauri/Cargo.toml` release profile); no `catch_unwind` anywhere; symphonia, lofty and image parse untrusted files in-process (`src-tauri/src/metadata.rs:137`, `src-tauri/src/audio/source.rs:18-57`, `src-tauri/src/tageditor.rs:124, 248`, `src-tauri/src/waveform.rs:93`). Parser panics on malformed input are historically common in media crates.
- **Impact:** one crafted or corrupt file in a watched folder can crash Tarab on every scan (with PB-18, on every file change), a crash loop the user cannot easily diagnose. (Also AR-15.)
- **Fix:** `panic = "unwind"` with per-file `catch_unwind` around parsing, or parse in a helper process; add fuzzed fixtures. **Effort:** M.

#### SEC-02 · Image size limits are checked after decoding
- **Category / Severity / Confidence:** Resource exhaustion · P2 · CONFIRMED
- **Evidence:** `src-tauri/src/image_cache.rs:136-145` calls `image::load_from_memory` and only then compares dimensions and pixel counts; blurhash and palette decodes (`src-tauri/src/metadata.rs:327, 395`) have no limits beyond the image crate's default allocation cap (512 MiB). Blurhash runs for every file during scans on a 6-thread pool. `docs/release-hardening.md:60` claims decoded-pixel limits.
- **Impact:** a small "decompression bomb" cover can force large allocations on several threads at once.
- **Fix:** read dimensions with `ImageReader::into_dimensions()` first, set `image::Limits` (width, height, allocation), cap input bytes. **Effort:** S.

#### SEC-04 · Release signing secrets are readable by dependency install and build scripts
- **Category / Severity / Confidence:** Supply chain · P2 · CONFIRMED
- **Evidence:** Apple and Windows signing secrets are set in job-level `env` (`.github/workflows/release.yml:70-76`, `:197-200`), so every later step can read them, including `pnpm install` lifecycle scripts and `cargo test`/`tauri build` build scripts of every dependency.
- **Impact:** a compromised npm or crate dependency could exfiltrate the Developer ID certificate, notarization credentials and Windows code-signing material.
- **Fix:** step-level `env` only on the signing steps, `pnpm install --ignore-scripts` where possible, run tests in a secret-free job. **Effort:** S.

#### SEC-03 · Waveform generator sizes a buffer from an unvalidated sample rate
- **Category / Severity / Confidence:** Resource exhaustion · P3 · LIKELY (`src-tauri/src/waveform.rs:95-106`; only reachable over IPC because no UI calls the waveform commands)
- **Fix:** bound sample rate and duration before allocating. **Effort:** S.

#### SEC-05 · Library grants accept `/` or the home folder; "Import folder" grants the launched file's parent with only a base-name prompt
- **Category / Severity / Confidence:** Authorization scope · P3 · CONFIRMED (`src-tauri/src/file_ops.rs:327-332, 407-441`; `src-tauri/src/launch_intents.rs:167-176`; prompt shows only the folder base name, `src/features/app/useLaunchFileIntents.ts:116`)
- **Impact:** an opened file in `~/Downloads` can grant broad filesystem authority to file operations (rename, move, trash) with little indication of scope.
- **Fix:** refuse filesystem roots and the bare home directory, show the full path. **Effort:** S.

#### SEC-06 · `opener:allow-reveal-item-in-dir` has no path scope
- **Category / Severity / Confidence:** Capability scope · P3 · CONFIRMED (`src-tauri/capabilities/opener.json:6`; the plugin's reveal command accepts any path)
- **Impact:** bypasses the library-root model for path disclosure in the file manager; low impact.
- **Fix:** add a path scope or route reveal through the native `reveal_in_file_manager` command, which already checks roots. **Effort:** S.

#### SEC-07 · The online-lyrics opt-in is enforced only in the renderer, and request errors carry metadata
- **Category / Severity / Confidence:** Privacy · P3 · CONFIRMED (`fetch_lrclib_lyrics` ignores its file path and always sends artist, title, album and duration, `src-tauri/src/lyrics.rs:205-215`; `auto_lyrics` arrives from the renderer, `:181-201`; reqwest errors include the URL with query, `:107`, which then reaches logs)
- **Fix:** read the opt-in in Rust; strip the query from error strings; document the data sent in the README privacy section. **Effort:** S.

#### SEC-08 · The mini window may emit any event name to the main window
- **Category / Severity / Confidence:** Capability scope · P3 · CONFIRMED (`src-tauri/capabilities/core-mini.json:9` grants `core:event:allow-emit-to` without an event scope; events carry no verified source)
- **Impact:** a compromised mini-window renderer could forge Rust-only events such as `launch-file-intent` or `library-scan-path-chunk`.
- **Fix:** validate the source window label on main-window listeners for privileged events, or route mini intents through a dedicated Rust command scoped to that window. **Effort:** S.

#### SEC-09 · Linux media plugin writes artwork to a fixed `/tmp` path following symlinks
- **Category / Severity / Confidence:** Local file clobbering · P3 · CONFIRMED (`src-tauri/vendor/tauri-plugin-media/src/platform/linux.rs:286-291`: `/tmp/mpris_artwork_tarab.desktop.jpg` via `fs::write`)
- **Impact:** on a shared machine another user can pre-create a symlink and have Tarab overwrite a file the Tarab user can write.
- **Fix:** per-user runtime directory (`$XDG_RUNTIME_DIR`) with `O_NOFOLLOW` or a unique temp file. **Effort:** S.

#### SEC-11 · `desktop_sync_media_session` takes untyped JSON, logs the raw payload on failure and reports success
- **Category / Severity / Confidence:** IPC typing (AGENTS.md rule 4), privacy · P3 · CONFIRMED (`src-tauri/src/desktop_integration.rs:314-325`: titles and base64 artwork printed with `{:?}`, error swallowed with `Ok(())`; artwork size uncapped). This silent success is why PB-01 broke the OS media session without any visible error. (Also AR-27.)
- **Fix:** typed struct parameter, capped artwork, return errors. **Effort:** S.

#### SEC-12 · Several commands check one path and then operate on another (time-of-check to time-of-use)
- **Category / Severity / Confidence:** Filesystem safety · P3 · CONFIRMED pattern (`play_track`, `src-tauri/src/audio.rs:1200-1204`; rename and move, `src-tauri/src/file_ops.rs:702-707, 758-760`, where rename can replace an existing target on Unix; trash restore, `:1001, :1016`; lyrics write follows symlinks, `src-tauri/src/lyrics.rs:235-243`; reveal, `file_ops.rs:1447-1453`)
- **Fix:** operate on the canonical path that was checked; refuse to overwrite existing targets (`renameat2` with `RENAME_NOREPLACE` or an existence check plus link/unlink). **Effort:** M.

#### SEC-13 · Reconcile deletes rows based on renderer-reported traversal completeness
- **Category / Severity / Confidence:** Trust boundary · P3 · CONFIRMED (`src-tauri/src/database/tracks.rs:207-218` trusts `traversalComplete` and `discoveredPaths`; the renderer always sends `true`, `src/components/settings/useLibraryScan.ts:231`)
- **Impact:** the AGENTS.md guarantee that rows are deleted "only after complete traversal proves they are missing" depends on renderer honesty and correct error handling (see QA-08).
- **Fix:** have Rust track traversal sessions it ran itself and reconcile against its own record. **Effort:** M.

#### SEC-14 · `db_rename_track_path` and `db_delete_tracks*` perform no library-root check
- **Category / Severity / Confidence:** Defense in depth · P3 · CONFIRMED (`src-tauri/src/database.rs:777-800`)
- **Effort:** S.

#### SEC-15 · `tarab://open/play` starts playback without confirmation and IDs are unsalted path hashes
- **Category / Severity / Confidence:** Design · P3 · SUBJECTIVE (`src/features/app/useDeepLinkBridge.ts:60-67`; public ID derived from the path, `src-tauri/src/database.rs:220-225`)
- **Impact:** any web page can make Tarab start playing a known track (for example a common album file path); low harm, but surprising.
- **Fix:** require focus or confirmation for play links; salt IDs per install. **Effort:** S.

#### SEC-16 · Full file paths reach persisted logs unredacted
- **Category / Severity / Confidence:** Privacy · P3 · CONFIRMED (`src/platform/logger.ts:49-53`; `src-tauri/src/file_ops.rs:605-609`)
- **Fix:** redact home-directory prefixes in logs. **Effort:** S.

#### SEC-17 · Bundled SQLite (rusqlite 0.31 / libsqlite3-sys 0.28) and glib 0.18 are behind upstream advisories
- **Category / Severity / Confidence:** Dependency hygiene · P3 · LIKELY (exploitability low: all SQL is static; glib comes through the GTK 3 stack Tauri 2 still requires on Linux)
- **Fix:** upgrade rusqlite; track Tauri's GTK migration. **Effort:** S to M.

#### SEC-18 · CI workflow uses mutable action tags and default token permissions
- **Category / Severity / Confidence:** Supply chain · P3 · CONFIRMED (`.github/workflows/ci.yml:16-98`: tag references, no `permissions:` block, unpinned `cargo install cargo-audit`; `scripts/check-release-config.mjs` only inspects `release.yml`)
- **Fix:** pin SHAs, add `permissions: contents: read`, extend the check script. **Effort:** S.

#### SEC-19 · No navigation guard on the webviews
- **Category / Severity / Confidence:** Defense in depth · P3 · SUBJECTIVE (no `on_navigation` handler; CSP already blocks most vectors)
- **Effort:** S.

### 4.9 File operations and data safety

#### QA-01 · Files moved to "Tarab Trash" cannot be found or purged after the undo dialog closes
- **Category / Severity / Confidence:** Data management · P2 · CONFIRMED
- **Evidence:** files move into `app_data/recoverable-trash/` (`src-tauri/src/file_ops.rs:96-105`); undo tokens are shown only in a one-time dialog (`src/features/app/useTrackOperations.ts:374-409`); no command lists, restores later, or purges trash contents. `README.md` describes "a bounded recovery record".
- **Impact:** removed music silently consumes disk forever and cannot be recovered once the dialog is gone.
- **Fix:** a Trash view with restore and empty actions, size display and automatic expiry; or use the OS trash. **Effort:** M.

#### QA-02 · Trash and move fail for libraries on a different volume from app data
- **Category / Severity / Confidence:** Reliability · P2 · CONFIRMED (`fs::rename` without a cross-device fallback at `src-tauri/src/file_ops.rs:760, 872, 1016`). (Also AR-14.)
- **Impact:** Remove fails for libraries on external drives or NAS mounts, a common setup for large collections.
- **Fix:** per-volume trash directory, copy-verify-remove fallback, or the OS trash API. **Effort:** M.

#### QA-12 · Tag editor cover picker only accepts images inside a library root, and writes WebP covers with a JPEG MIME type
- **Category / Severity / Confidence:** Correctness · P3 · CONFIRMED (`src-tauri/src/lib.rs:75` restricts `read_image_as_base64` to roots; `src-tauri/src/tageditor.rs:324-331` MIME mapping; cover bytes are not validated, `:338`)
- **Impact:** choosing artwork from Downloads fails with an "outside configured library roots" error; WebP covers are mislabeled in tags.
- **Fix:** grant the picked file for one read (like Play once); set the correct MIME or convert to JPEG. **Effort:** S.

#### QA-17 · A delete test exercises a test-only helper instead of the shipped command path
- **Category / Severity / Confidence:** Test validity · P3 · CONFIRMED (`src-tauri/src/file_ops.rs:646-660` helper vs test at `:1285-1308`; the shipped `delete_files` handles batches differently)
- **Effort:** S.

#### QA-29 · `fixed_store` writes without fsync and has no size limit
- **Category / Severity / Confidence:** Durability · P3 · CONFIRMED (`src-tauri/src/fixed_store.rs:28-63`)
- **Impact:** a crash during write can leave an empty or truncated `settings.json`/`tarab-player.dat`; see LD-14 for how settings then load.
- **Fix:** write temp, fsync, rename. **Effort:** S.

### 4.10 Quality assurance, CI, documentation and developer experience

#### QA-18 · Critical paths have no tests, and existing tests encode the wrong IPC payload
- **Category / Severity / Confidence:** Test coverage · P2 · CONFIRMED
- **Evidence:** Rust (87 tests ran on Linux): no end-to-end Trash/restore command test, no rename/move rollback test, no reconcile-at-scale test, no LRCLIB fetch test, no malformed-media fixtures, no migration-ordering test, no Windows path-form tests. Frontend (53 files, 170 tests): no tests for `usePlaybackPositionEvents`, `useLibraryScan`, `TagEditorModal`, `LyricsDisplay`, the mini-player entry, `useLaunchFileIntents`, gapless handoff under shuffle, save-queue failure, or media-session payload parsing. `usePlaybackLifecycle.test.tsx:195, 198` emits plain numbers where Rust sends objects, which is how PB-01 passed CI. Only 1 of 113 IPC wrappers has its argument names tested. (Merges PB-34.)
- **Fix:** generate TypeScript types from Rust (ts-rs or specta) for all command and event payloads; add contract tests; add the missing hook tests. **Effort:** M.

#### QA-31 · The IPC contract check validates names only
- **Category / Severity / Confidence:** Tooling gap · P2 · CONFIRMED (`node scripts/check-ipc-contract.mjs` prints "IPC contract verified: 113 frontend wrappers map to registered Rust commands" at HEAD while PB-01 exists; event payloads and argument shapes are not checked)
- **Impact:** the main architectural safeguard for AGENTS.md rule 4 cannot catch the class of bug that produced the P0.
- **Fix:** generated bindings (tauri-specta) or schema snapshots compared in CI. **Effort:** M.

#### QA-19 · No coverage thresholds; coverage not run in CI; Linux release jobs run no Rust tests
- **Category / Severity / Confidence:** CI · P3 · CONFIRMED (`vitest.config.ts:25-29`; `.github/workflows/release.yml` Linux job)
- **Effort:** S.

#### QA-20 · CI has no Rust cache, runs a redundant `cargo check`, and installs the legacy appindicator package
- **Category / Severity / Confidence:** CI efficiency · P3 · POSSIBLE (`.github/workflows/ci.yml:59-79`)
- **Effort:** S.

#### QA-21 · Release re-runs use `gh release upload --clobber`
- **Category / Severity / Confidence:** Release integrity · P3 · CONFIRMED (`.github/workflows/release.yml:374-375`)
- **Impact:** a re-run can silently replace already-published, attested assets.
- **Fix:** fail if assets exist. **Effort:** S.

#### QA-22 · The repository's knip configuration disables the rules that would find dead code
- **Category / Severity / Confidence:** Tooling · P3 · CONFIRMED (`knip.config.ts:9-13` turns off exports, types and duplicates, so `pnpm knip` prints nothing; with the rules enabled the subagent found 29 unused exports, 43 unused types, 4 duplicate exports and 2 unused dependencies, `@tauri-apps/plugin-positioner` and `@tauri-apps/plugin-window-state`, saved at `scratchpad/knip-full.txt`). (Merges FE-32's tooling note.)
- **Effort:** S.

#### FE-32 · Dead UI code and unused CSS
- **Category / Severity / Confidence:** Dead code · P3 · CONFIRMED
- **Evidence:** neo branches in `MiniPlayer.tsx:302-616` are unreachable after the early return at `:142`; the neo rail in `PlayerProgressBar.tsx:289-327` is reachable only from that dead path; `ParallaxProvider` updates state on every mouse move with no `useParallax` consumers; `BentoCard`, `SettingToggle` and `LiquidBg` are unused in the app; many CSS classes have no users (`empty-state-mesh`, `library-header-pill`, `squircle`, `glass-button`, `glass-input`, `glass-panel-subtle`, `adl-liquid-button`, `animate-b1..3`, `art-float`, `home-hero-shell`, `neo-danger-*`, `neo-card-action`, `neo-album-card`, `neo-context-badge`, `hero-container`, the neo `.dark` variant).
- **Effort:** S.

#### FE-33 · Duplicated and conflicting CSS
- **Category / Severity / Confidence:** CSS maintainability · P3 · CONFIRMED (`index.css:9` and `:634` both define `adl-liquid-ripple`; `.tarab-fade-up` at `:685` references a missing keyframe and is redefined at `:1019`; `home-cover-tilt` and `home-spotlight-*` defined twice with different values, `:778-835` vs `:1024-1047`; repeated selectors in `library-view.css`; about 93 KB of hand-written CSS with 104 `!important` in neo)
- **Effort:** S.

#### QA-30 · Visual baselines are orphaned and Storybook coverage is thin
- **Category / Severity / Confidence:** Testing · P3 · CONFIRMED (the 16 PNGs in `tests/visual-baselines/full-player/` are referenced by no tracked file or script, verified with `git grep`; 10 stories exist, none for Home, the top bars, MiniPlayer, Queue, Playlists, TagEditor or album overlays; `scripts/dev-doctor.mjs` does not check the Rust toolchain or Linux system packages). (Merges FE-43.)
- **Fix:** wire the baselines into a Playwright screenshot test (the lead's mocked-IPC harness approach works for this) or delete them. **Effort:** M.

#### QA-23 · Vendored `tauri-plugin-media` has no patch record
- **Category / Severity / Confidence:** Maintainability, supply chain · P3 · CONFIRMED (`src-tauri/vendor/tauri-plugin-media/` holds the normalized crates.io `Cargo.toml` with no notes or upstream diff, yet AGENTS.md requires preserving "local safety patches")
- **Fix:** record the upstream version and a patch file or changelog. **Effort:** S.

#### QA-24 · Dependency weight and duplicate versions
- **Category / Severity / Confidence:** Dependency hygiene · P3 · SUBJECTIVE / CONFIRMED (two reqwest, four `windows`, three `dirs`, four `hashbrown` versions in `Cargo.lock`; older direct crates: rusqlite 0.31, notify 6, rodio 0.19, cpal 0.15, lofty 0.21; `@types/three ^0.183` with `three ^0.170`)
- **Effort:** M.

#### QA-25 · Documentation drift
- **Category / Severity / Confidence:** Documentation · P3 · CONFIRMED
- **Evidence:** `README.md:41` advertises "automatic LRCLIB lookup" but `autoLyrics` defaults off and a v7 migration forces it off; the README lists waveforms, but no UI uses them; AGENTS.md requires `PlaybackCoordinator` while callers import individual functions; `docs/release-hardening.md` claims decoded-pixel limits (contradicted by SEC-02), "bounded" trash records (QA-01) and reveal-only opener scope (SEC-06); `package.json` `engines.node >=20.19` conflicts with `.nvmrc` 22.18.0; `docs/playback-session-report.md` cites `src/App.tsx:708-731` (the file has 595 lines) and components that no longer exist (`SidebarMiniPlayer.tsx`, `PlayerControls.tsx`); README states both themes "preserve the same … features" (contradicted by FE-18); `docs/release-evidence-1.0.0.md` records 88 Rust tests (87 run on Linux; one is platform-gated).
- **Fix:** a documentation pass tied to this report's fixes. **Effort:** S.

## 5. Detailed analysis of critical and high-severity issues

This section explains the eight P0/P1 findings in context. The per-finding evidence is in Section 4. The common thread is that each problem sits at a boundary: renderer ↔ Rust payloads, renderer-owned state ↔ native playback, or per-file events ↔ whole-library operations. None comes from the choice of a WebView for rendering.

### 5.1 PB-01 (P0): one payload change, six broken surfaces, zero failing checks

**The defect.** Commit `2dbe638` introduced generation-tagged position events in Rust: `PlaybackPositionEvent { generation, position }` (`src-tauri/src/audio/events.rs:86-91`). One of the two listeners was updated (`usePlaybackLifecycle.ts:102-107`). The one that drives the player store was not (`usePlaybackPositionEvents.ts:16-27`).

**Lead verification.** I read both sides at HEAD. Then I ran the real React app in the harness, started playback, and emitted both payload shapes on the mocked event bus:

| Emitted payload | Hero player displayed |
|---|---|
| `{ generation: 1, position: 61.5 }` (the real Rust shape) | `0:00 / -0:00` |
| `75.25` (a bare number) | `1:15 / -1:44` |

**Blast radius.** `currentTime` is a shared primitive, so the object spreads to:
- `useSmoothTime`, which drives the lyric highlight and progress bars and computes `currentTime * 1000`, giving `NaN`.
- `previewPrevious` (the `> 3` second rule).
- Session save, which writes `null`.
- Session restore, which therefore never restores a position.
- The media-session sync. Rust rejects the payload but returns `Ok`, so nothing surfaces (SEC-11).
- The mini-window snapshot.

**Why it shipped.** `usePlaybackLifecycle.test.tsx` emits numbers. `check-ipc-contract.mjs` checks command names only (QA-31). The media-session command hides parse errors. This is the strongest argument in the audit for generated, shared IPC types (tauri-specta or ts-rs): Tarab has around 120 commands and 20 event types maintained by hand on both sides.

**Recommended order:**
1. Fix the listener and add a generation gate.
2. Make `desktop_sync_media_session` typed and failing.
3. Generate event payload types from Rust.
4. Add a contract test that deserializes real Rust payload JSON in Vitest.

### 5.2 PB-18 + PB-04 + AR-11 (P1): the library pipeline amplifies small events into whole-library work

**How the chain behaves.** A single `Modify` event from the watcher, including one caused by Tarab's own tag or lyrics write, kicks off this sequence:
1. A rescan of the whole library root (`useLibraryScan.ts:505-512`).
2. Re-reading tags and computing blurhash for every file in the renderer-driven batches.
3. Re-hashing artwork for every file when `downloadArtwork` is on (the default).
4. Sending every track to Rust in one request.
5. A reconcile whose `preserved_count` loop is O(n²) and runs inside the write transaction while holding the only database connection.
6. A full lyrics re-index whose OFFSET paging re-sorts the table for each page.

**Measured shape (container):**
- Reconcile: 1.0 s at 10k files, 3.65 s at 20k, 8.8 s at 30k.
- Lyrics index: 41 s at 100k tracks.

During steps 5 and 6 every database-backed UI query waits on the mutex (AR-20).

**Why it matters more than the numbers suggest.**
- `autoWatch` defaults on.
- Editing tags is a core workflow ("Fix metadata inside your library").
- A single corrupt file can turn this loop into a crash loop under `panic = "abort"` (SEC-01).
- The renderer is also the one asserting `traversalComplete = true` (SEC-13).

**Recommended order:**
1. Use a `HashSet` in `preserved_count` (minutes of work).
2. Ignore self-writes and reconcile only the changed paths.
3. Add mtime/size skipping.
4. Use keyset pagination for the lyrics index.
5. Move the traversal-completeness record into Rust.

### 5.3 AR-04 (P1): main-thread playlist commands with whole-table loads

**Main-thread placement.** Tauri executes synchronous `#[tauri::command] fn` on the main thread. All 14 playlist commands are synchronous, and so are 42 others (LD-05). The main thread also pumps the WebView on macOS and Linux, so a long command freezes rendering, input and window dragging.

**Whole-table loads.** `get_playlists` builds a full detail for every playlist. For each smart or folder playlist it calls `get_all_tracks()` with no limit (a 1.16 s query at 100k tracks), and `sync_playlist` walks the folder.

**Fix.** Convert these commands to `async` + `spawn_blocking`, push smart-rule evaluation into SQL, and return summaries without entries. The same treatment should apply to every command that touches disk, devices or the database.

### 5.4 PB-06 (P1): the renderer re-decides what the backend already queued

**Mechanism.** Gapless works by appending the next decoded source to the current sink, so the audio really is seamless. The renderer then decides which track is "now playing" by calling `previewNext()` again at handoff time. Under shuffle that call is random, so the UI usually activates a different queue entry than the one the backend is playing.

**Effects.** Title, artwork, lyrics and play-count credit all follow the wrong track. Users would see lyrics that don't match the song.

**Fix.** Record the exact preloaded entry and its generation, include the incoming path in the event, and activate exactly that entry. Treat a mismatch as a reason to resynchronize, not to guess.

### 5.5 LD-02 (P1): client-side sorting of a server-paged list

The backend already supports sorted paging. The frontend always pages by date added and sorts the loaded subset on the client. With more than 400 tracks:
- "Title A to Z" is wrong.
- Scrolling inserts rows into the middle of the list.

**Fix:**
- Thread the sort into the query key and the paging call.
- Add a unique tiebreaker (LD-15).
- Ideally switch to keyset pagination, which also fixes the 323 ms deep-OFFSET cost (AR-21).

### 5.6 PB-02 (P1): a self-deadlock on the device-failure path

**The defect.** Two `state.lock()` temporaries in one function-call statement on a non-reentrant `parking_lot` mutex.

**Why it's worse than it looks.**
- It is on an error path, so it only fires when a device fails to open, which is exactly when a user is trying to recover.
- The command channel is unbounded, so the UI keeps receiving `Ok` while nothing plays.
- The mixer callback locks the same state for every sample (PB-09), so the deadlock also stalls audio output.

**Fix.** Hoist the values into locals before emitting. A clippy lint or a code-review rule against multiple `lock()` calls in one expression would prevent recurrences.

### 5.7 PB-03 (P1, LIKELY): queue advance lives in JavaScript that the OS may suspend

**The design.** Tarab's architecture deliberately makes the main renderer the state owner. The consequence is that track advance, gapless preload, crossfade scheduling, media-key handling, tray Quit and the sleep timer all depend on main-window JavaScript running.

**The risk.** Tauri's default WebView background policy can suspend a hidden view after a few minutes on macOS 14+. Close-to-tray hides the window by default (`hideToStatusIconOnClose` defaults to true).

**Not verified.** No macOS host was available to confirm the behavior.

**Fixes:**
- **Immediate (one line):** `backgroundThrottling: "disabled"` on the main window.
- **Structural:** move the queue cursor and "what plays next" decision into Rust, and keep the renderer as the editor of the queue rather than its clock. That also fixes PB-06 and makes the mini window and media keys independent of renderer liveness.

## 6. UI/UX and product-quality assessment

Basis: the code, the design documents, the committed screenshots (`docs/screenshots/`, `tests/visual-baselines/`) and the lead's harness renders. Harness renders come from headless Chromium with mocked IPC and 64 synthetic tracks without artwork, in both themes at 1200x800 and 800x600, so they show layout and state behavior, not native compositing or real album art.

### 6.1 Strengths

- **A distinctive visual identity.** The committed liquid-glass screenshots show an artwork-led, warm, layered look that is rare among local players. The neobrutalism theme is a fully committed second system rather than a palette swap.
- **Good bones for scale in the UI layer.**
  - Virtualized grids and lists.
  - Fuse ranking moved off the main thread.
  - Position updates handled by a rAF provider with leaf subscribers, so the whole tree does not re-render several times per second (AR-33).
- **Careful empty and error states in several places.** The queue empty state, the playlist missing-track handling and the file-association prompt are examples. The context menu has good keyboard handling.
- **Thoughtful native boundaries.** The file-association choices (Play once / Import folder / Cancel), recoverable trash with undo tokens, and grants managed natively are better product decisions than most local players make.

### 6.2 Principal weaknesses

1. **The headline experiences are currently degraded.**
   - Synchronized lyrics and the progress display are broken by PB-01.
   - The liquid shell's WebGL motion is invisible (FE-01) and its post pipeline cannot compile (LD-01).
   - In the default configuration, two of the three things the README leads with (lyrics, interface design) do not work as described.
2. **Desktop ergonomics at small sizes.** At the minimum window size (800x600) the floating dock duplicates the top navigation, clips its labels, covers player controls, and the search field overflows (FE-07, harness-confirmed). The dock is a mobile pattern. On desktop the top bar or the sidebar is enough.
3. **Two themes, two products.**
   - Liquid and neo are separate component trees for Home, the top bar, album detail and library layout, and they differ in behavior, not only appearance. The neo full player is not even neobrutalist (FE-17, FE-18).
   - The README promise that "both systems preserve the same … features" is not met.
   - Every future feature costs roughly twice.
   - **Recommendation:** shared view-models plus thin skins. If maintaining both themes at parity is not realistic, demote neo to a token-level theme.
4. **Information density and discoverability.**
   - Album titles appear only on hover (FE-30), so art-less albums show as identical music-note tiles (harness).
   - The full player has no elapsed or total time and no volume control in its default layout (FE-12).
   - Keyboard shortcuts and the command palette are not advertised (FE-35, FE-36).
   - Library facets report "Your library is empty" when only that facet is empty (FE-19).
5. **Inconsistent interaction primitives.**
   - Five volume controls with different semantics (FE-16), one of which does not affect audio (FE-05).
   - Search shortcuts that focus a hidden input (FE-04).
   - Selection pills that highlight the wrong item (FE-09).
   - A "Hide cover art" toggle that removes all transport controls (FE-06).
   - These are individually small, but together they make the app feel unpredictable.
6. **Accessibility.**
   - Nested interactive controls (FE-21, FE-15).
   - Hover-only controls without focus reveal (FE-15, FE-27).
   - Neo focus outlines invisible on dark surfaces and small grey text below AA contrast (FE-28).
   - framer-motion ignores reduced motion (FE-29).
   - Virtualized lists lack list semantics (FE-41).
   - The foundations, a native WebView accessibility tree with Radix dialogs, are good, so these fixes are cheap compared with any framework change.
7. **Internationalization.** There is no RTL or bidi handling anywhere (FE-22). For a player named Tarab, Arabic metadata and Arabic karaoke lyrics are an obvious use case: titles should use `dir="auto"`, and karaoke fill should follow reading direction.
8. **Missing or partial music-player features.** Verified as absent or partial (Section 4 and the playback inventory):
   - genre browsing (LD-07)
   - ReplayGain or loudness normalization
   - EQ
   - scrobbling
   - pitch-preserving speed (PB-21)
   - automatic skip of unplayable tracks (PB-14)
   - device hot-plug handling (PB-13)
   - a real end to shuffle with repeat off (PB-10)
   - a trash manager (QA-01)
   
   Gapless works only when the frame count is known and is inconsistent under shuffle (PB-08, PB-06).

### 6.3 Feature inventory (verified)

| Status | Features |
|---|---|
| Exists | Local playback (symphonia decode, rodio output); crossfade 0 to 12 s; seek; speed 0.5 to 2x; volume and 1 to 2x booster; output device selection; shuffle (history-based); repeat off/all/one; stop after current; previous with 3 s restart rule; sleep timer; smart shuffle; LRC and enhanced word timing; LRCLIB fetch (opt-in); lyrics index and lyric-text search; LRC editor; tag editor with batch edit; ratings and play counts; manual, smart and folder-sync playlists; library scan, reconcile and folder watcher; recoverable trash with undo; desktop mini window; tray and app menus; media keys / Now Playing / MPRIS / SMTC; global shortcuts; deep links; file associations; autostart; command palette; two visual themes |
| Partial or broken | Position display and lyric sync (PB-01); gapless (PB-06, PB-08); OS media session updates (PB-01); Windows taskbar progress (commands exist, never called, AR-25); waveforms (backend only, AR-25); sample-rate conversion (linear only, PB-22); Help > README (QA-10); autostart minimized (QA-11) |
| Absent | Genre (LD-07); ReplayGain/normalization; EQ/DSP; scrobbling; pitch-preserving speed; auto-skip of failed tracks; device hot-plug; Opus scanning; WMA decoding (despite scan and file association, PB-26); trash management UI (QA-01); RTL support (FE-22) |

### 6.4 Product recommendations, beyond the defect list

- **Pick one primary navigation per width.** Remove the floating dock on desktop.
- **Make the full player a complete listening surface.** It should show time, volume, the queue peek and lyrics, and every control should be reachable by keyboard.
- **Treat Arabic and RTL as a first-class audience.** Use `dir="auto"` throughout and RTL karaoke.
- **Add genre and a trash manager before adding new visual features.**
- **Decide the fate of the WebGL shell based on measured value.** It is currently invisible and costs GPU time. If it stays, make it visible, demand-driven and verified on all three WebViews.

## 7. GPUI comparison: KEEP vs PARTIAL vs FULL

### 7.1 GPUI status as of 2026-10-17 (verified facts)

| Fact | Evidence |
|---|---|
| The official `gpui` crate on crates.io is **0.2.2, published 2025-10-22**. No official release since. | crates.io API, checked by the lead and the research investigation (`max_version 0.2.2`, `updated_at 2025-10-22T03:56:29Z`) |
| Zed main still declares `gpui` 0.2.2 and `publish = true`, but it depends on workspace crates with `publish = false`. The new `gpui_platform` crate inherits `publish = false` (workspace `Cargo.toml:275`). The gpui README tells users to add `gpui_platform` from crates.io, and that crate returns **404**. | `zed@322cd50` (2026-10-16): `crates/gpui/Cargo.toml:3,8`, `crates/gpui_platform/Cargo.toml:5`, `crates/gpui/README.md:8-15`; `crates.io/api/v1/crates/gpui_platform` → 404 |
| In practice GPUI is used through third-party weekly snapshots (`gpui-pre` by Longbridge; `gpui-unofficial`, which says it is "not affiliated with Zed"), git pins or forks. gpui-kit pins `gpui-pre =0.3.9` exactly and comments that "any snapshot may change GPUI's API". | crates.io API; `gpui-component@f8cf0bd:Cargo.toml` |
| Zed's README: "still pre-1.0. There will often be breaking changes between versions." Recommended learning path: read Zed's source or ask on Discord. | `zed@322cd50:crates/gpui/README.md:8` |
| Platforms: macOS (Metal), Windows (DirectX 11 + DirectWrite; Zed for Windows stable 2025-10-15), Linux Wayland and X11 (renderer moved to wgpu 2026-02-13). Web and iOS crates are experimental. | Zed source; PR #46758 |
| Accessibility: AccessKit integration merged 2026-05-27 (PR #56065). Tester reports show focus problems in NVDA, Narrator and VoiceOver, and no Linux results. Nodes need an element ID and a role; duplicate `text!` IDs are silently dropped in release builds. | PR #56065; `zed@322cd50:crates/gpui/src/_accessibility.rs`; `Cargo.toml:528-531` (accesskit 0.24) |
| Not in GPUI: system tray, media keys/MPRIS/SMTC/Now Playing, global shortcuts, autostart, auto-updater, single-instance handling, custom shaders, per-element backdrop blur. URL-scheme registration returns `Err("register_url_scheme unimplemented")` on Windows and Linux. | Lead verified `zed@322cd50:crates/gpui_windows/src/platform.rs:1105-1106`; no tray API in the `Platform` trait; scene primitives are a fixed set (`crates/gpui/src/scene.rs`) |
| Real GPUI music players exist. **Hummingbird** (616 stars) runs on Linux, macOS and Windows with hand-written MPRIS/SMTC/Now Playing; it has no tray, no global shortcuts and no mini player, and had to build its own 1,112-line text input. **Sonora** (2.1k stars) adds a tray through `tray-icon`/`ksni` and souvlaki/MPRIS on a **forked** GPUI. | `hummingbird@a5afd01`, `sonora@63fcb51` |
| Same-process coexistence with Tauri is not viable. On macOS both GPUI and tao register their own `NSApplication` subclass and expect to own the run loop; on Windows both run blocking message loops. A separate process is feasible. | `zed@322cd50:crates/gpui_macos/src/platform.rs:75-100`; `tao@0c025d2:src/platform_impl/macos/app.rs:19-21` |
| No published head-to-head measurement of GPUI against a WebView app for memory or startup was found. Zed's "120 FPS" is a 2023 design claim; the only frame-time numbers come from the vendor of the gpui-fast fork. | Research investigation, Section 5 of its notes |

### 7.2 Does GPUI address Tarab's actual deficiencies?

| Deficiency class (findings) | Root cause | Would GPUI fix it? |
|---|---|---|
| IPC payload drift (PB-01, SEC-11, QA-18, QA-31) | Hand-maintained types on two sides of an IPC boundary | **Indirectly, yes.** A single-language Rust UI removes this boundary. Generated bindings fix it in days without a rewrite. |
| Library pipeline scaling (PB-04, PB-18, AR-11, AR-08, AR-21) | Rust algorithms, SQL and the scan design | **No.** These are backend problems. |
| Main-thread commands (AR-04, LD-05, AR-10) | Synchronous Tauri commands | **No.** GPUI also has a main thread; blocking work must be moved off it either way. |
| Playback state divergence (PB-06, PB-03, PB-12, PB-10/11) | Queue state owned by the UI layer | **Only if the queue moved into Rust**, which is equally possible under Tauri and is recommended regardless. |
| Audio engine defects (PB-02, PB-07/08/09, PB-13, PB-21/22) | rodio/symphonia usage | **No.** Same backend. |
| Rendering waste (FE-01, FE-02, LD-01, AR-18, FE-45) | Invisible always-on WebGL, unused passes, stacked blur | **No, and moot.** They are fixed by deleting code; GPUI cannot reproduce these effects at all. |
| UI inconsistency and theme duplication (FE-16, FE-18, FE-09, FE-04) | Component architecture | **No.** It would be rewritten, not removed, and two themes would still need a shared component model. |
| Accessibility gaps (FE-21, FE-15, FE-27, FE-28) | Markup choices | **Worse under GPUI today.** The WebView accessibility tree is mature; GPUI's is five months old. |
| Resource use of the WebView itself | WebView processes | **Possibly.** Plausible but unmeasured; see the experiment in Section 8. |

### 7.3 Option comparison

**Options:**
- **A. KEEP** the Tauri + React architecture and fix it.
- **B. PARTIAL:** keep Tauri and add GPUI selectively.
- **C. FULL:** rebuild the UI in GPUI and keep the Rust backend.

| Criterion | A. KEEP | B. PARTIAL | C. FULL |
|---|---|---|---|
| Performance and startup responsiveness | Current freezes come from main-thread commands and backend algorithms, which are fixable in place. Startup bundle 292 KB gzip is modest. | Unchanged for the main window; a native mini player might start faster (unmeasured). | Likely faster cold start and lower UI-thread overhead (inference, unmeasured). Backend freezes remain until fixed separately. |
| Memory and resources | WebView processes (especially WebView2) add resident memory (unmeasured here). Removing FE-01/FE-02 rendering and AR-05 artwork churn is the cheapest real win. | Adds a second process and binary; total memory likely **higher** than A while both run. | Likely lower idle memory without a browser engine (inference). GPU atlas memory and the Linux wgpu renderer's reported higher GPU memory offset part of it. |
| Rendering capabilities and visual polish | Full CSS, `backdrop-filter`, WebGL, framer-motion. Tarab's design language depends on these. | Mini player would need a GPUI redesign; whole-window OS blur only. | **Regression:** no custom shaders, no per-element backdrop blur, no layout-animation library. The liquid theme cannot be reproduced as designed. |
| UI flexibility and implementation complexity | Mature React ecosystem; parallel themes are the main complexity. | Two UI stacks, two styling systems, IPC between processes. | Everything is Rust plus GPUI APIs with thin docs; text inputs, sortable lists, sliders and dialogs come from gpui-component or are hand-built. |
| Accessibility and native behavior | Mature WebView accessibility tree, IME, text editing, spellcheck. Current gaps are markup fixes. | Mini player accessibility would depend on new AccessKit support. | Depends on AccessKit support merged 2026-05-27 with reported screen-reader focus issues. Higher risk. |
| OS support and portability | macOS, Windows, Linux through Tauri; per-WebView quirks (QA-05). | Same plus GPUI's platform matrix; Wayland blur only where the compositor supports it. | macOS, Windows, Linux supported by GPUI; Linux blur and tray need extra work. |
| Audio and background-task integration | Rust backend unchanged. Background throttling of the renderer is a risk (PB-03) with a config fix and a structural fix. | Unchanged. | Rust backend unchanged and no WebView throttling. But the queue-in-Rust change recommended for A is also required here. |
| Compatibility with existing modules and dependencies | All 13 Tauri plugins used today keep working. | Tauri stays; the GPUI sidecar needs its own window placement, signing and IPC. | Replace tray, global shortcuts, single-instance, deep links (Windows/Linux unimplemented in GPUI), autostart, window state, positioner, notifications, dialog, opener, updater and media session with separate crates (`tray-icon`, `global-hotkey`, OS crates) or custom code. |
| Engineering effort and migration risk | Stabilization batch about 2 engineer-weeks; full roadmap (Section 9) about 2 to 3 engineer-months. | Mini-player sidecar: an estimated 3 to 6 engineer-weeks plus ongoing two-stack maintenance. | Rewriting about 42k lines of TS/TSX and 3.6k lines of CSS across two themes, plus replacing plugin features: an estimated 6 to 12 engineer-months to parity (rough estimate; Hummingbird, a comparable GPUI player, is about 79k lines of Rust). High risk of feature regression. |
| Ecosystem maturity, documentation, long-term maintainability | Tauri 2 is stable and semver-versioned with first-party plugins and broad docs. React ecosystem mature. | Inherits both stacks' costs. | No stable upstream distribution; breaking changes on every snapshot; documentation is mainly Zed's source; upstream priorities follow Zed's needs. |
| Development speed and future feature flexibility | Fastest; web tooling, hot reload, Storybook already present. | Slower: every playback-surface feature touches two stacks. | Slower until the team is fluent; Rust compile times on UI changes; features Zed does not need (tray, media, shaders) stay the app's own problem. |

### 7.4 Partial migration: candidate surfaces examined

| Surface | Feasible as GPUI? | Assessment |
|---|---|---|
| Desktop mini player (`mini-player.html`, 413-line `DesktopMiniWindowSurface.tsx`) | Yes, as a **separate process** speaking the existing snapshot/control-intent protocol over a local socket. Same-process is not viable (7.1). | Small surface; not a measured bottleneck. Its main defects (AR-32 created at startup; FE-38 hit target; PB-01 NaN progress) are fixable in place in hours. A second signed binary and cross-process window choreography cost more than the benefit. |
| Main library grid / lists | Only as a full main-window replacement. A GPUI view cannot be embedded in a Tauri window (no foreign-window attach API). | Equivalent to FULL for this surface. |
| Full player and lyrics | Same constraint as above. | The lyrics view benefits from CSS text layout, bidi and font fallback, which matter for Arabic lyrics (FE-22). |
| Reverse coexistence (GPUI host + embedded WebView via `gpui-webview`) | Experimental; requires the gpui-fast fork; no Wayland; on Windows the WebView covers GPUI overlays. | Not suitable for production. It also drops the Tauri plugin layer, since wry is not Tauri. |
| Shared backend crate | Yes. | Extract the audio, library and database modules into a framework-agnostic crate. This is useful under KEEP (testability, clearer boundaries) and keeps any future migration option open. It is the only "partial" step recommended. |

## 8. Final GPUI recommendation

### Decision: **KEEP**

Retain Tauri 2 + React and fix the defects in this report. Do not start a partial or full GPUI migration.

### Rationale

1. **GPUI would not fix the defects that matter.** Seven of the eight P0/P1 findings are backend algorithms, command threading, IPC typing, data paging or state ownership. The eighth (PB-03) is fixed by configuration plus moving the queue into Rust, which any front end would need.
2. **The rendering costs are self-inflicted.** The WebGL shell renders invisibly (FE-01), its post pipeline does not compile (LD-01) and its blur output is unused (FE-02). Deleting or repairing that code recovers the GPU budget in days.
3. **GPUI would remove capabilities Tarab ships today:**
   - tray
   - media session
   - global shortcuts
   - autostart
   - updater
   - single instance
   - Windows/Linux deep links
   - custom shaders
   - per-element backdrop blur
   
   Each would have to be rebuilt or replaced with third-party crates. The liquid-glass design language could not be reproduced as specified.
4. **The distribution and stability risk is real and current:**
   - No official crate release in twelve months.
   - An unpublishable main branch.
   - Snapshot-pinned consumers.
   - An explicit "breaking changes between versions" policy.
   - Accessibility support only five months old.
5. **Opportunity cost:**
   - A full migration is an estimated 6 to 12 engineer-months to reach parity.
   - The stabilization batch in Section 9 removes every P0 and P1 in about two engineer-weeks.
   - The remaining roadmap delivers missing music features (genre, ReplayGain, trash manager, RTL) that users would notice far more than a framework change.

### Expected benefits of KEEP plus the roadmap

- Correct playback UI and lyrics (PB-01).
- No multi-second freezes on large libraries (PB-04, PB-18, AR-04, AR-11).
- Consistent now-playing state (PB-06, PB-03).
- Lower GPU and CPU use while visible (FE-01, FE-02, AR-05, AR-18).
- A typed IPC contract that prevents the PB-01 class of regression (QA-31).

### What would reverse this decision

Any of the following, ideally in combination:

- **A measured resource gap that users would notice, remaining after Tarab's own waste is removed** (see the experiment below).
- **Upstream maturity:**
  - GPUI publishes a supported, semver-versioned crate set (including the platform crate) and keeps it current for two or more quarters;
  - AccessKit support is reported as working with NVDA, Narrator, VoiceOver and Orca.
- **A product direction change** away from CSS-dependent visuals (backdrop glass, WebGL) toward a dense, native-feeling UI, combined with a team that is comfortable building UI in Rust.
- **Platform-level WebView problems that cannot be worked around,** for example persistent WebView2 memory or WebKitGTK rendering defects affecting core views, documented from user reports.

### Validation experiment (describe only; not implemented)

**Goal:** decide with data whether a GPUI front end would deliver a resource or responsiveness advantage that matters for a music player.

**Step 0, prerequisite: fix Tarab's own waste first.** FE-01, FE-02, LD-01, AR-05 and AR-18. Measuring before these fixes would attribute self-inflicted costs to the WebView.

**Step 1, measure Tarab.** Use a release build on each OS (macOS 14+, Windows 11, Ubuntu 24.04 Wayland) with a fixed 20k-track library and fixed artwork. Record:
- Idle resident memory 60 s after launch, summed across the app process and all WebView helper processes.
- GPU memory.
- Cold start to the first interactive frame (median of 10).
- CPU % while playing with the window visible, and while hidden in the tray.
- 95th-percentile frame time while scrolling the album grid for 10 s.
- Playback-start latency after a click.

**Step 2, measure a GPUI reference.** Repeat Step 1 for Hummingbird's release build with the same library. It is the closest public GPUI music player.

**Step 3, optional spike, only if Step 2 meets the thresholds below.** A time-boxed (two engineer-weeks) throwaway GPUI prototype of the album grid plus the now-playing bar on Tarab's extracted backend crate, measured the same way.

**Acceptance criteria to consider a migration (all must hold on at least two of the three OSes):**
- The GPUI reference uses **at most 50%** of Tarab's idle memory, **and** Tarab's idle memory exceeds **250 MB**.
- **Or:** cold start differs by **more than 500 ms**, **or** visible-window playing CPU differs by **more than 3 percentage points** of one core.
- 95th-percentile scroll frame time is **at least 30% better**, and Tarab's exceeds **16.7 ms**.
- A GPUI prototype reaches keyboard and screen-reader parity on the prototyped surfaces (NVDA, VoiceOver, Orca smoke tests).
- A plan exists for the tray, media session, global shortcuts, deep links, single instance and updater, using maintained crates, with a cost estimate.

**Outcome rule:**
- **If the thresholds are not met, KEEP is confirmed.** Revisit after the next GPUI stable release.
- **If they are met,** re-run this comparison with the measured data. A partial approach would still be limited to a separate-process surface.

## 9. Prioritized improvement roadmap

Effort scale: S under a day, M a few days, L a week or more (one engineer). Batches are ordered by user impact per unit of effort. Dependencies are noted.

### Batch 1: stabilization (about two engineer-weeks; removes every P0 and P1)

| Order | Work | Findings | Effort |
|---|---|---|---|
| 1 | Fix the position listener (`.position`, generation gate); add a generation to `playback-seeked`; update test fixtures to real payloads | PB-01, PB-24 | S |
| 2 | Make `desktop_sync_media_session` typed and failing; stop logging raw payloads | SEC-11 | S |
| 3 | Hoist the lock reads in the device-failure path; keep the audio loop alive with no device at startup | PB-02, AR-07 | S |
| 4 | `HashSet` in `preserved_count` | PB-04 | S |
| 5 | Set `backgroundThrottling: "disabled"` on the main window | PB-03 | S |
| 6 | Activate exactly the preloaded entry at the gapless handoff; send the incoming path | PB-06 | M |
| 7 | Pass sort into the library query and paging; add an `id` tiebreaker | LD-02, LD-15 | S to M |
| 8 | Make the playlist commands async; compute smart and folder membership in SQL | AR-04 | M |
| 9 | Ignore self-writes; reconcile only changed paths; add mtime/size skip | PB-18 | M |
| 10 | Make the save queue rejection-safe; hydrate only on a successful restore | PB-05, PB-15 | S |

### Batch 2: quick wins (each S; about one to two engineer-weeks in total)

- **Rendering waste:**
  - Liquid shell: fix the shader `#version` handling (LD-01).
  - Either make the canvas visible or remove it, and use `frameloop="demand"` with DPR 1 (FE-01, AR-18).
  - Delete the unused blur passes and the control-motion loop (FE-02).
- **Media session:** send artwork once per track (AR-05). Remove souvlaki and the four dead events (AR-12).
- **Disconnected UI:**
  - Search focus (FE-04)
  - Mute (FE-05)
  - Hide-cover-art gating (FE-06)
  - Selection pill `enabled` flag (FE-09)
  - Compact seek bar `group` class (FE-11)
  - `reportError` coercion (FE-03)
  - Neo grid `minmax(0, 1fr)` (LD-08)
- **Accessibility basics:**
  - Sibling controls instead of nested buttons (FE-21, FE-15)
  - `:focus-within` reveal and labels (FE-27)
  - `MotionConfig` reduced motion (FE-29)
  - Neo focus ring and contrast (FE-28)
- **Startup and diagnostics:**
  - Visible error on database init failure (LD-06)
  - `log::` instead of `eprintln!` (LD-19)
  - Autostart `--minimized` (QA-11)
  - Help > README (QA-10)
- **Security hygiene:**
  - Step-scoped release secrets (SEC-04)
  - Decode limits before image decode (SEC-02)
  - Per-user artwork temp path (SEC-09)
  - Pin CI actions and set permissions (SEC-18)
- **Correctness nits:**
  - LRC offset sign and edge cases (PB-27)
  - Duration rounding (QA-27)
  - Remove-current-track index (PB-29)
  - Crossfade pause timing (PB-23)
  - Clear pending crossfade on interrupts (PB-12)
  - Copy and pluralization (LD-11, FE-34, FE-39)

### Batch 3: structural improvements (one to two engineer-months)

1. **Generated IPC types and contract tests.** tauri-specta or ts-rs for all commands and events; a CI check that fails on unused commands (QA-31, QA-18, AR-25). This prevents the PB-01 class of regressions. Dependency: none.
2. **Move the playback queue cursor into Rust.** The renderer edits the queue; Rust decides what plays next, owns shuffle order (Fisher-Yates), handles repeat and gapless preloading, and auto-skips unplayable tracks. Fixes PB-03 (fully), PB-06, PB-10, PB-11, PB-14, PB-28 and LD-04, and makes media keys and the mini window independent of renderer liveness. This keeps the AGENTS.md principle of one state owner but moves that owner to the process that never sleeps; AGENTS.md rules 1 and 2 need updating. Dependency: item 1.
3. **Command threading policy.** Async plus `spawn_blocking` by default; asynchronous custom protocol; one writer connection plus a read pool (LD-05, AR-10, AR-20).
4. **Scan pipeline in Rust.** Native traversal, metadata, blurhash from thumbnails, artwork dedupe, incremental reconcile, keyset lyrics index, per-file panic isolation, trailing-edge watcher (PB-18, AR-08, AR-11, SEC-01, SEC-13, AR-19, QA-08). Removes large IPC payloads and the renderer's role in deletion decisions.
5. **Theme architecture.** Shared view-models with skinned presentational components; a single volume control and other shared primitives; neo full player (FE-18, FE-16, FE-17, FE-13). Alternatively, reduce neo to a token-level theme.
6. **Device robustness.** Stream error detection, reopen on hot-plug, follow the system default, stable device IDs (PB-13).
7. **Data safety.** Atomic tag and lyrics writes; cross-volume trash; trash manager UI; fsync for fixed stores (QA-09, QA-02, QA-01, QA-29).

### Batch 4: product features (prioritize by user research)

- Genre column, browse and smart rules (LD-07)
- ReplayGain or EBU R128 normalization
- RTL and bidi support with RTL karaoke (FE-22)
- Pitch-preserving speed (PB-21)
- Sinc resampling with rubato (PB-22)
- A complete full-player surface: time, volume, queue peek (FE-12)
- Playlists virtualization and per-row play (FE-26)
- Shortcut sheet and a richer command palette (FE-35, FE-36)
- Scrobbling (optional)
- Opus scanning; align the file associations with the codecs that actually play (PB-26)

### Batch 5: tooling and quality

- Wire the visual baselines into a Playwright screenshot suite using the mocked-IPC approach from this audit (QA-30).
- Enable knip export, type and duplicate rules (QA-22).
- Add coverage thresholds (QA-19), Rust caching in CI (QA-20) and a no-clobber release upload (QA-21).
- Record the vendored-plugin patches (QA-23).
- Do a documentation pass (QA-25).

## 10. Validation results, unresolved questions and unverified areas

### 10.1 Commands run and results (2026-10-17, Linux container)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Success (dependencies only; no lockfile change) |
| `pnpm -s tsc --noEmit` | Pass, no output |
| `npx biome check .` | Pass: "Checked 327 files … No fixes applied." |
| `npx vitest run` | Pass: 53 files, 170 tests, 29.7 s |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Pass, 0 warnings (2 min 13 s cold) |
| `cargo clippy … --all-targets --all-features -- -D warnings` | Pass |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Pass: 87 tests (library target); 0 in the binary and doc targets |
| `cargo fmt … -- --check` | Pass |
| `node scripts/check-ipc-contract.mjs` | Pass: "113 frontend wrappers map to registered Rust commands" (names only; PB-01 present at the same time) |
| `node scripts/check-release-config.mjs` | Pass (inspects `release.yml` only) |
| `node scripts/dev-doctor.mjs` | Warned about Node 22.22.0 vs pinned 22.18.0; then "dev-doctor ok" |
| `pnpm audit --prod` | No known vulnerabilities |
| `npx knip` (repo config) | No output (rules disabled, QA-22); with full rules: 29 unused exports, 43 unused types, 4 duplicate exports, 2 unused dependencies |
| `pnpm exec vite build --outDir <scratchpad>` | Success; initial main-window JS 955,266 bytes raw / 292,304 gzip; CSS 208,506 / 28,867; three-stack lazy chunk 841 KB / 226 KB gzip |
| Headless Chromium harness (Playwright 1.56.1, preinstalled Chromium 1194) against `vite` dev server with mocked `__TAURI_INTERNALS__` | Rendered both themes at 1200x800 and 800x600; observed LD-01 shader errors, FE-21 nested-button warning, FE-07 dock/search overflow, LD-08 grid blowout, FE-09 nav highlight, LD-11 copy defects; reproduced PB-01 display failure |
| Synthetic SQLite 100k-track benchmarks (Python sqlite 3.45.1) | All tracks 1,155 ms; title paging at offset 90k 323 ms; lyrics index paging 41.3 s total; FTS trigger 37 ms vs 9.4 ms per 1,000 updates; public-ID resolution 92 ms |
| Reconcile loop micro-benchmark (`rustc -O`) | 5k 0.21 s; 10k 0.95 to 1.0 s; 20k 3.65 s; 30k 8.8 s (two independent runs) |
| Thumbnail size test (libwebp via Pillow) | about 204 KB per album lossless vs about 20 KB lossy q80 |
| `git status` before commit | Only the report file added (Section 10.4) |

Not run: `cargo run` (no display or audio device), `pnpm build:storybook` (no settings primitives, shared UI states or theme tokens were changed, so AGENTS.md does not require it), `cargo audit` (not installed), release workflows, any Windows or macOS execution.

### 10.2 Unresolved questions

1. Does WKWebView on macOS 14+ actually suspend Tarab's hidden main window under Tauri 2.11's default policy, and after how long (PB-03)? Test: hide to tray for 10 minutes with a 2-track queue and check whether track 2 starts.
2. Does Windows show two "Tarab" sessions in the media flyout, and does souvlaki's Pause desynchronize the UI (AR-12)?
3. Do `cover-art://localhost` URLs load in WebView2, or does every cover go through the IPC fallback (QA-05)?
4. Are synchronized lyrics fully frozen under PB-01 in the native app? The data flow says yes; it was not observed natively.
5. How large is Tarab's real idle memory per OS, including WebView helper processes, after FE-01 and FE-02 are fixed? This is the key input to the GPUI decision (Section 8).
6. Does letter-spacing or uppercase transformation break Arabic shaping in WebKitGTK and WKWebView (FE-22)?
7. Do the macOS app-menu Play/Pause labels update (AR-26)?
8. Which, if any, of the `RUSTSEC-2026-0194/0195` advisory details change the documented build-time-only justification? The advisory text was not re-read.

### 10.3 Unverified or unexamined areas

- **Not examined in depth:**
  - `LyricsEditor.tsx` and the other tag-editor subparts
  - `LibraryNeoLayout.tsx` and the library list subcomponents
  - `LibraryFileInfoModal.tsx`, `CacheSettings.tsx`, settings primitives
  - the playlist editor and picker dialogs
  - most of `liquid-glass.tsx`
  - the liquid-glass git plugin source
  - `docs/design/3d-liquid-glass-design-language.md`
  - 11 of the 16 visual baselines
  - GLSL logic
- **Not executed:** all native runtime behavior (audio, OS integrations, window lifecycle, signing).
- **Code-only findings with platform specificity:** AR-12, AR-13, AR-26, QA-05, QA-06, SEC-10, PB-03.
- **GPUI claims from sources that could not be fetched** (zed.dev, Hacker News, gpui.rs) are marked secondhand in Section 11. Nothing in the decision depends on them alone.

### 10.4 Delivery checks performed before commit

- The report contains Sections 1 to 11 as requested.
- Every P0/P1 finding has file and line evidence and was verified by the lead in source; PB-01 was also reproduced in the harness.
- The GPUI comparison covers all three options on all eleven requested criteria (Section 7.3).
- Untested areas are listed in Sections 3 and 10.3.
- `git diff --cached --stat` shows only `docs/audits/2026-10-17-tarab-comprehensive-audit.md`. No application source, configuration, dependency or lockfile is changed, and temporary artifacts live outside the repository.

## 11. Evidence references and external sources

### 11.1 Repository evidence

All repository references are `path:line` at commit `2dbe638`. The most-cited files:
- **Rust:**
  - `src-tauri/src/lib.rs`, `audio.rs`, `audio/source.rs`, `audio/events.rs`
  - `database/tracks.rs`, `playlist.rs`
  - `desktop_integration.rs`, `media_controls.rs`, `file_ops.rs`
  - `vendor/tauri-plugin-media/src/platform/{windows,linux,macos}.rs`
- **Frontend:**
  - `src/features/app/usePlaybackPositionEvents.ts`, `src/features/app/usePlaybackLifecycle.ts`, `src/features/app/player-state-store.ts`
  - `src/store/player-store.ts`, `src/store/settings-store.ts`
  - `src/features/library/useLibraryData.ts`, `src/components/library/LibraryView.tsx`, `src/components/settings/useLibraryScan.ts`
  - `src/components/shell/*`, `src/features/app/AppLayouts.tsx`
- **Config and CI:** `src-tauri/tauri.conf.json`, `src-tauri/capabilities/*.json`, `.github/workflows/{ci,release}.yml`

Third-party source consulted from the local dependency trees:
- three 0.170.0 `src/renderers/webgl/WebGLProgram.js` (RawShaderMaterial prefix)
- tauri-macros 2.6.3 `src/command/wrapper.rs` (sync commands run on the main thread)
- tauri 2.11.5 `src/app.rs` (asynchronous URI scheme handler)
- tauri-utils 2.9.3 (background throttling policy)
- rodio 0.19.0 `src/source/speed.rs`
- symphonia-bundle-mp3 0.5.5 (coarse seek)
- image 0.25.10 `src/codecs/webp/encoder.rs` (lossless only)
- tauri-plugin-log 2.9.0 `src/lib.rs` (log directory creation)

### 11.2 External sources for the GPUI research (accessed 2026-10-17)

**Primary sources inspected directly (shallow clones, cited as `repo@SHA:path`):**
- `zed-industries/zed@322cd509dcccaee1f6bc44725d270598ae8171ad` (2026-10-16):
  - `crates/gpui/{Cargo.toml,README.md,docs/,examples/,src/platform.rs,src/window.rs,src/scene.rs,src/style.rs,src/input.rs,src/interactive.rs,src/_accessibility.rs,src/app.rs,src/spring.rs}`
  - `crates/gpui_{macos,windows,linux,wgpu,web,apple,platform}/`, root `Cargo.toml`
  - `crates/zed/src/zed/{open_listener.rs,windows_only_instance.rs}`
- `longbridge/gpui-component@f8cf0bd964f9ef2e5b7be79f3a8fc391371feb4a` (GPUI Kit): `README.md`, `Cargo.toml`, `crates/component/src/`, `crates/webview/`, `release-notes.md`
- `hummingbird-player/hummingbird@a5afd014deee78bf18b6c7494113a74fcde26b55` (GitHub mirror): `README.md`, `Cargo.toml`, `Cargo.lock`, `src/services/controllers*`, `src/ui/app.rs`, `src/ui/components/{input,drag_drop}.rs`
- `sonorahq/sonora@63fcb51e06d5ad6ac2e8ac4e4db53d07d3ded93b`: `Cargo.toml`, `README.md`, `crates/sonora/src/tray.rs`, `crates/state/Cargo.toml`
- `zed-industries/awesome-gpui@8c472427cd2e0f9a4a182e2daa2288849f26e10d`: community app list
- `tauri-apps/tao@0c025d22e90bd120d0298ce8dc3a8a3ad9090bbf`: `src/platform_impl/macos/{app.rs,event_loop.rs}` (NSApplication subclass conflict)

**Registries and web pages fetched:**
- https://crates.io/api/v1/crates/gpui: version 0.2.2 dated 2025-10-22 (also checked by the lead)
- https://crates.io/api/v1/crates/gpui_platform: not found (also checked by the lead)
- crates.io API for `gpui-pre`, `gpui-unofficial`, `gpui-kit`, `gpui-base`, `gpui-component`, `tray-icon`, `global-hotkey`, `souvlaki`, `tauri-plugin-updater`, `accesskit`: release cadence and current versions
- https://github.com/zed-industries/zed/pull/56065: AccessKit merged 2026-05-27; screen-reader test reports
- https://github.com/zed-industries/zed/pull/46758: Linux renderer moved to wgpu, merged 2026-02-13; GPU-memory comment
- https://github.com/zed-industries/zed/issues/51818: GPUI PR-review office hours, 2026-03-25
- https://github.com/iamnbutler/gpui-unofficial: unofficial republisher, "not affiliated with Zed Industries"
- https://github.com/gpui-ce/gpui-ce: community fork
- https://github.com/longbridge/gpui-fast: experimental retained-mode fork with vendor benchmarks
- https://github.com/remorses/gpuix: React/Solid bindings for GPUI (not evaluated in depth)
- https://github.com/hummingbird-player/hummingbird: mirror statistics
- Tauri memory and startup comparisons, which use inconsistent methods and are context only:
  - https://www.gethopp.app/blog/tauri-vs-electron
  - https://tech-insider.org/tauri-vs-electron-2026/
  - https://betterstack.com/community/guides/scaling-nodejs/tauri-vs-electron-vs-deno-vs-electrobun/

**Seen only through search results (hosts unreachable from this environment; treated as secondhand):**
- https://zed.dev/blog/zed-for-windows-is-here (Windows stable 2025-10-15), corroborated by https://thenewstack.io/fast-rust-based-zed-code-editor-finally-arrives-on-windows/
- https://zed.dev/releases/stable/1.0.0 and https://phoronix.com/news/Zed-1.0-Released (Zed 1.0 on 2026-04-29)
- https://zed.dev/blog/videogame (2023 "120 FPS" design claim)
- https://news.ycombinator.com/item?id=47003569 (quoted statement about deprioritizing non-Zed GPUI work; unverified, and not relied on for the decision)
- https://docs.rs/crate/gpui-pre-web/0.3.3 (GPUI web target description)

### 11.3 Audit artifacts (outside the repository, in the session scratchpad; not committed)

- Mocked-IPC rendering harness and screenshots
- Production build outputs
- SQLite and Rust benchmark scripts
- knip full-rule report
- Raw subagent reports
