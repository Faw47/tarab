import { isSameOrSubPath, normalizePath } from '../../lib/path-utils';

/** Above this many distinct changed folders in one debounce window, rescan the whole root. */
export const MAX_WATCH_SCAN_TARGETS = 16;

const trimTrailingSlash = (path: string): string => normalizePath(path).replace(/\/+$/, '');

const parentPath = (path: string): string => {
  const normalized = trimTrailingSlash(path);
  const slash = normalized.lastIndexOf('/');
  return slash > 0 ? normalized.slice(0, slash) : normalized;
};

/** Watcher paths with an extension in their last segment are treated as files. */
const looksLikeFile = (path: string): boolean => {
  const segment = trimTrailingSlash(path).split('/').pop() ?? '';
  const dot = segment.lastIndexOf('.');
  return dot > 0 && dot < segment.length - 1;
};

/**
 * Maps a watcher event path to the library root it belongs to and the smallest folder that needs
 * rescanning: the containing folder for a file, or the path itself for a directory. The target is
 * clamped to the root. Returns null for paths outside every root.
 */
export function resolveWatchScanTarget(
  changedPath: string,
  roots: string[],
): { root: string; target: string } | null {
  const root = roots.find((folder) => isSameOrSubPath(changedPath, folder));
  if (!root) return null;
  const candidate = looksLikeFile(changedPath)
    ? parentPath(changedPath)
    : trimTrailingSlash(changedPath);
  const target = isSameOrSubPath(candidate, root) ? candidate : root;
  return { root, target };
}

/**
 * Removes targets nested inside other targets. Returns just the root when too many folders
 * changed at once (bulk copies or renames), where one root scan is cheaper and simpler.
 */
export function collapseWatchScanTargets(root: string, targets: Iterable<string>): string[] {
  const unique = Array.from(new Set(targets)).sort((a, b) => a.length - b.length);
  const kept: string[] = [];
  for (const target of unique) {
    if (isSameOrSubPath(target, root) && target.length <= trimTrailingSlash(root).length) {
      return [root];
    }
    if (!kept.some((parent) => isSameOrSubPath(target, parent))) {
      kept.push(target);
    }
  }
  return kept.length > MAX_WATCH_SCAN_TARGETS ? [root] : kept;
}
