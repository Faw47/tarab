import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { SetStateAction } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { moveFile, renameFile } from '../../../lib/tauri-commands';
import { usePlayerStore } from '../../../store/player-store';
import type { ContextMenuPosition, Track } from '../../../types';
import { libraryKeys } from '../../library/queryKeys';
import type { AlbumDetailsState } from '../app-state-types';
import { useTrackOperations } from '../useTrackOperations';

vi.mock('../../../lib/tauri-commands', () => ({
  dbDeleteTracks: vi.fn(async () => undefined),
  dbGetTrackCount: vi.fn(async () => 0),
  deleteFiles: vi.fn(async () => 0),
  getCoverArtData: vi.fn(async () => null),
  moveFile: vi.fn(async () => ''),
  pausePlayback: vi.fn(async () => undefined),
  readFullTags: vi.fn(async () => ({})),
  renameFile: vi.fn(async () => ''),
  restoreTrashedFiles: vi.fn(async () => []),
  stopPlayback: vi.fn(async () => undefined),
  trashFiles: vi.fn(async () => []),
  writeTagsBatch: vi.fn(async () => undefined),
}));

vi.mock('../../../lib/track-refresh', () => ({
  refreshTracksByFilePaths: vi.fn(async () => undefined),
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: vi.fn(),
}));

const initialPlayerState = usePlayerStore.getState();

const makeTrack = (filePath: string, overrides: Partial<Track> = {}): Track => ({
  id: filePath,
  title: overrides.title ?? filePath.split('/').pop() ?? filePath,
  artist: overrides.artist ?? 'Artist',
  albumArtist: overrides.albumArtist ?? null,
  album: overrides.album ?? 'Album',
  year: overrides.year ?? 2024,
  duration: overrides.duration ?? 180,
  filePath,
  hasCoverArt: overrides.hasCoverArt ?? false,
  coverArtHash: overrides.coverArtHash ?? null,
  dateAdded: overrides.dateAdded ?? 1,
  rating: overrides.rating ?? null,
  playCount: overrides.playCount,
  lastPlayed: overrides.lastPlayed,
  coverArt: overrides.coverArt,
  fileFormat: overrides.fileFormat,
  bitrate: overrides.bitrate,
  sampleRate: overrides.sampleRate,
  fileSize: overrides.fileSize,
});

