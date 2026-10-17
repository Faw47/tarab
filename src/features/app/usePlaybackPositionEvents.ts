import { type MutableRefObject, useRef } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { usePlayerStore } from '../../store/player-store';
import { type ParsedPlaybackPosition, parsePlaybackPositionPayload } from './playback-events';
import { isCurrentPlaybackGeneration } from './playback-generation';

function acceptPosition(raw: unknown): ParsedPlaybackPosition | null {
  const parsed = parsePlaybackPositionPayload(raw);
  if (!parsed) return null;
  if (
    parsed.generation !== null &&
    !isCurrentPlaybackGeneration({ generation: parsed.generation })
  ) {
    return null;
  }
  return parsed;
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

  useTauriEvent<unknown>(
    'playback-position',
    (event) => {
      const parsed = acceptPosition(event.payload);
      if (!parsed) return;
      const pos = parsed.position;
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

  useTauriEvent<unknown>(
    'playback-seeked',
    (event) => {
      const parsed = acceptPosition(event.payload);
      if (!parsed) return;
      const pos = Math.max(0, parsed.position);
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      usePlayerStore.getState().setCurrentTime(pos);
      lastUiPositionRef.current = { time: now, pos };
      scheduleSessionSave(true);
    },
    [scheduleSessionSave],
    (error) => console.error('Failed to setup playback seek listener:', error),
  );
}
