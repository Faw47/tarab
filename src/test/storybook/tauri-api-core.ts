const audioDevices = [
  { id: 'system', name: 'System default' },
  { id: 'headphones', name: 'Studio headphones' },
  { id: 'speakers', name: 'Desk speakers' },
];

export const invoke = async <T>(command: string): Promise<T> => {
  switch (command) {
    case 'list_audio_output_devices':
      return audioDevices as T;
    case 'set_audio_output_device':
    case 'set_library_roots':
      return undefined as T;
    case 'db_get_tracks_paginated':
    case 'db_get_recently_added':
    case 'db_get_most_played':
      return [] as T;
    case 'db_get_track_count':
      return 0 as T;
    case 'db_get_library_stats':
      return {
        trackCount: 0,
        totalDuration: 0,
        artistCount: 0,
        albumCount: 0,
        totalPlays: 0,
      } as T;
    default:
      throw new Error(`Storybook mock missing Tauri command: ${command}`);
  }
};
