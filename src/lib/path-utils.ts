/**
 * Normalize file paths to use forward slashes consistently.
 * This ensures cross-platform compatibility between macOS (/) and Windows (\).
 */
export const normalizePath = (path: string): string => path.replace(/\\/g, '/');

export const getPathBaseName = (path: string): string => {
  const normalized = normalizePath(path).replace(/\/+$/, '');
  if (!normalized) return '';
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? '';
};

const normalizePathForMatch = (path: string): string => {
  const normalized = normalizePath(path).replace(/\/+$/, '');
  if (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)) {
    return normalized.toLowerCase();
  }
  return normalized;
};

export const isSameOrSubPath = (filePath: string, folderPath: string): boolean => {
  const normalizedFile = normalizePathForMatch(filePath);
  const normalizedFolder = normalizePathForMatch(folderPath);
  if (!normalizedFolder) return false;
  return normalizedFile === normalizedFolder || normalizedFile.startsWith(`${normalizedFolder}/`);
};
