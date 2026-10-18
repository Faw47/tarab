import {
  fixedStoreGet,
  fixedStoreSet,
  loadPlaybackSession,
  type PlaybackSessionPayload,
} from '../../lib/tauri-commands';

const KEY = 'player-state';
const QUEUE_KEY = 'queue';
const CURRENT_VERSION = 3;

let hydrated = false;
let latestRevision = 0;
let saveQueue: Promise<void> = Promise.resolve();
/** Queue IDs last written to the queue store; null means the next save writes them. */
let lastWrittenQueue: string[] | null = null;

const sameIds = (a: string[], b: string[] | null) =>
  b !== null && a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Loads persisted player session from the fixed native stores: small state in `tarab-player.dat`
 * (key `player-state`) and the queue in `tarab-player-queue.dat` (key `queue`). Sessions saved
 * before the split keep their queue inline. Migrates once from legacy Rust `session.json` via
 * `load_playback_session` if the store is empty.
 */
export async function loadPlayerStateFromStore(): Promise<PlaybackSessionPayload | null> {
  const raw = await fixedStoreGet<Partial<PlaybackSessionPayload>>('player', KEY);
  if (raw && typeof raw === 'object' && 'version' in raw) {
    const inlineQueue = Array.isArray(raw.queueIds) ? raw.queueIds : null;
    const queueIds =
      inlineQueue ??
      (await fixedStoreGet<{ queueIds: string[] }>('player-queue', QUEUE_KEY))?.queueIds ??
      [];
    // An inline queue is written to the queue store on the next save.
    lastWrittenQueue = inlineQueue ? null : [...queueIds];
    latestRevision = Math.max(latestRevision, raw.revision ?? 0);
    return {
      ...(raw as PlaybackSessionPayload),
      queueIds,
      version: CURRENT_VERSION,
      revision: raw.revision ?? 0,
    };
  }

  const legacy = await loadPlaybackSession();
  if (legacy) {
    const migrated = { ...legacy, version: CURRENT_VERSION, revision: 0 };
    await writeSession(migrated);
    return migrated;
  }
  return null;
}

/**
 * Writes the queue only when its IDs changed, then the small state. Position saves every few
 * seconds therefore no longer rewrite a large queue, and nothing is read back first: every save
 * goes through `saveQueue` in revision order.
 */
async function writeSession(session: PlaybackSessionPayload): Promise<void> {
  const { queueIds, ...state } = session;
  if (!sameIds(queueIds, lastWrittenQueue)) {
    await fixedStoreSet('player-queue', QUEUE_KEY, { queueIds, revision: session.revision });
    lastWrittenQueue = [...queueIds];
  }
  await fixedStoreSet('player', KEY, state);
}

export function markPlayerStateHydrated(): void {
  hydrated = true;
}

export function isPlayerStateHydrated(): boolean {
  return hydrated;
}

export function savePlayerStateToStore(session: PlaybackSessionPayload): Promise<void> {
  if (!hydrated) return Promise.resolve();

  const revision = ++latestRevision;
  const next = { ...session, version: CURRENT_VERSION, revision };
  const write = saveQueue.then(() => writeSession(next));
  // A failed write rejects for its caller only; later saves and flushes must still run.
  saveQueue = write.catch(() => undefined);
  return write;
}

export async function flushPlayerStateWrites(): Promise<void> {
  await saveQueue;
}
