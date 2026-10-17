use cpal::traits::{DeviceTrait, HostTrait};
use rodio::{OutputStream, OutputStreamHandle};
use serde::Serialize;

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
            Err(error) => {
                eprintln!("Skipping audio device because its name is unavailable: {error}");
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
            eprintln!("Audio device \"{name}\" was not found. Tarab will use the system default.");
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
