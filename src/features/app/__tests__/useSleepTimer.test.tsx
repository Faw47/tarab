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

  it('cancels a zero-valued timer handle when rescheduling', () => {
    const timeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockReturnValue(0 as unknown as ReturnType<typeof setTimeout>);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderHook(() => useSleepTimer({ setIsPlaying: vi.fn() }));

    try {
      act(() => result.current.scheduleSleepTimer(1));
      act(() => result.current.scheduleSleepTimer(2));

      expect(timeoutSpy).toHaveBeenCalledTimes(2);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(0);
    } finally {
      unmount();
      timeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });
});
