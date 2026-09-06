import { render, waitFor } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import {
  resetPlaybackGenerationForTests,
  setActivePlaybackGeneration,
} from '../playback-generation';
import { usePlaybackPositionEvents } from '../usePlaybackPositionEvents';

const { listeners, listenMock, reportErrorMock } = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => unknown>();
  return {
    listeners,
    listenMock: vi.fn(),
    reportErrorMock: vi.fn(),
  };
});

vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

vi.mock('../../../lib/report-error', () => ({ reportError: reportErrorMock }));

const initialPlayerState = usePlayerStore.getState();
const scheduleSessionSave = vi.fn();
const lastSavedPositionRef = { current: 0 } as MutableRefObject<number>;
const lastSessionSaveRef = { current: 0 } as MutableRefObject<number>;

function Harness() {
  usePlaybackPositionEvents({
    scheduleSessionSave,
    lastSavedPositionRef,
    lastSessionSaveRef,
  });
  return null;
}

describe('usePlaybackPositionEvents', () => {
  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    listenMock
      .mockReset()
      .mockImplementation(
        async (eventName: string, handler: (event: { payload: unknown }) => unknown) => {
          listeners.set(eventName, handler);
          return () => listeners.delete(eventName);
        },
      );
    reportErrorMock.mockReset();
    usePlayerStore.setState(initialPlayerState, true);
    usePlayerStore.setState({ currentTime: 0 });
    resetPlaybackGenerationForTests();
    setActivePlaybackGeneration(7);
    lastSavedPositionRef.current = 0;
    lastSessionSaveRef.current = Date.now();
  });

  it('reports listener setup failures through the app error channel', async () => {
    const error = new Error('listener unavailable');
    listenMock.mockRejectedValue(error);

    render(<Harness />);

    await waitFor(() => expect(reportErrorMock).toHaveBeenCalledTimes(2));
    expect(reportErrorMock).toHaveBeenNthCalledWith(
      1,
      'Failed to setup playback position listener',
      { source: 'playback-position-events', error },
    );
    expect(reportErrorMock).toHaveBeenNthCalledWith(2, 'Failed to setup playback seek listener', {
      source: 'playback-position-events',
      error,
    });
  });

  it('applies typed position events for the active generation', async () => {
    render(<Harness />);
    await waitFor(() => expect(listeners.has('playback-position')).toBe(true));

    await listeners.get('playback-position')?.({
      payload: { generation: 7, position: 12.5 },
    });

    expect(usePlayerStore.getState().currentTime).toBe(12.5);
  });

  it('ignores stale position and seek events', async () => {
    render(<Harness />);
    await waitFor(() => {
      expect(listeners.has('playback-position')).toBe(true);
      expect(listeners.has('playback-seeked')).toBe(true);
    });

    await listeners.get('playback-position')?.({
      payload: { generation: 6, position: 40 },
    });
    await listeners.get('playback-seeked')?.({
      payload: { generation: 6, position: 80 },
    });

    expect(usePlayerStore.getState().currentTime).toBe(0);
    expect(scheduleSessionSave).not.toHaveBeenCalled();
  });

  it('clamps active seek positions and persists immediately', async () => {
    render(<Harness />);
    await waitFor(() => expect(listeners.has('playback-seeked')).toBe(true));

    await listeners.get('playback-seeked')?.({
      payload: { generation: 7, position: -4 },
    });

    expect(usePlayerStore.getState().currentTime).toBe(0);
    expect(scheduleSessionSave).toHaveBeenCalledWith(true);
  });
});
