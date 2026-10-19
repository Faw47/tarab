import type { MouseEvent, TouchEvent } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import type { Track } from '../../types';

type PressEvent = MouseEvent<HTMLElement> | TouchEvent<HTMLElement>;

/** One pending row hold per album, shared by both presentational skins. */
export function useAlbumTrackLongPress(tracks: Track[], onHold: (track: Track) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestOnHold = useRef(onHold);
  latestOnHold.current = onHold;

  const cancelLongPress = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const startLongPress = useCallback(
    (track: Track, event: PressEvent) => {
      cancelLongPress();
      if ('button' in event && event.button !== 0) return;
      if (
        event.target instanceof Element &&
        event.target.closest('button, a, input, select, textarea, [role="button"], [role="link"]')
      ) {
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        latestOnHold.current(track);
      }, 500);
    },
    [cancelLongPress],
  );

  // An album replacement must not select an item from the old track list.
  useEffect(() => cancelLongPress, [cancelLongPress, tracks]);

  return { startLongPress, cancelLongPress };
}
