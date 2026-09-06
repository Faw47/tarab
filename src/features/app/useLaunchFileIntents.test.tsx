import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaunchFileIntents } from './useLaunchFileIntents';

const {
  getTrackMetadataMock,
  listLaunchFileIntentsMock,
  listLibraryGrantsMock,
  listenMock,
  reportErrorMock,
  resolveLaunchFileIntentMock,
  revokeLaunchFileAuthorityMock,
  startPlaybackMock,
} = vi.hoisted(() => ({
  getTrackMetadataMock: vi.fn(),
  listLaunchFileIntentsMock: vi.fn(),
  listLibraryGrantsMock: vi.fn(),
  listenMock: vi.fn(),
  reportErrorMock: vi.fn(),
  resolveLaunchFileIntentMock: vi.fn(),
  revokeLaunchFileAuthorityMock: vi.fn(),
  startPlaybackMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('../../lib/playback-actions', () => ({ startPlayback: startPlaybackMock }));
vi.mock('../../lib/report-error', () => ({ reportError: reportErrorMock }));
vi.mock('../../lib/tauri-commands', () => ({
  getTrackMetadata: getTrackMetadataMock,
  listLaunchFileIntents: listLaunchFileIntentsMock,
  listLibraryGrants: listLibraryGrantsMock,
  resolveLaunchFileIntent: resolveLaunchFileIntentMock,
  revokeLaunchFileAuthority: revokeLaunchFileAuthorityMock,
}));

const firstIntent = { id: 'first', displayName: 'first.mp3', folderName: 'Music' };
const secondIntent = { id: 'second', displayName: 'second.mp3', folderName: 'Music' };
const metadata = {
  file_path: '/outside/first.mp3',
  title: 'First',
  artist: 'Artist',
  album_artist: null,
  album: 'Album',
  year: null,
  track_number: null,
  disc_number: null,
  duration_secs: 120,
  has_cover_art: false,
  file_format: 'MP3',
  bitrate: null,
  sample_rate: null,
  file_size: 100,
};

describe('useLaunchFileIntents', () => {
  let emitIntent: ((event: { payload: typeof firstIntent }) => void) | undefined;

  beforeEach(() => {
    emitIntent = undefined;
    getTrackMetadataMock.mockReset();
    listLaunchFileIntentsMock.mockReset().mockResolvedValue([]);
    listLibraryGrantsMock.mockReset().mockResolvedValue([]);
    listenMock
      .mockReset()
      .mockImplementation(
        async (_eventName: string, handler: (event: { payload: typeof firstIntent }) => void) => {
          emitIntent = handler;
          return vi.fn();
        },
      );
    reportErrorMock.mockReset();
    resolveLaunchFileIntentMock.mockReset();
    revokeLaunchFileAuthorityMock.mockReset().mockResolvedValue(undefined);
    startPlaybackMock.mockReset();
  });

  it('subscribes before listing and merges an event received during the list', async () => {
    let finishList: ((items: (typeof firstIntent)[]) => void) | undefined;
    listLaunchFileIntentsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishList = resolve;
        }),
    );
    resolveLaunchFileIntentMock.mockResolvedValue(null);
    const hook = renderHook(() =>
      useLaunchFileIntents({ scanFolder: vi.fn(), setLibraryFolders: vi.fn() }),
    );

    await waitFor(() => expect(emitIntent).toBeDefined());
    act(() => emitIntent?.({ payload: secondIntent }));
    finishList?.([firstIntent]);

    await waitFor(() => expect(hook.result.current?.message).toContain('first.mp3'));
    await act(async () => hook.result.current?.onCancel());
    await waitFor(() => expect(hook.result.current?.message).toContain('second.mp3'));
    expect(listenMock.mock.invocationCallOrder[0]).toBeLessThan(
      listLaunchFileIntentsMock.mock.invocationCallOrder[0],
    );
  });

  it('keeps and relists an intent when native resolution fails', async () => {
    listLaunchFileIntentsMock.mockResolvedValue([firstIntent]);
    resolveLaunchFileIntentMock.mockRejectedValueOnce(new Error('grant failed'));
    const hook = renderHook(() =>
      useLaunchFileIntents({ scanFolder: vi.fn(), setLibraryFolders: vi.fn() }),
    );

    await waitFor(() => expect(hook.result.current?.message).toContain('first.mp3'));
    await act(async () => hook.result.current?.onConfirm());

    await waitFor(() => expect(resolveLaunchFileIntentMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current?.busy).toBe(false));
    expect(hook.result.current?.message).toContain('first.mp3');
    expect(listLaunchFileIntentsMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the confirmation busy until native Play Once resolution finishes', async () => {
    listLaunchFileIntentsMock.mockResolvedValue([firstIntent]);
    let finishResolution!: (value: null) => void;
    resolveLaunchFileIntentMock.mockReturnValue(
      new Promise<null>((resolve) => {
        finishResolution = resolve;
      }),
    );

    const hook = renderHook(() =>
      useLaunchFileIntents({ scanFolder: vi.fn(), setLibraryFolders: vi.fn() }),
    );

    await waitFor(() => expect(hook.result.current?.message).toContain('first.mp3'));

    let confirmation!: Promise<void>;
    act(() => {
      confirmation = hook.result.current?.onConfirm() as Promise<void>;
    });
    await waitFor(() => expect(hook.result.current?.busy).toBe(true));

    finishResolution(null);
    await act(async () => {
      await confirmation;
    });

    expect(hook.result.current).toBeNull();
  });
  it('passes the opaque authority through metadata and the single playback dispatch', async () => {
    listLaunchFileIntentsMock.mockResolvedValue([firstIntent]);
    resolveLaunchFileIntentMock.mockResolvedValue({
      filePath: metadata.file_path,
      libraryGrant: null,
      authorityId: 'authority-1',
    });
    getTrackMetadataMock.mockResolvedValue(metadata);
    startPlaybackMock.mockResolvedValue(undefined);
    const hook = renderHook(() =>
      useLaunchFileIntents({ scanFolder: vi.fn(), setLibraryFolders: vi.fn() }),
    );

    await waitFor(() => expect(hook.result.current?.message).toContain('first.mp3'));
    await act(async () => hook.result.current?.onConfirm());

    expect(getTrackMetadataMock).toHaveBeenCalledWith(metadata.file_path, 'authority-1');
    expect(startPlaybackMock).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: metadata.file_path }),
      { authorityId: 'authority-1' },
    );
    expect(revokeLaunchFileAuthorityMock).not.toHaveBeenCalled();
  });

  it('revokes Play Once authority when metadata parsing fails', async () => {
    listLaunchFileIntentsMock.mockResolvedValue([firstIntent]);
    resolveLaunchFileIntentMock.mockResolvedValue({
      filePath: metadata.file_path,
      libraryGrant: null,
      authorityId: 'authority-metadata',
    });
    getTrackMetadataMock.mockRejectedValue(new Error('malformed metadata'));
    const hook = renderHook(() =>
      useLaunchFileIntents({ scanFolder: vi.fn(), setLibraryFolders: vi.fn() }),
    );

    await waitFor(() => expect(hook.result.current?.message).toContain('first.mp3'));
    await act(async () => hook.result.current?.onConfirm());

    expect(revokeLaunchFileAuthorityMock).toHaveBeenCalledWith('authority-metadata');
    expect(startPlaybackMock).not.toHaveBeenCalled();
  });

  it('revokes Play Once authority when playback dispatch fails', async () => {
    listLaunchFileIntentsMock.mockResolvedValue([firstIntent]);
    resolveLaunchFileIntentMock.mockResolvedValue({
      filePath: metadata.file_path,
      libraryGrant: null,
      authorityId: 'authority-playback',
    });
    getTrackMetadataMock.mockResolvedValue(metadata);
    startPlaybackMock.mockRejectedValue(new Error('dispatch failed'));
    const hook = renderHook(() =>
      useLaunchFileIntents({ scanFolder: vi.fn(), setLibraryFolders: vi.fn() }),
    );

    await waitFor(() => expect(hook.result.current?.message).toContain('first.mp3'));
    await act(async () => hook.result.current?.onConfirm());

    expect(revokeLaunchFileAuthorityMock).toHaveBeenCalledWith('authority-playback');
  });
});
