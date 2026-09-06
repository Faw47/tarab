use crate::models::{
    MediaControlEvent, MediaControlEventType, MediaMetadata, PlaybackInfo, PlaybackStatus,
};
use souvlaki::{
    MediaControlEvent as NativeEvent, MediaControls, MediaMetadata as NativeMetadata,
    MediaPlayback, MediaPosition, PlatformConfig, SeekDirection,
};
use std::error::Error as StdError;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

type EventHandler = Arc<Mutex<Option<Box<dyn Fn(MediaControlEvent) + Send>>>>;
static ARTWORK_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);
const ARTWORK_CREATE_ATTEMPTS: usize = 128;

fn open_new_artwork_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);

    // create_new maps to O_CREAT|O_EXCL, so existing files and symlinks are not followed.
    options.open(path)
}

fn write_artwork_file(bytes: &[u8]) -> io::Result<PathBuf> {
    let temp_dir = std::env::temp_dir();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);

    for _ in 0..ARTWORK_CREATE_ATTEMPTS {
        let sequence = ARTWORK_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = temp_dir.join(format!(
            "tarab-media-artwork-{:x}-{timestamp:x}-{sequence:x}",
            std::process::id()
        ));
        let mut file = match open_new_artwork_file(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };

        if let Err(error) = file.write_all(bytes) {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        return Ok(path);
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a unique media artwork file",
    ))
}

pub struct SouvlakiMediaController {
    controls: Option<MediaControls>,
    event_handler: EventHandler,
    metadata: Option<MediaMetadata>,
    playback_info: Option<PlaybackInfo>,
    artwork_path: Option<PathBuf>,
}

impl SouvlakiMediaController {
    pub fn new() -> Self {
        Self {
            controls: None,
            event_handler: Arc::new(Mutex::new(None)),
            metadata: None,
            playback_info: None,
            artwork_path: None,
        }
    }

    fn controls_mut(&mut self) -> Result<&mut MediaControls, Box<dyn StdError>> {
        self.controls
            .as_mut()
            .ok_or_else(|| io::Error::other("media session is not initialized").into())
    }

    fn remove_artwork_file(&mut self) {
        if let Some(path) = self.artwork_path.take() {
            let _ = fs::remove_file(path);
        }
    }

    fn artwork_url(&mut self, metadata: &MediaMetadata) -> Option<String> {
        self.remove_artwork_file();
        if let Some(url) = metadata.artwork_url.clone() {
            return Some(url);
        }

        let bytes = metadata.artwork_data.as_ref()?;
        let path = write_artwork_file(bytes).ok()?;
        self.artwork_path = Some(path.clone());
        Some(format!("file://{}", path.display()))
    }

    fn apply_playback(
        &mut self,
        status: PlaybackStatus,
        position: f64,
    ) -> Result<(), Box<dyn StdError>> {
        let progress = Duration::try_from_secs_f64(position.max(0.0))
            .ok()
            .map(MediaPosition);
        let playback = match status {
            PlaybackStatus::Playing => MediaPlayback::Playing { progress },
            PlaybackStatus::Paused => MediaPlayback::Paused { progress },
            PlaybackStatus::Stopped => MediaPlayback::Stopped,
        };
        self.controls_mut()?
            .set_playback(playback)
            .map_err(native_error)
    }
}

impl Drop for SouvlakiMediaController {
    fn drop(&mut self) {
        self.remove_artwork_file();
    }
}

fn native_error(error: impl std::fmt::Debug) -> Box<dyn StdError> {
    io::Error::other(format!("{error:?}")).into()
}

fn unix_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn map_native_event(event: NativeEvent) -> Option<MediaControlEventType> {
    match event {
        NativeEvent::Play => Some(MediaControlEventType::Play),
        NativeEvent::Pause => Some(MediaControlEventType::Pause),
        NativeEvent::Toggle => Some(MediaControlEventType::PlayPause),
        NativeEvent::Next => Some(MediaControlEventType::Next),
        NativeEvent::Previous => Some(MediaControlEventType::Previous),
        NativeEvent::Stop => Some(MediaControlEventType::Stop),
        NativeEvent::Seek(SeekDirection::Forward)
        | NativeEvent::SeekBy(SeekDirection::Forward, _) => {
            Some(MediaControlEventType::FastForward)
        }
        NativeEvent::Seek(SeekDirection::Backward)
        | NativeEvent::SeekBy(SeekDirection::Backward, _) => Some(MediaControlEventType::Rewind),
        NativeEvent::SetPosition(MediaPosition(position)) => {
            Some(MediaControlEventType::SetPosition(position.as_secs_f64()))
        }
        NativeEvent::Raise => Some(MediaControlEventType::Raise),
        NativeEvent::Quit => Some(MediaControlEventType::Quit),
        NativeEvent::SetVolume(volume) => Some(MediaControlEventType::SetVolume(volume)),
        NativeEvent::OpenUri(_) => None,
    }
}

