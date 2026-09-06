use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use lofty::config::{apply_global_options, GlobalOptions, ParseOptions};
use lofty::file::{FileType, TaggedFile, TaggedFileExt};
use lofty::picture::APE_PICTURE_TYPES;
use lofty::probe::Probe;
use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use crate::image_cache::MAX_ENCODED_IMAGE_BYTES;

const MAX_PICTURE_BYTES: u64 = MAX_ENCODED_IMAGE_BYTES as u64;
const MAX_PICTURE_COUNT: u32 = 32;
const MAX_PICTURE_METADATA_BYTES: u64 = 64 * 1024;
const MAX_TOTAL_PICTURE_METADATA_BYTES: u64 = 1024 * 1024;
const MAX_NON_ART_TAG_BYTES: u64 = 1024 * 1024;
const MAX_BASE64_PICTURE_BYTES: u64 =
    (MAX_PICTURE_BYTES + MAX_TOTAL_PICTURE_METADATA_BYTES).div_ceil(3) * 4;
// Lofty buffers OGG comments and MP4 ilst metadata around the decoded picture payload.
const MAX_TAG_CONTAINER_BYTES: u64 = MAX_BASE64_PICTURE_BYTES + MAX_NON_ART_TAG_BYTES;
const MAX_OGG_IDENTIFICATION_PACKET_BYTES: u64 = 64 * 1024;
const MAX_MP4_DEPTH: usize = 16;

#[derive(Clone, Copy)]
enum CanonicalFormat {
    Mpeg,
    Flac,
    Wav,
    Ogg,
    Mp4,
    Aac,
    Aiff,
}

impl CanonicalFormat {
    fn from_path(path: &Path) -> Result<Self, String> {
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .ok_or_else(|| "Media file has no supported extension".to_string())?;
        match extension.as_str() {
            "mp3" => Ok(Self::Mpeg),
            "flac" => Ok(Self::Flac),
            "wav" => Ok(Self::Wav),
            "ogg" => Ok(Self::Ogg),
            "m4a" | "alac" => Ok(Self::Mp4),
            "aac" => Ok(Self::Aac),
            "aiff" => Ok(Self::Aiff),
            _ => Err(format!(
                "Embedded cover-art preflight does not support .{extension} files"
            )),
        }
    }

    const fn lofty_file_type(self) -> FileType {
        match self {
            Self::Mpeg => FileType::Mpeg,
            Self::Flac => FileType::Flac,
            Self::Wav => FileType::Wav,
            Self::Ogg => FileType::Vorbis,
            Self::Mp4 => FileType::Mp4,
            Self::Aac => FileType::Aac,
            Self::Aiff => FileType::Aiff,
        }
    }
}

#[derive(Debug, Default)]
struct ArtPreflight {
    has_art: bool,
    picture_count: u32,
    picture_bytes: u64,
    picture_metadata_bytes: u64,
}

impl ArtPreflight {
    fn add_picture(
        &mut self,
        picture_bytes: u64,
        metadata_bytes: u64,
        location: &str,
    ) -> Result<(), String> {
        self.has_art = true;
        if picture_bytes > MAX_PICTURE_BYTES {
            return Err(format!(
                "Embedded cover art in {location} declares {picture_bytes} bytes, exceeding the {MAX_PICTURE_BYTES} byte limit"
            ));
        }

        self.picture_count = self
            .picture_count
            .checked_add(1)
            .ok_or_else(|| "Embedded cover-art count overflowed".to_string())?;
        if self.picture_count > MAX_PICTURE_COUNT {
            return Err(format!(
                "Embedded cover art contains more than {MAX_PICTURE_COUNT} pictures"
            ));
        }

        self.picture_bytes = self
            .picture_bytes
            .checked_add(picture_bytes)
            .ok_or_else(|| "Embedded cover-art size overflowed".to_string())?;
        if self.picture_bytes > MAX_PICTURE_BYTES {
            return Err(format!(
                "Embedded cover art declares more than {MAX_PICTURE_BYTES} bytes in total"
            ));
        }

        if metadata_bytes > MAX_PICTURE_METADATA_BYTES {
            return Err(format!(
                "Embedded cover-art metadata in {location} exceeds the {MAX_PICTURE_METADATA_BYTES} byte limit"
            ));
        }
        self.picture_metadata_bytes = self
            .picture_metadata_bytes
            .checked_add(metadata_bytes)
            .ok_or_else(|| "Embedded cover-art metadata size overflowed".to_string())?;
        if self.picture_metadata_bytes > MAX_TOTAL_PICTURE_METADATA_BYTES {
            return Err(format!(
                "Embedded cover-art metadata exceeds the {MAX_TOTAL_PICTURE_METADATA_BYTES} byte total limit"
            ));
        }
        Ok(())
    }
}

pub(crate) struct BoundedTaggedFile {
    pub(crate) tagged_file: TaggedFile,
    pub(crate) has_art: bool,
}

pub(crate) fn read_tagged_file_from_path(
    path: &Path,
    read_cover_art: bool,
) -> Result<BoundedTaggedFile, String> {
    let file = File::open(path).map_err(|error| format!("Failed to open file: {error}"))?;
    read_tagged_file_from_file(file, path, read_cover_art)
}

pub(crate) fn read_tagged_file_from_file(
    mut file: File,
    path: &Path,
    read_cover_art: bool,
) -> Result<BoundedTaggedFile, String> {
    let format = CanonicalFormat::from_path(path)?;
    // In Lofty 0.21.1, APIC read_to_end, ogg_pager packet assembly, and base64 decoding are not
    // covered by GlobalOptions::allocation_limit, so declarations must be checked first.
    let preflight = preflight_embedded_art(&mut file, format, read_cover_art)?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| format!("Failed to rewind media file: {error}"))?;

    apply_global_options(GlobalOptions::new().allocation_limit(MAX_TAG_CONTAINER_BYTES as usize));
    let options = ParseOptions::new().read_cover_art(read_cover_art);
    let tagged_file = Probe::with_file_type(BufReader::new(file), format.lofty_file_type())
        .options(options)
        .read()
        .map_err(|error| format!("Failed to read file: {error}"))?;

    if read_cover_art {
        verify_materialized_pictures(&tagged_file)?;
    }
    let has_art = if read_cover_art {
        tagged_file
            .tags()
            .iter()
            .any(|tag| !tag.pictures().is_empty())
    } else {
        preflight.has_art
    };

    Ok(BoundedTaggedFile {
        tagged_file,
        has_art,
    })
}

fn verify_materialized_pictures(tagged_file: &TaggedFile) -> Result<(), String> {
    let mut total = 0_u64;
    let mut count = 0_u32;
    for picture in tagged_file
        .tags()
        .iter()
        .flat_map(|tag| tag.pictures().iter())
    {
        let size = picture.data().len() as u64;
        if size > MAX_PICTURE_BYTES {
            return Err("Lofty materialized cover art above the preflight limit".to_string());
        }
        count = count
            .checked_add(1)
            .ok_or_else(|| "Materialized cover-art count overflowed".to_string())?;
        total = total
            .checked_add(size)
            .ok_or_else(|| "Materialized cover-art size overflowed".to_string())?;
    }
    if count > MAX_PICTURE_COUNT || total > MAX_PICTURE_BYTES {
        return Err(
            "Lofty materialized cover art above the cumulative preflight limit".to_string(),
        );
    }
    Ok(())
}

