import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppOverlayMessages } from '../../../features/app/AppOverlayMessages';
import { usePlayerStore } from '../../../store/player-store';
import type { Track } from '../../../types';
import { PlaybackRecoveryBanner, playbackFailureTitle } from '../PlaybackRecoveryBanner';

const { playAdjacentTrackMock, startPlaybackMock, revealMock } = vi.hoisted(() => ({
  playAdjacentTrackMock: vi.fn(async (_direction: 'next' | 'previous', ..._options: unknown[]) => undefined),
  startPlaybackMock: vi.fn(async () => 1),
  revealMock: vi.fn(async () => undefined),
}));
vi.mock('../../../lib/playback-actions', () => ({
  PlaybackCoordinator: {
    next: (...args: unknown[]) => playAdjacentTrackMock('next', ...args),
    start: startPlaybackMock,
  },
  playAdjacentTrack: playAdjacentTrackMock,
  startPlayback: startPlaybackMock,
}));
vi.mock('../../../lib/tauri-commands', () => ({ revealInFileManager: revealMock }));

const track: Track = {
  id: 't1',
  filePath: '/music/a.flac',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  year: 2020,
  duration: 100,
  hasCoverArt: false,
  dateAdded: 0,
};

describe('PlaybackRecoveryBanner (FE-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({
      currentTrack: track,
      currentTime: 12,
      queue: [track],
      playbackError: {
        generation: 3,
        filePath: track.filePath,
        stage: 'decode',
        message: 'Unsupported format',
        recoverable: false,
      },
    });
  });

  it('shows plain wording and the recovery actions in the main shell', () => {
    render(
      <AppOverlayMessages
        playlistRepair={null}
        playbackRecovery={<PlaybackRecoveryBanner theme="liquid-glass" placement="shell" />}
        theme="liquid-glass"
        onRetryPlaylistLoad={vi.fn()}
        onResetPlaylistData={vi.fn()}
        onOpenPlaylistsDataFolder={vi.fn()}
      />,
    );
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('This track could not be decoded');
    expect(banner).toHaveTextContent('Song: Unsupported format');
    for (const name of ['Retry', 'Skip', 'Reveal in Finder', 'Remove from Queue']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('Retry restarts at the current position and clears the error', async () => {
    render(<PlaybackRecoveryBanner theme="neobrutalism" placement="shell" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(usePlayerStore.getState().playbackError).toBeNull());
    expect(startPlaybackMock).toHaveBeenCalledWith(track, { startPos: 12 });
  });

  it('Skip, Reveal and Dismiss act on the failure', async () => {
    render(<PlaybackRecoveryBanner theme="liquid-glass" placement="shell" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in Finder' }));
    expect(revealMock).toHaveBeenCalledWith('/music/a.flac');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(playAdjacentTrackMock).toHaveBeenCalledWith('next'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());

    usePlayerStore.setState({
      playbackError: {
        generation: 4,
        filePath: '',
        stage: 'stream',
        message: 'x',
        recoverable: true,
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('The audio output stopped');
    expect(screen.queryByRole('button', { name: 'Reveal in Finder' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss playback error' }));
    expect(usePlayerStore.getState().playbackError).toBeNull();
  });

  it('never shows backend stage names', () => {
    for (const stage of ['preflight', 'decode', 'seek', 'stream', 'deviceSwitch'] as const) {
      expect(playbackFailureTitle(stage)).not.toMatch(/preflight|deviceSwitch|\bat\b/);
    }
  });
});
