import { listen } from '@tauri-apps/api/event';
import { logger } from './logger';

const DOMAIN = 'SingleInstance';

export interface SecondInstancePayload {
  argumentCount: number;
}

/**
 * Listen for second instance launch events and handle incoming arguments.
 */
export async function setupSingleInstanceListener(
  onLaunch: (payload: SecondInstancePayload) => void,
) {
  logger.debug(DOMAIN, 'Setting up second-instance listener');

  return await listen<SecondInstancePayload>('app://second-instance', (event) => {
    logger.info(DOMAIN, 'Second instance detected', {
      argumentCount: event.payload.argumentCount,
    });
    onLaunch(event.payload);
  });
}
