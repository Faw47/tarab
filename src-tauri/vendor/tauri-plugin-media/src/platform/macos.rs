use crate::models::*;
use std::error::Error as StdError;

#[cfg(target_os = "macos")]
use std::ffi::CStr;
#[cfg(target_os = "macos")]
use cocoa::base::{id, nil};
#[cfg(target_os = "macos")]
use cocoa::foundation::{NSArray, NSDictionary, NSString};
#[cfg(target_os = "macos")]
use objc::{msg_send, rc::StrongPtr, runtime::Class, sel, sel_impl};

#[cfg(target_os = "macos")]
struct AutoreleasePoolGuard(*mut std::ffi::c_void);

#[cfg(target_os = "macos")]
impl AutoreleasePoolGuard {
    fn new() -> Self {
        Self(unsafe { objc::runtime::objc_autoreleasePoolPush() })
    }
}

#[cfg(target_os = "macos")]
impl Drop for AutoreleasePoolGuard {
    fn drop(&mut self) {
        unsafe { objc::runtime::objc_autoreleasePoolPop(self.0) };
    }
}

pub struct MacOSMediaController {
    event_handler: Option<Box<dyn Fn(MediaControlEvent) + Send>>,
    metadata: Option<MediaMetadata>,
    playback_info: Option<PlaybackInfo>,
}

impl MacOSMediaController {
    pub fn new() -> Self {
        MacOSMediaController {
            event_handler: None,
            metadata: None,
            playback_info: None,
        }
    }

    #[cfg(target_os = "macos")]
    fn get_info_center() -> Option<id> {
        unsafe {
            let Some(cls) = Class::get("MPNowPlayingInfoCenter") else {
                return None;
            };
            let center: id = msg_send![cls, defaultCenter];
            if center == nil {
                None
            } else {
                Some(center)
            }
        }
    }

    #[cfg(target_os = "macos")]
    fn get_command_center() -> Option<id> {
        unsafe {
            let Some(cls) = Class::get("MPRemoteCommandCenter") else {
                return None;
            };
            let center: id = msg_send![cls, sharedCommandCenter];
            if center == nil {
                None
            } else {
                Some(center)
            }
        }
    }

    #[cfg(target_os = "macos")]
    fn setup_command_handlers(&mut self) -> Result<(), Box<dyn StdError>> {
        unsafe {
            let _pool = AutoreleasePoolGuard::new();
            let Some(command_center) = Self::get_command_center() else {
                return Ok(());
            };

            // Play command
            let play_command: id = msg_send![command_center, playCommand];
            let _: () = msg_send![play_command, setEnabled: true];

            // Pause command
            let pause_command: id = msg_send![command_center, pauseCommand];
            let _: () = msg_send![pause_command, setEnabled: true];

            // Stop command
            let stop_command: id = msg_send![command_center, stopCommand];
            let _: () = msg_send![stop_command, setEnabled: true];

            // Next track command
            let next_command: id = msg_send![command_center, nextTrackCommand];
            let _: () = msg_send![next_command, setEnabled: true];

            // Previous track command
            let previous_command: id = msg_send![command_center, previousTrackCommand];
            let _: () = msg_send![previous_command, setEnabled: true];

            // Toggle play/pause command
            let toggle_command: id = msg_send![command_center, togglePlayPauseCommand];
            let _: () = msg_send![toggle_command, setEnabled: true];

            // Change playback position command
            let position_command: id = msg_send![command_center, changePlaybackPositionCommand];
            let _: () = msg_send![position_command, setEnabled: true];
        }

        Ok(())
    }

    #[cfg(target_os = "macos")]
    unsafe fn autoreleased_nsstring(value: &str) -> id {
        // NSString::init returns +1; hand that ownership to the current autorelease pool.
        let owned = unsafe { StrongPtr::new(NSString::alloc(nil).init_str(value)) };
        owned.autorelease()
    }

