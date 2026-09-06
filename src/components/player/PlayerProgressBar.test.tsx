import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seekToPosition } from '../../lib/playback-actions';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import { PlayerProgressBar } from './PlayerProgressBar';

const { captureActivePlaybackSourceMock } = vi.hoisted(() => ({
  captureActivePlaybackSourceMock: vi.fn(() => ({ trackId: 'track-1', generation: 4 })),
}));

vi.mock('../../lib/playback-actions', () => ({
  captureActivePlaybackSource: captureActivePlaybackSourceMock,
  seekToPosition: vi.fn(async () => undefined),
}));

describe('PlayerProgressBar', () => {
  beforeEach(() => {
    vi.mocked(seekToPosition).mockClear();
    captureActivePlaybackSourceMock.mockClear();
    captureActivePlaybackSourceMock.mockReturnValue({ trackId: 'track-1', generation: 4 });
    usePlayerStore.setState({ currentTime: 10, duration: 100 });
    useSettingsStore.setState({ theme: 'liquid-glass' });
  });

  it('commits a drag against the source captured when the drag began', async () => {
    render(<PlayerProgressBar />);
    const slider = screen.getByRole('slider', { name: 'Seek' });

    fireEvent.pointerDown(slider, { pointerId: 3 });
    fireEvent.change(slider, { target: { value: '40' } });
    captureActivePlaybackSourceMock.mockReturnValue({ trackId: 'replacement', generation: 5 });
    fireEvent.pointerUp(slider, { pointerId: 3 });

    await waitFor(() =>
      expect(seekToPosition).toHaveBeenCalledWith(40, {
        trackId: 'track-1',
        generation: 4,
      }),
    );
    expect(seekToPosition).toHaveBeenCalledTimes(1);
  });
});
