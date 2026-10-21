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

#[test]
fn play_once_access_lasts_with_the_active_queue_entry() {
    let play_command = command_body(AUDIO, "pub fn play_track(");
    assert!(
        play_command.contains("retain_transient_file_for_queue_entry"),
        "starting playback must retain its exact one-file grant for the queue entry"
    );
    assert!(
        !play_command.contains("consume_transient_file"),
        "starting playback must not consume the grant before artwork and preload use it"
    );

    let stop_command = command_body(AUDIO, "pub fn stop_playback(");
    assert!(
        stop_command.contains("clear_transient_file_grants"),
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

    for signature in [
        "pub fn crossfade_to_track(",
        "pub fn preload_next_track(",
    ] {
        assert!(
            command_body(AUDIO, signature).contains("ensure_audio_file_allowed"),
            "{signature} must validate with transient file access"
        );
    }
}
