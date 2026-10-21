import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeepLinkBridge } from '../useDeepLinkBridge';

const { getInitialMock, listenMock } = vi.hoisted(() => ({
  getInitialMock: vi.fn(async (): Promise<string[]> => []),
  listenMock: vi.fn(),
}));

let onLink: ((url: string) => void) | null = null;

vi.mock('../../../platform/deepLinks', () => ({
  deepLinks: {
    getInitial: getInitialMock,
    listen: listenMock,
  },
}));
vi.mock('../../../platform/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../lib/playback-actions', () => ({
  PlaybackCoordinator: { start: vi.fn() },
  startPlayback: vi.fn(),
}));
vi.mock('../../../lib/tauri-commands', () => ({ dbGetTrackByPublicId: vi.fn() }));
vi.mock('../../../lib/report-error', () => ({ reportError: vi.fn() }));
vi.mock('../../library/api', () => ({ mapDbTrackToTrack: vi.fn() }));

describe('useDeepLinkBridge repeated opens (QA-13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onLink = null;
    getInitialMock.mockResolvedValue([]);
    listenMock.mockImplementation(async (handler: (url: string) => void) => {
      onLink = handler;
      return () => {
        onLink = null;
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts the same URL again later in the session', async () => {
    const onSearch = vi.fn();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    renderHook(() => useDeepLinkBridge({ onSearch }));
    await waitFor(() => expect(onLink).not.toBeNull());

    const url = 'tarab://open/search?q=Fairuz';
    act(() => onLink?.(url));
    // Even a rapid second click is intentional after startup (unlike a mirrored initial event).
    now.mockReturnValue(1100);
    act(() => onLink?.(url));

    expect(onSearch).toHaveBeenCalledTimes(2);
    expect(onSearch).toHaveBeenNthCalledWith(1, 'Fairuz');
    expect(onSearch).toHaveBeenNthCalledWith(2, 'Fairuz');
  });

  it('deduplicates only one startup mirror, not every subsequent opening', async () => {
    const url = 'tarab://open/search?q=Fairuz';
    const onSearch = vi.fn();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    getInitialMock.mockResolvedValue([url]);
    renderHook(() => useDeepLinkBridge({ onSearch }));
    await waitFor(() => expect(onLink).not.toBeNull());

    act(() => onLink?.(url)); // Native replay of getInitial()
    act(() => onLink?.(url)); // New user click immediately afterward
    expect(onSearch).toHaveBeenCalledTimes(2);

    now.mockReturnValue(3000);
    act(() => onLink?.(url));
    expect(onSearch).toHaveBeenCalledTimes(3);
  });

  it('suppresses only an immediate duplicate initial-link event', async () => {
    const url = 'tarab://open/search?q=Fairuz';
    const onSearch = vi.fn();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    getInitialMock.mockResolvedValue([url]);
    renderHook(() => useDeepLinkBridge({ onSearch }));
    await waitFor(() => expect(onLink).not.toBeNull());

    act(() => onLink?.(url));
    expect(onSearch).toHaveBeenCalledTimes(1);

    now.mockReturnValue(3000);
    act(() => onLink?.(url));
    expect(onSearch).toHaveBeenCalledTimes(2);
  });
});