fn preflight_embedded_art<R: Read + Seek>(
    reader: &mut R,
    format: CanonicalFormat,
    materialize: bool,
) -> Result<ArtPreflight, String> {
    let file_len = reader
        .seek(SeekFrom::End(0))
        .map_err(|error| format!("Failed to inspect media length: {error}"))?;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(|error| format!("Failed to inspect media file: {error}"))?;

    let mut preflight = ArtPreflight::default();
    match format {
        CanonicalFormat::Mpeg => scan_mpeg(reader, file_len, materialize, &mut preflight)?,
        CanonicalFormat::Flac => scan_flac(reader, file_len, materialize, &mut preflight)?,
        CanonicalFormat::Wav => scan_iff(reader, file_len, true, materialize, &mut preflight)?,
        CanonicalFormat::Ogg => scan_ogg(reader, &mut preflight)?,
        CanonicalFormat::Mp4 => scan_mp4(reader, file_len, &mut preflight)?,
        CanonicalFormat::Aac => scan_leading_id3(reader, file_len, materialize, &mut preflight)?,
        CanonicalFormat::Aiff => scan_iff(reader, file_len, false, materialize, &mut preflight)?,
    }
    Ok(preflight)
}

fn read_exact_at<R: Read + Seek>(
    reader: &mut R,
    position: u64,
    bytes: &mut [u8],
) -> io::Result<()> {
    reader.seek(SeekFrom::Start(position))?;
    reader.read_exact(bytes)
}

fn read_u32_le<R: Read>(reader: &mut R) -> io::Result<u32> {
    let mut bytes = [0_u8; 4];
    reader.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_u32_be<R: Read>(reader: &mut R) -> io::Result<u32> {
    let mut bytes = [0_u8; 4];
    reader.read_exact(&mut bytes)?;
    Ok(u32::from_be_bytes(bytes))
}

fn skip_exact<R: Read>(reader: &mut R, bytes: u64) -> io::Result<()> {
    let copied = io::copy(&mut reader.take(bytes), &mut io::sink())?;
    if copied != bytes {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "tag payload ended before its declared length",
        ));
    }
    Ok(())
}

fn synchsafe_u32(bytes: [u8; 4]) -> Result<u32, String> {
    if bytes.iter().any(|byte| byte & 0x80 != 0) {
        return Err("ID3v2 contains a non-synchsafe size".to_string());
    }
    Ok((u32::from(bytes[0]) << 21)
        | (u32::from(bytes[1]) << 14)
        | (u32::from(bytes[2]) << 7)
        | u32::from(bytes[3]))
}

fn scan_leading_id3<R: Read + Seek>(
    reader: &mut R,
    file_len: u64,
    materialize: bool,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    let mut position = first_nonzero_position(reader, file_len)?;
    loop {
        let Some(end) = scan_id3_at(reader, position, file_len, materialize, preflight)? else {
            break;
        };
        position = first_nonzero_position_from(reader, end, file_len)?;
    }
    Ok(())
}

fn first_nonzero_position<R: Read + Seek>(reader: &mut R, file_len: u64) -> Result<u64, String> {
    first_nonzero_position_from(reader, 0, file_len)
}

fn first_nonzero_position_from<R: Read + Seek>(
    reader: &mut R,
    mut position: u64,
    file_len: u64,
) -> Result<u64, String> {
    let mut buffer = [0_u8; 4096];
    while position < file_len {
        let to_read = (file_len - position).min(buffer.len() as u64) as usize;
        read_exact_at(reader, position, &mut buffer[..to_read])
            .map_err(|error| format!("Failed to inspect media prefix: {error}"))?;
        if let Some(index) = buffer[..to_read].iter().position(|byte| *byte != 0) {
            return Ok(position + index as u64);
        }
        position += to_read as u64;
    }
    Ok(file_len)
}

fn scan_id3_at<R: Read + Seek>(
    reader: &mut R,
    offset: u64,
    bound_end: u64,
    materialize: bool,
    preflight: &mut ArtPreflight,
) -> Result<Option<u64>, String> {
    if offset.saturating_add(10) > bound_end {
        return Ok(None);
    }
    let mut header = [0_u8; 10];
    read_exact_at(reader, offset, &mut header)
        .map_err(|error| format!("Failed to inspect ID3v2 header: {error}"))?;
    if &header[..3] != b"ID3" {
        return Ok(None);
    }

    let version = header[3];
    if !(2..=4).contains(&version) {
        return Err(format!("Unsupported ID3v2.{version} tag"));
    }
    let tag_size = u64::from(synchsafe_u32(header[6..10].try_into().expect("ID3 size"))?);
    let content_start = offset
        .checked_add(10)
        .ok_or_else(|| "ID3v2 offset overflowed".to_string())?;
    let tag_end = content_start
        .checked_add(tag_size)
        .ok_or_else(|| "ID3v2 size overflowed".to_string())?;
    let full_end = tag_end
        .checked_add(u64::from(version >= 3 && header[5] & 0x10 != 0) * 10)
        .ok_or_else(|| "ID3v2 footer size overflowed".to_string())?;
    if full_end > bound_end {
        return Err("ID3v2 tag exceeds its containing file or chunk".to_string());
    }

    if header[5] & 0x80 != 0 {
        preflight.has_art = true;
        if materialize {
            return Err(
                "Cover-art parsing is disabled for tag-level-unsynchronized ID3v2 tags because Lofty 0.21.1 cannot bound their decoded APIC frames"
                    .to_string(),
            );
        }
        return Ok(Some(full_end));
    }

    let mut frame_start = content_start;
    if version >= 3 && header[5] & 0x40 != 0 {
        if version == 3 {
            preflight.has_art = true;
            if materialize {
                return Err(
                    "Cover-art parsing is disabled for ID3v2.3 extended-header tags because Lofty 0.21.1 does not expose a bounded APIC frame range"
                        .to_string(),
                );
            }
            return Ok(Some(full_end));
        }

        let mut size = [0_u8; 4];
        read_exact_at(reader, content_start, &mut size)
            .map_err(|error| format!("Failed to inspect ID3v2 extended header: {error}"))?;
        let extended_size = u64::from(synchsafe_u32(size)?);
        if extended_size < 6 || extended_size >= tag_size {
            return Err("ID3v2 contains an invalid extended-header size".to_string());
        }
        frame_start = content_start + extended_size;
    }

    scan_id3_frames(
        reader,
        frame_start,
        tag_end,
        version,
        materialize,
        preflight,
    )?;
    Ok(Some(full_end))
}

fn scan_id3_frames<R: Read + Seek>(
    reader: &mut R,
    mut position: u64,
    tag_end: u64,
    version: u8,
    materialize: bool,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    let frame_header_len = if version == 2 { 6_u64 } else { 10_u64 };
    while position.saturating_add(frame_header_len) <= tag_end {
        let mut header = [0_u8; 10];
        read_exact_at(reader, position, &mut header[..frame_header_len as usize])
            .map_err(|error| format!("Failed to inspect ID3v2 frame header: {error}"))?;
        if header[0] == 0 {
            break;
        }

        let (is_picture, frame_size, flags) = if version == 2 {
            (
                &header[..3] == b"PIC",
                u64::from(u32::from_be_bytes([0, header[3], header[4], header[5]])),
                0_u16,
            )
        } else {
            let size = if version == 4 {
                u64::from(synchsafe_u32(
                    header[4..8].try_into().expect("ID3 frame size"),
                )?)
            } else {
                u64::from(u32::from_be_bytes(
                    header[4..8].try_into().expect("ID3 frame size"),
                ))
            };
            (
                &header[..4] == b"APIC"
                    || (version == 3 && &header[..3] == b"PIC" && header[3] == 0),
                size,
                u16::from_be_bytes([header[8], header[9]]),
            )
        };
        let content_start = position + frame_header_len;
        let frame_end = content_start
            .checked_add(frame_size)
            .ok_or_else(|| "ID3v2 frame size overflowed".to_string())?;
        if frame_end > tag_end {
            return Err("ID3v2 frame exceeds the declared tag size".to_string());
        }

        if is_picture {
            scan_id3_picture(
                reader,
                content_start,
                frame_end,
                version,
                flags,
                materialize,
                preflight,
            )?;
        }
        if frame_size == 0 {
            break;
        }
        position = frame_end;
    }
    Ok(())
}

