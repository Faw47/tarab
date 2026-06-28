import { useEffect, type DependencyList } from 'react';

export function useAsyncCleanup(
  setup: () => Promise<() => void>,
  deps: DependencyList,
  onSetupError?: (error: unknown) => void,
): void {
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    void setup()
      .then((resolvedCleanup) => {
        if (disposed) {
          resolvedCleanup();
          return;
        }
        cleanup = resolvedCleanup;
      })
      .catch((error) => {
        if (!disposed) {
          onSetupError?.(error);
        }
      });

    return () => {
      disposed = true;
      if (cleanup) {
        cleanup();
      }
    };
  }, deps);
}
