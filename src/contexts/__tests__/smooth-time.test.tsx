import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../store/player-store';
import { SmoothTimeProvider, useSmoothTimeSubscription, useSmoothTimeValue } from '../smooth-time';

const { getTimeMsMock } = vi.hoisted(() => ({
  getTimeMsMock: vi.fn(() => 5000),
}));

vi.mock('../../hooks/useSmoothTime', () => ({
  useSmoothTime: () => getTimeMsMock,
}));

const initialPlayerState = usePlayerStore.getState();
const frames: FrameRequestCallback[] = [];
const requestFrameMock = vi.fn((callback: FrameRequestCallback) => {
  frames.push(callback);
  return frames.length;
});
const cancelFrameMock = vi.fn();

function Subscriber({ onTime }: { onTime: (timeSec: number) => void }) {
  useSmoothTimeSubscription(onTime);
  return null;
}

function Reader({ onRead }: { onRead: (getTime: () => number) => void }) {
  const smoothTime = useSmoothTimeValue();
  onRead(() => smoothTime.timeSec);
  return null;
}

describe('SmoothTimeProvider frame scheduling (FE-42)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState(initialPlayerState, true);
    frames.length = 0;
    vi.stubGlobal('requestAnimationFrame', requestFrameMock);
    vi.stubGlobal('cancelAnimationFrame', cancelFrameMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not schedule frames when nothing subscribes, even during playback', () => {
    usePlayerStore.getState().setIsPlaying(true);
    render(
      <SmoothTimeProvider>
        <div>No subscribers</div>
      </SmoothTimeProvider>,
    );

    expect(requestFrameMock).not.toHaveBeenCalled();
  });

  it('notifies once while paused without starting a frame loop', () => {
    const onTime = vi.fn();
    render(
      <SmoothTimeProvider>
        <Subscriber onTime={onTime} />
      </SmoothTimeProvider>,
    );

    expect(onTime).toHaveBeenCalledWith(5);
    expect(requestFrameMock).not.toHaveBeenCalled();
  });

  it('animates while playing and cancels the loop on pause', () => {
    const onTime = vi.fn();
    usePlayerStore.getState().setIsPlaying(true);
    render(
      <SmoothTimeProvider>
        <Subscriber onTime={onTime} />
      </SmoothTimeProvider>,
    );

    expect(requestFrameMock).toHaveBeenCalledTimes(1);
    act(() => frames[0](0));
    expect(onTime).toHaveBeenCalledWith(5);
    expect(requestFrameMock).toHaveBeenCalledTimes(2);

    act(() => usePlayerStore.getState().setIsPlaying(false));
    expect(cancelFrameMock).toHaveBeenCalledWith(2);
    expect(requestFrameMock).toHaveBeenCalledTimes(2);
  });

  it('cancels the loop when the final subscriber unmounts', () => {
    usePlayerStore.getState().setIsPlaying(true);
    const { rerender } = render(
      <SmoothTimeProvider>
        <Subscriber onTime={vi.fn()} />
      </SmoothTimeProvider>,
    );

    expect(requestFrameMock).toHaveBeenCalledTimes(1);
    rerender(<SmoothTimeProvider>{null}</SmoothTimeProvider>);
    expect(cancelFrameMock).toHaveBeenCalledWith(1);
  });

  it('returns an imperative timestamp without subscribing or scheduling frames', () => {
    let readTime: (() => number) | undefined;
    render(
      <SmoothTimeProvider>
        <Reader
          onRead={(getter) => {
            readTime = getter;
          }}
        />
      </SmoothTimeProvider>,
    );

    expect(readTime?.()).toBe(5);
    expect(requestFrameMock).not.toHaveBeenCalled();
  });
});
