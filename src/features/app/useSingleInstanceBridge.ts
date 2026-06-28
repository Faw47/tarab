import { useAsyncCleanup } from '../../hooks/useAsyncCleanup';
import { logger } from '../../platform/logger';
import { setupSingleInstanceListener } from '../../platform/singleInstance';

const DOMAIN = 'SingleInstanceBridge';

/**
 * Hook to handle second instance launches.
 * This should be used at the root of the application.
 */
export function useSingleInstanceBridge(onSecondInstance?: (argv: string[], cwd: string) => void) {
  useAsyncCleanup(
    () =>
      setupSingleInstanceListener((payload) => {
        logger.info(DOMAIN, 'Handling second instance launch', { argv: payload.argv });
        if (onSecondInstance) {
          onSecondInstance(payload.argv, payload.cwd);
        }
      }),
    [onSecondInstance],
    (err) => logger.error(DOMAIN, 'Failed to setup single instance listener', err),
  );
}
