import { useEffect, useRef } from 'react';
import { reportError } from '../../lib/report-error';
import { setAudioOutputDevice, setCrossfadeDuration } from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';

export function usePlaybackSettingsSync() {
  const crossfadeSeconds = useSettingsStore((state) => state.crossfadeSeconds);
  const outputDevice = useSettingsStore((state) => state.outputDevice);
  const shuffleHistorySize = useSettingsStore((state) => state.shuffleHistorySize);
  const syncShuffleHistorySize = usePlayerStore((state) => state.setShuffleHistorySize);
  const hasSyncedCrossfadeRef = useRef(false);

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
    void setAudioOutputDevice(outputDevice).catch((err) =>
      console.error('Failed to set audio output device:', err),
    );
  }, [outputDevice]);

  useEffect(() => {
    syncShuffleHistorySize(shuffleHistorySize);
  }, [shuffleHistorySize, syncShuffleHistorySize]);
}