fn scan_id3_picture<R: Read + Seek>(
    reader: &mut R,
    mut position: u64,
    frame_end: u64,
    version: u8,
    flags: u16,
    materialize: bool,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    preflight.has_art = true;
    let (grouping, compressed, encrypted, unsynchronized, data_length) = match version {
        3 => (
            flags & 0x0020 != 0,
            flags & 0x0080 != 0,
            flags & 0x0040 != 0,
            false,
            flags & 0x0080 != 0,
        ),
        4 => (
            flags & 0x0040 != 0,
            flags & 0x0008 != 0,
            flags & 0x0004 != 0,
            flags & 0x0002 != 0,
            flags & 0x0001 != 0 || flags & 0x0008 != 0,
        ),
        _ => (false, false, false, false, false),
    };

    if compressed || encrypted {
        if materialize {
            return Err(
                "Cover-art parsing is disabled for compressed or encrypted ID3 APIC frames because Lofty 0.21.1 cannot bound their materialized payload"
                    .to_string(),
            );
        }
        return Ok(());
    }

    if grouping {
        position = position.saturating_add(1);
    }
    if data_length {
        position = position.saturating_add(4);
    }
    if position >= frame_end {
        return Err("ID3 APIC frame is shorter than its flags require".to_string());
    }

    if unsynchronized {
        return preflight.add_picture(frame_end - position, 0, "an unsynchronized ID3 APIC frame");
    }

    let metadata_start = position;
    let mut encoding = [0_u8; 1];
    read_exact_at(reader, position, &mut encoding)
        .map_err(|error| format!("Failed to inspect ID3 APIC encoding: {error}"))?;
    if encoding[0] > 3 {
        return Err("ID3 APIC frame uses an invalid text encoding".to_string());
    }
    position += 1;

    if version == 2 {
        position = position
            .checked_add(3)
            .ok_or_else(|| "ID3 PIC metadata overflowed".to_string())?;
    } else {
        position = scan_terminator(reader, position, frame_end, 1)?;
    }
    position = position
        .checked_add(1)
        .ok_or_else(|| "ID3 APIC picture type overflowed".to_string())?;
    if position > frame_end {
        return Err("ID3 APIC frame is missing a picture type".to_string());
    }
    let terminator_len = if matches!(encoding[0], 1 | 2) { 2 } else { 1 };
    position = scan_terminator(reader, position, frame_end, terminator_len)?;

    let metadata_bytes = position - metadata_start;
    preflight.add_picture(frame_end - position, metadata_bytes, "an ID3 APIC frame")
}

fn scan_terminator<R: Read + Seek>(
    reader: &mut R,
    mut position: u64,
    end: u64,
    terminator_len: usize,
) -> Result<u64, String> {
    let start = position;
    let mut pair = [1_u8; 2];
    while position < end {
        if position - start > MAX_PICTURE_METADATA_BYTES {
            return Err("Embedded cover-art text metadata exceeds its limit".to_string());
        }
        read_exact_at(reader, position, &mut pair[..terminator_len])
            .map_err(|error| format!("Failed to inspect cover-art metadata: {error}"))?;
        position += terminator_len as u64;
        if pair[..terminator_len].iter().all(|byte| *byte == 0) {
            return Ok(position);
        }
    }
    Err("Embedded cover-art text metadata has no terminator".to_string())
}

fn scan_mpeg<R: Read + Seek>(
    reader: &mut R,
    file_len: u64,
    materialize: bool,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    let first = first_nonzero_position(reader, file_len)?;
    let mut position = first;
    let mut found_id3 = false;
    loop {
        if let Some(end) = scan_id3_at(reader, position, file_len, materialize, preflight)? {
            found_id3 = true;
            position = first_nonzero_position_from(reader, end, file_len)?;
            continue;
        }
        if let Some(end) = scan_ape_header(reader, position, file_len, preflight)? {
            position = first_nonzero_position_from(reader, end, file_len)?;
            continue;
        }
        break;
    }

    if !found_id3 {
        let search_len = file_len.min(ParseOptions::DEFAULT_MAX_JUNK_BYTES as u64) as usize;
        let mut search = vec![0_u8; search_len];
        read_exact_at(reader, 0, &mut search)
            .map_err(|error| format!("Failed to inspect ID3v2 prefix: {error}"))?;
        for offset in 0..search.len().saturating_sub(2) {
            if &search[offset..offset + 3] == b"ID3" {
                let _ = scan_id3_at(reader, offset as u64, file_len, materialize, preflight)?;
                break;
            }
        }
    }
    scan_trailing_ape(reader, file_len, preflight)
}

fn scan_ape_header<R: Read + Seek>(
    reader: &mut R,
    offset: u64,
    file_len: u64,
    preflight: &mut ArtPreflight,
) -> Result<Option<u64>, String> {
    if offset.saturating_add(32) > file_len {
        return Ok(None);
    }
    let mut header = [0_u8; 32];
    read_exact_at(reader, offset, &mut header)
        .map_err(|error| format!("Failed to inspect APE header: {error}"))?;
    if &header[..8] != b"APETAGEX" {
        return Ok(None);
    }
    let size = u64::from(u32::from_le_bytes(
        header[12..16].try_into().expect("APE size"),
    ));
    let count = u32::from_le_bytes(header[16..20].try_into().expect("APE item count"));
    if size < 32 {
        return Err("APE tag declares an invalid size".to_string());
    }
    let items_start = offset + 32;
    let items_end = offset
        .checked_add(size)
        .ok_or_else(|| "APE tag size overflowed".to_string())?;
    let full_end = items_end
        .checked_add(32)
        .ok_or_else(|| "APE footer size overflowed".to_string())?;
    if full_end > file_len {
        return Err("APE tag exceeds the media file".to_string());
    }
    scan_ape_items(reader, items_start, items_end, count, preflight)?;
    Ok(Some(full_end))
}

fn scan_trailing_ape<R: Read + Seek>(
    reader: &mut R,
    file_len: u64,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    let mut boundary = file_len;
    if boundary >= 128 {
        let mut marker = [0_u8; 3];
        read_exact_at(reader, boundary - 128, &mut marker)
            .map_err(|error| format!("Failed to inspect ID3v1 trailer: {error}"))?;
        if &marker == b"TAG" {
            boundary -= 128;
        }
    }
    if boundary >= 15 {
        let mut lyrics = [0_u8; 15];
        read_exact_at(reader, boundary - 15, &mut lyrics)
            .map_err(|error| format!("Failed to inspect Lyrics3 trailer: {error}"))?;
        if &lyrics[7..] == b"LYRICS200" {
            let size = std::str::from_utf8(&lyrics[..7])
                .ok()
                .and_then(|size| size.parse::<u64>().ok())
                .ok_or_else(|| "Lyrics3 trailer has an invalid size".to_string())?;
            boundary = boundary
                .checked_sub(size + 15)
                .ok_or_else(|| "Lyrics3 trailer exceeds the media file".to_string())?;
        }
    }
    if boundary < 32 {
        return Ok(());
    }

    let footer_start = boundary - 32;
    let mut footer = [0_u8; 32];
    read_exact_at(reader, footer_start, &mut footer)
        .map_err(|error| format!("Failed to inspect APE footer: {error}"))?;
    if &footer[..8] != b"APETAGEX" {
        return Ok(());
    }
    let size = u64::from(u32::from_le_bytes(
        footer[12..16].try_into().expect("APE size"),
    ));
    let count = u32::from_le_bytes(footer[16..20].try_into().expect("APE item count"));
    if size < 32 || size > boundary {
        return Err("APE footer declares an invalid tag size".to_string());
    }
    let items_start = boundary - size;
    scan_ape_items(reader, items_start, footer_start, count, preflight)
}

