import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTauriEvent } from './useTauriEvent';

const { listenMock, handlers } = vi.hoisted(() => ({
  listenMock: vi.fn(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

describe('useTauriEvent', () => {
  beforeEach(() => {
    handlers.clear();
    listenMock.mockReset();
    listenMock.mockImplementation(
      async (eventName: string, handler: (event: { payload: unknown }) => void) => {
        handlers.set(eventName, handler);
        return () => handlers.delete(eventName);
      },
    );
  });

  it('keeps one native listener while delivering events to the latest handler', async () => {
    const received: number[] = [];
    const { rerender } = renderHook(
      ({ multiplier }) => {
        useTauriEvent<number>('test-event', (event) => received.push(event.payload * multiplier), [
          multiplier,
        ]);
      },
      { initialProps: { multiplier: 1 } },
    );

    await waitFor(() => expect(handlers.has('test-event')).toBe(true));
    rerender({ multiplier: 2 });
    handlers.get('test-event')?.({ payload: 3 });

    expect(received).toEqual([6]);
    expect(listenMock).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch or report ready after unmounting during listener setup', async () => {
    const received: number[] = [];
    const onReady = vi.fn();
    const cleanup = vi.fn();
    let pendingHandler: ((event: { payload: number }) => void) | undefined;
    let resolveListen: ((cleanup: () => void) => void) | undefined;
    listenMock.mockImplementation(
      (_eventName: string, handler: (event: { payload: number }) => void) => {
        pendingHandler = handler;
        return new Promise<() => void>((resolve) => {
          resolveListen = resolve;
        });
      },
    );

    const { unmount } = renderHook(() => {
      useTauriEvent<number>(
        'test-event',
        (event) => received.push(event.payload),
        [],
        undefined,
        onReady,
      );
    });
    unmount();
    pendingHandler?.({ payload: 3 });
    resolveListen?.(cleanup);

    await waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    expect(received).toEqual([]);
    expect(onReady).not.toHaveBeenCalled();
  });
});
