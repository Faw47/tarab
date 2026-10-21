import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPlayback } from '../../../lib/playback-actions';
import { reportError } from '../../../lib/report-error';
import { dbGetTrackByPublicId } from '../../../lib/tauri-commands';
import { useDeepLinkBridge } from '../useDeepLinkBridge';

const { getInitialMock, listenMock } = vi.hoisted(() => ({
  getInitialMock: vi.fn(async (): Promise<string[]> => []),
  listenMock: vi.fn(),
}));

let onLink: ((url: string) => void) | null = null;

vi.mock('../../../platform/deepLinks', () => ({
  deepLinks: { getInitial: getInitialMock, listen: listenMock },
}));
vi.mock('../../../platform/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../lib/playback-actions', () => ({ startPlayback: vi.fn() }));
vi.mock('../../../lib/tauri-commands', () => ({ dbGetTrackByPublicId: vi.fn() }));
vi.mock('../../../lib/report-error', () => ({ reportError: vi.fn() }));
vi.mock('../../library/api', () => ({ mapDbTrackToTrack: vi.fn() }));

const url = 'tarab://open/search?q=Fairuz';

describe('useDeepLinkBridge repeated opens and lifecycle (QA-13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onLink = null;
    getInitialMock.mockResolvedValue([]);
    listenMock.mockImplementation(async (handler: (value: string) => void) => {
      onLink = handler;
      return () => {
        onLink = null;
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts every repeated event after an empty startup snapshot', async () => {
    const onSearch = vi.fn();
    renderHook(() => useDeepLinkBridge({ onSearch }));
    await waitFor(() => expect(onLink).not.toBeNull());
    act(() => {
      onLink?.(url);
      onLink?.(url);
    });
    expect(onSearch.mock.calls).toEqual([['Fairuz'], ['Fairuz']]);
  });

  it('accepts the first rapid repeat when startup has no mirrored event', async () => {
    const onSearch = vi.fn();
    getInitialMock.mockResolvedValue([url]);
    renderHook(() => useDeepLinkBridge({ onSearch }));
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    act(() => onLink?.(url));
    expect(onSearch.mock.calls).toEqual([['Fairuz'], ['Fairuz']]);
  });

  it('subscribes before requesting the initial snapshot', async () => {
    const order: string[] = [];
    listenMock.mockImplementation(async () => {
      order.push('listen');
      return () => {};
    });
    getInitialMock.mockImplementationOnce(async () => {
      order.push('initial');
      return [];
    });
    renderHook(() => useDeepLinkBridge({ onSearch: vi.fn() }));
    await waitFor(() => expect(order).toHaveLength(2));
    expect(order).toEqual(['listen', 'initial']);
  });

  it('waits for asynchronous listener registration before reading the snapshot', async () => {
    let resolveListener!: (cleanup: () => void) => void;
    listenMock.mockImplementationOnce(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListener = resolve;
        }),
    );
    renderHook(() => useDeepLinkBridge({ onSearch: vi.fn() }));
    await act(async () => {});
    const readsBeforeRegistration = getInitialMock.mock.calls.length;
    expect(listenMock).toHaveBeenCalledTimes(1);
    await act(async () => resolveListener(() => {}));
    expect(readsBeforeRegistration).toBe(0);
    expect(getInitialMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates a snapshot against events received while the snapshot is pending', async () => {
    let resolveInitial!: (values: string[]) => void;
    getInitialMock.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveInitial = resolve;
        }),
    );
    const onSearch = vi.fn();
    renderHook(() => useDeepLinkBridge({ onSearch }));
    await waitFor(() => expect(getInitialMock).toHaveBeenCalled());
    await act(async () => {
      onLink?.(url);
      onLink?.(url);
      resolveInitial([url, url]);
    });
    expect(onSearch.mock.calls).toEqual([['Fairuz'], ['Fairuz']]);
    act(() => onLink?.(url));
    expect(onSearch).toHaveBeenCalledTimes(3);
  });

  it('handles distinct startup URLs once and preserves their later repeats', async () => {
    const other = 'tarab://open/search?q=Oud';
    const onSearch = vi.fn();
    getInitialMock.mockResolvedValue([url, url, other]);
    renderHook(() => useDeepLinkBridge({ onSearch }));
    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(2));
    act(() => {
      onLink?.(url);
      onLink?.(other);
    });
    expect(onSearch.mock.calls).toEqual([['Fairuz'], ['Oud'], ['Fairuz'], ['Oud']]);
  });

  it('does not dispatch a snapshot that resolves after unmount', async () => {
    let resolveInitial!: (values: string[]) => void;
    getInitialMock.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveInitial = resolve;
        }),
    );
    const onSearch = vi.fn();
    const { unmount } = renderHook(() => useDeepLinkBridge({ onSearch }));
    await waitFor(() => expect(getInitialMock).toHaveBeenCalled());
    unmount();
    await act(async () => resolveInitial([url]));
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('releases the listener even while the initial snapshot is still pending', async () => {
    let resolveInitial!: (values: string[]) => void;
    const unsubscribe = vi.fn();
    listenMock.mockImplementation(async (handler: (value: string) => void) => {
      onLink = handler;
      return unsubscribe;
    });
    getInitialMock.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          resolveInitial = resolve;
        }),
    );
    const onSearch = vi.fn();
    const { unmount } = renderHook(() => useDeepLinkBridge({ onSearch }));
    await waitFor(() => expect(getInitialMock).toHaveBeenCalled());
    unmount();
    const cleanupCount = unsubscribe.mock.calls.length;
    await act(async () => {
      onLink?.(url);
      resolveInitial([]);
    });
    expect(cleanupCount).toBe(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('releases registration that resolves after unmount without dispatching events', async () => {
    let resolveListener!: (cleanup: () => void) => void;
    let retainedHandler!: (value: string) => void;
    const unsubscribe = vi.fn();
    listenMock.mockImplementationOnce((handler: (value: string) => void) => {
      retainedHandler = handler;
      return new Promise<() => void>((resolve) => {
        resolveListener = resolve;
      });
    });
    const onSearch = vi.fn();
    const { unmount } = renderHook(() => useDeepLinkBridge({ onSearch }));
    await waitFor(() => expect(listenMock).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      retainedHandler(url);
      resolveListener(unsubscribe);
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(onSearch).not.toHaveBeenCalled();
  });

  for (const outcome of ['resolved', 'rejected'] as const) {
    it(`ignores a track lookup ${outcome} after unmount`, async () => {
      type LinkedTrack = Awaited<ReturnType<typeof dbGetTrackByPublicId>>;
      let resolveLookup!: (track: LinkedTrack) => void;
      let rejectLookup!: (error: Error) => void;
      vi.mocked(dbGetTrackByPublicId).mockImplementationOnce(
        () =>
          new Promise<LinkedTrack>((resolve, reject) => {
            resolveLookup = resolve;
            rejectLookup = reject;
          }),
      );
      const { unmount } = renderHook(() => useDeepLinkBridge({ onSearch: vi.fn() }));
      await waitFor(() => expect(onLink).not.toBeNull());
      act(() => onLink?.(`tarab://open/play?id=${'a'.repeat(64)}`));
      expect(dbGetTrackByPublicId).toHaveBeenCalledTimes(1);
      unmount();
      await act(async () => {
        if (outcome === 'resolved') {
          resolveLookup({
            id: 'linked',
            title: 'Linked track',
            artist: 'Artist',
            album: 'Album',
            year: null,
            duration: 60,
            filePath: '/music/linked.mp3',
            hasCoverArt: false,
            coverArtHash: null,
            dateAdded: 0,
            playCount: 0,
            lastPlayed: null,
            rating: null,
            blurhash: null,
          });
        } else {
          rejectLookup(new Error('lookup unavailable'));
        }
      });
      expect(startPlayback).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
    });
  }

  it('keeps listening when reading the initial snapshot fails', async () => {
    getInitialMock.mockRejectedValueOnce(new Error('snapshot unavailable'));
    const onSearch = vi.fn();
    renderHook(() => useDeepLinkBridge({ onSearch }));
    await act(async () => {});
    act(() => onLink?.(url));
    expect(onSearch).toHaveBeenCalledWith('Fairuz');
  });

  it('uses the latest search callback without replaying the initial snapshot', async () => {
    getInitialMock.mockResolvedValue([url]);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ onSearch }) => useDeepLinkBridge({ onSearch }), {
      initialProps: { onSearch: first },
    });
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    rerender({ onSearch: second });
    await act(async () => {});
    expect(second).not.toHaveBeenCalled();
    expect(listenMock).toHaveBeenCalledTimes(1);
    act(() => onLink?.(url));
    expect(second).toHaveBeenCalledWith('Fairuz');
  });
});