fn scan_ape_items<R: Read + Seek>(
    reader: &mut R,
    mut position: u64,
    items_end: u64,
    item_count: u32,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    for _ in 0..item_count {
        if position.saturating_add(8) > items_end {
            return Err("APE item header exceeds the tag".to_string());
        }
        let mut item_header = [0_u8; 8];
        read_exact_at(reader, position, &mut item_header)
            .map_err(|error| format!("Failed to inspect APE item: {error}"))?;
        let value_size = u64::from(u32::from_le_bytes(
            item_header[..4].try_into().expect("APE value size"),
        ));
        position += 8;

        let mut key = Vec::with_capacity(64);
        loop {
            if position >= items_end || key.len() > 255 {
                return Err("APE item key is missing or exceeds 255 bytes".to_string());
            }
            let mut byte = [0_u8; 1];
            read_exact_at(reader, position, &mut byte)
                .map_err(|error| format!("Failed to inspect APE item key: {error}"))?;
            position += 1;
            if byte[0] == 0 {
                break;
            }
            key.push(byte[0]);
        }
        let value_end = position
            .checked_add(value_size)
            .ok_or_else(|| "APE item size overflowed".to_string())?;
        if value_end > items_end {
            return Err("APE item exceeds the declared tag size".to_string());
        }

        let key = String::from_utf8_lossy(&key);
        if APE_PICTURE_TYPES.contains(&key.as_ref()) {
            let description_start = position;
            let mut found_terminator = false;
            while position < value_end {
                if position - description_start > MAX_PICTURE_METADATA_BYTES {
                    return Err("APE cover-art description exceeds its limit".to_string());
                }
                let mut byte = [0_u8; 1];
                read_exact_at(reader, position, &mut byte)
                    .map_err(|error| format!("Failed to inspect APE cover art: {error}"))?;
                position += 1;
                if byte[0] == 0 {
                    found_terminator = true;
                    break;
                }
            }
            if !found_terminator {
                return Err("APE cover art has no description terminator".to_string());
            }
            preflight.add_picture(
                value_end - position,
                position - description_start,
                "an APE cover-art item",
            )?;
        }
        position = value_end;
    }
    Ok(())
}

fn scan_flac<R: Read + Seek>(
    reader: &mut R,
    file_len: u64,
    materialize: bool,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    let offset = scan_id3_at(reader, 0, file_len, materialize, preflight)?.unwrap_or(0);
    let mut marker = [0_u8; 4];
    read_exact_at(reader, offset, &mut marker)
        .map_err(|error| format!("Failed to inspect FLAC marker: {error}"))?;
    if &marker != b"fLaC" {
        return Err("FLAC file is missing its stream marker".to_string());
    }

    let mut position = offset + 4;
    loop {
        if position.saturating_add(4) > file_len {
            return Err("FLAC metadata block header exceeds the file".to_string());
        }
        let mut header = [0_u8; 4];
        read_exact_at(reader, position, &mut header)
            .map_err(|error| format!("Failed to inspect FLAC block: {error}"))?;
        let last = header[0] & 0x80 != 0;
        let block_type = header[0] & 0x7f;
        let size = u64::from(u32::from_be_bytes([0, header[1], header[2], header[3]]));
        let content_start = position + 4;
        let block_end = content_start
            .checked_add(size)
            .ok_or_else(|| "FLAC metadata size overflowed".to_string())?;
        if block_end > file_len {
            return Err("FLAC metadata block exceeds the file".to_string());
        }

        match block_type {
            4 => {
                reader
                    .seek(SeekFrom::Start(content_start))
                    .map_err(|error| format!("Failed to inspect FLAC comments: {error}"))?;
                let mut comments = reader.by_ref().take(size);
                scan_vorbis_comments(&mut comments, preflight)?;
            }
            6 => scan_flac_picture(reader, content_start, size, preflight)?,
            _ => {}
        }
        if last {
            break;
        }
        position = block_end;
    }
    Ok(())
}

fn scan_flac_picture<R: Read + Seek>(
    reader: &mut R,
    start: u64,
    size: u64,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    reader
        .seek(SeekFrom::Start(start))
        .map_err(|error| format!("Failed to inspect FLAC picture: {error}"))?;
    let mut picture = reader.by_ref().take(size);
    let _picture_type = read_u32_be(&mut picture)
        .map_err(|error| format!("Failed to inspect FLAC picture type: {error}"))?;
    let mime_len = u64::from(
        read_u32_be(&mut picture)
            .map_err(|error| format!("Failed to inspect FLAC picture MIME: {error}"))?,
    );
    if mime_len > MAX_PICTURE_METADATA_BYTES {
        return Err("FLAC picture MIME exceeds its metadata limit".to_string());
    }
    skip_exact(&mut picture, mime_len)
        .map_err(|error| format!("Failed to inspect FLAC picture MIME: {error}"))?;
    let description_len = u64::from(
        read_u32_be(&mut picture)
            .map_err(|error| format!("Failed to inspect FLAC picture description: {error}"))?,
    );
    let metadata_bytes = mime_len
        .checked_add(description_len)
        .and_then(|value| value.checked_add(32))
        .ok_or_else(|| "FLAC picture metadata size overflowed".to_string())?;
    if metadata_bytes > MAX_PICTURE_METADATA_BYTES {
        return Err("FLAC picture metadata exceeds its limit".to_string());
    }
    skip_exact(&mut picture, description_len)
        .map_err(|error| format!("Failed to inspect FLAC picture description: {error}"))?;
    let mut dimensions = [0_u8; 16];
    picture
        .read_exact(&mut dimensions)
        .map_err(|error| format!("Failed to inspect FLAC picture dimensions: {error}"))?;
    let data_len = u64::from(
        read_u32_be(&mut picture)
            .map_err(|error| format!("Failed to inspect FLAC picture payload: {error}"))?,
    );
    preflight.add_picture(data_len, metadata_bytes, "a FLAC picture block")?;
    if data_len > picture.limit() {
        return Err("FLAC picture payload exceeds its containing block".to_string());
    }
    Ok(())
}

fn scan_vorbis_comments<R: Read>(
    reader: &mut R,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    let vendor_len = u64::from(
        read_u32_le(reader)
            .map_err(|error| format!("Failed to inspect Vorbis vendor length: {error}"))?,
    );
    if vendor_len > MAX_TAG_CONTAINER_BYTES {
        return Err("Vorbis vendor string exceeds the tag-container limit".to_string());
    }
    skip_exact(reader, vendor_len)
        .map_err(|error| format!("Failed to inspect Vorbis vendor string: {error}"))?;
    let item_count = read_u32_le(reader)
        .map_err(|error| format!("Failed to inspect Vorbis comment count: {error}"))?;

    for _ in 0..item_count {
        let comment_len = u64::from(
            read_u32_le(reader)
                .map_err(|error| format!("Failed to inspect Vorbis comment length: {error}"))?,
        );
        if comment_len > MAX_TAG_CONTAINER_BYTES {
            return Err("Vorbis comment exceeds the tag-container limit".to_string());
        }

        let mut key = [0_u8; 32];
        let mut key_len = 0_usize;
        let mut consumed = 0_u64;
        let mut separator = false;
        while consumed < comment_len && key_len < key.len() {
            let mut byte = [0_u8; 1];
            reader
                .read_exact(&mut byte)
                .map_err(|error| format!("Failed to inspect Vorbis comment key: {error}"))?;
            consumed += 1;
            if byte[0] == b'=' {
                separator = true;
                break;
            }
            key[key_len] = byte[0];
            key_len += 1;
        }

        let value_len = comment_len - consumed;
        if separator && key[..key_len].eq_ignore_ascii_case(b"METADATA_BLOCK_PICTURE") {
            scan_base64_flac_picture(reader, value_len, preflight)?;
        } else if separator && key[..key_len].eq_ignore_ascii_case(b"COVERART") {
            scan_base64_image(reader, value_len, preflight)?;
        } else {
            skip_exact(reader, value_len)
                .map_err(|error| format!("Failed to skip Vorbis comment: {error}"))?;
        }
    }
    Ok(())
}

