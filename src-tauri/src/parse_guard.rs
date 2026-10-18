//! Media files are untrusted input, and parser panics on malformed files are common in media
//! crates. Release builds unwind (see `Cargo.toml`), and each per-file parse runs through `guard`
//! so one corrupt file fails only itself instead of a whole scan batch or the audio thread.

use std::panic::{catch_unwind, AssertUnwindSafe};

/// Runs `parse`, turning a panic into an error that names what was being read.
pub(crate) fn guard<T>(what: &str, parse: impl FnOnce() -> T) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(parse)).map_err(|payload| {
        let detail = payload
            .downcast_ref::<&str>()
            .map(|message| (*message).to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".to_string());
        format!("The parser crashed while reading {what}: {detail}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_panicking_parse_becomes_an_error() {
        let result: Result<u32, String> = guard("song.flac", || panic!("bad frame header"));
        assert_eq!(
            result.unwrap_err(),
            "The parser crashed while reading song.flac: bad frame header"
        );
        assert_eq!(guard("song.flac", || 7), Ok(7));
    }
}
