import {
  fixedStoreGet,
  fixedStoreSet,
  loadPlaybackSession,
  type PlaybackSessionPayload,
} from '../../lib/tauri-commands';

const KEY = 'player-state';
const CURRENT_VERSION = 2;

let hydrated = false;
let latestRevision = 0;
let saveQueue: Promise<void> = Promise.resolve();

/**
 * Loads persisted player session from the fixed native store (`tarab-player.dat`, key `player-state`).
 * Migrates once from legacy Rust `session.json` via `load_playback_session` if the store is empty.
 */
export async function loadPlayerStateFromStore(): Promise<PlaybackSessionPayload | null> {
  const raw = await fixedStoreGet<PlaybackSessionPayload>('player', KEY);
  if (raw && typeof raw === 'object' && 'version' in (raw as object)) {
    const session = raw as PlaybackSessionPayload;
    latestRevision = Math.max(latestRevision, session.revision ?? 0);
    return {
      ...session,
      version: CURRENT_VERSION,
      revision: session.revision ?? 0,
    };
  }

  const legacy = await loadPlaybackSession();
  if (legacy) {
    const migrated = { ...legacy, version: CURRENT_VERSION, revision: 0 };
    await fixedStoreSet('player', KEY, migrated);
    return migrated;
  }
  return null;
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
  saveQueue = saveQueue.then(async () => {
    const persisted = await fixedStoreGet<PlaybackSessionPayload>('player', KEY);
    if ((persisted?.revision ?? -1) >= revision) return;
    await fixedStoreSet('player', KEY, next);
  });
  return saveQueue;
}

export async function flushPlayerStateWrites(): Promise<void> {
  await saveQueue;
}
