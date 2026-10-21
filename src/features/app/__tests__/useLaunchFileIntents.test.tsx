import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaunchFileIntents } from '../useLaunchFileIntents';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  resolve: vi.fn(),
  grants: vi.fn(async () => []),
  metadata: vi.fn(async () => ({ file_path: '/home/listener/song.mp3', title: 'Song' })),
  play: vi.fn(async () => undefined),
  report: vi.fn(),
}));

vi.mock('../../../hooks/useTauriEvent', () => ({ useTauriEvent: vi.fn() }));
vi.mock('../../../lib/tauri-commands', () => ({
  listLaunchFileIntents: mocks.list,
  resolveLaunchFileIntent: mocks.resolve,
  listLibraryGrants: mocks.grants,
  getTrackMetadata: mocks.metadata,
}));
vi.mock('../../../lib/playback-actions', () => ({
  PlaybackCoordinator: { start: mocks.play },
  startPlayback: mocks.play,
}));
vi.mock('../../../lib/report-error', () => ({ reportError: mocks.report }));

const intent = {
  id: 'intent-1',
  displayName: 'song.mp3',
  folderName: 'listener',
  folderPath: '/home/listener',
};

function setup() {
  const scanFolder = vi.fn(async () => undefined);
  const setLibraryFolders = vi.fn();
  const hook = renderHook(() => useLaunchFileIntents({ scanFolder, setLibraryFolders }));
  return { ...hook, scanFolder, setLibraryFolders };
}

describe('file-open consent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([intent]);
    mocks.resolve.mockResolvedValue({ filePath: '/home/listener/song.mp3', libraryGrant: null });
  });

  it('shows the full folder scope before granting access', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.detail).toContain('/home/listener');
    expect(result.current?.detail).toContain('subfolders');
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('keeps Play once available after a rejected folder import', async () => {
    mocks.resolve.mockRejectedValueOnce(new Error('Select a folder inside your home directory'));
    const { result, scanFolder } = setup();
    await waitFor(() => expect(result.current).not.toBeNull());
    await act(async () => result.current?.onSecondary?.());
    expect(result.current).not.toBeNull();
    expect(result.current?.busy).toBe(false);
    expect(mocks.play).not.toHaveBeenCalled();
    await act(async () => result.current?.onConfirm());
    expect(mocks.resolve).toHaveBeenLastCalledWith('intent-1', 'playOnce');
    expect(mocks.play).toHaveBeenCalledTimes(1);
    expect(scanFolder).not.toHaveBeenCalled();
    expect(mocks.grants).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('cancels without opening or scanning files', async () => {
    mocks.resolve.mockResolvedValue(null);
    const { result, scanFolder } = setup();
    await waitFor(() => expect(result.current).not.toBeNull());
    await act(async () => result.current?.onCancel());
    expect(mocks.resolve).toHaveBeenCalledWith('intent-1', 'cancel');
    expect(mocks.metadata).not.toHaveBeenCalled();
    expect(scanFolder).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});
