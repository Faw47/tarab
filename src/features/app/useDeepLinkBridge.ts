import { useEffect, useRef } from 'react';
import { startPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { dbGetTrackByPublicId } from '../../lib/tauri-commands';
import { deepLinks } from '../../platform/deepLinks';
import { logger } from '../../platform/logger';
import { mapDbTrackToTrack } from '../library/api';

const DOMAIN = 'DeepLinkBridge';
const PUBLIC_TRACK_ID = /^[a-f0-9]{64}$/i;
const MAX_SEARCH_QUERY_LENGTH = 200;

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

/**
 * Hook to handle incoming deep links.
 * Routes deep links to application actions.
 */
export function useDeepLinkBridge({ onSearch }: UseDeepLinkBridgeOptions) {
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let readingStartup = true;
    const startupEvents = new Set<string>();

    const handleLink = (url: string) => {
      if (disposed) return;
      try {
        logger.info(DOMAIN, 'Handling deep link', { url });
        const intent = parseDeepLink(url);
        if (!intent) {
          logger.warn(DOMAIN, 'Ignoring unsupported deep link');
          return;
        }
        if (intent.kind === 'search') {
          onSearchRef.current(intent.query);
          return;
        }
        void dbGetTrackByPublicId(intent.publicId)
          .then((track) => {
            if (disposed) return;
            if (!track) {
              reportError('The linked track is not in this library', { source: 'deep-link' });
              return;
            }
            return startPlayback(mapDbTrackToTrack(track));
          })
          .catch((error) => {
            if (!disposed) {
              reportError('Failed to open the linked track', { source: 'deep-link', error });
            }
          });
      } catch (err) {
        logger.error(DOMAIN, 'Ignoring malformed deep link', err);
      }
    };

    const readStartup = async () => {
      try {
        const initial = await deepLinks.getInitial();
        if (disposed) return;
        for (const url of new Set(initial)) {
          if (!startupEvents.has(url)) handleLink(url);
        }
      } catch (error) {
        if (!disposed) logger.error(DOMAIN, 'Failed to read startup deep links', error);
      } finally {
        readingStartup = false;
        startupEvents.clear();
      }
    };

    // Finish registration before reading the snapshot. Events received in the meantime
    // are real intents; suppress only their copies in the startup snapshot.
    void deepLinks
      .listen((url) => {
        if (disposed) return;
        if (readingStartup) startupEvents.add(url);
        handleLink(url);
      })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unsubscribe = cleanup;
        void readStartup();
      })
      .catch((error) => {
        if (!disposed) logger.error(DOMAIN, 'Failed to setup deep link listener', error);
      });

    return () => {
      disposed = true;
      startupEvents.clear();
      unsubscribe?.();
    };
  }, []);
}
