import { useEffect, useRef } from 'react';
import { switchAudioOutputDevice } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { setCrossfadeDuration } from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';

const OUTPUT_DEVICE_RETRY_DELAYS_MS = [100, 400] as const;
const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

export function usePlaybackSettingsSync() {
  const crossfadeSeconds = useSettingsStore((state) => state.crossfadeSeconds);
  const outputDevice = useSettingsStore((state) => state.outputDevice);
  const shuffleHistorySize = useSettingsStore((state) => state.shuffleHistorySize);
  const syncShuffleHistorySize = usePlayerStore((state) => state.setShuffleHistorySize);
  const hasSyncedCrossfadeRef = useRef(false);
  const appliedOutputDeviceRef = useRef<string | null>(null);

  useEffect(() => {
    const syncCrossfade = async () => {
      try {
        await setCrossfadeDuration(crossfadeSeconds);
      } catch (err) {
        if (hasSyncedCrossfadeRef.current) {
          reportError('Failed to apply crossfade duration', {
            source: 'playback-settings',
            error: err,
          });
        } else {
          console.error('Failed to sync crossfade duration:', err);
        }
      } finally {
        hasSyncedCrossfadeRef.current = true;
      }
    };
    void syncCrossfade();
  }, [crossfadeSeconds]);

  useEffect(() => {
    if (appliedOutputDeviceRef.current === outputDevice) return;
    let active = true;

    const applyOutputDevice = async () => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= OUTPUT_DEVICE_RETRY_DELAYS_MS.length; attempt += 1) {
        if (!active) return;
        try {
          const selection = await switchAudioOutputDevice(outputDevice);
          if (!active) return;
          appliedOutputDeviceRef.current = selection.deviceId;
          if (selection.deviceId === outputDevice) return;
          const settings = useSettingsStore.getState();
          if (settings.outputDevice === outputDevice) {
            settings.setOutputDevice(selection.deviceId);
          }
          return;
        } catch (err) {
          lastError = err;
          if (attempt < OUTPUT_DEVICE_RETRY_DELAYS_MS.length) {
            await sleep(OUTPUT_DEVICE_RETRY_DELAYS_MS[attempt]!);
          }
        }
      }

      if (!active) return;
      appliedOutputDeviceRef.current = null;
      reportError('Failed to apply audio output device', {
        source: 'playback-settings',
        error: lastError,
      });
    };

    void applyOutputDevice();
    return () => {
      active = false;
    };
  }, [outputDevice]);

  useEffect(() => {
    syncShuffleHistorySize(shuffleHistorySize);
  }, [shuffleHistorySize, syncShuffleHistorySize]);
}
