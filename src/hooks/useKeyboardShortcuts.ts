import { useEffect, useRef } from 'react';
import { playAdjacentTrack, toggleCurrentPlayback } from '../lib/playback-actions';
import { reportError } from '../lib/report-error';
import { setVolume as setAudioVolume } from '../lib/tauri-commands';
import { usePlayerStore } from '../store/player-store';
import type { ContextMenuPosition, Track } from '../types';

interface UseKeyboardShortcutsParams {
  setContextMenuPosition: (pos: ContextMenuPosition | null) => void;
  setTagEditorTracks: (tracks: Track[] | null) => void;
  setShowFullPlayer: (show: boolean) => void;
  setSelectedTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  contextMenuPosition: ContextMenuPosition | null;
  tagEditorTracks: Track[] | null;
  showFullPlayer: boolean;
  selectedTracks: Track[];
}

const INTERACTIVE_TARGET_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
].join(',');

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest(INTERACTIVE_TARGET_SELECTOR) !== null;
};

export const useKeyboardShortcuts = ({
  setContextMenuPosition,
  setTagEditorTracks,
  setShowFullPlayer,
  setSelectedTracks,
  contextMenuPosition,
  tagEditorTracks,
  showFullPlayer,
  selectedTracks,
}: UseKeyboardShortcutsParams) => {
  const preMuteVolumeRef = useRef<number>(0.8);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.defaultPrevented || isInteractiveTarget(e.target)) {
        return;
      }

      switch (e.code) {
        case 'Space': {
          e.preventDefault();
          const state = usePlayerStore.getState();
          const { currentTrack: track } = state;
          if (track) {
            try {
              await toggleCurrentPlayback();
            } catch (error) {
              reportError('Playback toggle failed', { source: 'app', error });
            }
          }
          break;
        }

        case 'ArrowRight':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            try {
              await playAdjacentTrack('next');
            } catch (error) {
              reportError('Failed to play next track', { source: 'app', error });
            }
          }
          break;

        case 'ArrowLeft':
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            try {
              await playAdjacentTrack('previous');
            } catch (error) {
              reportError('Failed to play previous track', { source: 'app', error });
            }
          }
          break;

        case 'ArrowUp': {
          const target = e.target instanceof HTMLElement ? e.target : null;
          const inScrollable =
            target?.closest('[data-scrollable]') ||
            target?.closest('.overflow-auto') ||
            target?.closest('.overflow-y-auto');
          if (inScrollable) break;
          e.preventDefault();
          const state = usePlayerStore.getState();
          const newVolumeUp = Math.min(1, state.volume + 0.1);
          state.setVolume(newVolumeUp);
          try {
            await setAudioVolume(newVolumeUp);
          } catch (error) {
            reportError('Failed to increase volume', { source: 'app', error });
          }
          break;
        }

        case 'ArrowDown': {
          const target = e.target instanceof HTMLElement ? e.target : null;
          const inScrollable =
            target?.closest('[data-scrollable]') ||
            target?.closest('.overflow-auto') ||
            target?.closest('.overflow-y-auto');
          if (inScrollable) break;
          e.preventDefault();
          const state = usePlayerStore.getState();
          const newVolumeDown = Math.max(0, state.volume - 0.1);
          state.setVolume(newVolumeDown);
          try {
            await setAudioVolume(newVolumeDown);
          } catch (error) {
            reportError('Failed to decrease volume', { source: 'app', error });
          }
          break;
        }

        case 'KeyM': {
          e.preventDefault();
          const state = usePlayerStore.getState();
          if (state.volume > 0) {
            preMuteVolumeRef.current = state.volume;
            state.setVolume(0);
            try {
              await setAudioVolume(0);
            } catch (error) {
              reportError('Failed to mute volume', { source: 'app', error });
            }
          } else {
            const restoreVolume = preMuteVolumeRef.current || 0.8;
            state.setVolume(restoreVolume);
            try {
              await setAudioVolume(restoreVolume);
            } catch (error) {
              reportError('Failed to restore volume', { source: 'app', error });
            }
          }
          break;
        }

        case 'KeyF': {
          e.preventDefault();
          const state = usePlayerStore.getState();
          if (state.currentTrack) {
            setShowFullPlayer(!showFullPlayer);
          }
          break;
        }

        case 'Escape':
          if (contextMenuPosition) {
            setContextMenuPosition(null);
          } else if (tagEditorTracks) {
            setTagEditorTracks(null);
          } else if (showFullPlayer) {
            setShowFullPlayer(false);
          } else if (selectedTracks.length > 0) {
            setSelectedTracks([]);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    setContextMenuPosition,
    setTagEditorTracks,
    setShowFullPlayer,
    setSelectedTracks,
    contextMenuPosition,
    tagEditorTracks,
    showFullPlayer,
    selectedTracks,
  ]);
};
