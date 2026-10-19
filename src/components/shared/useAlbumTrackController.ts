import { type HTMLAttributes, useCallback, useEffect, useMemo, useRef } from 'react';
import { reportError } from '../../lib/report-error';
import type { Track } from '../../types';
import type { AlbumDetailsOverlayProps } from './AlbumDetailsOverlay';
import { moveTrackRowFocus, useTrackRowTabStop } from './album-track-rows';
import { useAlbumTrackLongPress } from './useAlbumTrackLongPress';
import { useAlbumTrackSelection } from './useAlbumTrackSelection';

type Options = Pick<
  AlbumDetailsOverlayProps,
  | 'tracks'
  | 'onPlayTrack'
  | 'onOpenTrackDetails'
  | 'onTrackContextMenu'
  | 'onTrackSelect'
  | 'onClearSelection'
  | 'onSelectAll'
> & { selectedTrackIds: string[] };

/** Shared interaction policy; the parent still owns selection and playback. */
export function useAlbumTrackController(options: Options) {
  const { tracks, onPlayTrack, onOpenTrackDetails, onTrackContextMenu, onTrackSelect } = options;
  const selection = useAlbumTrackSelection(options);
  const { activateSelection, selectionActive } = selection;
  const heldTrackId = useRef<string | null>(null);
  const longPress = useAlbumTrackLongPress(tracks, (track) => {
    heldTrackId.current = track.id;
    activateSelection();
    onTrackSelect?.(track, false);
  });
  useEffect(() => {
    heldTrackId.current = null;
  }, [tracks]);
  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);
  const { tabStopId, onRowFocus } = useTrackRowTabStop(trackIds);

  const activateTrack = useCallback(
    async (track: Track) => {
      try {
        await onPlayTrack?.(track);
      } catch (error) {
        reportError('Could not play the track', { source: 'album-details-overlay', error });
      }
    },
    [onPlayTrack],
  );

  const rowProps = (track: Track): HTMLAttributes<HTMLDivElement> => ({
    tabIndex: tabStopId === track.id ? 0 : -1,
    onFocus: () => onRowFocus(track.id),
    // A new physical gesture starts with pointerdown. Compatibility mouse
    // events after a touch hold do not, so they must keep the click suppressed.
    onPointerDown: () => {
      heldTrackId.current = null;
    },
    onClick: (event) => {
      if (heldTrackId.current === track.id) {
        heldTrackId.current = null;
        return;
      }
      if (selectionActive || event.shiftKey || event.metaKey || event.ctrlKey) {
        onTrackSelect?.(track, true);
      } else if (onOpenTrackDetails) {
        onOpenTrackDetails(track, () => activateTrack(track));
      } else {
        onTrackSelect?.(track, false);
      }
    },
    onDoubleClick: (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('button, a, input, select, textarea')
      )
        return;
      event.stopPropagation();
      void activateTrack(track);
    },
    onKeyDown: (event) => {
      if (event.target !== event.currentTarget) return;
      if (moveTrackRowFocus(event)) return;
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
      event.preventDefault();
      heldTrackId.current = null;
      if (event.key !== 'Enter' && selectionActive) onTrackSelect?.(track, true);
      else void activateTrack(track);
    },
    onMouseDown: (event) => {
      if (heldTrackId.current === track.id) return;
      longPress.startLongPress(track, event);
    },
    onMouseUp: longPress.cancelLongPress,
    onMouseLeave: longPress.cancelLongPress,
    onTouchStart: (event) => {
      heldTrackId.current = null;
      longPress.startLongPress(track, event);
    },
    onTouchEnd: longPress.cancelLongPress,
    onTouchMove: longPress.cancelLongPress,
    onTouchCancel: longPress.cancelLongPress,
    onContextMenu: (event) => {
      longPress.cancelLongPress();
      event.preventDefault();
      onTrackContextMenu?.(event, track);
    },
  });

  return { ...selection, tabStopId, rowProps, activateTrack };
}

export type AlbumTrackController = ReturnType<typeof useAlbumTrackController>;