    #[cfg(target_os = "macos")]
    unsafe fn mutable_copy(object: id) -> Option<StrongPtr> {
        let copy: id = unsafe { msg_send![object, mutableCopy] };
        if copy == nil {
            None
        } else {
            Some(unsafe { StrongPtr::new(copy) })
        }
    }

    #[cfg(target_os = "macos")]
    unsafe fn update_now_playing_info(info_center: id, update: impl FnOnce(id)) {
        let current_info: id = unsafe { msg_send![info_center, nowPlayingInfo] };
        if current_info == nil {
            return;
        }

        let Some(mut_dict) = (unsafe { Self::mutable_copy(current_info) }) else {
            return;
        };
        update(*mut_dict);
        let _: () = unsafe { msg_send![info_center, setNowPlayingInfo: *mut_dict] };
    }

    #[cfg(target_os = "macos")]
    unsafe fn nsnumber_from_f64(value: f64) -> id {
        let Some(cls) = Class::get("NSNumber") else {
            return nil;
        };
        let number: id = msg_send![cls, numberWithDouble: value];
        number
    }
}

impl super::MediaController for MacOSMediaController {
    fn initialize_session(
        &mut self,
        _app_id: String,
        _app_name: String,
    ) -> Result<(), Box<dyn StdError>> {
        #[cfg(target_os = "macos")]
        {
            self.setup_command_handlers()?;
        }
        Ok(())
    }

    fn set_metadata(&mut self, metadata: MediaMetadata) -> Result<(), Box<dyn StdError>> {
        #[cfg(target_os = "macos")]
        {
            unsafe {
                let _pool = AutoreleasePoolGuard::new();
                let Some(info_center) = Self::get_info_center() else {
                    self.metadata = Some(metadata);
                    return Ok(());
                };
                let mut info = Vec::new();

                let title_key = Self::autoreleased_nsstring("MPMediaItemPropertyTitle");
                let title_value = Self::autoreleased_nsstring(&metadata.title);
                info.push((title_key, title_value));

                if let Some(artist) = &metadata.artist {
                    let artist_key = Self::autoreleased_nsstring("MPMediaItemPropertyArtist");
                    let artist_value = Self::autoreleased_nsstring(artist);
                    info.push((artist_key, artist_value));
                }

                if let Some(album) = &metadata.album {
                    let album_key = Self::autoreleased_nsstring("MPMediaItemPropertyAlbumTitle");
                    let album_value = Self::autoreleased_nsstring(album);
                    info.push((album_key, album_value));
                }

                if let Some(album_artist) = &metadata.album_artist {
                    let album_artist_key =
                        Self::autoreleased_nsstring("MPMediaItemPropertyAlbumArtist");
                    let album_artist_value = Self::autoreleased_nsstring(album_artist);
                    info.push((album_artist_key, album_artist_value));
                }

                if let Some(duration) = metadata.duration {
                    let duration_key =
                        Self::autoreleased_nsstring("MPMediaItemPropertyPlaybackDuration");
                    let duration_value = Self::nsnumber_from_f64(duration);
                    if duration_value != nil {
                        info.push((duration_key, duration_value));
                    }
                }

                if let Some(artwork_url) = &metadata.artwork_url {
                    let artwork_key =
                        Self::autoreleased_nsstring("MPMediaItemPropertyArtworkURL");
                    let artwork_value = Self::autoreleased_nsstring(artwork_url);
                    info.push((artwork_key, artwork_value));
                } else if let Some(artwork_data) = &metadata.artwork_data {
                    use std::fs;
                    let temp_dir = std::env::temp_dir();
                    let artwork_path = temp_dir.join("macos_artwork.jpg");

                    if fs::write(&artwork_path, artwork_data).is_ok() {
                        let file_url = format!("file://{}", artwork_path.display());
                        let artwork_key =
                            Self::autoreleased_nsstring("MPMediaItemPropertyArtworkURL");
                        let artwork_value = Self::autoreleased_nsstring(&file_url);
                        info.push((artwork_key, artwork_value));
                    }
                }

                let keys: Vec<id> = info.iter().map(|(key, _)| *key).collect();
                let values: Vec<id> = info.iter().map(|(_, value)| *value).collect();
                let dict = NSDictionary::dictionaryWithObjects_forKeys_(
                    nil,
                    NSArray::arrayWithObjects(nil, &values),
                    NSArray::arrayWithObjects(nil, &keys),
                );

                let _: () = msg_send![info_center, setNowPlayingInfo: dict];
            }

            self.metadata = Some(metadata);
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.metadata = Some(metadata);
        }
        Ok(())
    }

