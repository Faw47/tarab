import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelGaplessPreload,
  dbGetAllTrackIds,
  dbGetTracksCursorPage,
  desktopMiniControl,
  desktopMiniRequestSnapshot,
  desktopMiniSeek,
  generateCoverArtHashes,
  getTrackMetadata,
  listRecoverableTrashEntries,
  pickCoverArt,
  playTrack,
  preloadNextTrack,
  purgeTrashedFiles,
  removeLibrarySource,
  resolveLaunchFileIntent,
  revealPlaylistsDataFolder,
  revokeLaunchFileAuthority,
  seekPlayback,
  setAudioOutputDevice,
  setVolumeRamp,
} from '../tauri-commands';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async (): Promise<unknown> => undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('../performance', () => ({
  Perf: {
    measureIPC: (cmd: string, args: unknown, invoke: (cmd: string, args?: unknown) => unknown) =>
      invoke(cmd, args),
  },
}));

describe('tauri command wrappers', () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it('uses Tauri camelCase argument names for set_volume_ramp', async () => {
    await setVolumeRamp(0.1, 0.8, 124.6);

    expect(invokeMock).toHaveBeenCalledWith('set_volume_ramp', {
      from: 0.1,
      to: 0.8,
      durationMs: 125,
    });
  });

  it('uses the ID-only library command for large-library shuffle planning', async () => {
    invokeMock.mockResolvedValueOnce(['track-a', 'track-b']);

    await expect(dbGetAllTrackIds()).resolves.toEqual(['track-a', 'track-b']);
    expect(invokeMock).toHaveBeenCalledWith('db_get_all_track_ids', undefined);
  });

  it('sends the typed library cursor contract unchanged', async () => {
    const cursor = {
      revision: 7,
      lastId: 'C:/Music/a.flac',
      sortBy: 'dateAdded',
      sortOrder: 'desc',
    };

    await dbGetTracksCursorPage(cursor, 300, 'dateAdded', 'desc');

    expect(invokeMock).toHaveBeenCalledWith('db_get_tracks_cursor_page', {
      cursor,
      limit: 300,
      sortBy: 'dateAdded',
      sortOrder: 'desc',
    });
  });

  it('sends the full opaque identity when cancelling a gapless preload', async () => {
    const preload = {
      preloadId: 'gapless-0000000000000001',
      generation: 7,
      path: '/music/next.flac',
    };

    await preloadNextTrack(preload.path);
    await cancelGaplessPreload(preload);

    expect(invokeMock.mock.calls).toEqual([
      ['preload_next_track', { filePath: preload.path }],
      ['cancel_gapless_preload', { preload }],
    ]);
  });

  it('carries Play Once authority only through metadata and the playback attempt', async () => {
    await resolveLaunchFileIntent('intent-1', 'playOnce');
    await getTrackMetadata('/outside/song.mp3', 'authority-1');
    await playTrack('/outside/song.mp3', undefined, 'authority-1');
    await revokeLaunchFileAuthority('authority-1');

    expect(invokeMock.mock.calls).toEqual([
      ['resolve_launch_file_intent', { intentId: 'intent-1', action: 'playOnce' }],
      ['get_track_metadata', { filePath: '/outside/song.mp3', authorityId: 'authority-1' }],
      [
        'play_track',
        { filePath: '/outside/song.mp3', startPos: undefined, authorityId: 'authority-1' },
      ],
      ['revoke_launch_file_authority', { authorityId: 'authority-1' }],
    ]);
  });

  it('returns the typed output-device reconciliation contract unchanged', async () => {
    invokeMock.mockResolvedValueOnce({
      selection: {
        status: 'fallback',
        deviceId: 'system',
        reason: 'notFound',
      },
      gaplessCancellation: null,
    });

    await expect(setAudioOutputDevice('cpal-v1:missing:0')).resolves.toEqual({
      selection: {
        status: 'fallback',
        deviceId: 'system',
        reason: 'notFound',
      },
      gaplessCancellation: null,
    });
    expect(invokeMock).toHaveBeenCalledWith('set_audio_output_device', {
      deviceId: 'cpal-v1:missing:0',
    });
  });

  it('binds seek IPC to the expected native generation and source path', async () => {
    const expectedSource = { generation: 9, path: '/music/current.flac' };
    invokeMock.mockResolvedValueOnce({
      status: 'stale',
      expectedSource,
      activeSource: { generation: 10, path: '/music/next.flac' },
      gaplessCancellation: null,
    });

    await seekPlayback(18.5, expectedSource);

    expect(invokeMock).toHaveBeenCalledWith('seek_playback', {
      positionSecs: 18.5,
      expectedSource,
    });
  });

  it('maps mini-player intents only to the typed native bridge commands', async () => {
    await desktopMiniControl('toggle-play');
    await desktopMiniSeek({ positionSecs: 42.5, sourceId: 'source-a' });
    await desktopMiniRequestSnapshot();

    expect(invokeMock.mock.calls).toEqual([
      ['desktop_mini_control', { action: 'toggle-play' }],
      ['desktop_mini_seek', { payload: { positionSecs: 42.5, sourceId: 'source-a' } }],
      ['desktop_mini_request_snapshot', undefined],
    ]);
  });

  it('routes source removal through the atomic native command', async () => {
    await removeLibrarySource('grant-root');

    expect(invokeMock).toHaveBeenCalledWith('remove_library_source', {
      grantId: 'grant-root',
    });
  });

  it('lists and purges persistent recoverable Trash tokens', async () => {
    await listRecoverableTrashEntries();
    await purgeTrashedFiles(['0123456789abcdef0123456789abcdef']);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_recoverable_trash_entries', undefined);
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'purge_trashed_files', {
      undoTokens: ['0123456789abcdef0123456789abcdef'],
    });
  });

  it('sends an explicit force flag when artwork must be re-read', async () => {
    invokeMock.mockResolvedValueOnce([['/music/song.mp3', ['new-hash', null]]]);

    await expect(generateCoverArtHashes(['/music/song.mp3'], true)).resolves.toEqual([
      ['/music/song.mp3', 'new-hash'],
    ]);
    expect(invokeMock).toHaveBeenCalledWith('generate_cover_art_hashes', {
      filePaths: ['/music/song.mp3'],
      force: true,
    });
  });

  it('keeps artwork selection and playlist reveal pathless in renderer IPC', async () => {
    await pickCoverArt();
    await revealPlaylistsDataFolder();

    expect(invokeMock.mock.calls).toEqual([
      ['pick_cover_art', undefined],
      ['reveal_playlists_data_folder', undefined],
    ]);
  });
});
