const AUDIO: &str = include_str!("../src/audio.rs");
const METADATA: &str = include_str!("../src/metadata.rs");
const AUDIO_SOURCE: &str = include_str!("../src/audio/source.rs");
const FILE_OPS: &str = include_str!("../src/file_ops.rs");

fn command_body<'a>(source: &'a str, signature: &str) -> &'a str {
    let start = source.find(signature).expect("command signature");
    let end = source[start..]
        .find("\n#[tauri::command]")
        .map(|offset| start + offset)
        .unwrap_or(source.len());
    &source[start..end]
}

fn audio_command_arm(signature: &str) -> &str {
    let command_loop = AUDIO
        .find("match receiver.recv_timeout")
        .expect("audio command loop");
    let arm_marker = format!("\n                            {signature}");
    let start = command_loop
        + AUDIO[command_loop..]
            .find(&arm_marker)
            .expect("audio command arm")
        + 1;
    let end = AUDIO[start..]
        .find("\n                            AudioCommand::")
        .or_else(|| AUDIO[start..].find("\n                            command @"))
        .map(|offset| start + offset)
        .unwrap_or(AUDIO.len());
    &AUDIO[start..end]
}

#[test]
fn play_once_access_lasts_with_the_active_queue_entry() {
    let play_command = command_body(AUDIO, "pub fn play_track(");
    assert!(
        play_command.contains("mark_playback_generation"),
        "starting playback must reserve its generation before queued source preparation"
    );
    assert!(
        !play_command.contains("retain_transient_file_for_queue_entry_at_generation"),
        "a failed playback request must not replace the active track's transient grant"
    );
    let prepared_commit = command_body(AUDIO, "fn commit_prepared_source(");
    assert!(
        prepared_commit.contains("retain_transient_file_for_queue_entry_at_generation"),
        "the new transient grant must be committed only after source preparation succeeds"
    );
    assert!(
        AUDIO.contains("discard_transient_file_for_failed_playback"),
        "failed preparation must discard only its pending transient grant"
    );
    assert!(
        !play_command.contains("consume_transient_file"),
        "starting playback must not consume the grant before artwork and preload use it"
    );

    let crossfade_command = command_body(AUDIO, "pub fn crossfade_to_track(");
    assert!(
        crossfade_command.contains("mark_playback_generation"),
        "queued crossfades must reserve their generation before async completion"
    );

    let stop_command = command_body(AUDIO, "pub fn stop_playback(");
    assert!(
        stop_command.contains("clear_transient_file_grants_through_generation"),
        "stopping playback must release one-file access"
    );
}

#[test]
fn artwork_palette_crossfade_and_preload_accept_the_active_transient_file() {
    assert!(
        AUDIO.contains("ensure_path_allowed_by_state(Path::new(file_path), roots, action)"),
        "audio validation must honor exact in-memory file grants"
    );

    for signature in [
        "async fn get_cover_art_with_blurhash(",
        "pub async fn resolve_cover_art(",
        "pub async fn get_cover_art_data(",
        "pub async fn get_cover_art_palette(",
    ] {
        assert!(
            command_body(METADATA, signature).contains("ensure_metadata_path_allowed_by_state"),
            "{signature} must honor the exact in-memory file grant"
        );
    }

    let cover_art_command = command_body(METADATA, "pub async fn get_cover_art(");
    assert!(
        cover_art_command.contains("get_cover_art_with_blurhash"),
        "the registered cover-art command must keep using the guarded private helper"
    );

    for signature in ["pub fn crossfade_to_track(", "pub fn preload_next_track("] {
        assert!(
            command_body(AUDIO, signature).contains("ensure_audio_file_allowed"),
            "{signature} must validate with transient file access"
        );
    }
}