impl super::MediaController for SouvlakiMediaController {
    fn initialize_session(
        &mut self,
        app_id: String,
        app_name: String,
    ) -> Result<(), Box<dyn StdError>> {
        self.disable_session()?;
        #[cfg(target_os = "macos")]
        if objc::runtime::Class::get("MPRemoteCommandCenter").is_none()
            || objc::runtime::Class::get("MPNowPlayingInfoCenter").is_none()
        {
            return Err(io::Error::other("macOS media classes are unavailable").into());
        }
        let mut controls = MediaControls::new(PlatformConfig {
            dbus_name: &app_id,
            display_name: &app_name,
            hwnd: None,
        })
        .map_err(native_error)?;
        let event_handler = self.event_handler.clone();
        controls
            .attach(move |event| {
                let Some(event_type) = map_native_event(event) else {
                    return;
                };
                if let Ok(handler) = event_handler.lock() {
                    if let Some(handler) = handler.as_ref() {
                        handler(MediaControlEvent {
                            event_type,
                            timestamp: unix_timestamp_secs(),
                        });
                    }
                }
            })
            .map_err(native_error)?;
        self.controls = Some(controls);
        Ok(())
    }

    fn disable_session(&mut self) -> Result<(), Box<dyn StdError>> {
        let mut first_error = None;
        if let Some(mut controls) = self.controls.take() {
            if let Err(error) = controls.set_playback(MediaPlayback::Stopped) {
                first_error = Some(native_error(error));
            }
            if let Err(error) = controls.detach() {
                if first_error.is_none() {
                    first_error = Some(native_error(error));
                }
            }
        }
        self.remove_artwork_file();
        self.metadata = None;
        self.playback_info = None;
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    fn set_metadata(&mut self, metadata: MediaMetadata) -> Result<(), Box<dyn StdError>> {
        let artwork_url = self.artwork_url(&metadata);
        let duration = metadata
            .duration
            .filter(|duration| duration.is_finite() && *duration >= 0.0)
            .and_then(|duration| Duration::try_from_secs_f64(duration).ok());
        let result = match self.controls_mut() {
            Ok(controls) => controls.set_metadata(NativeMetadata {
                title: Some(&metadata.title),
                album: metadata.album.as_deref(),
                artist: metadata.artist.as_deref(),
                cover_url: artwork_url.as_deref(),
                duration,
            }),
            Err(error) => {
                self.remove_artwork_file();
                return Err(error);
            }
        };
        if let Err(error) = result {
            self.remove_artwork_file();
            return Err(native_error(error));
        }
        self.metadata = Some(metadata);
        Ok(())
    }

    fn set_playback_info(&mut self, info: PlaybackInfo) -> Result<(), Box<dyn StdError>> {
        self.apply_playback(info.status, info.position)?;
        self.playback_info = Some(info);
        Ok(())
    }

    fn set_playback_status(&mut self, status: PlaybackStatus) -> Result<(), Box<dyn StdError>> {
        let position = self
            .playback_info
            .as_ref()
            .map(|info| info.position)
            .unwrap_or(0.0);
        self.apply_playback(status, position)?;
        if let Some(info) = self.playback_info.as_mut() {
            info.status = status;
        }
        Ok(())
    }

    fn set_position(&mut self, position: f64) -> Result<(), Box<dyn StdError>> {
        let status = self
            .playback_info
            .as_ref()
            .map(|info| info.status)
            .unwrap_or(PlaybackStatus::Stopped);
        self.apply_playback(status, position)?;
        if let Some(info) = self.playback_info.as_mut() {
            info.position = position;
        }
        Ok(())
    }

    fn set_volume(&mut self, volume: f64) -> Result<(), Box<dyn StdError>> {
        #[cfg(target_os = "linux")]
        {
            return self
                .controls_mut()?
                .set_volume(volume.clamp(0.0, 1.0))
                .map_err(native_error);
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = volume;
            Ok(())
        }
    }

    fn clear_metadata(&mut self) -> Result<(), Box<dyn StdError>> {
        self.controls_mut()?
            .set_metadata(NativeMetadata::default())
            .map_err(native_error)?;
        self.remove_artwork_file();
        self.metadata = None;
        Ok(())
    }

    fn set_event_handler(&mut self, handler: Box<dyn Fn(MediaControlEvent) + Send>) {
        if let Ok(mut current) = self.event_handler.lock() {
            *current = Some(handler);
        }
    }

    fn get_metadata(&self) -> Result<Option<MediaMetadata>, Box<dyn StdError>> {
        Ok(self.metadata.clone())
    }

    fn get_playback_info(&self) -> Result<Option<PlaybackInfo>, Box<dyn StdError>> {
        Ok(self.playback_info.clone())
    }

    fn get_playback_status(&self) -> Result<PlaybackStatus, Box<dyn StdError>> {
        Ok(self
            .playback_info
            .as_ref()
            .map(|info| info.status)
            .unwrap_or(PlaybackStatus::Stopped))
    }

    fn get_position(&self) -> Result<f64, Box<dyn StdError>> {
        Ok(self
            .playback_info
            .as_ref()
            .map(|info| info.position)
            .unwrap_or(0.0))
    }

    fn is_enabled(&self) -> Result<bool, Box<dyn StdError>> {
        Ok(self.controls.is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata_with_artwork(bytes: &[u8]) -> MediaMetadata {
        MediaMetadata {
            title: "Test track".to_string(),
            artist: None,
            album: None,
            album_artist: None,
            duration: None,
            artwork_url: None,
            artwork_data: Some(bytes.to_vec()),
        }
    }

    #[test]
    fn maps_supported_native_controls() {
        let controller = SouvlakiMediaController::new();
        assert!(!super::super::MediaController::is_enabled(&controller).unwrap());
        assert!(matches!(
            map_native_event(NativeEvent::Toggle),
            Some(MediaControlEventType::PlayPause)
        ));
        assert!(matches!(
            map_native_event(NativeEvent::SetPosition(MediaPosition(Duration::from_secs(42)))),
            Some(MediaControlEventType::SetPosition(position)) if position == 42.0
        ));
        assert!(matches!(
            map_native_event(NativeEvent::SetVolume(0.5)),
            Some(MediaControlEventType::SetVolume(volume)) if volume == 0.5
        ));
    }

    #[test]
    fn artwork_files_are_unique_private_and_no_clobber() {
        let first = write_artwork_file(b"first").unwrap();
        let second = write_artwork_file(b"second").unwrap();

        assert_ne!(first, second);
        assert_eq!(fs::read(&first).unwrap(), b"first");
        assert_eq!(fs::read(&second).unwrap(), b"second");
        let error = open_new_artwork_file(&first).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&first).unwrap(), b"first");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&first).unwrap().permissions().mode() & 0o077,
                0
            );
        }

        fs::remove_file(first).unwrap();
        fs::remove_file(second).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn artwork_creation_does_not_follow_symlinks() {
        use std::os::unix::fs::symlink;

        let target = write_artwork_file(b"target").unwrap();
        let link = target.with_extension("symlink");
        symlink(&target, &link).unwrap();

        let error = open_new_artwork_file(&link).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&target).unwrap(), b"target");

        fs::remove_file(link).unwrap();
        fs::remove_file(target).unwrap();
    }

    #[test]
    fn artwork_replacement_and_drop_remove_owned_files() {
        let mut controller = SouvlakiMediaController::new();
        assert!(controller
            .artwork_url(&metadata_with_artwork(b"first"))
            .is_some());
        let first = controller.artwork_path.clone().unwrap();

        assert!(controller
            .artwork_url(&metadata_with_artwork(b"second"))
            .is_some());
        let second = controller.artwork_path.clone().unwrap();
        assert!(!first.exists());
        assert!(second.exists());

        drop(controller);
        assert!(!second.exists());
    }

    #[test]
    fn failed_metadata_update_removes_temporary_artwork() {
        let mut controller = SouvlakiMediaController::new();
        let result = super::super::MediaController::set_metadata(
            &mut controller,
            metadata_with_artwork(b"temporary"),
        );

        assert!(result.is_err());
        assert!(controller.artwork_path.is_none());
    }
}
