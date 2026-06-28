use image::imageops::FilterType;
use std::io::Cursor;

pub fn resize_artwork(input_bytes: Vec<u8>, max_dimension: u32) -> Result<Vec<u8>, String> {
    // TODO: A cache lookup should go here before decode/resize to avoid redundant work.

    // Decode image from memory
    let img = image::load_from_memory(&input_bytes)
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    // Resize maintaining aspect ratio using Lanczos3
    let resized = img.resize(max_dimension, max_dimension, FilterType::Lanczos3);

    // Re-encode as JPEG at quality 85
    let mut buffer = Cursor::new(Vec::new());
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, 85);

    encoder
        .encode_image(&resized)
        .map_err(|e| format!("Failed to encode JPEG: {}", e))?;

    Ok(buffer.into_inner())
}

#[tauri::command]
pub fn process_artwork(input: Vec<u8>, max_size: u32) -> Result<Vec<u8>, String> {
    resize_artwork(input, max_size)
}
