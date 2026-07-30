import { useEffect, useState } from 'react';
import { ipcBatchLimit } from '../lib/ipc-concurrency';
import { cacheGetThumbnailBytes, getCoverArt, resolveCoverArt } from '../lib/tauri-commands';

type CoverArtSize = 'small' | 'medium' | 'large';

const MAX_URL_CACHE_ENTRIES = 300;
const MAX_FALLBACK_BLOB_BYTES = 64 * 1024 * 1024;
const IPC_FALLBACK_WINDOW_MS = 15_000;
const IPC_FALLBACK_MAX_REQUESTS = 1000;
const PROTOCOL_FAILURE_TTL_MS = 5 * 60_000;
const coverArtCache = new Map<string, string | null>();
const fallbackBlobCache = new Map<string, { url: string; byteLength: number }>();
let fallbackBlobCacheBytes = 0;
const inflight = new Map<string, Promise<string | null>>();
const ipcFallbackRequests: number[] = [];
const failedIpcFallbacks = new Set<string>();

const buildCoverArtUrl = (hash: string, size: CoverArtSize = 'large') =>
  `cover-art://localhost/${hash}/${size}`;
const cacheKey = (filePath: string, size: CoverArtSize, hash?: string | null) =>
  `${filePath}::${size}::${hash ?? 'nohash'}`;
const fallbackKey = (hash: string, size: CoverArtSize) => `${hash}:${size}`;
const isPersistableCoverArtUrl = (value: string) => value.startsWith('cover-art://');

const removeCachedBlobUrl = (url: string) => {
  for (const [key, value] of Array.from(coverArtCache.entries())) {
    if (value === url) coverArtCache.delete(key);
  }
};

const revokeBlobUrl = (url: string) => {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  URL.revokeObjectURL(url);
};

const rememberFallbackBlob = (key: string, url: string, byteLength: number) => {
  const previous = fallbackBlobCache.get(key);
  if (previous && previous.url !== url) {
    revokeBlobUrl(previous.url);
    removeCachedBlobUrl(previous.url);
  }
  if (previous) {
    fallbackBlobCache.delete(key);
    fallbackBlobCacheBytes -= previous.byteLength;
  }
  fallbackBlobCache.set(key, { url, byteLength });
  fallbackBlobCacheBytes += byteLength;

  while (fallbackBlobCacheBytes > MAX_FALLBACK_BLOB_BYTES) {
    const firstKey = fallbackBlobCache.keys().next().value;
    if (!firstKey) break;
    const evicted = fallbackBlobCache.get(firstKey);
    fallbackBlobCache.delete(firstKey);
    if (evicted) {
      fallbackBlobCacheBytes -= evicted.byteLength;
      removeCachedBlobUrl(evicted.url);
      revokeBlobUrl(evicted.url);
    }
  }
};

