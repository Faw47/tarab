# Tarab 1.0.0 Release Evidence

This file records the evidence available on 2026-09-05. The macOS sections retain explicitly dated 2026-07-28 host evidence; newer source-gate evidence is listed separately. It separates local proof from hosted distribution proof. Do not treat a configured workflow or an unsigned local package as proof of a published release.

## Source and quality gate

| Requirement | Evidence | Status |
| --- | --- | --- |
| Version alignment | `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` contain `1.0.0`. `pnpm verify:release-config` passed. | Proven locally |
| Tauri packaging toolchain | `@tauri-apps/cli` is pinned to `2.11.4` and the Rust Tauri crate resolves to `2.11.5`. `pnpm build:app` completed with executable, MSI, and NSIS output without the prior bundle-type patch warning. | Proven locally on 2026-09-05 |
| Frontend quality | TypeScript, Biome on 432 files, 123 frontend test files with 553 tests, the 124-command IPC contract, production build, Storybook build, and Knip passed under the available Node 26.7.0 runtime. The repository pins Node 22.18.0 in `.nvmrc`; `nvm` was not available on this Windows host. | Proven locally on 2026-09-05 |
| Rust quality | Rust formatting, 221 tests, and Clippy with warnings denied passed on 2026-09-05. | Proven locally on 2026-09-05 |
| Windows atomic metadata writes | The Windows Rust test suite covers tag and lyric replacement, hard-link preservation, concurrent-change recovery, and bounded sidecar writes; all 221 tests pass after the `ReplaceFileW` compatibility fix. | Proven locally on 2026-09-05 |
| Desktop startup smoke | cargo run --manifest-path src-tauri/Cargo.toml initialized the database, playlist bootstrap, and desktop integration, then exited cleanly after the bounded smoke window. | Proven locally on 2026-09-05 |
| Refactor boundaries | Database migrations, tracks, playlists, lyrics, and aggregates are separate modules. Audio state, events, crossfade, devices, and source lifecycle are separate modules. Tag Manager selection and mutations and Tag Editor metadata, artwork, file information, and lyrics are separated and covered by the same release gate. | Proven locally |
| Release configuration | Deep links, eight file associations, CSP, updater policy, both CI/release `cargo-audit 0.22.1 --locked` pins, and 32 immutable GitHub Action references passed the release configuration check. | Proven locally on 2026-09-05 |
| Rust dependency audit | `cargo-audit 0.22.2 --file src-tauri/Cargo.lock` completed against the live RustSec database. It reported no unallowed vulnerabilities; 18 allowed transitive maintenance/runtime warnings remain for GTK/Unicode dependencies. | Proven locally on 2026-09-05 |
| JavaScript dependency audit | `pnpm audit --prod --audit-level high` completed against the external registry and reported no known vulnerabilities. | Proven locally against the live advisory registry |

## macOS package evidence (historical 2026-07-28)

| Requirement | Evidence | Status |
| --- | --- | --- |
| Universal 2 DMG | `src-tauri/target/universal-apple-darwin/release/bundle/dmg/Tarab_1.0.0_universal.dmg` passed `hdiutil verify`. The mounted application contains x86_64 and arm64 slices, version 1.0.0, minimum macOS 12.0, the `tarab` URL scheme, and the Applications link. | Proven locally |
| Universal 2 checksum | SHA-256 is `43e00765182f5e3a2dd126b38aecc5ff214fadb5659b4f16ef246711e3051f26`. | Proven locally |
| Apple Silicon application | `src-tauri/target/release/bundle/macos/Tarab.app` was rebuilt on 2026-07-28. It is an arm64 application with identifier `com.fawaz.tarab` and version `1.0.0`. It launched from the bundle and stayed running. | Proven locally |
| Packaged artwork | The rebuilt application displayed cached artwork while macOS withheld access to the original Documents source. This proves that app-owned artwork no longer depends on a current source grant. | Proven locally |
| Apple Silicon DMG | Tauri reached `hdiutil create`, which failed on this macOS 27 host with `Device not configured`. No current Apple Silicon DMG was produced. | Blocked by local host |
| Ad hoc application signature | The linker-created ad hoc signature is not a valid sealed application-bundle signature. Strict verification reports `code has no resources but signature indicates they must be present`. | Not distribution-ready |
| Developer ID signature | A Developer ID Application identity is not available in this workspace. | Missing external credential |
| Notarization and stapling | Apple notarization credentials are not available in this workspace. | Missing external credential |
| Gatekeeper distribution acceptance | The release workflow checks the application and DMG after signing and stapling. | Not proven on a Developer ID artifact |

