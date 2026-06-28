import { useAsyncCleanup } from '../../hooks/useAsyncCleanup';
import { deepLinks } from '../../platform/deepLinks';
import { logger } from '../../platform/logger';

const DOMAIN = 'DeepLinkBridge';

/**
 * Hook to handle incoming deep links.
 * Routes deep links to application actions.
 */
export function useDeepLinkBridge() {
  useAsyncCleanup(
    () =>
      deepLinks.listen((url) => {
        try {
          logger.info(DOMAIN, 'Handling deep link', { url });

          const uri = new URL(url);
          const path = uri.pathname.replace(/^\/+/, '');

          switch (path) {
            case 'play':
              break;
            case 'search': {
              const query = uri.searchParams.get('q');
              if (query) {
                // Search routing will be wired when deep-link search UI is implemented.
              }
              break;
            }
            default:
              logger.warn(DOMAIN, 'Unknown deep link path', { path });
          }
        } catch (err) {
          logger.warn(DOMAIN, 'Ignoring malformed deep link', { url, err });
        }
      }),
    [],
    (err) => logger.error(DOMAIN, 'Failed to setup deep link listener', err),
  );
}
