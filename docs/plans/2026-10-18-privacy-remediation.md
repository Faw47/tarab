# Scoped file reveal and online lyrics privacy

Base: published security/data candidate 0d5184c (PR #26). Keep this work separate and stacked.

1. SEC-06: remove renderer reveal-item capability. Keep ordinary library reveal behind the
   existing native grant guard. Playlist repair must retain folder access through a parameterless
   native command deriving the app-owned data directory; do not grant app-data authority through
   a renderer-selected path. Preserve the existing data-path getter interface. Add a frontend
   routing regression and a release guard rejecting unscoped reveal permissions.
2. SEC-07: gate every LRCLIB request on the persisted native autoLyrics boolean, defaulting off
   for missing, malformed or invalid settings. Keep local sidecars usable without network consent.
   Read settings under the fixed-store lock off the async worker. Strip request URLs from
   reqwest errors. Await pending frontend settings writes before automatic lookup to avoid an
   enable/disable ordering race. Document metadata transmission in README.

Tests: playlist repair routes no arbitrary path; native bool reads cover true/false/missing,
malformed and wrong-type values; reqwest error formatting omits synthetic track metadata;
settings-write drain waits for the toggle write and handles writes arriving during a drain.
Then run complete frontend and Rust checks, release permission mutations and independent review.
Native file manager acceptance and live LRCLIB integration remain separate platform checks.

Implemented and independently reviewed. Review corrections require primary-only consent reads and check forbidden opener permissions across every capability JSON. Verification is recorded in `docs/audits/2026-10-18-privacy-verification.md`.