## Windows package evidence (local unsigned 2026-09-05)

| Requirement | Evidence | Status |
| --- | --- | --- |
| Windows x64 application | `pnpm build:app` produced `src-tauri/target/release/TARAB.exe`; size 16,290,816 bytes; SHA-256 `94F0A2F066096C2746290C6090FC67A3F5358356FF0D1B33B4F46602C511483C`. | Proven locally |
| Windows x64 MSI installer | `pnpm build:app` produced `src-tauri/target/release/bundle/msi/Tarab_1.0.0_x64_en-US.msi`; size 7,933,952 bytes; SHA-256 `F800FCCF544D268C2BB9BD8A164DA003A7FDD768B7DF3963239A0AC9347BB9FD`. | Proven locally |
| Windows x64 NSIS installer | `pnpm build:app` produced `src-tauri/target/release/bundle/nsis/Tarab_1.0.0_x64-setup.exe`; size 5,931,104 bytes; SHA-256 `ABE4CBEFBAB39B814D8F9643E48F3A45070276B0F163A15F8D4DE2F0DF6EDFD9`. | Proven locally |
| Windows Authenticode | The local application, MSI installer, and NSIS installer all report `NotSigned`, as expected for a build without the hosted certificate secrets. | Not distribution-ready |

## macOS runtime evidence (historical 2026-07-28)

The earlier runtime test used an isolated temporary HOME. The 2026-07-28 packaged-artwork smoke test used the normal app-owned cache and did not grant new source access.

| Requirement | Evidence | Status |
| --- | --- | --- |
| Startup stability | The application started, initialized the database in 7.1 ms, completed setup in 175.4 ms, and created the 1200 by 800 main window. | Proven on the local debug bundle |
| Data isolation | Database, player store, cache, and log files were created only below the temporary HOME. | Proven for the test |
| Search deep link | `tarab://open/search?q=release-smoke` reached the existing process. The UI showed `release-smoke` in the search field and showed the expected empty result. | Proven on macOS |
| Opaque play deep link | A well-formed unknown 64-character track ID reached the handler. The UI reported that the linked track was not in the library. It did not expose a local path. | Proven on macOS |
| File association prompt | Opening a temporary `.mp3` displayed the Play once, Import folder, and Cancel choices with only the file and folder display names. | Proven on macOS |
| Native authority | Merely opening the file did not create `library-grants.json`. | Proven on macOS |
| Single instance | Deep-link delivery kept one Tarab process. | Proven on macOS |
| Packaged startup | The rebuilt release `.app` launched without the development server and remained running until the verification process closed it. | Proven on macOS |
| Cached artwork without source access | Artwork remained visible behind the macOS Documents permission prompt. The app did not replace it with the vinyl placeholder. | Proven on macOS |

## Cross-platform workflow evidence

| Target | Configured proof | Hosted result |
| --- | --- | --- |
| macOS Universal 2 | Rust tests, signed build, architecture checks, URL scheme check, nested signature check, hardened runtime, notarization tickets, and Gatekeeper assessments | Not run |
| Windows x64 | Rust tests, PE machine check, application and NSIS Authenticode checks, and trusted timestamp checks | Not run |
| Windows arm64 | Native arm64 runner, Rust tests, PE machine check, application and NSIS Authenticode checks, and trusted timestamp checks | Not run |
| Linux x64 | Native build, executable AppImage check, amd64 Debian check, and Debian package validation | Not run |
| Linux arm64 | Native arm64 build, executable AppImage check, arm64 Debian check, and Debian package validation | Not run |
| Publication | Duplicate-safe flat staging, verified SHA-256 file, GitHub attestations, and release asset upload | Not run |

## Release decision

The current source gates, dependency audits, historical macOS evidence, and local unsigned Windows package evidence are ready for a hosted release candidate. Tarab 1.0.0 is not yet approved for public release because the current Apple Silicon DMG cannot be created on this host, the current application is not Developer ID signed, and hosted signed cross-platform packages, notarization, published checksums, and GitHub attestations do not exist.

To complete the decision:

1. Create or connect the intended GitHub repository.
2. Configure Apple Developer ID and notarization secrets.
3. Configure the Windows code-signing certificate and RFC 3161 timestamp endpoint.
4. Push the reviewed source and create the exact `v1.0.0` tag.
5. Require every release workflow job to pass.
6. Download each published asset and verify `SHA256SUMS.txt`.
7. Verify GitHub attestations and perform clean-install and upgrade tests on each supported operating system.
