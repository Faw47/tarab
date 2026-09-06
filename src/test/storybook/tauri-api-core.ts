const audioDevices = [
  { id: 'system', name: 'System default' },
  { id: 'headphones', name: 'Studio headphones' },
  { id: 'speakers', name: 'Desk speakers' },
];

export const invoke = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  switch (command) {
    case 'list_audio_output_devices':
      return audioDevices as T;
    case 'set_audio_output_device':
      return {
        selection: {
          status: 'selected',
          deviceId: typeof args?.deviceId === 'string' ? args.deviceId : 'system',
        },
        gaplessCancellation: null,
      } as T;
    case 'seek_playback':
      return {
        status: 'applied',
        position: typeof args?.positionSecs === 'number' ? args.positionSecs : 0,
        gaplessCancellation: null,
      } as T;
    case 'set_audio_booster':
    case 'set_playback_speed':
    case 'plugin:log|log':
      return undefined as T;
    case 'get_cover_art':
      return null as T;
    case 'list_library_grants':
    case 'list_recoverable_trash_entries':
    case 'purge_trashed_files':
    case 'restore_trashed_files':
      return [] as T;
    case 'get_library_health':
      return {
        nativeGrants: [],
        cachedSources: [],
        unavailableSources: [],
        watcherState: 'inactive',
        repairActions: ['addFolder'],
      } as T;
    case 'remove_library_source':
      return {
        grantId: 'storybook-source',
        path: '/Music',
        removedTrackCount: 0,
        databaseCleanupCompleted: true,
        cleanupPending: false,
        cleanupError: null,
      } as T;
    case 'select_library_folder':
      return null as T;
    case 'db_get_tracks_paginated':
    case 'db_get_recently_added':
    case 'db_get_most_played':
    case 'db_get_all_track_ids':
    case 'db_get_tracks_by_ids':
    case 'get_smart_shuffle_queue':
      return [] as T;
    case 'db_get_album_aggregates':
    case 'db_get_artist_aggregates':
      return [] as T;
    case 'read_full_tags':
      return {
        title: 'Storybook track',
        artist: 'Storybook artist',
        album: 'Storybook album',
        albumArtist: 'Storybook artist',
        hasCoverArt: false,
        filePath: typeof args?.filePath === 'string' ? args.filePath : '',
        fileFormat: 'FLAC',
        durationSecs: 180,
      } as T;
    case 'db_get_tracks_cursor_page':
      return {
        status: 'ready',
        tracks: [],
        nextCursor: null,
        revision: 1,
        totalCount: 0,
      } as T;
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
