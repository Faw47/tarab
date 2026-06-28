import { useEffect, useState } from 'react';
import { ipcBatchLimit } from '../lib/ipc-concurrency';
import { cacheGetThumbnailDataUrl, getCoverArt } from '../lib/tauri-commands';

// Simple in-memory caches so multiple components share results
const MAX_CACHE = 300;
const MAX_DATA_URL_LENGTH = 3_000_000;
const IPC_FALLBACK_WINDOW_MS = 15_000;
const IPC_FALLBACK_MAX_REQUESTS = 1000;
const coverArtCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
const ipcFallbackRequests: number[] = [];
const failedIpcFallbacks = new Set<string>();

// Detect if we're on Windows where cover-art:// protocol doesn't work
const isWindows = typeof navigator !== 'undefined' && navigator.platform.includes('Win');

// Check if protocol is known to be unsupported (Windows or previously failed)
const isProtocolUnsupported = (): boolean => {
  if (isWindows) return true;
  try {
    return sessionStorage.getItem('coverart:protocol_unsupported') === 'true';
  } catch {
    return false;
  }
};

const buildCoverArtUrl = (hash: string, size: 'small' | 'medium' | 'large' = 'large') =>
  `cover-art://localhost/${hash}/${size}`;
const cacheKey = (filePath: string, size: 'small' | 'medium' | 'large', hash?: string | null) =>
  `${filePath}::${size}::${hash ?? 'nohash'}`;

const setWithLimit = (key: string, value: string | null) => {
  if (coverArtCache.has(key)) {
    coverArtCache.delete(key);
  }
  coverArtCache.set(key, value);
  // Simple LRU eviction
  while (coverArtCache.size > MAX_CACHE) {
    const firstKey = coverArtCache.keys().next().value;
    if (firstKey !== undefined) {
      coverArtCache.delete(firstKey);
    } else {
      break;
    }
  }
};

