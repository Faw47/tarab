import { useHotkeys } from 'react-hotkeys-hook';
import { playAdjacentTrack, toggleCurrentPlayback } from '../../lib/playback-actions';

export function HotkeysBootstrap() {
  // Global Player Shortcuts
  useHotkeys(
    'space',
    (e) => {
      e.preventDefault();
      void toggleCurrentPlayback();
    },
    {
      enabled: true,
      scopes: ['global'],
      preventDefault: true,
    },
  );

  useHotkeys(
    'shift+right',
    (e) => {
      e.preventDefault();
      void playAdjacentTrack('next');
    },
    {
      scopes: ['global'],
    },
  );

  useHotkeys(
    'shift+left',
    (e) => {
      e.preventDefault();
      void playAdjacentTrack('previous');
    },
    {
      scopes: ['global'],
    },
  );

  // Example Global Navigation
  useHotkeys(
    'mod+,',
    (e) => {
      e.preventDefault();
      // Logic to open settings if we had a global router/view state
      console.log('Open settings');
    },
    {
      scopes: ['global'],
    },
  );

  return null;
}
