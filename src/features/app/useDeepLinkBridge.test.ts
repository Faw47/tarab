import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeepLinkDispatcher, parseDeepLink, useDeepLinkBridge } from './useDeepLinkBridge';

const { dbGetTrackMock, getInitialMock, listenMock, reportErrorMock, startPlaybackMock } =
  vi.hoisted(() => ({
    dbGetTrackMock: vi.fn(),
    getInitialMock: vi.fn(),
    listenMock: vi.fn(),
    reportErrorMock: vi.fn(),
    startPlaybackMock: vi.fn(),
  }));

vi.mock('../../lib/playback-actions', () => ({ startPlayback: startPlaybackMock }));
vi.mock('../../lib/report-error', () => ({ reportError: reportErrorMock }));
vi.mock('../../lib/tauri-commands', () => ({ dbGetTrackByPublicId: dbGetTrackMock }));
vi.mock('../../platform/deepLinks', () => ({
  deepLinks: { getInitial: getInitialMock, listen: listenMock },
}));
vi.mock('../../platform/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('../library/api', () => ({ mapDbTrackToTrack: (track: unknown) => track }));

beforeEach(() => {
  dbGetTrackMock.mockReset();
  getInitialMock.mockReset().mockResolvedValue([]);
  listenMock.mockReset().mockResolvedValue(vi.fn());
  reportErrorMock.mockReset();
  startPlaybackMock.mockReset().mockResolvedValue(undefined);
});

describe('parseDeepLink', () => {
  it('accepts a bounded search intent', () => {
    expect(parseDeepLink('tarab://open/search?q=Fairuz')).toEqual({
      kind: 'search',
      query: 'Fairuz',
    });
  });

  it('accepts an opaque track identifier', () => {
    const id = 'a'.repeat(64);
    expect(parseDeepLink(`tarab://open/play?id=${id}`)).toEqual({
      kind: 'play',
      publicId: id,
    });
  });

  it.each([
    'https://open/search?q=Fairuz',
    'tarab://other/search?q=Fairuz',
    'tarab://open/search',
    `tarab://open/search?q=${'x'.repeat(201)}`,
    'tarab://open/play?id=/Users/alice/Music/song.mp3',
    'tarab://open/unknown',
  ])('rejects unsupported or unsafe input: %s', (url) => {
    expect(parseDeepLink(url)).toBeNull();
  });
});

describe('deep-link dispatch', () => {
  const firstId = 'a'.repeat(64);
  const secondId = 'b'.repeat(64);

  it('subscribes before replaying startup links and deduplicates the overlap', async () => {
    let onLink: ((url: string) => void) | undefined;
    let finishInitial: ((urls: string[]) => void) | undefined;
    listenMock.mockImplementation(async (handler: (url: string) => void) => {
      onLink = handler;
      return vi.fn();
    });
    getInitialMock.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          finishInitial = resolve;
        }),
    );
    const onSearch = vi.fn();

    renderHook(() => useDeepLinkBridge({ onSearch }));
    await waitFor(() => expect(onLink).toBeDefined());
    onLink?.('tarab://open/search?q=Fairuz');
    finishInitial?.(['tarab://open/search?q=Fairuz']);

    await waitFor(() => expect(onSearch).toHaveBeenCalledTimes(1));
    expect(listenMock.mock.invocationCallOrder[0]).toBeLessThan(
      getInitialMock.mock.invocationCallOrder[0],
    );
  });

  it('allows a successful identical link again after the dedupe TTL', async () => {
    let currentTime = 0;
    dbGetTrackMock.mockResolvedValue({ id: 'track' });
    const dispatcher = createDeepLinkDispatcher({
      onSearch: vi.fn(),
      now: () => currentTime,
      wait: async () => undefined,
    });
    const link = `tarab://open/play?id=${firstId}`;

    await dispatcher.handle(link);
    await dispatcher.handle(link);
    expect(dbGetTrackMock).toHaveBeenCalledTimes(1);

    currentTime = 5_001;
    await dispatcher.handle(link);
    expect(dbGetTrackMock).toHaveBeenCalledTimes(2);
  });

  it('does not deduplicate failed lookups', async () => {
    dbGetTrackMock.mockResolvedValue(null);
    const dispatcher = createDeepLinkDispatcher({ onSearch: vi.fn(), wait: async () => undefined });
    const link = `tarab://open/play?id=${firstId}`;

    await dispatcher.handle(link);
    await dispatcher.handle(link);

    expect(dbGetTrackMock).toHaveBeenCalledTimes(2);
  });

  it('does not start playback after the dispatcher is disposed during lookup', async () => {
    let finishLookup: ((track: unknown) => void) | undefined;
    dbGetTrackMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    const dispatcher = createDeepLinkDispatcher({ onSearch: vi.fn(), wait: async () => undefined });
    const pending = dispatcher.handle('tarab://open/play?id=' + firstId);

    await waitFor(() => expect(dbGetTrackMock).toHaveBeenCalledTimes(1));
    dispatcher.dispose();
    finishLookup?.({ id: 'stale-track' });
    await pending;

    expect(startPlaybackMock).not.toHaveBeenCalled();
    expect(reportErrorMock).not.toHaveBeenCalled();
  });
  it('serializes and spaces play lookups', async () => {
    let finishFirst: ((track: unknown) => void) | undefined;
    dbGetTrackMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ id: 'second' });
    const wait = vi.fn(async () => undefined);
    const dispatcher = createDeepLinkDispatcher({ onSearch: vi.fn(), now: () => 0, wait });

    const first = dispatcher.handle(`tarab://open/play?id=${firstId}`);
    const second = dispatcher.handle(`tarab://open/play?id=${secondId}`);
    await waitFor(() => expect(dbGetTrackMock).toHaveBeenCalledTimes(1));
    finishFirst?.({ id: 'first' });
    await first;
    await second;

    expect(dbGetTrackMock).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(250);
  });
});