const setWithLimit = (key: string, value: string | null) => {
  if (coverArtCache.has(key)) coverArtCache.delete(key);
  coverArtCache.set(key, value);

  while (coverArtCache.size > MAX_URL_CACHE_ENTRIES) {
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
    if (!isPersistableCoverArtUrl(stored)) {
      sessionStorage.removeItem(key);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
};

const writeSessionCoverArt = (key: string, value: string) => {
  if (!isPersistableCoverArtUrl(value)) return;
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
};

const protocolFailed = (hash: string, size: CoverArtSize): boolean => {
  try {
    const key = `coverart:protocol_failed:${hash}:${size}`;
    const value = Number(sessionStorage.getItem(key));
    if (!Number.isFinite(value) || value <= 0) {
      sessionStorage.removeItem(key);
      return false;
    }
    if (Date.now() - value >= PROTOCOL_FAILURE_TTL_MS) {
      sessionStorage.removeItem(key);
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

const allowIpcFallbackRequest = (): boolean => {
  const now = Date.now();
  while (ipcFallbackRequests.length && now - ipcFallbackRequests[0] > IPC_FALLBACK_WINDOW_MS) {
    ipcFallbackRequests.shift();
  }
  if (ipcFallbackRequests.length >= IPC_FALLBACK_MAX_REQUESTS) return false;
  ipcFallbackRequests.push(now);
  return true;
};

const bytesToBlobUrl = (
  bytes: number[] | Uint8Array,
): { url: string; byteLength: number } | null => {
  if (
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return null;
  }
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return {
    url: URL.createObjectURL(new Blob([body], { type: 'image/webp' })),
    byteLength: body.byteLength,
  };
};

export const markCoverArtProtocolFailed = (hash: string, size: CoverArtSize = 'large') => {
  try {
    sessionStorage.setItem(`coverart:protocol_failed:${hash}:${size}`, String(Date.now()));
  } catch {
    // ignore storage errors
  }
};

export const clearCoverArtProtocolFailed = (hash: string, size: CoverArtSize = 'large') => {
  try {
    sessionStorage.removeItem(`coverart:protocol_failed:${hash}:${size}`);
  } catch {
    // ignore storage errors
  }
};

export const repairCoverArt = async (
  filePath: string,
  coverArtHash: string | null,
  size: CoverArtSize,
): Promise<string | null> => {
  const resolution = await resolveCoverArt(filePath, coverArtHash, size);
  if (resolution.status !== 'ready' || !resolution.hash || !resolution.cacheAvailable) {
    return null;
  }

  clearCoverArtProtocolFailed(resolution.hash, size);
  failedIpcFallbacks.delete(fallbackKey(resolution.hash, size));
  return resolution.hash;
};

export const getCoverArtBlobFallback = async (
  hash: string,
  size: CoverArtSize = 'large',
): Promise<string | null> => {
  const key = fallbackKey(hash, size);
  const cached = fallbackBlobCache.get(key);
  if (cached) {
    fallbackBlobCache.delete(key);
    fallbackBlobCache.set(key, cached);
    return cached.url;
  }
  if (failedIpcFallbacks.has(key)) return null;
  if (!allowIpcFallbackRequest()) return null;

  try {
    const bytes = await cacheGetThumbnailBytes(hash, size);
    if (!bytes || bytes.length === 0) {
      failedIpcFallbacks.add(key);
      return null;
    }
    const blob = bytesToBlobUrl(bytes);
    if (!blob) {
      failedIpcFallbacks.add(key);
      return null;
    }
    rememberFallbackBlob(key, blob.url, blob.byteLength);
    return blob.url;
  } catch {
    failedIpcFallbacks.add(key);
    return null;
  }
};

export const invalidateCoverArtCache = (filePath: string, coverArtHash?: string | null) => {
  for (const key of Array.from(coverArtCache.keys())) {
    if (key.startsWith(`${filePath}::`) || (coverArtHash && key.includes(`::${coverArtHash}`))) {
      coverArtCache.delete(key);
    }
  }
  if (coverArtHash) {
    for (const size of ['small', 'medium', 'large'] as const) {
      const key = fallbackKey(coverArtHash, size);
      const blob = fallbackBlobCache.get(key);
      if (blob) {
        fallbackBlobCache.delete(key);
        fallbackBlobCacheBytes -= blob.byteLength;
        removeCachedBlobUrl(blob.url);
        revokeBlobUrl(blob.url);
      }
      failedIpcFallbacks.delete(key);
      try {
        sessionStorage.removeItem(`coverart:protocol_failed:${coverArtHash}:${size}`);
      } catch {
        // ignore storage errors
      }
    }
  }
};

/**
 * Lazy-load cover art for a track. Returns a local cover-art:// URL, blob fallback URL, or null.
 */
export const useCoverArt = (
  filePath?: string,
  hasCoverArt?: boolean,
  load: boolean = true,
  size: CoverArtSize = 'large',
  coverArtHash?: string | null,
): string | null => {
  const key = filePath ? cacheKey(filePath, size, coverArtHash) : null;
  const initial = (() => {
    if (!filePath || !key) return null;
    const mem = coverArtCache.get(key);
    if (mem !== undefined) return mem;
    const stored = readSessionCoverArt(`coverart:${key}`);
    if (stored !== null) {
      setWithLimit(key, stored);
      return stored;
    }
    if (coverArtHash && !protocolFailed(coverArtHash, size)) {
      const url = buildCoverArtUrl(coverArtHash, size);
      setWithLimit(key, url);
      writeSessionCoverArt(`coverart:${key}`, url);
      return url;
    }
    return null;
  })();

  const [art, setArt] = useState<string | null>(initial);

  useEffect(() => {
    if (!filePath || !load || !key) {
      setArt(null);
      return;
    }

    const resolveHash = (hash: string, cancelledRef: { current: boolean }) => {
      if (protocolFailed(hash, size)) {
        void getCoverArtBlobFallback(hash, size).then((blobUrl) => {
          if (!cancelledRef.current && blobUrl) {
            setArt(blobUrl);
            setWithLimit(key, blobUrl);
          }
        });
        return;
      }

      const url = buildCoverArtUrl(hash, size);
      setArt(url);
      setWithLimit(key, url);
      writeSessionCoverArt(`coverart:${key}`, url);
    };

    const cancelledRef = { current: false };

    if (coverArtHash) {
      resolveHash(coverArtHash, cancelledRef);
      return () => {
        cancelledRef.current = true;
      };
    }

    const cached = coverArtCache.get(key);
    if (cached !== undefined) {
      setArt(cached);
      if (cached !== null || hasCoverArt === false) return;
    }

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

    if (!existing) inflight.set(filePath, promise);

    promise.then((hash) => {
      if (cancelledRef.current) return;
      if (hash) {
        resolveHash(hash, cancelledRef);
      } else {
        setArt(null);
        setWithLimit(key, null);
      }
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [filePath, hasCoverArt, load, size, coverArtHash]);

  return art;
};

export const getCachedCoverArt = (
  filePath: string,
  size: CoverArtSize = 'large',
  coverArtHash?: string | null,
): string | null => coverArtCache.get(cacheKey(filePath, size, coverArtHash)) ?? null;

export const prefetchCoverArtBatch = async (
  entries: { filePath: string; coverArtHash?: string | null; hasCoverArt?: boolean }[],
  size: CoverArtSize = 'medium',
) => {
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
      setWithLimit(key, buildCoverArtUrl(coverArtHash, size));
      return;
    }

    const existing = inflight.get(filePath);
    if (existing) {
      const hash = await existing.catch(() => null);
      if (hash) setWithLimit(key, buildCoverArtUrl(hash, size));
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
    if (hash) setWithLimit(key, buildCoverArtUrl(hash, size));
  };

  await Promise.all(entries.slice(0, 200).map((entry) => ipcBatchLimit(() => runOne(entry))));
};
