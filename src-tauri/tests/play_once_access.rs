const AUDIO: &str = include_str!("../src/audio.rs");
const METADATA: &str = include_str!("../src/metadata.rs");

fn command_body<'a>(source: &'a str, signature: &str) -> &'a str {
    let start = source.find(signature).expect("command signature");
    let end = source[start..]
        .find("\n#[tauri::command]")
        .map(|offset| start + offset)
        .expect("next Tauri command");
    &source[start..end]
}

fn audio_command_arm(signature: &str) -> &str {
    let command_loop = AUDIO
        .find("match receiver.recv_timeout")
        .expect("audio command loop");
    let start = command_loop
        + AUDIO[command_loop..]
            .find(signature)
            .expect("audio command arm");
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
        play_command.contains("retain_transient_file_for_queue_entry_at_generation"),
        "starting playback must retain its exact one-file grant for the queue entry"
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
        stop_command.contains("clear_transient_file_grants_at_generation"),
        "stopping playback must release one-file access"
    );
}

#[test]
fn artwork_palette_crossfade_and_preload_accept_the_active_transient_file() {
    assert!(
        command_body(AUDIO, "fn ensure_audio_file_allowed(")
            .contains("ensure_path_allowed_by_state(Path::new(file_path), roots, action)"),
        "audio validation must honor exact in-memory file grants"
    );

    for signature in [
        "pub async fn get_cover_art_with_blurhash(",
        "pub async fn resolve_cover_art(",
        "pub async fn get_cover_art_data(",
        "pub async fn get_cover_art_palette(",
    ] {
        assert!(
            command_body(METADATA, signature).contains("ensure_metadata_path_allowed_by_state"),
            "{signature} must honor the exact in-memory file grant"
        );
    }

    for signature in ["pub fn crossfade_to_track(", "pub fn preload_next_track("] {
        assert!(
            command_body(AUDIO, signature).contains("ensure_audio_file_allowed"),
            "{signature} must validate with transient file access"
        );
    }
}

#[test]
fn crossfade_and_gapless_handoffs_move_transient_access_with_the_active_track() {
    let crossfade = audio_command_arm(
        "AudioCommand::CrossfadeTo {\n                                file_path,",
    );
    assert!(
        crossfade.contains("retain_transient_file_for_queue_entry_at_generation"),
        "a successfully started crossfade must retain only its incoming track grant"
    );

    let gapless = audio_command_arm(
        "AudioCommand::GaplessHandoffStarted {\n                                ended,",
    );
    assert!(
        audio_command_arm("AudioCommand::Stop { generation } =>")
            .contains("clear_transient_file_grants_at_generation"),
        "the serialized Stop handler must clear grants using its source generation"
    );
    assert!(
        gapless.contains("if is_still_current")
            && gapless.contains("retain_transient_file_for_queue_entry_at_generation"),
        "a committed gapless handoff must update grants only for the current track"
    );
}
