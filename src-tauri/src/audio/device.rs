use cpal::traits::{DeviceTrait, HostTrait};
use rodio::{OutputStream, OutputStreamHandle};
use serde::Serialize;
use std::collections::HashMap;

pub(super) const AUDIO_OUTPUT_UNAVAILABLE: &str = "Audio output is not available";
const SYSTEM_OUTPUT_DEVICE_ID: &str = "system";
const OUTPUT_DEVICE_ID_PREFIX: &str = "cpal-name-v1:";

pub(super) struct AudioOutputState<T> {
    output: Option<T>,
}

impl<T> AudioOutputState<T> {
    pub(super) fn unavailable() -> Self {
        Self { output: None }
    }

    pub(super) fn apply_open_result(&mut self, result: Result<T, String>) -> Result<(), String> {
        let output = result?;
        self.output = Some(output);
        Ok(())
    }

    pub(super) fn current(&self) -> Result<&T, &'static str> {
        self.output.as_ref().ok_or(AUDIO_OUTPUT_UNAVAILABLE)
    }

    pub(super) fn install(&mut self, output: T) {
        self.output = Some(output);
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudioOutputDeviceInfo {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AudioOutputFallbackReason {
    NotFound,
    AmbiguousLegacyName,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AudioOutputSelection {
    Selected {
        device_id: String,
    },
    Migrated {
        device_id: String,
    },
    Fallback {
        device_id: String,
        reason: AudioOutputFallbackReason,
    },
}

pub(super) struct OpenedAudioOutput {
    pub(super) output: (OutputStream, OutputStreamHandle),
    pub(super) selection: AudioOutputSelection,
}

struct OutputDeviceCandidate {
    device: cpal::Device,
    descriptor: OutputDeviceDescriptor,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OutputDeviceDescriptor {
    id: Option<String>,
    name: String,
}

#[derive(Debug, PartialEq, Eq)]
struct ResolvedOutputDevice {
    candidate_index: Option<usize>,
    selection: AudioOutputSelection,
}

fn output_device_id(name: &str) -> String {
    format!("{OUTPUT_DEVICE_ID_PREFIX}{}", hex::encode(name.as_bytes()))
}

fn describe_output_devices<'a>(
    names: impl IntoIterator<Item = &'a str>,
) -> Vec<OutputDeviceDescriptor> {
    let names = names.into_iter().map(str::to_string).collect::<Vec<_>>();
    let mut counts = HashMap::<String, usize>::new();
    for name in &names {
        *counts.entry(name.clone()).or_default() += 1;
    }
    names
        .into_iter()
        .map(|name| OutputDeviceDescriptor {
            id: (counts.get(&name).copied() == Some(1)).then(|| output_device_id(&name)),
            name,
        })
        .collect()
}

fn selectable_device_infos(descriptors: &[OutputDeviceDescriptor]) -> Vec<AudioOutputDeviceInfo> {
    descriptors
        .iter()
        .filter_map(|descriptor| {
            descriptor.id.as_ref().map(|id| AudioOutputDeviceInfo {
                id: id.clone(),
                name: descriptor.name.clone(),
            })
        })
        .collect()
}

fn enumerate_output_device_candidates() -> Result<Vec<OutputDeviceCandidate>, String> {
    let host = cpal::default_host();
    let devices = host
        .output_devices()
        .map_err(|error| format!("Failed to list output devices: {error}"))?;
    let mut named_devices = Vec::new();
    for device in devices {
        let name = match device.name() {
            Ok(name) => name,
            Err(error) => {
                eprintln!("Skipping audio device because its name is unavailable: {error}");
                continue;
            }
        };
        named_devices.push((device, name));
    }
    let descriptors = describe_output_devices(named_devices.iter().map(|(_, name)| name.as_str()));
    Ok(named_devices
        .into_iter()
        .zip(descriptors)
        .map(|((device, _), descriptor)| OutputDeviceCandidate { device, descriptor })
        .collect())
}

pub fn enumerate_output_devices() -> Result<Vec<AudioOutputDeviceInfo>, String> {
    let mut list = vec![AudioOutputDeviceInfo {
        id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
        name: "System default".to_string(),
    }];
    let candidates = enumerate_output_device_candidates()?;
    let descriptors = candidates
        .iter()
        .map(|candidate| candidate.descriptor.clone())
        .collect::<Vec<_>>();
    list.extend(selectable_device_infos(&descriptors));
    Ok(list)
}

fn resolve_output_device(
    requested_id: Option<&str>,
    devices: &[OutputDeviceDescriptor],
) -> ResolvedOutputDevice {
    let Some(requested_id) = requested_id.filter(|id| !id.is_empty()) else {
        return ResolvedOutputDevice {
            candidate_index: None,
            selection: AudioOutputSelection::Selected {
                device_id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
            },
        };
    };
    if requested_id == SYSTEM_OUTPUT_DEVICE_ID {
        return ResolvedOutputDevice {
            candidate_index: None,
            selection: AudioOutputSelection::Selected {
                device_id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
            },
        };
    }

    if let Some(candidate_index) = devices
        .iter()
        .position(|device| device.id.as_deref() == Some(requested_id))
    {
        return ResolvedOutputDevice {
            candidate_index: Some(candidate_index),
            selection: AudioOutputSelection::Selected {
                device_id: requested_id.to_string(),
            },
        };
    }

    let mut legacy_matches = devices
        .iter()
        .enumerate()
        .filter(|(_, device)| device.name == requested_id);
    let first = legacy_matches.next();
    let second = legacy_matches.next();
    match (first, second) {
        (Some((candidate_index, device)), None) => match device.id.as_ref() {
            Some(device_id) => ResolvedOutputDevice {
                candidate_index: Some(candidate_index),
                selection: AudioOutputSelection::Migrated {
                    device_id: device_id.clone(),
                },
            },
            None => ResolvedOutputDevice {
                candidate_index: None,
                selection: AudioOutputSelection::Fallback {
                    device_id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
                    reason: AudioOutputFallbackReason::AmbiguousLegacyName,
                },
            },
        },
        (Some(_), Some(_)) => ResolvedOutputDevice {
            candidate_index: None,
            selection: AudioOutputSelection::Fallback {
                device_id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
                reason: AudioOutputFallbackReason::AmbiguousLegacyName,
            },
        },
        _ => ResolvedOutputDevice {
            candidate_index: None,
            selection: AudioOutputSelection::Fallback {
                device_id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
                reason: AudioOutputFallbackReason::NotFound,
            },
        },
    }
}

pub(super) fn open_output_stream(device_id: Option<&str>) -> Result<OpenedAudioOutput, String> {
    if matches!(device_id, None | Some("") | Some(SYSTEM_OUTPUT_DEVICE_ID)) {
        let output = OutputStream::try_default()
            .map_err(|error| format!("Failed to open default audio output: {error}"))?;
        return Ok(OpenedAudioOutput {
            output,
            selection: AudioOutputSelection::Selected {
                device_id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
            },
        });
    }

    let candidates = enumerate_output_device_candidates()?;
    let descriptors = candidates
        .iter()
        .map(|candidate| candidate.descriptor.clone())
        .collect::<Vec<_>>();
    let resolved = resolve_output_device(device_id, &descriptors);

    if let Some(candidate_index) = resolved.candidate_index {
        let candidate = &candidates[candidate_index];
        match OutputStream::try_from_device(&candidate.device) {
            Ok(output) => {
                return Ok(OpenedAudioOutput {
                    output,
                    selection: resolved.selection,
                });
            }
            Err(error) => {
                eprintln!(
                    "Failed to open audio device \"{}\": {error}. Tarab will use the system default.",
                    candidate.descriptor.name
                );
                let output = OutputStream::try_default().map_err(|fallback_error| {
                    format!(
                        "Failed to open audio device \"{}\": {error}; failed to open default audio output: {fallback_error}",
                        candidate.descriptor.name
                    )
                })?;
                return Ok(OpenedAudioOutput {
                    output,
                    selection: AudioOutputSelection::Fallback {
                        device_id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
                        reason: AudioOutputFallbackReason::Unavailable,
                    },
                });
            }
        }
    }

    let output = OutputStream::try_default()
        .map_err(|error| format!("Failed to open default audio output: {error}"))?;
    Ok(OpenedAudioOutput {
        output,
        selection: resolved.selection,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_output_state_rejects_playback_then_recovers() {
        let mut state = AudioOutputState::<u8>::unavailable();

        let startup_error = state.apply_open_result(Err("no default output".to_string()));
        assert_eq!(startup_error, Err("no default output".to_string()));
        assert_eq!(state.current().copied(), Err(AUDIO_OUTPUT_UNAVAILABLE));

        state
            .apply_open_result(Ok(7))
            .expect("a later device open should recover output");
        assert_eq!(state.current().copied(), Ok(7));
    }

    #[test]
    fn failed_open_does_not_discard_available_output() {
        let mut state = AudioOutputState::<u8>::unavailable();
        state.install(7);

        assert!(state
            .apply_open_result(Err("replacement failed".to_string()))
            .is_err());
        assert_eq!(state.current().copied(), Ok(7));
    }

    #[test]
    fn duplicate_friendly_names_are_omitted_across_enumeration_reorders() {
        let first = describe_output_devices(["Speakers", "Headphones", "Speakers"]);
        let reordered = describe_output_devices(["Speakers", "Speakers", "Headphones"]);

        assert_eq!(
            selectable_device_infos(&first),
            vec![AudioOutputDeviceInfo {
                id: output_device_id("Headphones"),
                name: "Headphones".to_string(),
            }]
        );
        assert_eq!(
            selectable_device_infos(&reordered),
            selectable_device_infos(&first)
        );
        assert_eq!(
            resolve_output_device(Some("cpal-v1:537065616b657273:0"), &first).selection,
            AudioOutputSelection::Fallback {
                device_id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
                reason: AudioOutputFallbackReason::NotFound,
            }
        );
        assert_eq!(
            resolve_output_device(Some("cpal-v1:537065616b657273:1"), &reordered).selection,
            AudioOutputSelection::Fallback {
                device_id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
                reason: AudioOutputFallbackReason::NotFound,
            }
        );
    }

    #[test]
    fn legacy_names_migrate_only_when_the_match_is_unique() {
        let devices = describe_output_devices(["Speakers", "Speakers", "Headphones"]);

        assert_eq!(
            resolve_output_device(Some("Headphones"), &devices).selection,
            AudioOutputSelection::Migrated {
                device_id: output_device_id("Headphones"),
            }
        );
        assert_eq!(
            resolve_output_device(Some("Speakers"), &devices).selection,
            AudioOutputSelection::Fallback {
                device_id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
                reason: AudioOutputFallbackReason::AmbiguousLegacyName,
            }
        );
    }

    #[test]
    fn a_missing_enumerated_id_returns_a_typed_system_fallback() {
        let devices = describe_output_devices(["Speakers"]);

        assert_eq!(
            resolve_output_device(Some("cpal-name-v1:missing"), &devices).selection,
            AudioOutputSelection::Fallback {
                device_id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
                reason: AudioOutputFallbackReason::NotFound,
            }
        );
    }

    #[test]
    fn output_selection_serializes_with_the_frontend_contract() {
        let value = serde_json::to_value(AudioOutputSelection::Fallback {
            device_id: SYSTEM_OUTPUT_DEVICE_ID.to_string(),
            reason: AudioOutputFallbackReason::NotFound,
        })
        .expect("serialize output selection");

        assert_eq!(
            value,
            serde_json::json!({
                "status": "fallback",
                "deviceId": "system",
                "reason": "notFound"
            })
        );
    }
}
