import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSleepTimer } from '../useSleepTimer';

const { pauseCurrentPlaybackMock, reportErrorMock } = vi.hoisted(() => ({
  pauseCurrentPlaybackMock: vi.fn(async () => undefined),
  reportErrorMock: vi.fn(),
}));

vi.mock('../../../lib/playback-actions', () => ({
  pauseCurrentPlayback: pauseCurrentPlaybackMock,
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: reportErrorMock,
}));

describe('useSleepTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses through the playback coordinator when the timer expires', async () => {
    const setIsPlaying = vi.fn();
    const { result } = renderHook(() => useSleepTimer({ setIsPlaying }));

    act(() => result.current.scheduleSleepTimer(1));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));

    expect(pauseCurrentPlaybackMock).toHaveBeenCalledTimes(1);
    expect(setIsPlaying).toHaveBeenCalledWith(false);
    expect(result.current.sleepDeadline).toBeNull();
  });
});