    fn set_playback_info(&mut self, info: PlaybackInfo) -> Result<(), Box<dyn StdError>> {
        #[cfg(target_os = "macos")]
        {
            unsafe {
                let _pool = AutoreleasePoolGuard::new();
                let Some(info_center) = Self::get_info_center() else {
                    self.playback_info = Some(info);
                    return Ok(());
                };

                Self::update_now_playing_info(info_center, |mut_dict| unsafe {
                    let position_key =
                        Self::autoreleased_nsstring("MPNowPlayingInfoPropertyElapsedPlaybackTime");
                    let position_value = Self::nsnumber_from_f64(info.position);
                    if position_value != nil {
                        let _: () =
                            msg_send![mut_dict, setObject: position_value forKey: position_key];
                    }

                    let rate_key =
                        Self::autoreleased_nsstring("MPNowPlayingInfoPropertyPlaybackRate");
                    let rate_value =
                        Self::nsnumber_from_f64(if info.status == PlaybackStatus::Playing {
                            info.playback_rate
                        } else {
                            0.0
                        });
                    if rate_value != nil {
                        let _: () = msg_send![mut_dict, setObject: rate_value forKey: rate_key];
                    }
                });
            }

            self.playback_info = Some(info);
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.playback_info = Some(info);
        }
        Ok(())
    }

