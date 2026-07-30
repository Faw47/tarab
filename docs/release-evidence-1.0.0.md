# Tarab 1.0.0 Release Evidence

This file records the evidence available on 2026-07-28. It separates local proof from hosted distribution proof. Do not treat a configured workflow or an unsigned local package as proof of a published release.

## Source and quality gate

| Requirement | Evidence | Status |
| --- | --- | --- |
| Version alignment | `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` contain `1.0.0`. `pnpm verify:release-config` passed. | Proven locally |
| Frontend quality | TypeScript, Biome, 53 test files with 170 tests, the 113-command IPC contract, production build, Storybook build, and Knip passed under Node 22.18.0. | Proven locally |
| Rust quality | Rust formatting, 88 tests, and Clippy with warnings denied passed. | Proven locally |
| Refactor boundaries | Database migrations, tracks, playlists, lyrics, and aggregates are separate modules. Audio state, events, crossfade, devices, and source lifecycle are separate modules. Tag Manager selection and mutations and Tag Editor metadata, artwork, file information, and lyrics are separated and covered by the same release gate. | Proven locally |
| Release configuration | Deep links, nine file associations, CSP, updater policy, and 23 immutable GitHub Action references passed the release configuration check. | Proven locally |
| Rust dependency audit | The approved live scan fetched the RustSec database, loaded 1,172 advisories, updated the crates.io index, and scanned 703 locked dependencies. It had no non-ignored vulnerability failure and reported 18 allowed transitive-dependency warnings. The two `quick-xml` ignores are documented in `docs/security-review.md`. | Proven locally against the live advisory database |
| JavaScript dependency audit | `pnpm audit --prod --audit-level high` completed against the external registry and reported no known vulnerabilities. | Proven locally against the live advisory registry |

## macOS package evidence

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

## macOS runtime evidence

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

The source and available local macOS evidence are ready for a hosted release candidate. Tarab 1.0.0 is not yet approved for public release because the current Apple Silicon DMG cannot be created on this host, the current application is not Developer ID signed, and hosted audits, cross-platform packages, notarization, published checksums, and GitHub attestations do not exist.

To complete the decision:

1. Create or connect the intended GitHub repository.
2. Configure Apple Developer ID and notarization secrets.
3. Configure the Windows code-signing certificate and RFC 3161 timestamp endpoint.
4. Push the reviewed source and create the exact `v1.0.0` tag.
5. Require every release workflow job to pass.
6. Download each published asset and verify `SHA256SUMS.txt`.
7. Verify GitHub attestations and perform clean-install and upgrade tests on each supported operating system.
