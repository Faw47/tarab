import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../store/player-store';
import type { ParsedLyrics, Track } from '../../types';
import { AlbumSpotlightCard, CardLyricsDisplay, VolumeControl } from './HomeView.parts';

const { reportErrorMock, setAudioVolumeMock } = vi.hoisted(() => ({
  reportErrorMock: vi.fn(),
  setAudioVolumeMock: vi.fn(async () => undefined),
}));

vi.mock('../../lib/tauri-commands', () => ({
  setVolume: setAudioVolumeMock,
}));

vi.mock('../../lib/report-error', () => ({
  reportError: reportErrorMock,
}));

vi.mock('../ui/button', () => ({
  Button: ({
    children,
    accentColor: _accentColor,
    ...props
  }: ComponentProps<'button'> & {
    accentColor?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock('../shared/CoverArtImage', () => ({
  CoverArtImage: () => <div data-testid="spotlight-cover-art" />,
}));
const cardLyrics: ParsedLyrics = {
  isEnhanced: false,
  lines: [
    { startTime: 1_000, endTime: 3_000, text: 'First line', words: [] },
    { startTime: 3_000, endTime: 5_000, text: 'Second line', words: [] },
  ],
};
const spotlightTrack: Track = {
  id: 'spotlight-track',
  title: 'Spotlight song',
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 120,
  filePath: 'spotlight.mp3',
  hasCoverArt: false,
  dateAdded: 0,
};
const initialPlayerState = usePlayerStore.getState();

describe('Home VolumeControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAudioVolumeMock.mockResolvedValue(undefined);
    usePlayerStore.setState(initialPlayerState, true);
    usePlayerStore.getState().setVolume(0.65);
  });

  it('commits mute and unmute to the native engine', async () => {
    render(<VolumeControl />);

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    await waitFor(() => expect(setAudioVolumeMock).toHaveBeenCalledWith(0));
    expect(usePlayerStore.getState().volume).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
    await waitFor(() => expect(setAudioVolumeMock).toHaveBeenLastCalledWith(0.65));
    expect(usePlayerStore.getState().volume).toBe(0.65);
  });

  it('rolls back and reports a failed mute commit', async () => {
    const error = new Error('native volume failed');
    setAudioVolumeMock.mockRejectedValueOnce(error);
    render(<VolumeControl />);

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));

    await waitFor(() => {
      expect(usePlayerStore.getState().volume).toBe(0.65);
      expect(reportErrorMock).toHaveBeenCalledWith('volume commit failed', {
        source: 'home-volume',
        error,
      });
    });
  });
});

describe('Home CardLyricsDisplay', () => {
  beforeEach(() => {
    usePlayerStore.setState(initialPlayerState, true);
    usePlayerStore.setState({ lyrics: null, currentTime: 0, isPlaying: false });
  });

  it('updates lyric text from the shared smooth-time subscription', () => {
    usePlayerStore.setState({ lyrics: cardLyrics, currentTime: 1.5, isPlaying: true });
    render(<CardLyricsDisplay />);

    expect(screen.getByText(/First line/)).toBeInTheDocument();

    act(() => {
      usePlayerStore.getState().setCurrentTime(3.2);
    });

    expect(screen.getByText(/Second line/)).toBeInTheDocument();
    expect(screen.queryByText(/First line/)).not.toBeInTheDocument();
  });
});
describe('Home AlbumSpotlightCard', () => {
  it('does not open the album when the nested Play button is activated by keyboard', () => {
    const onOpenAlbumDetails = vi.fn();
    const onPlayAlbum = vi.fn(async () => undefined);

    render(
      <AlbumSpotlightCard
        track={spotlightTrack}
        count={1}
        albumTracks={[spotlightTrack]}
        featured
        interactiveSpotlight={false}
        staggerIndex={0}
        reducedEffects
        onOpenAlbumDetails={onOpenAlbumDetails}
        onPlayAlbum={onPlayAlbum}
      />,
    );

    const playButton = screen.getByRole('button', { name: 'Play Album' });
    fireEvent.keyDown(playButton, { key: 'Enter' });
    expect(onOpenAlbumDetails).not.toHaveBeenCalled();

    fireEvent.click(playButton);
    expect(onPlayAlbum).toHaveBeenCalledWith(spotlightTrack, [spotlightTrack]);

    fireEvent.keyDown(screen.getByRole('group', { name: 'Open Album by Artist' }), {
      key: 'Enter',
    });
    expect(onOpenAlbumDetails).toHaveBeenCalledWith({
      album: 'Album',
      artist: 'Artist',
      coverArt: undefined,
      tracks: [spotlightTrack],
    });
  });
});
