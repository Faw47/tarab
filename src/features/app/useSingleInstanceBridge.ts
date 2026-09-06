import { useAsyncCleanup } from '../../hooks/useAsyncCleanup';
import { logger } from '../../platform/logger';
import { setupSingleInstanceListener } from '../../platform/singleInstance';

const DOMAIN = 'SingleInstanceBridge';

/**
 * Hook to handle second instance launches.
 * This should be used at the root of the application.
 */
export function useSingleInstanceBridge(onSecondInstance?: () => void) {
  useAsyncCleanup(
    () =>
      setupSingleInstanceListener((payload) => {
        logger.info(DOMAIN, 'Handling second instance launch', {
          argumentCount: payload.argumentCount,
        });
        if (onSecondInstance) {
          onSecondInstance();
        }
      }),
    [onSecondInstance],
    (err) => logger.error(DOMAIN, 'Failed to setup single instance listener', err),
  );
}
