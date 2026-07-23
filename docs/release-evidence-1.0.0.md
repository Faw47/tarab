# Tarab 1.0.0 Release Evidence

This file records the evidence available on 2026-07-24. It separates local proof from hosted distribution proof. Do not treat a configured workflow or an unsigned local package as proof of a published release.

## Source and quality gate

| Requirement | Evidence | Status |
| --- | --- | --- |
| Version alignment | `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` contain `1.0.0`. `pnpm verify:release-config` passed. | Proven locally |
| Frontend quality | TypeScript, Biome, 46 test files with 149 tests, the IPC contract, production build, Storybook build, and Knip passed. | Proven locally |
| Rust quality | Rust formatting, 67 tests, and Clippy with warnings denied passed. | Proven locally |
| Release configuration | Deep links, nine file associations, CSP, updater policy, and 23 immutable GitHub Action references passed the release configuration check. | Proven locally |
| Rust dependency audit | An offline scan loaded 1,166 cached advisories. It had no non-ignored vulnerability failure. It reported 18 informational dependency warnings. The two `quick-xml` ignores are documented in `docs/security-review.md`. | Partial; database was cached |
| JavaScript dependency audit | The hosted workflow contains the production audit. | Not run locally; external registry access is required |

## macOS package evidence

| Requirement | Evidence | Status |
| --- | --- | --- |
| Universal 2 DMG | `src-tauri/target/universal-apple-darwin/release/bundle/dmg/Tarab_1.0.0_universal.dmg` passed `hdiutil verify`. The mounted application contains x86_64 and arm64 slices, version 1.0.0, minimum macOS 12.0, the `tarab` URL scheme, and the Applications link. | Proven locally |
| Universal 2 checksum | SHA-256 is `43e00765182f5e3a2dd126b38aecc5ff214fadb5659b4f16ef246711e3051f26`. | Proven locally |
| Apple Silicon DMG | Local file is `src-tauri/target/release/bundle/dmg/Tarab_1.0.0_aarch64.dmg`. | Proven locally |
| Apple Silicon checksum | SHA-256 is `a85e1b5d93c962421fe5da86bd03a9363a9921255535676c1b41b87784416cc5`. | Proven locally |
| Ad hoc signed application | The debug application passed strict nested signature verification and contains the hardened-runtime flag. | Local structure proof only |
| Developer ID signature | A Developer ID Application identity is not available in this workspace. | Missing external credential |
| Notarization and stapling | Apple notarization credentials are not available in this workspace. | Missing external credential |
| Gatekeeper distribution acceptance | The release workflow checks the application and DMG after signing and stapling. | Not proven on a Developer ID artifact |

## macOS runtime evidence

The runtime test used an isolated temporary HOME. It did not use the normal user data directory.

| Requirement | Evidence | Status |
| --- | --- | --- |
| Startup stability | The application started, initialized the database in 7.1 ms, completed setup in 175.4 ms, and created the 1200 by 800 main window. | Proven on the local debug bundle |
| Data isolation | Database, player store, cache, and log files were created only below the temporary HOME. | Proven for the test |
| Search deep link | `tarab://open/search?q=release-smoke` reached the existing process. The UI showed `release-smoke` in the search field and showed the expected empty result. | Proven on macOS |
| Opaque play deep link | A well-formed unknown 64-character track ID reached the handler. The UI reported that the linked track was not in the library. It did not expose a local path. | Proven on macOS |
| File association prompt | Opening a temporary `.mp3` displayed the Play once, Import folder, and Cancel choices with only the file and folder display names. | Proven on macOS |
| Native authority | Merely opening the file did not create `library-grants.json`. | Proven on macOS |
| Single instance | Deep-link delivery kept one Tarab process. | Proven on macOS |

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

The source and available local macOS evidence are ready for a hosted release candidate. Tarab 1.0.0 is not yet approved for public release because signed macOS and Windows packages, native Windows and Linux packages, hosted dependency audits, published checksums, and GitHub attestations do not exist.

To complete the decision:

1. Create or connect the intended GitHub repository.
2. Configure Apple Developer ID and notarization secrets.
3. Configure the Windows code-signing certificate and RFC 3161 timestamp endpoint.
4. Push the reviewed source and create the exact `v1.0.0` tag.
5. Require every release workflow job to pass.
6. Download each published asset and verify `SHA256SUMS.txt`.
7. Verify GitHub attestations and perform clean-install and upgrade tests on each supported operating system.