fn scan_base64_image<R: Read>(
    reader: &mut R,
    encoded_len: u64,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    let max_encoded = MAX_PICTURE_BYTES.div_ceil(3) * 4;
    if encoded_len > max_encoded || !encoded_len.is_multiple_of(4) {
        return Err(format!(
            "Vorbis COVERART declares an encoded payload above the {MAX_PICTURE_BYTES} byte decoded limit"
        ));
    }
    let decoded_len = scan_base64_length(reader, encoded_len)
        .map_err(|error| format!("Failed to inspect Vorbis COVERART payload: {error}"))?;
    preflight.add_picture(decoded_len, 0, "a Vorbis COVERART field")
}

fn scan_base64_length<R: Read>(reader: &mut R, encoded_len: u64) -> io::Result<u64> {
    let mut remaining = encoded_len;
    let mut buffer = [0_u8; 8192];
    let mut tail = [0_u8; 2];
    let mut seen = 0_u64;
    while remaining > 0 {
        let read_len = remaining.min(buffer.len() as u64) as usize;
        reader.read_exact(&mut buffer[..read_len])?;
        for byte in &buffer[..read_len] {
            tail[0] = tail[1];
            tail[1] = *byte;
            seen += 1;
        }
        remaining -= read_len as u64;
    }
    let padding = if seen >= 2 && tail == *b"==" {
        2
    } else if seen >= 1 && tail[1] == b'=' {
        1
    } else {
        0
    };
    Ok((encoded_len / 4) * 3 - padding)
}

fn scan_base64_flac_picture<R: Read>(
    reader: &mut R,
    encoded_len: u64,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    if encoded_len > MAX_BASE64_PICTURE_BYTES {
        return Err(format!(
            "Vorbis METADATA_BLOCK_PICTURE declares an encoded payload above the {MAX_PICTURE_BYTES} byte cover-art limit"
        ));
    }
    if !encoded_len.is_multiple_of(4) {
        return Err("Vorbis METADATA_BLOCK_PICTURE has an invalid base64 length".to_string());
    }

    let max_prefix = ((MAX_PICTURE_METADATA_BYTES + 32).div_ceil(3) * 4) as usize;
    let prefix_len = encoded_len.min(max_prefix as u64) as usize;
    let prefix_len = prefix_len - (prefix_len % 4);
    let mut prefix = vec![0_u8; prefix_len];
    reader
        .read_exact(&mut prefix)
        .map_err(|error| format!("Failed to inspect base64 FLAC picture header: {error}"))?;
    let decoded = STANDARD
        .decode(&prefix)
        .map_err(|error| format!("Invalid base64 FLAC picture header: {error}"))?;
    scan_flac_picture_prefix(
        &decoded,
        (encoded_len / 4) * 3,
        preflight,
        "a Vorbis METADATA_BLOCK_PICTURE field",
    )?;
    skip_exact(reader, encoded_len - prefix_len as u64)
        .map_err(|error| format!("Failed to inspect base64 FLAC picture payload: {error}"))
}

fn scan_flac_picture_prefix(
    bytes: &[u8],
    decoded_upper_bound: u64,
    preflight: &mut ArtPreflight,
    location: &str,
) -> Result<(), String> {
    let read_u32 = |offset: usize| -> Result<u32, String> {
        let value = bytes
            .get(offset..offset + 4)
            .ok_or_else(|| "FLAC picture metadata exceeds its bounded prefix".to_string())?;
        Ok(u32::from_be_bytes(value.try_into().expect("FLAC field")))
    };

    let mime_len = read_u32(4)? as usize;
    let description_len_offset = 8_usize
        .checked_add(mime_len)
        .ok_or_else(|| "FLAC picture MIME size overflowed".to_string())?;
    let description_len = read_u32(description_len_offset)? as usize;
    let dimensions_offset = description_len_offset
        .checked_add(4)
        .and_then(|value| value.checked_add(description_len))
        .ok_or_else(|| "FLAC picture description size overflowed".to_string())?;
    let data_len_offset = dimensions_offset
        .checked_add(16)
        .ok_or_else(|| "FLAC picture dimensions overflowed".to_string())?;
    let data_len = u64::from(read_u32(data_len_offset)?);
    let payload_offset = data_len_offset + 4;
    let metadata_bytes = payload_offset as u64;
    preflight.add_picture(data_len, metadata_bytes, location)?;
    if metadata_bytes.saturating_add(data_len) > decoded_upper_bound {
        return Err("FLAC picture declaration exceeds its base64 field".to_string());
    }
    Ok(())
}

fn scan_iff<R: Read + Seek>(
    reader: &mut R,
    file_len: u64,
    little_endian: bool,
    materialize: bool,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    if file_len < 12 {
        return Err("IFF audio file is shorter than its header".to_string());
    }
    let mut header = [0_u8; 12];
    read_exact_at(reader, 0, &mut header)
        .map_err(|error| format!("Failed to inspect IFF header: {error}"))?;
    let valid = if little_endian {
        &header[..4] == b"RIFF" && &header[8..] == b"WAVE"
    } else {
        &header[..4] == b"FORM" && matches!(&header[8..], b"AIFF" | b"AIFC")
    };
    if !valid {
        return Err("IFF audio file has an invalid container signature".to_string());
    }

    let mut position = 12_u64;
    while position.saturating_add(8) <= file_len {
        let mut chunk = [0_u8; 8];
        read_exact_at(reader, position, &mut chunk)
            .map_err(|error| format!("Failed to inspect IFF chunk: {error}"))?;
        let size = if little_endian {
            u32::from_le_bytes(chunk[4..8].try_into().expect("RIFF chunk size"))
        } else {
            u32::from_be_bytes(chunk[4..8].try_into().expect("AIFF chunk size"))
        };
        let content_start = position + 8;
        let chunk_end = content_start
            .checked_add(u64::from(size))
            .ok_or_else(|| "IFF chunk size overflowed".to_string())?;
        if chunk_end > file_len {
            return Err("IFF chunk exceeds the media file".to_string());
        }
        if matches!(&chunk[..4], b"ID3 " | b"id3 ") {
            let parsed_end = scan_id3_at(reader, content_start, chunk_end, materialize, preflight)?;
            if parsed_end.is_none() {
                return Err("IFF ID3 chunk does not contain an ID3v2 tag".to_string());
            }
        }
        position = chunk_end + u64::from(size % 2);
    }
    Ok(())
}

struct OggPacketReader<'a, R> {
    reader: &'a mut R,
    laces: [u8; 255],
    lace_count: usize,
    next_lace: usize,
    current_lace: u8,
    current_remaining: usize,
    packet_ended: bool,
}

impl<'a, R: Read> OggPacketReader<'a, R> {
    fn new(reader: &'a mut R) -> io::Result<Self> {
        let mut packets = Self {
            reader,
            laces: [0; 255],
            lace_count: 0,
            next_lace: 0,
            current_lace: 0,
            current_remaining: 0,
            packet_ended: false,
        };
        packets.load_page()?;
        packets.prepare_segment()?;
        Ok(packets)
    }

