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
