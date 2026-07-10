import { type MutableRefObject, useRef } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { usePlayerStore } from '../../store/player-store';

export function usePlaybackPositionEvents({
  scheduleSessionSave,
  lastSavedPositionRef,
  lastSessionSaveRef,
}: {
  scheduleSessionSave: (immediate?: boolean) => void;
  lastSavedPositionRef: MutableRefObject<number>;
  lastSessionSaveRef: MutableRefObject<number>;
}) {
  const lastUiPositionRef = useRef<{ time: number; pos: number }>({ time: 0, pos: 0 });

  useTauriEvent<number>(
    'playback-position',
    (event) => {
      const pos = event.payload;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const last = lastUiPositionRef.current;
      const { setCurrentTime } = usePlayerStore.getState();

      if (now - last.time >= 250 || Math.abs(pos - last.pos) >= 0.25) {
        setCurrentTime(pos);
        lastUiPositionRef.current = { time: now, pos };
      }

      const lastSaved = lastSavedPositionRef.current;
      const timeSinceSave = Date.now() - lastSessionSaveRef.current;
      if (timeSinceSave >= 5000 || Math.abs(pos - lastSaved) >= 5) {
        scheduleSessionSave(false);
      }
    },
    [scheduleSessionSave],
    (error) => console.error('Failed to setup playback position listener:', error),
  );

  useTauriEvent<number>(
    'playback-seeked',
    (event) => {
      const pos = Math.max(0, event.payload);
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      usePlayerStore.getState().setCurrentTime(pos);
      lastUiPositionRef.current = { time: now, pos };
      scheduleSessionSave(true);
    },
    [scheduleSessionSave],
    (error) => console.error('Failed to setup playback seek listener:', error),
  );
}