    fn load_page(&mut self) -> io::Result<()> {
        let mut header = [0_u8; 27];
        self.reader.read_exact(&mut header)?;
        if &header[..4] != b"OggS" || header[4] != 0 || header[26] == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid OGG page header",
            ));
        }
        self.lace_count = header[26] as usize;
        self.next_lace = 0;
        self.reader.read_exact(&mut self.laces[..self.lace_count])?;
        Ok(())
    }

    fn prepare_segment(&mut self) -> io::Result<()> {
        if self.next_lace == self.lace_count {
            self.load_page()?;
        }
        self.current_lace = self.laces[self.next_lace];
        self.current_remaining = self.current_lace as usize;
        self.next_lace += 1;
        Ok(())
    }

    fn next_packet(&mut self) -> io::Result<()> {
        if !self.packet_ended {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "current OGG packet was not fully consumed",
            ));
        }
        self.packet_ended = false;
        self.prepare_segment()
    }
}

impl<R: Read> Read for OggPacketReader<'_, R> {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if output.is_empty() || self.packet_ended {
            return Ok(0);
        }
        while self.current_remaining == 0 {
            if self.current_lace < 255 {
                self.packet_ended = true;
                return Ok(0);
            }
            self.prepare_segment()?;
        }

        let read_len = output.len().min(self.current_remaining);
        self.reader.read_exact(&mut output[..read_len])?;
        self.current_remaining -= read_len;
        Ok(read_len)
    }
}

fn scan_ogg<R: Read>(reader: &mut R, preflight: &mut ArtPreflight) -> Result<(), String> {
    let mut packets = OggPacketReader::new(reader)
        .map_err(|error| format!("Failed to inspect OGG pages: {error}"))?;
    let mut signature = [0_u8; 7];
    packets
        .read_exact(&mut signature)
        .map_err(|error| format!("Failed to inspect OGG identification packet: {error}"))?;
    if &signature != b"\x01vorbis" {
        return Err(
            "Canonical .ogg cover-art preflight currently supports Vorbis streams only".to_string(),
        );
    }
    drain_packet(&mut packets, MAX_OGG_IDENTIFICATION_PACKET_BYTES - 7)?;
    packets
        .next_packet()
        .map_err(|error| format!("Failed to inspect OGG comment packet: {error}"))?;
    packets
        .read_exact(&mut signature)
        .map_err(|error| format!("Failed to inspect OGG comment signature: {error}"))?;
    if &signature != b"\x03vorbis" {
        return Err("OGG stream is missing its Vorbis comment packet".to_string());
    }

    {
        let mut bounded = packets.by_ref().take(MAX_TAG_CONTAINER_BYTES);
        scan_vorbis_comments(&mut bounded, preflight)?;
        io::copy(&mut bounded, &mut io::sink())
            .map_err(|error| format!("Failed to finish OGG comment preflight: {error}"))?;
    }
    let mut extra = [0_u8; 1];
    if packets
        .read(&mut extra)
        .map_err(|error| format!("Failed to bound OGG comment packet: {error}"))?
        != 0
    {
        return Err(format!(
            "OGG comment packet exceeds the {MAX_TAG_CONTAINER_BYTES} byte metadata limit"
        ));
    }
    Ok(())
}

