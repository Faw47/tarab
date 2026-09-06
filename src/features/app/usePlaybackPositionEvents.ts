import { type MutableRefObject, useRef } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { reportError } from '../../lib/report-error';
import { usePlayerStore } from '../../store/player-store';
import { isCurrentPlaybackGeneration } from './playback-generation';

interface PlaybackPositionEventPayload {
  generation: number;
  position: number;
}

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

  useTauriEvent<PlaybackPositionEventPayload>(
    'playback-position',
    (event) => {
      if (!isCurrentPlaybackGeneration(event.payload)) return;
      const pos = event.payload.position;
      if (!Number.isFinite(pos)) return;
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
    (error) =>
      reportError('Failed to setup playback position listener', {
        source: 'playback-position-events',
        error,
      }),
  );

  useTauriEvent<PlaybackPositionEventPayload>(
    'playback-seeked',
    (event) => {
      if (!isCurrentPlaybackGeneration(event.payload)) return;
      const pos = Math.max(0, event.payload.position);
      if (!Number.isFinite(pos)) return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      usePlayerStore.getState().setCurrentTime(pos);
      lastUiPositionRef.current = { time: now, pos };
      scheduleSessionSave(true);
    },
    [scheduleSessionSave],
    (error) =>
      reportError('Failed to setup playback seek listener', {
        source: 'playback-position-events',
        error,
      }),
  );
}
