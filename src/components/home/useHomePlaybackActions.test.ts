import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../types';
import { useHomePlaybackActions } from './useHomePlaybackActions';

const playback = vi.hoisted(() => ({
  playAdjacentTrack: vi.fn(),
  toggleCurrentPlayback: vi.fn(),
}));
const reportError = vi.hoisted(() => vi.fn());

vi.mock('../../lib/playback-actions', () => playback);
vi.mock('../../lib/report-error', () => ({ reportError }));

const track = { id: 'track-1' } as Track;

describe('useHomePlaybackActions', () => {
  beforeEach(() => {
    playback.playAdjacentTrack.mockReset().mockResolvedValue(undefined);
    playback.toggleCurrentPlayback.mockReset().mockResolvedValue(undefined);
    reportError.mockReset();
  });

  it('guards play toggle when there is no current track', async () => {
    const { result } = renderHook(() => useHomePlaybackActions(null, 'home-view'));

    await result.current.handleTogglePlay();

    expect(playback.toggleCurrentPlayback).not.toHaveBeenCalled();
  });

  it('routes previous and next actions through the shared playback API', async () => {
    const { result } = renderHook(() => useHomePlaybackActions(track, 'home-neo'));

    await result.current.handlePrevious();
    await result.current.handleNext();
    await result.current.handleTogglePlay();

    expect(playback.playAdjacentTrack).toHaveBeenNthCalledWith(1, 'previous');
    expect(playback.playAdjacentTrack).toHaveBeenNthCalledWith(2, 'next');
    expect(playback.toggleCurrentPlayback).toHaveBeenCalledOnce();
  });

  it('reports playback failures without leaving rejected click promises', async () => {
    const error = new Error('native playback failed');
    playback.playAdjacentTrack.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useHomePlaybackActions(track, 'home-neo'));

    await expect(result.current.handlePrevious()).resolves.toBeUndefined();

    expect(reportError).toHaveBeenCalledWith('previous failed', {
      source: 'home-neo',
      error,
    });
  });
});
