import {
  fixedStoreGet,
  fixedStoreSet,
  loadPlaybackSession,
  type PlaybackSessionPayload,
} from '../../lib/tauri-commands';
import { PlaybackSessionSchema } from '../../lib/validation/session';

const KEY = 'player-state';
const CURRENT_VERSION = 2;

let hydrated = false;
let hydrationWaiters: Array<() => void> = [];
let latestRevision = 0;

interface PendingSave {
  revision: number;
  session: PlaybackSessionPayload;
}

interface SaveWaiter {
  revision: number;
  resolve: () => void;
  reject: (error: unknown) => void;
}

let pendingSave: PendingSave | null = null;
let saveWaiters: SaveWaiter[] = [];
let saveWorker: Promise<void> | null = null;
let lastWriteError: unknown = null;

function settleWaiters(revision: number, error?: unknown): void {
  const settled = saveWaiters.filter((waiter) => waiter.revision <= revision);
  saveWaiters = saveWaiters.filter((waiter) => waiter.revision > revision);
  for (const waiter of settled) {
    if (error === undefined) waiter.resolve();
    else waiter.reject(error);
  }
}

async function drainPendingSaves(): Promise<void> {
  while (pendingSave) {
    const next = pendingSave;
    pendingSave = null;
    try {
      const persisted = await fixedStoreGet<PlaybackSessionPayload>('player', KEY);
      if ((persisted?.revision ?? -1) < next.revision) {
        await fixedStoreSet('player', KEY, next.session);
      }
      lastWriteError = null;
      settleWaiters(next.revision);
    } catch (error) {
      lastWriteError = error;
      settleWaiters(next.revision, error);
    }
  }
}

function startSaveWorker(): void {
  if (saveWorker) return;
  saveWorker = Promise.resolve()
    .then(drainPendingSaves)
    .finally(() => {
      saveWorker = null;
      if (pendingSave) startSaveWorker();
    });
}

/**
 * Loads persisted player session from the fixed native store (`tarab-player.dat`, key `player-state`).
 * Migrates once from legacy Rust `session.json` via `load_playback_session` if the store is empty.
 */
const parsePlaybackSession = (raw: unknown): PlaybackSessionPayload | null => {
  const parsed = PlaybackSessionSchema.safeParse(raw);
  if (!parsed.success) return null;

  return {
    ...parsed.data,
    version: CURRENT_VERSION,
    revision: parsed.data.revision ?? 0,
    lastView: parsed.data.lastView ?? undefined,
    lastOpenedAlbum: parsed.data.lastOpenedAlbum ?? null,
    lastOpenedArtist: parsed.data.lastOpenedArtist ?? null,
    lastOpenedAlbumKey: parsed.data.lastOpenedAlbumKey ?? null,
  };
};

export async function loadPlayerStateFromStore(): Promise<PlaybackSessionPayload | null> {
  const raw = await fixedStoreGet<unknown>('player', KEY);
  const stored = parsePlaybackSession(raw);
  if (stored) {
    latestRevision = Math.max(latestRevision, stored.revision ?? 0);
    return stored;
  }

  const legacy = parsePlaybackSession(await loadPlaybackSession());
  if (legacy) {
    const migrated = { ...legacy, version: CURRENT_VERSION, revision: 0 };
    await fixedStoreSet('player', KEY, migrated);
    return migrated;
  }
  return null;
}

export function markPlayerStateHydrated(): void {
  hydrated = true;
  const waiters = hydrationWaiters;
  hydrationWaiters = [];
  for (const resolve of waiters) resolve();
}

export function isPlayerStateHydrated(): boolean {
  return hydrated;
}

export function waitForPlayerStateHydration(): Promise<void> {
  if (hydrated) return Promise.resolve();
  return new Promise((resolve) => hydrationWaiters.push(resolve));
}

export function savePlayerStateToStore(session: PlaybackSessionPayload): Promise<void> {
  if (!hydrated) return Promise.resolve();

  const revision = ++latestRevision;
  const next = { ...session, version: CURRENT_VERSION, revision };
  pendingSave = { revision, session: next };
  const result = new Promise<void>((resolve, reject) => {
    saveWaiters.push({ revision, resolve, reject });
  });
  startSaveWorker();
  return result;
}

export async function flushPlayerStateWrites(): Promise<void> {
  while (saveWorker) {
    await saveWorker;
  }
  if (lastWriteError !== null) throw lastWriteError;
}
