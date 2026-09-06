import { beforeEach, describe, expect, it, vi } from 'vitest';

const persisted = new Map<string, unknown>();
const writes: Array<{ key: string; value: unknown }> = [];
const { loadPlaybackSessionMock } = vi.hoisted(() => ({
  loadPlaybackSessionMock: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock('../../lib/tauri-commands', () => ({
  loadPlaybackSession: loadPlaybackSessionMock,
  fixedStoreGet: vi.fn(async (_store: string, key: string) => persisted.get(key) ?? null),
  fixedStoreSet: vi.fn(async (_store: string, key: string, value: unknown) => {
    writes.push({ key, value });
    persisted.set(key, value);
  }),
}));

const payload = (timestamp: number) => ({
  version: 1,
  currentTrackId: null,
  queueIds: [],
  queueIndex: -1,
  currentTime: 0,
  playbackSpeed: 1,
  volume: 0.8,
  wasPlaying: false,
  shuffleEnabled: false,
  loopMode: 'all' as const,
  stopAfterCurrent: false,
  lastOpenedAlbum: null,
  lastOpenedArtist: null,
  timestamp,
});

describe('player state persistence', () => {
  beforeEach(() => {
    persisted.clear();
    writes.length = 0;
    loadPlaybackSessionMock.mockReset();
    loadPlaybackSessionMock.mockResolvedValue(null);
    vi.resetModules();
  });

  it('does not save default state before hydration completes', async () => {
    const store = await import('./player-state-store');

    await store.savePlayerStateToStore(payload(1));

    expect(writes).toHaveLength(0);
  });

  it('coalesces pending saves and keeps the latest revision', async () => {
    const store = await import('./player-state-store');
    store.markPlayerStateHydrated();

    await Promise.all([
      store.savePlayerStateToStore(payload(1)),
      store.savePlayerStateToStore(payload(2)),
    ]);
    await store.flushPlayerStateWrites();

    expect(writes).toHaveLength(1);
    const latest = writes[0].value as { revision: number; timestamp: number };
    expect(latest.revision).toBe(2);
    expect(latest.timestamp).toBe(2);
    expect(persisted.get('player-state')).toEqual(writes[0].value);
  });

  it('recovers after a transient write failure', async () => {
    const commands = await import('../../lib/tauri-commands');
    vi.mocked(commands.fixedStoreSet).mockRejectedValueOnce(new Error('disk unavailable'));
    const store = await import('./player-state-store');
    store.markPlayerStateHydrated();

    await expect(store.savePlayerStateToStore(payload(1))).rejects.toThrow('disk unavailable');
    await expect(store.savePlayerStateToStore(payload(2))).resolves.toBeUndefined();
    await expect(store.flushPlayerStateWrites()).resolves.toBeUndefined();

    const latest = persisted.get('player-state') as { timestamp: number };
    expect(latest.timestamp).toBe(2);
  });

  it('migrates version one state without losing queue data', async () => {
    persisted.set('player-state', { ...payload(5), queueIds: ['a', 'b'], revision: 7 });
    const store = await import('./player-state-store');

    const loaded = await store.loadPlayerStateFromStore();

    expect(loaded?.version).toBe(2);
    expect(loaded?.revision).toBe(7);
    expect(loaded?.queueIds).toEqual(['a', 'b']);
  });

  it('rejects malformed fixed-store state and falls back to a valid legacy session', async () => {
    persisted.set('player-state', { ...payload(5), volume: 2 });
    loadPlaybackSessionMock.mockResolvedValueOnce(payload(6));
    const store = await import('./player-state-store');

    const loaded = await store.loadPlayerStateFromStore();

    expect(loaded?.timestamp).toBe(6);
    expect(loaded?.version).toBe(2);
    expect(loadPlaybackSessionMock).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
  });

  it('returns null when both fixed-store and legacy state are malformed', async () => {
    persisted.set('player-state', { ...payload(5), queueIndex: 'bad' });
    loadPlaybackSessionMock.mockResolvedValueOnce({ ...payload(6), loopMode: 'invalid' });

    const store = await import('./player-state-store');

    await expect(store.loadPlayerStateFromStore()).resolves.toBeNull();
    expect(writes).toHaveLength(0);
  });
});
