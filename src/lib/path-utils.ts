/**
 * Normalize file paths to use forward slashes consistently.
 * This ensures cross-platform compatibility between macOS (/) and Windows (\).
 */
export const normalizePath = (path: string): string => path.replace(/\\/g, '/');

export const normalizeFolderPath = (path: string): string => {
  let normalized = normalizePath(path.trim());
  if (/^\/+$/u.test(normalized)) return '/';
  if (/^[A-Za-z]:\/+$/u.test(normalized)) return `${normalized.slice(0, 2)}/`;
  if (/^\/\/\?\/[A-Za-z]:/u.test(normalized)) {
    normalized = normalized.slice(4);
  } else if (normalized.startsWith('//?/UNC/')) {
    normalized = `//${normalized.slice('//?/UNC/'.length)}`;
  }
  return normalized.replace(/\/+$/u, '');
};

export const getPathBaseName = (path: string): string => {
  const normalized = normalizePath(path).replace(/\/+$/, '');
  if (!normalized) return '';
  const parts = normalized.split('/');
  return parts[parts.length - 1] ?? '';
};

export const getPathDirectory = (path: string): string => {
  const normalized = normalizePath(path);
  const separatorIndex = normalized.lastIndexOf('/');
  if (separatorIndex < 0) return '';
  if (separatorIndex === 0) return '/';

  const directory = normalized.slice(0, separatorIndex);
  return /^[A-Za-z]:$/u.test(directory) ? directory + '/' : directory;
};

const normalizePathForMatch = (path: string): string => {
  const normalized = normalizeFolderPath(path);
  if (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)) {
    return normalized.toLowerCase();
  }
  return normalized;
};

export const isSamePath = (first: string, second: string): boolean =>
  normalizePathForMatch(first) === normalizePathForMatch(second);

export const isSameOrSubPath = (filePath: string, folderPath: string): boolean => {
  const normalizedFile = normalizePathForMatch(filePath);
  const normalizedFolder = normalizePathForMatch(folderPath);
  if (!normalizedFolder) return false;
  if (normalizedFolder === '/') return normalizedFile.startsWith('/');
  if (/^[a-z]:\/$/iu.test(normalizedFolder)) {
    return normalizedFile.startsWith(normalizedFolder);
  }
  return normalizedFile === normalizedFolder || normalizedFile.startsWith(`${normalizedFolder}/`);
};
