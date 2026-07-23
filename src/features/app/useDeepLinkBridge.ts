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
  useAsyncCleanup(
    async () => {
      const handled = new Set<string>();
      const handleLink = (url: string) => {
        if (handled.has(url)) return;
        handled.add(url);
        try {
          logger.info(DOMAIN, 'Handling deep link', { url });
          const intent = parseDeepLink(url);
          if (!intent) {
            logger.warn(DOMAIN, 'Ignoring unsupported deep link');
            return;
          }
          if (intent.kind === 'search') {
            onSearch(intent.query);
            return;
          }
          void dbGetTrackByPublicId(intent.publicId)
            .then((track) => {
              if (!track) {
                reportError('The linked track is not in this library', { source: 'deep-link' });
                return;
              }
              return startPlayback(mapDbTrackToTrack(track));
            })
            .catch((error) => {
              reportError('Failed to open the linked track', { source: 'deep-link', error });
            });
        } catch (err) {
          logger.error(DOMAIN, 'Ignoring malformed deep link', err);
        }
      };
      const initial = await deepLinks.getInitial();
      initial.forEach(handleLink);
      return deepLinks.listen(handleLink);
    },
    [onSearch],
    (err) => logger.error(DOMAIN, 'Failed to setup deep link listener', err),
  );
}
