import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import type { Track } from '../../types';
import { PlayerContent } from './PlayerContent';

const {
  playAdjacentTrackMock,
  startPlaybackMock,
  toggleCurrentPlaybackMock,
  revealInFileManagerMock,
  setAudioBoosterMock,
  setPlaybackSpeedMock,
  coverArtMock,
} = vi.hoisted(() => ({
  playAdjacentTrackMock: vi.fn(),
  startPlaybackMock: vi.fn(),
  toggleCurrentPlaybackMock: vi.fn(),
  revealInFileManagerMock: vi.fn(),
  setAudioBoosterMock: vi.fn(),
  setPlaybackSpeedMock: vi.fn(),
  coverArtMock: vi.fn(),
}));

vi.mock('../../hooks/useCoverArt', () => ({
  useCoverArt: coverArtMock,
}));

vi.mock('../../hooks/useEffectiveReducedEffects', () => ({
  useEffectiveReducedEffects: () => true,
}));

vi.mock('../../lib/playback-actions', () => ({
  playAdjacentTrack: playAdjacentTrackMock,
  startPlayback: startPlaybackMock,
  toggleCurrentPlayback: toggleCurrentPlaybackMock,
}));

vi.mock('../../lib/tauri-commands', () => ({
  revealInFileManager: revealInFileManagerMock,
  setAudioBooster: setAudioBoosterMock,
  setPlaybackSpeed: setPlaybackSpeedMock,
}));

vi.mock('../playlist/PlaylistPickerDialog', () => ({
  PlaylistPickerDialog: () => null,
}));

vi.mock('../shared/CoverArtImage', () => ({
  CoverArtImage: () => null,
}));

vi.mock('../shared/HidingProgressBar', () => ({
  HidingProgressBar: () => null,
}));

vi.mock('./LyricsDisplay', () => ({
  LyricsDisplay: () => null,
}));

vi.mock('./LyricsSnippet', () => ({
  LyricsSnippet: () => null,
}));

vi.mock('./PlayerVolume', () => ({
  PlayerVolume: () => null,
}));

vi.mock('../ui/IconButton', () => ({
  IconButton: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

const initialPlayerState = usePlayerStore.getState();
const initialSettingsState = useSettingsStore.getState();

const makeTrack = (id: string, queueId: string): Track => ({
  id,
  _queueId: queueId,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: '/music/' + id + '.mp3',
  hasCoverArt: false,
  dateAdded: 1,
});

const setPlaybackErrorState = (currentTrack: Track, queue: Track[]) => {
  usePlayerStore.setState({
    currentTrack,
    queue,
    queueIndex: queue.findIndex((track) => track._queueId === currentTrack._queueId),
    currentTime: 10,
    duration: currentTrack.duration,
    isPlaying: false,
    hasActivePlayback: false,
    playbackError: {
      generation: 1,
      filePath: currentTrack.filePath,
      stage: 'decode',
      message: 'The track could not be decoded.',
      recoverable: false,
    },
  });
};

describe('PlayerContent playback error actions', () => {
  beforeEach(() => {
    usePlayerStore.setState(initialPlayerState, true);
    useSettingsStore.setState(initialSettingsState, true);
    vi.clearAllMocks();
    coverArtMock.mockReturnValue(null);
    playAdjacentTrackMock.mockResolvedValue(null);
    startPlaybackMock.mockResolvedValue(undefined);
    toggleCurrentPlaybackMock.mockResolvedValue(undefined);
    revealInFileManagerMock.mockResolvedValue(undefined);
    setAudioBoosterMock.mockResolvedValue(undefined);
    setPlaybackSpeedMock.mockResolvedValue(undefined);
  });

  it('removes the exact failed queue occurrence and clears orphaned playback', async () => {
    const firstDuplicate = makeTrack('duplicate', 'first-occurrence');
    const failed = makeTrack('duplicate', 'failed-occurrence');
    const thirdDuplicate = makeTrack('duplicate', 'third-occurrence');
    setPlaybackErrorState(failed, [firstDuplicate, failed, thirdDuplicate]);

    render(<PlayerContent onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove from Queue' }));

    await waitFor(() => expect(usePlayerStore.getState().currentTrack).toBeNull());
    expect(usePlayerStore.getState().queue.map((track) => track._queueId)).toEqual([
      'first-occurrence',
      'third-occurrence',
    ]);
    expect(usePlayerStore.getState()).toMatchObject({
      queueIndex: -1,
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      hasActivePlayback: false,
      playbackError: null,
    });
  });

  it('keeps the error actionable when skipping has no next track', async () => {
    const failed = makeTrack('failed', 'failed-occurrence');
    setPlaybackErrorState(failed, [failed]);

    render(<PlayerContent onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => expect(playAdjacentTrackMock).toHaveBeenCalledWith('next'));
    expect(usePlayerStore.getState().playbackError).toMatchObject({
      message: 'The track could not be decoded.',
    });
  });

  it('does not mount a cover-art ambient background when effects are reduced', () => {
    const track = makeTrack('reduced-effects', 'reduced-effects-occurrence');
    coverArtMock.mockReturnValue('cover-art://hash/large');
    usePlayerStore.setState({
      currentTrack: track,
      queue: [track],
      queueIndex: 0,
      currentTime: 10,
      duration: track.duration,
      isPlaying: false,
      hasActivePlayback: false,
      playbackError: null,
    });
    useSettingsStore.setState({ fullscreenPlayerLayout: true });

    render(<PlayerContent onClose={() => undefined} />);

    expect(document.querySelectorAll('[style*="background-image"]').length).toBe(0);
  });
});
