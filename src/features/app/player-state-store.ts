import { load } from '@tauri-apps/plugin-store';
import { loadPlaybackSession, type PlaybackSessionPayload } from '../../lib/tauri-commands';

const STORE_PATH = 'tarab-player.dat';
const KEY = 'player-state';

let storePromise: ReturnType<typeof load> | null = null;

const getPlayerStore = () => {
  if (!storePromise) {
    storePromise = load(STORE_PATH, { autoSave: true, defaults: {} });
  }
  return storePromise;
};

/**
 * Loads persisted player session from the plugin store (`tarab-player.dat`, key `player-state`).
 * Migrates once from legacy Rust `session.json` via `load_playback_session` if the store is empty.
 */
export async function loadPlayerStateFromStore(): Promise<PlaybackSessionPayload | null> {
  const store = await getPlayerStore();
  const raw = await store.get(KEY);
  if (raw && typeof raw === 'object' && 'version' in (raw as object)) {
    return raw as PlaybackSessionPayload;
  }

  const legacy = await loadPlaybackSession();
  if (legacy) {
    await store.set(KEY, legacy);
    return legacy;
  }
  return null;
}

export async function savePlayerStateToStore(session: PlaybackSessionPayload): Promise<void> {
  const store = await getPlayerStore();
  await store.set(KEY, session);
}