fn drain_packet<R: Read>(reader: &mut R, limit: u64) -> Result<(), String> {
    let copied = io::copy(&mut reader.take(limit + 1), &mut io::sink())
        .map_err(|error| format!("Failed to inspect OGG packet: {error}"))?;
    if copied > limit {
        return Err(format!("OGG packet exceeds its {limit} byte limit"));
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct Mp4Atom {
    kind: [u8; 4],
    content_start: u64,
    end: u64,
}

fn scan_mp4<R: Read + Seek>(
    reader: &mut R,
    file_len: u64,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    scan_mp4_atoms(reader, 0, file_len, 0, false, preflight)
}

fn scan_mp4_atoms<R: Read + Seek>(
    reader: &mut R,
    mut position: u64,
    end: u64,
    depth: usize,
    in_ilst: bool,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    if depth > MAX_MP4_DEPTH {
        return Err("MP4 metadata nesting exceeds the preflight limit".to_string());
    }
    while position < end {
        let atom = read_mp4_atom(reader, position, end)?;
        let content_len = atom.end - atom.content_start;
        match &atom.kind {
            b"ilst" => {
                if content_len > MAX_TAG_CONTAINER_BYTES {
                    return Err(format!(
                        "MP4 ilst metadata exceeds the {MAX_TAG_CONTAINER_BYTES} byte limit"
                    ));
                }
                scan_mp4_atoms(
                    reader,
                    atom.content_start,
                    atom.end,
                    depth + 1,
                    true,
                    preflight,
                )?;
            }
            b"covr" if in_ilst => scan_mp4_cover(reader, atom, preflight)?,
            b"moov" | b"udta" => scan_mp4_atoms(
                reader,
                atom.content_start,
                atom.end,
                depth + 1,
                false,
                preflight,
            )?,
            b"meta" => {
                let child_start = mp4_meta_child_start(reader, atom)?;
                scan_mp4_atoms(reader, child_start, atom.end, depth + 1, false, preflight)?;
            }
            _ => {}
        }
        position = atom.end;
    }
    Ok(())
}

fn read_mp4_atom<R: Read + Seek>(
    reader: &mut R,
    position: u64,
    parent_end: u64,
) -> Result<Mp4Atom, String> {
    if position.saturating_add(8) > parent_end {
        return Err("MP4 atom header exceeds its parent".to_string());
    }
    let mut header = [0_u8; 8];
    read_exact_at(reader, position, &mut header)
        .map_err(|error| format!("Failed to inspect MP4 atom: {error}"))?;
    let short_size = u32::from_be_bytes(header[..4].try_into().expect("MP4 atom size"));
    let kind = header[4..8].try_into().expect("MP4 atom type");
    let (size, header_len) = match short_size {
        0 => (parent_end - position, 8_u64),
        1 => {
            let mut extended = [0_u8; 8];
            read_exact_at(reader, position + 8, &mut extended)
                .map_err(|error| format!("Failed to inspect extended MP4 atom: {error}"))?;
            (u64::from_be_bytes(extended), 16)
        }
        size => (u64::from(size), 8),
    };
    if size < header_len {
        return Err("MP4 atom is shorter than its header".to_string());
    }
    let atom_end = position
        .checked_add(size)
        .ok_or_else(|| "MP4 atom size overflowed".to_string())?;
    if atom_end > parent_end {
        return Err("MP4 atom exceeds its parent".to_string());
    }
    Ok(Mp4Atom {
        kind,
        content_start: position + header_len,
        end: atom_end,
    })
}

fn mp4_meta_child_start<R: Read + Seek>(reader: &mut R, atom: Mp4Atom) -> Result<u64, String> {
    if atom.content_start.saturating_add(8) > atom.end {
        return Err("MP4 meta atom is too short".to_string());
    }
    let mut prefix = [0_u8; 8];
    read_exact_at(reader, atom.content_start, &mut prefix)
        .map_err(|error| format!("Failed to inspect MP4 meta atom: {error}"))?;
    let non_full = matches!(
        &prefix[4..],
        b"hdlr" | b"ilst" | b"mhdr" | b"ctry" | b"lang"
    );
    Ok(atom.content_start + if non_full { 0 } else { 4 })
}

fn scan_mp4_cover<R: Read + Seek>(
    reader: &mut R,
    atom: Mp4Atom,
    preflight: &mut ArtPreflight,
) -> Result<(), String> {
    let mut position = atom.content_start;
    while position < atom.end {
        let data = read_mp4_atom(reader, position, atom.end)?;
        if &data.kind == b"data" {
            let atom_size = data.end - position;
            if atom_size < 16 {
                return Err("MP4 cover data atom is shorter than 16 bytes".to_string());
            }
            preflight.add_picture(atom_size - 16, 16, "an MP4 covr data atom")?;
        }
        position = data.end;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    const TEST_IMAGE: &[u8] = b"\x89PNG\r\n\x1a\nsmall-cover";

    fn synchsafe(value: u32) -> [u8; 4] {
        [
            ((value >> 21) & 0x7f) as u8,
            ((value >> 14) & 0x7f) as u8,
            ((value >> 7) & 0x7f) as u8,
            (value & 0x7f) as u8,
        ]
    }

    fn id3_picture_prefix(declared_image_len: u32, image: &[u8]) -> (Vec<u8>, u64) {
        let picture_prefix = b"\0image/png\0\x03\0";
        let frame_size = picture_prefix.len() as u32 + declared_image_len;
        let tag_size = 10 + frame_size;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"ID3\x03\0\0");
        bytes.extend_from_slice(&synchsafe(tag_size));
        bytes.extend_from_slice(b"APIC");
        bytes.extend_from_slice(&frame_size.to_be_bytes());
        bytes.extend_from_slice(&[0, 0]);
        bytes.extend_from_slice(picture_prefix);
        bytes.extend_from_slice(image);
        (bytes, u64::from(tag_size) + 10)
    }

    fn flac_picture(image: &[u8]) -> Vec<u8> {
        let mut picture = Vec::new();
        picture.extend_from_slice(&3_u32.to_be_bytes());
        picture.extend_from_slice(&9_u32.to_be_bytes());
        picture.extend_from_slice(b"image/png");
        picture.extend_from_slice(&0_u32.to_be_bytes());
        picture.extend_from_slice(&[0_u8; 16]);
        picture.extend_from_slice(&(image.len() as u32).to_be_bytes());
        picture.extend_from_slice(image);
        picture
    }

    fn native_flac(image: &[u8]) -> Vec<u8> {
        let picture = flac_picture(image);
        let size = picture.len() as u32;
        let mut bytes = b"fLaC".to_vec();
        bytes.push(0x80 | 6);
        bytes.extend_from_slice(&size.to_be_bytes()[1..]);
        bytes.extend_from_slice(&picture);
        bytes
    }

    fn flac_with_comment(comment: &[u8]) -> Vec<u8> {
        let mut block = Vec::new();
        block.extend_from_slice(&0_u32.to_le_bytes());
        block.extend_from_slice(&1_u32.to_le_bytes());
        block.extend_from_slice(&(comment.len() as u32).to_le_bytes());
        block.extend_from_slice(comment);
        let size = block.len() as u32;
        let mut bytes = b"fLaC".to_vec();
        bytes.push(0x80 | 4);
        bytes.extend_from_slice(&size.to_be_bytes()[1..]);
        bytes.extend_from_slice(&block);
        bytes
    }

    fn ape_picture_prefix(declared_image_len: u32) -> (Vec<u8>, u64) {
        let key = b"Cover Art (Front)\0";
        let value_size = declared_image_len + 1;
        let item_size = 8_u32 + key.len() as u32 + value_size;
        let tag_size = item_size + 32;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"APETAGEX");
        bytes.extend_from_slice(&2000_u32.to_le_bytes());
        bytes.extend_from_slice(&tag_size.to_le_bytes());
        bytes.extend_from_slice(&1_u32.to_le_bytes());
        bytes.extend_from_slice(&[0_u8; 12]);
        bytes.extend_from_slice(&value_size.to_le_bytes());
        bytes.extend_from_slice(&2_u32.to_le_bytes());
        bytes.extend_from_slice(key);
        bytes.push(0);
        (bytes, u64::from(tag_size) + 32)
    }

    fn iff_with_id3(id3: &[u8], little_endian: bool) -> Vec<u8> {
        let mut bytes = Vec::new();
        if little_endian {
            bytes.extend_from_slice(b"RIFF");
            bytes.extend_from_slice(&(12_u32 + id3.len() as u32).to_le_bytes());
            bytes.extend_from_slice(b"WAVE");
        } else {
            bytes.extend_from_slice(b"FORM");
            bytes.extend_from_slice(&(12_u32 + id3.len() as u32).to_be_bytes());
            bytes.extend_from_slice(b"AIFF");
        }
        bytes.extend_from_slice(b"ID3 ");
        if little_endian {
            bytes.extend_from_slice(&(id3.len() as u32).to_le_bytes());
        } else {
            bytes.extend_from_slice(&(id3.len() as u32).to_be_bytes());
        }
        bytes.extend_from_slice(id3);
        if !id3.len().is_multiple_of(2) {
            bytes.push(0);
        }
        bytes
    }

    fn ogg_with_comment(comment_len: u32, comment_prefix: &[u8]) -> Vec<u8> {
        let identification = b"\x01vorbis";
        let mut comments = b"\x03vorbis".to_vec();
        comments.extend_from_slice(&0_u32.to_le_bytes());
        comments.extend_from_slice(&1_u32.to_le_bytes());
        comments.extend_from_slice(&comment_len.to_le_bytes());
        comments.extend_from_slice(comment_prefix);
        assert!(identification.len() < 255 && comments.len() < 255);

        let mut page = Vec::new();
        page.extend_from_slice(b"OggS\0\x02");
        page.extend_from_slice(&0_u64.to_le_bytes());
        page.extend_from_slice(&1_u32.to_le_bytes());
        page.extend_from_slice(&0_u32.to_le_bytes());
        page.extend_from_slice(&0_u32.to_le_bytes());
        page.push(2);
        page.push(identification.len() as u8);
        page.push(comments.len() as u8);
        page.extend_from_slice(identification);
        page.extend_from_slice(&comments);
        page
    }

    fn normal_ogg(image: &[u8]) -> Vec<u8> {
        let encoded = STANDARD.encode(flac_picture(image));
        let mut comment = b"METADATA_BLOCK_PICTURE=".to_vec();
        comment.extend_from_slice(encoded.as_bytes());
        ogg_with_comment(comment.len() as u32, &comment)
    }

    fn atom(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&(payload.len() as u32 + 8).to_be_bytes());
        bytes.extend_from_slice(kind);
        bytes.extend_from_slice(payload);
        bytes
    }

    fn normal_mp4(image: &[u8]) -> Vec<u8> {
        let mut data_payload = vec![0_u8; 8];
        data_payload.extend_from_slice(image);
        let data = atom(b"data", &data_payload);
        let cover = atom(b"covr", &data);
        let ilst = atom(b"ilst", &cover);
        let mut meta_payload = vec![0_u8; 4];
        meta_payload.extend_from_slice(&ilst);
        let meta = atom(b"meta", &meta_payload);
        let user_data = atom(b"udta", &meta);
        let movie = atom(b"moov", &user_data);
        let mut bytes = atom(b"ftyp", b"M4A \0\0\0\0");
        bytes.extend_from_slice(&movie);
        bytes
    }

    fn scan_bytes(bytes: Vec<u8>, format: CanonicalFormat) -> ArtPreflight {
        let mut cursor = Cursor::new(bytes);
        preflight_embedded_art(&mut cursor, format, true).expect("bounded cover accepted")
    }

    fn temp_file(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        std::env::temp_dir().join(format!("tarab-art-preflight-{name}-{nonce}"))
    }

    fn sparse_scan(
        name: &str,
        prefix: &[u8],
        declared_len: u64,
        format: CanonicalFormat,
    ) -> String {
        assert!(
            prefix.len() < 1024,
            "crafted header must stay allocation-small"
        );
        let path = temp_file(name);
        let mut file = File::options()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
            .expect("create sparse test file");
        file.write_all(prefix).expect("write crafted header");
        file.set_len(declared_len)
            .expect("set sparse declared length");
        file.seek(SeekFrom::Start(0)).expect("rewind sparse file");
        let error = preflight_embedded_art(&mut file, format, true)
            .expect_err("oversized cover declaration must be rejected");
        drop(file);
        let _ = std::fs::remove_file(path);
        error
    }

    fn oversized_iff_prefix(id3_prefix: &[u8], id3_len: u64, little_endian: bool) -> Vec<u8> {
        let mut bytes = Vec::new();
        if little_endian {
            bytes.extend_from_slice(b"RIFF");
            bytes.extend_from_slice(&((id3_len + 12) as u32).to_le_bytes());
            bytes.extend_from_slice(b"WAVEID3 ");
            bytes.extend_from_slice(&(id3_len as u32).to_le_bytes());
        } else {
            bytes.extend_from_slice(b"FORM");
            bytes.extend_from_slice(&((id3_len + 12) as u32).to_be_bytes());
            bytes.extend_from_slice(b"AIFFID3 ");
            bytes.extend_from_slice(&(id3_len as u32).to_be_bytes());
        }
        bytes.extend_from_slice(id3_prefix);
        bytes
    }

    fn oversized_mp4_prefix(image_len: u32) -> (Vec<u8>, u64) {
        let data_size = image_len + 16;
        let cover_size = data_size + 8;
        let ilst_size = cover_size + 8;
        let meta_size = ilst_size + 12;
        let user_data_size = meta_size + 8;
        let movie_size = user_data_size + 8;

        let mut bytes = atom(b"ftyp", b"M4A \0\0\0\0");
        bytes.extend_from_slice(&movie_size.to_be_bytes());
        bytes.extend_from_slice(b"moov");
        bytes.extend_from_slice(&user_data_size.to_be_bytes());
        bytes.extend_from_slice(b"udta");
        bytes.extend_from_slice(&meta_size.to_be_bytes());
        bytes.extend_from_slice(b"meta");
        bytes.extend_from_slice(&[0_u8; 4]);
        bytes.extend_from_slice(&ilst_size.to_be_bytes());
        bytes.extend_from_slice(b"ilst");
        bytes.extend_from_slice(&cover_size.to_be_bytes());
        bytes.extend_from_slice(b"covr");
        bytes.extend_from_slice(&data_size.to_be_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&[0_u8; 8]);
        let declared_len = 16_u64 + u64::from(movie_size);
        (bytes, declared_len)
    }

    #[test]
    fn canonical_extensions_have_an_explicit_preflight_format() {
        for (extension, expected) in [
            ("mp3", FileType::Mpeg),
            ("flac", FileType::Flac),
            ("wav", FileType::Wav),
            ("ogg", FileType::Vorbis),
            ("m4a", FileType::Mp4),
            ("aac", FileType::Aac),
            ("aiff", FileType::Aiff),
            ("alac", FileType::Mp4),
        ] {
            let path = PathBuf::from(format!("track.{extension}"));
            assert_eq!(
                CanonicalFormat::from_path(&path)
                    .expect("canonical format")
                    .lofty_file_type(),
                expected
            );
        }
    }

    #[test]
    fn normal_covers_pass_every_canonical_container_preflight() {
        let (id3, _) = id3_picture_prefix(TEST_IMAGE.len() as u32, TEST_IMAGE);
        let cases = [
            (id3.clone(), CanonicalFormat::Mpeg),
            (id3.clone(), CanonicalFormat::Aac),
            (native_flac(TEST_IMAGE), CanonicalFormat::Flac),
            (iff_with_id3(&id3, true), CanonicalFormat::Wav),
            (normal_ogg(TEST_IMAGE), CanonicalFormat::Ogg),
            (normal_mp4(TEST_IMAGE), CanonicalFormat::Mp4),
            (iff_with_id3(&id3, false), CanonicalFormat::Aiff),
        ];

        for (bytes, format) in cases {
            let result = scan_bytes(bytes, format);
            assert!(result.has_art);
            assert_eq!(result.picture_bytes, TEST_IMAGE.len() as u64);
        }
    }

    #[test]
    fn legacy_pic_identifier_inside_id3v23_is_still_preflighted() {
        let (mut id3, _) = id3_picture_prefix(TEST_IMAGE.len() as u32, TEST_IMAGE);
        id3[10..14].copy_from_slice(b"PIC\0");

        let result = scan_bytes(id3, CanonicalFormat::Mpeg);

        assert!(result.has_art);
        assert_eq!(result.picture_bytes, TEST_IMAGE.len() as u64);
    }

    #[test]
    fn oversized_id3_headers_reject_mp3_aac_flac_wav_and_aiff_without_image_payloads() {
        let declared_image_len = MAX_PICTURE_BYTES as u32 + 1;
        let (id3_prefix, id3_len) = id3_picture_prefix(declared_image_len, &[]);
        let mut flac_prefix = id3_prefix.clone();
        flac_prefix.extend_from_slice(b"fLaC");

        let cases = [
            ("mp3", id3_prefix.clone(), id3_len, CanonicalFormat::Mpeg),
            ("aac", id3_prefix.clone(), id3_len, CanonicalFormat::Aac),
            ("flac", flac_prefix, id3_len + 4, CanonicalFormat::Flac),
            (
                "wav",
                oversized_iff_prefix(&id3_prefix, id3_len, true),
                id3_len + 20 + u64::from(id3_len % 2 != 0),
                CanonicalFormat::Wav,
            ),
            (
                "aiff",
                oversized_iff_prefix(&id3_prefix, id3_len, false),
                id3_len + 20 + u64::from(id3_len % 2 != 0),
                CanonicalFormat::Aiff,
            ),
        ];

        for (name, prefix, length, format) in cases {
            let error = sparse_scan(name, &prefix, length, format);
            assert!(
                error.contains("exceeding"),
                "unexpected {name} error: {error}"
            );
        }
    }

    #[test]
    fn oversized_ogg_picture_header_rejects_before_the_base64_payload() {
        let encoded_len = MAX_PICTURE_BYTES.div_ceil(3) * 4 + 4;
        let key = b"COVERART=";
        let bytes = ogg_with_comment((key.len() as u64 + encoded_len) as u32, key);

        let error = preflight_embedded_art(&mut Cursor::new(bytes), CanonicalFormat::Ogg, true)
            .expect_err("reject oversized OGG cover declaration");

        assert!(error.contains("above"), "unexpected error: {error}");
    }

    #[test]
    fn oversized_flac_vorbis_picture_header_rejects_without_an_image_payload() {
        let mut picture_header = flac_picture(&[]);
        let data_len_offset = picture_header.len() - 4;
        picture_header[data_len_offset..]
            .copy_from_slice(&(MAX_PICTURE_BYTES as u32 + 1).to_be_bytes());
        let mut comment = b"METADATA_BLOCK_PICTURE=".to_vec();
        comment.extend_from_slice(STANDARD.encode(picture_header).as_bytes());

        let error = preflight_embedded_art(
            &mut Cursor::new(flac_with_comment(&comment)),
            CanonicalFormat::Flac,
            true,
        )
        .expect_err("reject oversized FLAC Vorbis picture declaration");

        assert!(error.contains("exceeding"), "unexpected error: {error}");
    }

    #[test]
    fn oversized_ape_picture_header_rejects_without_an_image_payload() {
        let (prefix, length) = ape_picture_prefix(MAX_PICTURE_BYTES as u32 + 1);

        let error = sparse_scan("ape-mp3", &prefix, length, CanonicalFormat::Mpeg);

        assert!(error.contains("exceeding"), "unexpected error: {error}");
    }

    #[test]
    fn oversized_mp4_header_rejects_m4a_and_alac_without_an_image_payload() {
        let (prefix, length) = oversized_mp4_prefix(MAX_PICTURE_BYTES as u32 + 1);
        for extension in ["m4a", "alac"] {
            let error = sparse_scan(extension, &prefix, length, CanonicalFormat::Mp4);
            assert!(
                error.contains("exceeding"),
                "unexpected {extension} error: {error}"
            );
        }
    }
}
