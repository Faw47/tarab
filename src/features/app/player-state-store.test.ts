import { beforeEach, describe, expect, it, vi } from 'vitest';

const persisted = new Map<string, unknown>();
const writes: Array<{ key: string; value: unknown }> = [];

vi.mock('../../lib/tauri-commands', () => ({
  loadPlaybackSession: vi.fn(async () => null),
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
  loopMode: 'all',
  stopAfterCurrent: false,
  lastOpenedAlbum: null,
  lastOpenedArtist: null,
  timestamp,
});

describe('player state persistence', () => {
  beforeEach(() => {
    persisted.clear();
    writes.length = 0;
    vi.resetModules();
  });

  it('does not save default state before hydration completes', async () => {
    const store = await import('./player-state-store');

    await store.savePlayerStateToStore(payload(1));

    expect(writes).toHaveLength(0);
  });

  it('serializes saves and keeps the latest revision', async () => {
    const store = await import('./player-state-store');
    store.markPlayerStateHydrated();

    await Promise.all([
      store.savePlayerStateToStore(payload(1)),
      store.savePlayerStateToStore(payload(2)),
    ]);
    await store.flushPlayerStateWrites();

    expect(writes).toHaveLength(2);
    const first = writes[0].value as { revision: number; timestamp: number };
    const second = writes[1].value as { revision: number; timestamp: number };
    expect(first.revision).toBeLessThan(second.revision);
    expect(second.timestamp).toBe(2);
    expect(persisted.get('player-state')).toEqual(writes[1].value);
  });

  it('migrates version one state without losing queue data', async () => {
    persisted.set('player-state', { ...payload(5), queueIds: ['a', 'b'], revision: 7 });
    const store = await import('./player-state-store');

    const loaded = await store.loadPlayerStateFromStore();

    expect(loaded?.version).toBe(2);
    expect(loaded?.revision).toBe(7);
    expect(loaded?.queueIds).toEqual(['a', 'b']);
  });
});
