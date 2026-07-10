import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';
import { type ReactNode, useState } from 'react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { Toaster } from 'sonner';
import { setLibraryQueryClient } from '../features/library/queryClientBridge';

const QUERY_CACHE_KEY = 'tarab-query-cache';
const PERSIST_MAX_AGE_MS = 86400000;

const idbPersisterStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const fromIdb = await get<string>(key);
    if (fromIdb != null) {
      return fromIdb;
    }
    try {
      const legacy = globalThis.localStorage.getItem(key);
      if (legacy != null) {
        await set(key, legacy);
        globalThis.localStorage.removeItem(key);
      }
      return legacy;
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await set(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    await del(key);
    try {
      globalThis.localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

const persister = createAsyncStoragePersister({
  storage: idbPersisterStorage,
  key: QUERY_CACHE_KEY,
});

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: PERSIST_MAX_AGE_MS,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  setLibraryQueryClient(queryClient);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE_MS,
      }}
    >
      <HotkeysProvider>
        {children}
        <Toaster
          position="top-right"
          richColors
          closeButton
          theme="dark"
          toastOptions={{
            style: {
              background: 'var(--toast-surface)',
              backdropFilter: 'blur(var(--toast-blur))',
              border: '1px solid var(--toast-border)',
              color: 'var(--toast-foreground)',
            },
          }}
        />
      </HotkeysProvider>
    </PersistQueryClientProvider>
  );
}
