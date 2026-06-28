import { listen, type Event, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, type DependencyList } from 'react';

type EventHandler<T> = EventCallback<T>;

export function useTauriEvent<T>(
  eventName: string,
  handler: EventHandler<T>,
  deps: DependencyList,
  onSetupError?: (error: unknown) => void,
): void {
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    void listen<T>(eventName, (event: Event<T>) => {
      handler(event);
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch((error) => {
        if (!disposed) {
          onSetupError?.(error);
        }
      });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, deps);
}