describe('useTrackOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState(initialPlayerState, true);
  });

  it('keeps album details and playback state in sync after track path changes', () => {
    const queryClient = new QueryClient();
    const oldPath = '/music/album/one.mp3';
    const newPath = '/music/album/one-renamed.mp3';
    const oldTrack = makeTrack(oldPath, { title: 'One' });
    const otherTrack = makeTrack('/music/album/two.mp3', { title: 'Two' });
    const tracks = [oldTrack, otherTrack];

    queryClient.setQueryData(libraryKeys.tracks(), tracks);

    let albumDetails: AlbumDetailsState | null = {
      album: 'Album',
      artist: 'Artist',
      coverArt: 'cover-art://localhost/hash/large',
      tracks,
    };
    let selectedTracks = [oldTrack];
    let tagEditorTracks: Track[] | null = [oldTrack];
    let contextMenuTrack: Track | null = oldTrack;
    let contextMenuPosition: ContextMenuPosition | null = { x: 10, y: 20 };

    const setAlbumDetails = vi.fn((details: AlbumDetailsState | null) => {
      albumDetails = details;
    });
    const setTracks = vi.fn((nextTracks: Track[]) => {
      queryClient.setQueryData(libraryKeys.tracks(), nextTracks);
    });
    const setSelectedTracks = vi.fn((value: SetStateAction<Track[]>) => {
      selectedTracks = typeof value === 'function' ? value(selectedTracks) : value;
    });
    const setTagEditorTracks = vi.fn((value: SetStateAction<Track[] | null>) => {
      tagEditorTracks = typeof value === 'function' ? value(tagEditorTracks) : value;
    });
    const setContextMenuTrack = vi.fn((value: SetStateAction<Track | null>) => {
      contextMenuTrack = typeof value === 'function' ? value(contextMenuTrack) : value;
    });
    const setContextMenuPosition = vi.fn((value: SetStateAction<ContextMenuPosition | null>) => {
      contextMenuPosition = typeof value === 'function' ? value(contextMenuPosition) : value;
    });

    usePlayerStore.setState({
      currentTrack: oldTrack,
      queue: tracks,
      queueIndex: 0,
      queueVersion: 1,
    });

    const { result } = renderHook(() =>
      useTrackOperations({
        queryClient,
        libraryTracks: tracks,
        albumDetails,
        setAlbumDetails,
        setTracks,
        setTrackCount: vi.fn(),
        setSelectedTracks,
        setTagEditorTracks,
        setContextMenuTrack,
        setContextMenuPosition,
        setConfirmDialog: vi.fn(),
        handleClearSelection: vi.fn(),
      }),
    );

    act(() => {
      result.current.applyTrackPathUpdates({ [oldPath]: newPath });
    });

    expect(queryClient.getQueryData<Track[]>(libraryKeys.tracks())?.[0]).toMatchObject({
      id: newPath,
      filePath: newPath,
    });
    expect(albumDetails?.tracks[0]).toMatchObject({ id: newPath, filePath: newPath });
    expect(selectedTracks[0]).toMatchObject({ id: newPath, filePath: newPath });
    expect(tagEditorTracks?.[0]).toMatchObject({ id: newPath, filePath: newPath });
    expect(contextMenuTrack).toMatchObject({ id: newPath, filePath: newPath });
    expect(contextMenuPosition).toEqual({ x: 10, y: 20 });
    expect(usePlayerStore.getState().queue[0]).toMatchObject({ id: newPath, filePath: newPath });
    expect(usePlayerStore.getState().currentTrack).toMatchObject({
      id: newPath,
      filePath: newPath,
    });
  });
  it('keeps queueIndex on the current track when pruning earlier queued tracks', async () => {
    const queryClient = new QueryClient();
    const tracks = [
      makeTrack('/music/album/one.mp3', { title: 'One' }),
      makeTrack('/music/album/two.mp3', { title: 'Two' }),
      makeTrack('/music/album/three.mp3', { title: 'Three' }),
      makeTrack('/music/album/four.mp3', { title: 'Four' }),
    ];

    queryClient.setQueryData(libraryKeys.tracks(), tracks);

    const setTracks = vi.fn((nextTracks: Track[]) => {
      queryClient.setQueryData(libraryKeys.tracks(), nextTracks);
    });

    const player = usePlayerStore.getState();
    player.setQueue(tracks);
    const queuedTracks = usePlayerStore.getState().queue;
    usePlayerStore.getState().setQueueIndex(2);
    usePlayerStore.getState().setCurrentTrack(queuedTracks[2]);

    const { result } = renderHook(() =>
      useTrackOperations({
        queryClient,
        libraryTracks: tracks,
        albumDetails: null,
        setAlbumDetails: vi.fn(),
        setTracks,
        setTrackCount: vi.fn(),
        setSelectedTracks: vi.fn(),
        setTagEditorTracks: vi.fn(),
        setContextMenuTrack: vi.fn(),
        setContextMenuPosition: vi.fn(),
        setConfirmDialog: vi.fn(),
        handleClearSelection: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.pruneTracks([tracks[0]]);
    });

    const state = usePlayerStore.getState();
    expect(state.queue.map((track) => track.id)).toEqual([
      tracks[1].id,
      tracks[2].id,
      tracks[3].id,
    ]);
    expect(state.currentTrack?.id).toBe(tracks[2].id);
    expect(state.queueIndex).toBe(1);
    expect(state.queue[state.queueIndex]?.id).toBe(tracks[2].id);
  });

  it('preserves active playback state when the current source is renamed and moved', async () => {
    const queryClient = new QueryClient();
    const original = makeTrack('/music/album/one.mp3', { title: 'One' });
    queryClient.setQueryData(libraryKeys.tracks(), [original]);
    const setTracks = vi.fn((nextTracks: Track[]) => {
      queryClient.setQueryData(libraryKeys.tracks(), nextTracks);
    });
    usePlayerStore.setState({
      currentTrack: original,
      queue: [original],
      queueIndex: 0,
      currentTime: 47,
      duration: 180,
      isPlaying: false,
      hasActivePlayback: true,
    });

    const { result } = renderHook(() =>
      useTrackOperations({
        queryClient,
        libraryTracks: [original],
        albumDetails: null,
        setAlbumDetails: vi.fn(),
        setTracks,
        setTrackCount: vi.fn(),
        setSelectedTracks: vi.fn(),
        setTagEditorTracks: vi.fn(),
        setContextMenuTrack: vi.fn(),
        setContextMenuPosition: vi.fn(),
        setConfirmDialog: vi.fn(),
        handleClearSelection: vi.fn(),
      }),
    );

    vi.mocked(renameFile).mockResolvedValueOnce('/music/album/renamed.mp3');
    await act(async () => {
      await result.current.handleRenameTrack(original, 'renamed');
    });

    let state = usePlayerStore.getState();
    expect(state.currentTrack?.filePath).toBe('/music/album/renamed.mp3');
    expect(state.currentTime).toBe(47);
    expect(state.isPlaying).toBe(false);
    expect(state.hasActivePlayback).toBe(true);

    vi.mocked(moveFile).mockResolvedValueOnce('/music/archive/renamed.mp3');
    await act(async () => {
      await result.current.handleMoveTracks([state.currentTrack as Track], '/music/archive');
    });

    state = usePlayerStore.getState();
    expect(state.currentTrack?.filePath).toBe('/music/archive/renamed.mp3');
    expect(state.queueIndex).toBe(0);
    expect(state.currentTime).toBe(47);
    expect(state.isPlaying).toBe(false);
    expect(state.hasActivePlayback).toBe(true);
  });
});
