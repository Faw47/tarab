import { useAsyncCleanup } from '../../hooks/useAsyncCleanup';
import { startPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { dbGetTrackByPublicId } from '../../lib/tauri-commands';
import { deepLinks } from '../../platform/deepLinks';
import { logger } from '../../platform/logger';
import { mapDbTrackToTrack } from '../library/api';

const DOMAIN = 'DeepLinkBridge';
const PUBLIC_TRACK_ID = /^[a-f0-9]{64}$/i;
const MAX_SEARCH_QUERY_LENGTH = 200;
const SUCCESS_DEDUPE_TTL_MS = 5_000;
const SUCCESS_DEDUPE_LIMIT = 100;
const MAX_PENDING_PLAY_LOOKUPS = 20;
const PLAY_LOOKUP_INTERVAL_MS = 250;

export type DeepLinkIntent = { kind: 'search'; query: string } | { kind: 'play'; publicId: string };

export const parseDeepLink = (value: string): DeepLinkIntent | null => {
  const url = new URL(value);
  if (url.protocol !== 'tarab:' || url.hostname !== 'open' || url.username || url.password) {
    return null;
  }
  const path = url.pathname.replace(/^\/+|\/+$/g, '');
  if (path === 'search') {
    const query = url.searchParams.get('q')?.trim() ?? '';
    if (!query || query.length > MAX_SEARCH_QUERY_LENGTH) return null;
    return { kind: 'search', query };
  }
  if (path === 'play') {
    const publicId = url.searchParams.get('id') ?? '';
    if (!PUBLIC_TRACK_ID.test(publicId)) return null;
    return { kind: 'play', publicId: publicId.toLowerCase() };
  }
  return null;
};

interface UseDeepLinkBridgeOptions {
  onSearch: (query: string) => void;
}

interface DeepLinkDispatcher {
  handle: (url: string) => Promise<void>;
  dispose: () => void;
}

interface DeepLinkDispatcherOptions extends UseDeepLinkBridgeOptions {
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  state?: DeepLinkDispatchState;
}

interface DeepLinkDispatchState {
  recentSuccesses: Map<string, number>;
  pendingPlayLinks: Set<string>;
  nextPlayLookupAt: number;
  playLookupTail: Promise<void>;
}

const createDeepLinkDispatchState = (): DeepLinkDispatchState => ({
  recentSuccesses: new Map(),
  pendingPlayLinks: new Set(),
  nextPlayLookupAt: 0,
  playLookupTail: Promise.resolve(),
});

const bridgeDispatchState = createDeepLinkDispatchState();

const waitFor = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createDeepLinkDispatcher({
  onSearch,
  now = Date.now,
  wait = waitFor,
  state = createDeepLinkDispatchState(),
}: DeepLinkDispatcherOptions): DeepLinkDispatcher {
  let disposed = false;

  const pruneSuccesses = (currentTime: number) => {
    for (const [key, completedAt] of state.recentSuccesses) {
      if (currentTime - completedAt <= SUCCESS_DEDUPE_TTL_MS) break;
      state.recentSuccesses.delete(key);
    }
  };

  const wasRecentlySuccessful = (key: string) => {
    const currentTime = now();
    pruneSuccesses(currentTime);
    return state.recentSuccesses.has(key);
  };

  const rememberSuccess = (key: string) => {
    state.recentSuccesses.delete(key);
    state.recentSuccesses.set(key, now());
    while (state.recentSuccesses.size > SUCCESS_DEDUPE_LIMIT) {
      const oldest = state.recentSuccesses.keys().next().value;
      if (!oldest) break;
      state.recentSuccesses.delete(oldest);
    }
  };

  const handle = async (url: string): Promise<void> => {
    if (disposed) return;
    let intent: DeepLinkIntent | null;
    try {
      intent = parseDeepLink(url);
    } catch (error) {
      logger.error(DOMAIN, 'Ignoring malformed deep link', error);
      return;
    }
    if (!intent) {
      logger.warn(DOMAIN, 'Ignoring unsupported deep link');
      return;
    }

    const key = intent.kind === 'search' ? `search:${intent.query}` : `play:${intent.publicId}`;
    if (wasRecentlySuccessful(key)) return;

    logger.info(DOMAIN, 'Handling deep link', { kind: intent.kind });
    if (intent.kind === 'search') {
      try {
        onSearch(intent.query);
        rememberSuccess(key);
      } catch (error) {
        logger.error(DOMAIN, 'Failed to handle deep-link search', error);
      }
      return;
    }

    if (state.pendingPlayLinks.has(key)) return;
    if (state.pendingPlayLinks.size >= MAX_PENDING_PLAY_LOOKUPS) {
      logger.warn(DOMAIN, 'Dropping deep-link play request because the queue is full');
      return;
    }
    state.pendingPlayLinks.add(key);
    const publicId = intent.publicId;

    const runLookup = async () => {
      try {
        if (disposed) return;
        const delay = Math.max(0, state.nextPlayLookupAt - now());
        if (delay > 0) await wait(delay);
        if (disposed) return;
        state.nextPlayLookupAt = now() + PLAY_LOOKUP_INTERVAL_MS;

        const track = await dbGetTrackByPublicId(publicId);
        if (disposed) return;
        if (!track) {
          reportError('The linked track is not in this library', { source: 'deep-link' });
          return;
        }
        await startPlayback(mapDbTrackToTrack(track));
        if (!disposed) rememberSuccess(key);
      } catch (error) {
        if (!disposed) {
          reportError('Failed to open the linked track', { source: 'deep-link', error });
        }
      } finally {
        state.pendingPlayLinks.delete(key);
      }
    };

    const queued = state.playLookupTail.then(runLookup, runLookup);
    state.playLookupTail = queued.catch(() => undefined);
    await queued;
  };

  return {
    handle,
    dispose: () => {
      disposed = true;
    },
  };
}

/**
 * Hook to handle incoming deep links.
 * Routes deep links to application actions.
 */
export function useDeepLinkBridge({ onSearch }: UseDeepLinkBridgeOptions) {
  useAsyncCleanup(
    async () => {
      const dispatcher = createDeepLinkDispatcher({ onSearch, state: bridgeDispatchState });
      const unlisten = await deepLinks.listen((url) => {
        void dispatcher.handle(url);
      });
      try {
        const initial = await deepLinks.getInitial();
        initial.forEach((url) => void dispatcher.handle(url));
      } catch (error) {
        unlisten();
        dispatcher.dispose();
        throw error;
      }
      return () => {
        unlisten();
        dispatcher.dispose();
      };
    },
    [onSearch],
    (err) => logger.error(DOMAIN, 'Failed to setup deep link listener', err),
  );
}