#[test]
fn prepared_sources_and_gapless_handoffs_reject_superseded_generations() {
    let installer_start = AUDIO_SOURCE
        .find("pub(super) fn play_with_source<")
        .expect("prepared source installer");
    let installer_end = AUDIO_SOURCE[installer_start..]
        .find("\npub(super) struct SymphoniaSource")
        .map(|offset| installer_start + offset)
        .expect("prepared source installer end");
    let installer = &AUDIO_SOURCE[installer_start..installer_end];
    assert!(
        installer.contains("roots_state.write()")
            && installer.contains("playback_generation_is_current")
            && installer.contains("commit_prepared_source"),
        "prepared sources must validate and commit while the latest source generation is locked"
    );

    let commit_start = AUDIO
        .find("fn commit_gapless_handoff(")
        .expect("gapless commit helper");
    let commit_end = AUDIO[commit_start..]
        .find("\nfn reset_active_counter")
        .map(|offset| commit_start + offset)
        .expect("gapless commit helper end");
    let commit = &AUDIO[commit_start..commit_end];
    let grant_commit = commit
        .find("retain_transient_file_for_queue_entry_at_generation")
        .expect("gapless grant commit");
    let state_commit = commit
        .find("state.current_file = Some(next_path.to_string())")
        .expect("gapless playback-state commit");
    assert!(
        commit.contains("roots_state.write()")
            && commit.contains("outgoing_generation")
            && commit.contains("state.current_file.as_deref()")
            && grant_commit < state_commit,
        "gapless grant and playback state must commit atomically before exposing the next generation"
    );
}

#[test]
fn crossfade_and_gapless_handoffs_move_transient_access_with_the_active_track() {
    let crossfade = audio_command_arm("AudioCommand::CrossfadeTo");
    assert!(
        crossfade.contains("play_with_source") && crossfade.contains("&roots_for_audio"),
        "crossfade source installation must commit its current generation and transient grant atomically"
    );

    let gapless = audio_command_arm("AudioCommand::GaplessHandoffStarted");
    let stop_arm = audio_command_arm("AudioCommand::Stop");
    assert!(
        stop_arm.contains("clear_transient_file_grants_through_generation")
            && stop_arm.contains("reset_playback_state_for_stop"),
        "the serialized Stop handler must revoke grants through its generation and stop the installed source"
    );
    assert!(
        gapless.contains("if is_still_current")
            && !gapless.contains("retain_transient_file_for_queue_entry_at_generation"),
        "the serialized handoff event must not expose state before its transient grant is committed"
    );
}

#[test]
fn failed_newer_playback_request_restores_the_active_generation() {
    assert!(
        FILE_OPS.contains("active_playback_generation:"),
        "the installed source generation must be tracked separately from the latest request"
    );
    assert!(
        FILE_OPS.contains("pending_playback_generation:"),
        "failed requests must be distinguishable from a live source transition"
    );
    assert!(
        FILE_OPS.contains("settle_failed_playback_generation"),
        "a failed source request must settle without invalidating the still-active track"
    );
}

#[test]
fn gapless_commit_rechecks_seek_cancellation_after_taking_the_state_lock() {
    let commit_start = AUDIO
        .find("fn commit_gapless_handoff(")
        .expect("gapless commit");
    let commit_end = AUDIO[commit_start..]
        .find("\nfn reset_active_counter")
        .map(|offset| commit_start + offset)
        .expect("gapless commit end");
    let commit = &AUDIO[commit_start..commit_end];
    let state_lock = commit
        .find("let mut state = state.lock()")
        .expect("serialized playback state lock");
    assert!(
        commit[state_lock..].contains("cancelled.load(Ordering::Acquire)"),
        "the callback must observe a Seek cancellation made while it waited for playback state"
    );
}

#[test]
fn superseded_requests_drop_transient_grants_by_generation() {
    assert!(
        FILE_OPS.contains("pending_transient_file_grants:"),
        "pending file access must be associated with the request that authorized it"
    );
    assert!(
        FILE_OPS.contains("prune_superseded_transient_file_grants"),
        "a newer request must retire older pending grants even if the newer request fails"
    );
}

#[test]
fn failed_play_keeps_the_exact_preloaded_gapless_entry_available() {
    assert!(
        FILE_OPS.contains("preloaded_queue_entry: Option<(u64, PathBuf)>"),
        "the queued successor must keep its generation and path while a newer request is pending"
    );
    assert!(
        FILE_OPS.contains("*preloaded_generation == generation"),
        "a handoff must match the exact entry that was preloaded"
    );
    assert!(
        FILE_OPS.contains("generation > active_generation"),
        "a queued successor must be compared with the installed track, not a failed request's high-water mark"
    );
    assert!(
        AUDIO.contains("replace_preloaded_queue_entry"),
        "preload and clear commands must update transient file ownership"
    );
    assert!(
        FILE_OPS.contains("*preloaded_generation > generation"),
        "a preload queued after a Play request must survive that Play's successful commit"
    );
}