const readSessionCoverArt = (key: string): string | null => {
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;
    // Avoid reviving oversized data URLs from stale caches.
    if (stored.startsWith('data:image/')) {
      sessionStorage.removeItem(key);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
};

const writeSessionCoverArt = (key: string, value: string) => {
  // Never persist data URLs to session storage; they bloat memory and reload cost.
  if (value.startsWith('data:image/')) return;
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
};

const allowIpcFallbackRequest = (): boolean => {
  const now = Date.now();
  while (ipcFallbackRequests.length && now - ipcFallbackRequests[0] > IPC_FALLBACK_WINDOW_MS) {
    ipcFallbackRequests.shift();
  }
  if (ipcFallbackRequests.length >= IPC_FALLBACK_MAX_REQUESTS) {
    return false;
  }
  ipcFallbackRequests.push(now);
  return true;
};

export const markCoverArtProtocolFailed = (
  hash: string,
  size: 'small' | 'medium' | 'large' = 'large',
) => {
  try {
    sessionStorage.setItem(`coverart:protocol_failed:${hash}:${size}`, 'true');
  } catch {
    // ignore storage errors
  }
};

export const getCoverArtDataUrlFallback = async (
  hash: string,
  size: 'small' | 'medium' | 'large' = 'large',
): Promise<string | null> => {
  const key = `${hash}:${size}`;
  if (failedIpcFallbacks.has(key)) return null;
  if (!allowIpcFallbackRequest()) return null;
  try {
    const dataUrl = await cacheGetThumbnailDataUrl(hash, size);
    if (dataUrl && dataUrl.length <= MAX_DATA_URL_LENGTH) {
      return dataUrl;
    }
  } catch {
    // fall through to failure cache
  }
  failedIpcFallbacks.add(key);
  return null;
};

export const invalidateCoverArtCache = (filePath: string, coverArtHash?: string | null) => {
  for (const key of Array.from(coverArtCache.keys())) {
    if (key.startsWith(`${filePath}::`) || (coverArtHash && key.includes(`::${coverArtHash}`))) {
      coverArtCache.delete(key);
    }
  }
  if (coverArtHash) {
    for (const size of ['small', 'medium', 'large'] as const) {
      failedIpcFallbacks.delete(`${coverArtHash}:${size}`);
      try {
        sessionStorage.removeItem(`coverart:protocol_failed:${coverArtHash}:${size}`);
      } catch {
        // ignore storage errors
      }
    }
  }
};

/**
 * Lazy-load cover art for a track. Returns a local cover-art:// URL or null.
 */
export const useCoverArt = (
  filePath?: string,
  hasCoverArt?: boolean,
  load: boolean = true,
  size: 'small' | 'medium' | 'large' = 'large',
  coverArtHash?: string | null,
): string | null => {
  const key = filePath ? cacheKey(filePath, size, coverArtHash) : null;
  const initial = (() => {
    if (!filePath || !key) return null;
    // On Windows, don't return protocol URLs from initial state - will be fetched via IPC
    if (isProtocolUnsupported()) {
      // Check if we have a cached data URL
      const mem = coverArtCache.get(key);
      if (mem !== undefined && !mem?.startsWith('cover-art://')) return mem;
      return null;
    }
    if (coverArtHash) {
      const url = buildCoverArtUrl(coverArtHash, size);
      setWithLimit(key, url);
      writeSessionCoverArt(`coverart:${key}`, url);
      return url;
    }
    const mem = coverArtCache.get(key);
    if (mem !== undefined) return mem;
    const stored = readSessionCoverArt(`coverart:${key}`);
    if (stored !== null) {
      setWithLimit(key, stored);
      return stored;
    }
    return null;
  })();

  const [art, setArt] = useState<string | null>(initial);

  // Fallback function to get cover art via IPC if protocol fails
  const getCoverArtViaIPC = async (hash: string): Promise<string | null> => {
    if (!allowIpcFallbackRequest()) {
      return null;
    }
    try {
      return await getCoverArtDataUrlFallback(hash, size);
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!filePath || !load || !key) {
      setArt(null);
      return;
    }

    // Fast path: if we already have a hash, build the URL and cache it without IPC
    if (coverArtHash) {
      // On Windows or if protocol is known to be unsupported, use IPC directly
      const protocolFailedKey = `coverart:protocol_failed:${coverArtHash}:${size}`;
      let shouldUseIPC = isProtocolUnsupported();

      if (!shouldUseIPC) {
        try {
          const failed = sessionStorage.getItem(protocolFailedKey);
          if (failed === 'true') {
            shouldUseIPC = true;
          }
        } catch {
          // ignore storage errors
        }
      }

      if (shouldUseIPC) {
        // Protocol unsupported or failed before, use IPC directly
        let cancelled = false;
        getCoverArtViaIPC(coverArtHash).then((dataUrl) => {
          if (!cancelled && dataUrl) {
            setArt(dataUrl);
            setWithLimit(key, dataUrl);
          }
        });
        return () => {
          cancelled = true;
        };
      }

      // Try protocol URL first (works on macOS)
      const url = buildCoverArtUrl(coverArtHash, size);
      setWithLimit(key, url);
      setArt(url);
      writeSessionCoverArt(`coverart:${key}`, url);
      return;
    }

    const cached = coverArtCache.get(key);
    if (cached !== undefined) {
      setArt(cached);
      // If we know there should be art (hasCoverArt not explicitly false), allow a refresh
      // when the cache has a null entry so we can recover from past failures.
      if (cached !== null || hasCoverArt === false) {
        return;
      }
    }

    let cancelled = false;
    const existing = inflight.get(filePath);
    const promise =
      existing ??
      getCoverArt(filePath)
        .then((result) => {
          inflight.delete(filePath);
          return result;
        })
        .catch((err) => {
          console.error('Failed to fetch cover art:', err);
          inflight.delete(filePath);
          return null;
        });

    if (!existing) {
      inflight.set(filePath, promise);
    }

    promise.then((hash) => {
      if (!cancelled && hash) {
        // On Windows or if protocol is known to be unsupported, use IPC directly
        const protocolFailedKey = `coverart:protocol_failed:${hash}:${size}`;
        let shouldUseIPC = isProtocolUnsupported();

        if (!shouldUseIPC) {
          try {
            const failed = sessionStorage.getItem(protocolFailedKey);
            if (failed === 'true') {
              shouldUseIPC = true;
            }
          } catch {
            // ignore storage errors
          }
        }

        if (shouldUseIPC) {
          // Protocol unsupported or failed before, use IPC directly
          getCoverArtViaIPC(hash).then((dataUrl) => {
            if (!cancelled && dataUrl) {
              setArt(dataUrl);
              setWithLimit(key, dataUrl);
            }
          });
        } else {
          // Try protocol URL first (works on macOS)
          const protocolUrl = buildCoverArtUrl(hash, size);
          setArt(protocolUrl);
          setWithLimit(key, protocolUrl);
          writeSessionCoverArt(`coverart:${key}`, protocolUrl);
        }
      } else if (!cancelled) {
        setArt(null);
        setWithLimit(key, null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, hasCoverArt, load, size, coverArtHash]);

  return art;
};

export const getCachedCoverArt = (
  filePath: string,
  size: 'small' | 'medium' | 'large' = 'large',
  coverArtHash?: string | null,
): string | null => coverArtCache.get(cacheKey(filePath, size, coverArtHash)) ?? null;

export const prefetchCoverArtBatch = async (
  entries: { filePath: string; coverArtHash?: string | null; hasCoverArt?: boolean }[],
  size: 'small' | 'medium' | 'large' = 'medium',
) => {
  const useIPC = isProtocolUnsupported();

  const runOne = async ({
    filePath,
    coverArtHash,
    hasCoverArt,
  }: {
    filePath: string;
    coverArtHash?: string | null;
    hasCoverArt?: boolean;
  }) => {
    if (!filePath || hasCoverArt === false) return;
    const key = cacheKey(filePath, size, coverArtHash);
    if (coverArtCache.has(key)) return;
    if (coverArtHash) {
      if (useIPC) {
        try {
          if (!allowIpcFallbackRequest()) return;
          const dataUrl = await cacheGetThumbnailDataUrl(coverArtHash, size);
          if (dataUrl && dataUrl.length <= MAX_DATA_URL_LENGTH) {
            setWithLimit(key, dataUrl);
          }
        } catch {
          // ignore errors
        }
      } else {
        const url = buildCoverArtUrl(coverArtHash, size);
        setWithLimit(key, url);
      }
      return;
    }
    if (inflight.has(filePath)) {
      const existing = inflight.get(filePath);
      if (existing) {
        const hash = await existing.catch(() => null);
        if (hash) {
          if (useIPC) {
            try {
              if (!allowIpcFallbackRequest()) return;
              const dataUrl = await cacheGetThumbnailDataUrl(hash, size);
              if (dataUrl && dataUrl.length <= MAX_DATA_URL_LENGTH) {
                setWithLimit(key, dataUrl);
              }
            } catch {
              // ignore errors
            }
          } else {
            const url = buildCoverArtUrl(hash, size);
            setWithLimit(key, url);
          }
        }
      }
      return;
    }
    const promise = ipcBatchLimit(() =>
      getCoverArt(filePath)
        .then((hash) => {
          inflight.delete(filePath);
          return hash;
        })
        .catch(() => {
          inflight.delete(filePath);
          return null;
        }),
    );
    inflight.set(filePath, promise);
    const hash = await promise;
    if (hash) {
      if (useIPC) {
        try {
          if (!allowIpcFallbackRequest()) return;
          const dataUrl = await ipcBatchLimit(() => cacheGetThumbnailDataUrl(hash, size));
          if (dataUrl && dataUrl.length <= MAX_DATA_URL_LENGTH) {
            setWithLimit(key, dataUrl);
          }
        } catch {
          // ignore errors
        }
      } else {
        const url = buildCoverArtUrl(hash, size);
        setWithLimit(key, url);
      }
    }
  };

  await Promise.all(entries.slice(0, 200).map((entry) => ipcBatchLimit(() => runOne(entry))));
};
