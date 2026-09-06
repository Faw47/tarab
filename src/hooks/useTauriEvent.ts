import { type Event, type EventCallback, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { type DependencyList, useEffect, useRef } from 'react';

type EventHandler<T> = EventCallback<T>;

export function useTauriEvent<T>(
  eventName: string,
  handler: EventHandler<T>,
  _deps: DependencyList,
  onSetupError?: (error: unknown) => void,
  onReady?: () => void,
): void {
  const handlerRef = useRef(handler);
  const setupErrorRef = useRef(onSetupError);
  const readyRef = useRef(onReady);
  handlerRef.current = handler;
  setupErrorRef.current = onSetupError;
  readyRef.current = onReady;

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    void listen<T>(eventName, (event: Event<T>) => {
      if (!disposed) handlerRef.current(event);
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        readyRef.current?.();
      })
      .catch((error) => {
        if (!disposed) {
          setupErrorRef.current?.(error);
        }
      });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [eventName]);
}
