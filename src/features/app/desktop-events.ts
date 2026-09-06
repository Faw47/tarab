export const MAIN_WINDOW_LABEL = 'main' as const;
export const MINI_WINDOW_LABEL = 'mini-player' as const;

export const EVENT_DESKTOP_CONTROL_ACTION = 'desktop-control-action' as const;
export const EVENT_DESKTOP_NATIVE_SEEK_TO = 'desktop-native-seek-to' as const;
export const EVENT_DESKTOP_NATIVE_VOLUME = 'desktop-native-volume' as const;
export const EVENT_DESKTOP_SEEK = 'desktop-seek' as const;
export const EVENT_DESKTOP_SNAPSHOT_REQUEST = 'desktop-snapshot-request' as const;
export const EVENT_DESKTOP_PLAYBACK_SNAPSHOT = 'desktop-playback-snapshot' as const;

export type {
  DesktopMiniControlAction,
  DesktopMiniSeekPayload,
  DesktopPlaybackSnapshot,
  DesktopPlaybackTrackSnapshot,
} from '../../types';
