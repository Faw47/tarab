use cpal::traits::{DeviceTrait, HostTrait};
use rodio::{OutputStream, OutputStreamHandle};
use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDeviceInfo {
    pub id: String,
    pub name: String,
}

pub fn enumerate_output_devices() -> Result<Vec<AudioOutputDeviceInfo>, String> {
    let host = cpal::default_host();
    let mut list = vec![AudioOutputDeviceInfo {
        id: "system".to_string(),
        name: "System default".to_string(),
    }];
    let devices = host
        .output_devices()
        .map_err(|error| format!("Failed to list output devices: {error}"))?;
    for device in devices {
        let name = match device.name() {
            Ok(name) => name,
            Err(_error) => {
                log::warn!("Skipping audio device because its name is unavailable");
                continue;
            }
        };
        list.push(AudioOutputDeviceInfo {
            id: name.clone(),
            name,
        });
    }
    Ok(list)
}

pub(super) fn open_output_stream(
    device_name: Option<&str>,
) -> Result<(OutputStream, OutputStreamHandle), String> {
    match device_name {
        None | Some("") | Some("system") => OutputStream::try_default()
            .map_err(|error| format!("Failed to open default audio output: {error}")),
        Some(name) => {
            let host = cpal::default_host();
            let devices = host
                .output_devices()
                .map_err(|error| format!("Failed to list output devices: {error}"))?;
            for device in devices {
                let device_name = match device.name() {
                    Ok(device_name) => device_name,
                    Err(_) => continue,
                };
                if device_name == name {
                    return OutputStream::try_from_device(&device).map_err(|error| {
                        format!("Failed to open audio device \"{name}\": {error}")
                    });
                }
            }
            log::warn!("Requested audio device was not found; using the system default");
            OutputStream::try_default()
                .map_err(|error| format!("Failed to open default audio output: {error}"))
        }
    }
}

/// Opens the output stream on demand when none is available yet.
///
/// The audio thread starts even when no output device exists (for example a docked laptop or a
/// Bluetooth headset that connects later). Play, crossfade and seek call this before using the
/// stream, so a device that appears after launch is picked up without restarting Tarab.
pub(super) fn ensure_output_stream<T>(
    slot: &mut Option<T>,
    open: impl FnOnce() -> Result<T, String>,
) -> Result<(), String> {
    if slot.is_none() {
        *slot = Some(open()?);
    }
    Ok(())
}

/// Name of the current system default output device, if the host reports one.
pub(super) fn default_output_device_name() -> Option<String> {
    cpal::default_host().default_output_device()?.name().ok()
}

/// No sample progress for this long while playing means the output device stopped pulling audio.
const OUTPUT_STALL_AFTER: Duration = Duration::from_secs(2);
const MAX_RECOVERY_BACKOFF: Duration = Duration::from_secs(30);
const DEFAULT_DEVICE_POLL_INTERVAL: Duration = Duration::from_secs(3);

/// Detects a lost output device (the sample counter stops while playing) and a changed system
/// default device, which an open stream does not follow.
pub(super) struct OutputWatch {
    last_samples: u64,
    progress_at: Instant,
    backoff: Duration,
    default_polled_at: Instant,
    default_name: Option<String>,
}

impl OutputWatch {
    pub(super) fn new(now: Instant) -> Self {
        Self {
            last_samples: 0,
            progress_at: now,
            backoff: OUTPUT_STALL_AFTER,
            default_polled_at: now,
            default_name: None,
        }
    }

    /// True when output should be advancing but `samples` has not changed for the stall period.
    /// Repeated stalls back off up to 30 s until samples move again.
    pub(super) fn observe_samples(&mut self, samples: u64, expecting: bool, now: Instant) -> bool {
        if samples != self.last_samples {
            self.last_samples = samples;
            self.progress_at = now;
            if expecting {
                self.backoff = OUTPUT_STALL_AFTER;
            }
            return false;
        }
        if !expecting {
            self.progress_at = now;
            return false;
        }
        if now.duration_since(self.progress_at) < self.backoff {
            return false;
        }
        self.progress_at = now;
        self.backoff = (self.backoff * 2).min(MAX_RECOVERY_BACKOFF);
        true
    }

    /// Restarts the stall clock after the audio thread was busy handling a command.
    pub(super) fn note_activity(&mut self, now: Instant) {
        self.progress_at = now;
    }

    /// A stream was just opened on the current default: the next poll records the baseline
    /// instead of reporting a change.
    pub(super) fn rebaseline_default(&mut self, now: Instant) {
        self.default_name = None;
        self.default_polled_at = now.checked_sub(DEFAULT_DEVICE_POLL_INTERVAL).unwrap_or(now);
    }