    fn set_playback_status(&mut self, status: PlaybackStatus) -> Result<(), Box<dyn StdError>> {
        #[cfg(target_os = "macos")]
        {
            unsafe {
                let _pool = AutoreleasePoolGuard::new();
                let Some(info_center) = Self::get_info_center() else {
                    if let Some(mut info) = self.playback_info.clone() {
                        info.status = status;
                        self.playback_info = Some(info);
                    }
                    return Ok(());
                };

                Self::update_now_playing_info(info_center, |mut_dict| unsafe {
                    let rate_key =
                        Self::autoreleased_nsstring("MPNowPlayingInfoPropertyPlaybackRate");
                    let rate = if status == PlaybackStatus::Playing {
                        1.0
                    } else {
                        0.0
                    };
                    let rate_value = Self::nsnumber_from_f64(rate);
                    if rate_value != nil {
                        let _: () = msg_send![mut_dict, setObject: rate_value forKey: rate_key];
                    }
                });
            }

            if let Some(mut info) = self.playback_info.clone() {
                info.status = status;
                self.playback_info = Some(info);
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            if let Some(mut info) = self.playback_info.clone() {
                info.status = status;
                self.playback_info = Some(info);
            }
        }
        Ok(())
    }

    fn set_position(&mut self, position: f64) -> Result<(), Box<dyn StdError>> {
        #[cfg(target_os = "macos")]
        {
            unsafe {
                let _pool = AutoreleasePoolGuard::new();
                let Some(info_center) = Self::get_info_center() else {
                    if let Some(mut info) = self.playback_info.clone() {
                        info.position = position;
                        self.playback_info = Some(info);
                    }
                    return Ok(());
                };

                Self::update_now_playing_info(info_center, |mut_dict| unsafe {
                    let position_key =
                        Self::autoreleased_nsstring("MPNowPlayingInfoPropertyElapsedPlaybackTime");
                    let position_value = Self::nsnumber_from_f64(position);
                    if position_value != nil {
                        let _: () =
                            msg_send![mut_dict, setObject: position_value forKey: position_key];
                    }
                });
            }

            if let Some(mut info) = self.playback_info.clone() {
                info.position = position;
                self.playback_info = Some(info);
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            if let Some(mut info) = self.playback_info.clone() {
                info.position = position;
                self.playback_info = Some(info);
            }
        }
        Ok(())
    }

    fn clear_metadata(&mut self) -> Result<(), Box<dyn StdError>> {
        #[cfg(target_os = "macos")]
        {
            unsafe {
                let _pool = AutoreleasePoolGuard::new();
                if let Some(info_center) = Self::get_info_center() {
                    let _: () = msg_send![info_center, setNowPlayingInfo: nil];
                }
            }

            self.metadata = None;
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.metadata = None;
        }
        Ok(())
    }

    fn set_event_handler(&mut self, handler: Box<dyn Fn(MediaControlEvent) + Send>) {
        self.event_handler = Some(handler);
        // Note: Actual event handler setup would require more complex Objective-C runtime manipulation
        // This is a simplified version. In production, you'd need to create proper target-action pairs
    }

    fn get_metadata(&self) -> Result<Option<MediaMetadata>, Box<dyn StdError>> {
        #[cfg(target_os = "macos")]
        unsafe {
            let _pool = AutoreleasePoolGuard::new();
            // Get current now playing info from the system
            let Some(info_center) = Self::get_info_center() else {
                return Ok(self.metadata.clone());
            };
            let now_playing_info: id = msg_send![info_center, nowPlayingInfo];

            if now_playing_info != nil {
                // Extract metadata from NSDictionary
                let title_key = Self::autoreleased_nsstring("MPMediaItemPropertyTitle");
                let title: id = msg_send![now_playing_info, objectForKey: title_key];

                if title != nil {
                    let title_str = CStr::from_ptr(msg_send![title, UTF8String])
                        .to_string_lossy()
                        .into_owned();

                    let mut metadata = MediaMetadata {
                        title: title_str,
                        artist: None,
                        album: None,
                        album_artist: None,
                        duration: None,
                        artwork_url: None,
                        artwork_data: None,
                    };

                    // Get artist
                    let artist_key = Self::autoreleased_nsstring("MPMediaItemPropertyArtist");
                    let artist: id = msg_send![now_playing_info, objectForKey: artist_key];
                    if artist != nil {
                        metadata.artist = Some(
                            CStr::from_ptr(msg_send![artist, UTF8String])
                                .to_string_lossy()
                                .into_owned(),
                        );
                    }

                    // Get album
                    let album_key = Self::autoreleased_nsstring("MPMediaItemPropertyAlbumTitle");
                    let album: id = msg_send![now_playing_info, objectForKey: album_key];
                    if album != nil {
                        metadata.album = Some(
                            CStr::from_ptr(msg_send![album, UTF8String])
                                .to_string_lossy()
                                .into_owned(),
                        );
                    }

                    // Get artwork URL if available
                    let artwork_key =
                        Self::autoreleased_nsstring("MPMediaItemPropertyArtworkURL");
                    let artwork: id = msg_send![now_playing_info, objectForKey: artwork_key];
                    if artwork != nil {
                        metadata.artwork_url = Some(
                            CStr::from_ptr(msg_send![artwork, UTF8String])
                                .to_string_lossy()
                                .into_owned(),
                        );
                    }

                    // Get duration
                    let duration_key =
                        Self::autoreleased_nsstring("MPMediaItemPropertyPlaybackDuration");
                    let duration: id = msg_send![now_playing_info, objectForKey: duration_key];
                    if duration != nil {
                        let duration_val: f64 = msg_send![duration, doubleValue];
                        metadata.duration = Some(duration_val);
                    }

                    return Ok(Some(metadata));
                }
            }
        }

        // Fall back to our own metadata
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
        // On macOS, media controls are always available once initialized
        Ok(true)
    }
}