    /// Polls the system default device at most every few seconds; true when it changed since the
    /// previous poll.
    pub(super) fn default_device_changed(
        &mut self,
        now: Instant,
        probe: impl FnOnce() -> Option<String>,
    ) -> bool {
        if now.duration_since(self.default_polled_at) < DEFAULT_DEVICE_POLL_INTERVAL {
            return false;
        }
        self.default_polled_at = now;
        let Some(name) = probe() else {
            return false;
        };
        let changed = self
            .default_name
            .as_ref()
            .is_some_and(|previous| previous != &name);
        self.default_name = Some(name);
        changed
    }
}

#[cfg(test)]
mod output_watch_tests {
    use super::*;

    #[test]
    fn reports_a_stall_only_while_output_should_advance() {
        let start = Instant::now();
        let mut watch = OutputWatch::new(start);
        assert!(!watch.observe_samples(100, true, start));
        // Paused: no progress expected, never a stall.
        assert!(!watch.observe_samples(100, false, start + Duration::from_secs(10)));
        assert!(!watch.observe_samples(100, true, start + Duration::from_secs(11)));
        assert!(watch.observe_samples(100, true, start + Duration::from_secs(13)));
    }

    #[test]
    fn backs_off_repeated_stalls_until_samples_move() {
        let start = Instant::now();
        let mut watch = OutputWatch::new(start);
        assert!(!watch.observe_samples(5, true, start));
        assert!(watch.observe_samples(5, true, start + Duration::from_secs(2)));
        assert!(!watch.observe_samples(5, true, start + Duration::from_secs(5)));
        assert!(watch.observe_samples(5, true, start + Duration::from_secs(6)));
        assert!(!watch.observe_samples(9, true, start + Duration::from_secs(7)));
        assert!(watch.observe_samples(9, true, start + Duration::from_secs(9)));
    }

    #[test]
    fn a_reopened_stream_takes_the_current_default_as_its_baseline() {
        let start = Instant::now();
        let mut watch = OutputWatch::new(start);
        let poll = |seconds| start + Duration::from_secs(seconds);
        assert!(!watch.default_device_changed(poll(3), || Some("Speakers".to_string())));

        // The stream was reopened on new headphones: that is the baseline, not a change.
        watch.rebaseline_default(poll(4));
        assert!(!watch.default_device_changed(poll(4), || Some("Headphones".to_string())));
        assert!(!watch.default_device_changed(poll(7), || Some("Headphones".to_string())));
    }

    #[test]
    fn a_long_command_is_not_a_stall() {
        let start = Instant::now();
        let mut watch = OutputWatch::new(start);
        assert!(!watch.observe_samples(0, false, start));
        // A three-second decode before the first sample.
        watch.note_activity(start + Duration::from_secs(3));
        assert!(!watch.observe_samples(0, true, start + Duration::from_secs(3)));
        assert!(watch.observe_samples(0, true, start + Duration::from_secs(5)));
    }

    #[test]
    fn detects_a_changed_system_default_after_the_first_poll() {
        let start = Instant::now();
        let mut watch = OutputWatch::new(start);
        let poll = |seconds| start + Duration::from_secs(seconds);
        assert!(!watch.default_device_changed(poll(1), || panic!("polled too early")));
        assert!(!watch.default_device_changed(poll(3), || Some("Speakers".to_string())));
        assert!(!watch.default_device_changed(poll(6), || Some("Speakers".to_string())));
        assert!(!watch.default_device_changed(poll(9), || None));
        assert!(watch.default_device_changed(poll(12), || Some("Headphones".to_string())));
    }
}

#[cfg(test)]
mod ensure_output_stream_tests {
    use super::ensure_output_stream;

    #[test]
    fn opens_a_missing_stream_on_demand() {
        let mut slot: Option<u8> = None;
        assert!(ensure_output_stream(&mut slot, || Ok(1)).is_ok());
        assert_eq!(slot, Some(1));
    }

    #[test]
    fn keeps_an_existing_stream_without_reopening() {
        let mut slot = Some(1u8);
        let result = ensure_output_stream(&mut slot, || panic!("must not reopen"));
        assert!(result.is_ok());
        assert_eq!(slot, Some(1));
    }

    #[test]
    fn reports_failure_and_retries_on_the_next_call() {
        let mut slot: Option<u8> = None;
        let error = ensure_output_stream(&mut slot, || Err("no device".to_string()));
        assert_eq!(error, Err("no device".to_string()));
        assert_eq!(slot, None);
        assert!(ensure_output_stream(&mut slot, || Ok(2)).is_ok());
        assert_eq!(slot, Some(2));
    }
}
