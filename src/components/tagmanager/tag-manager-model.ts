import { normalizePath } from '../../lib/path-utils';
import type { Track } from '../../types';

export type FileFilter = 'all' | 'missing-art' | 'untagged';
export type SortColumn = 'title' | 'artist' | 'album' | 'year' | 'duration';
export type SortDirection = 'asc' | 'desc';

export interface FolderNode {
  path: string;
  name: string;
  trackCount: number;
}

const losslessFormats = new Set(['flac', 'alac', 'wav', 'aiff']);

export function buildFolderTree(tracks: Track[]): FolderNode[] {
  const folders = new Map<string, FolderNode>();

  tracks.forEach((track) => {
    const norm = normalizePath(track.filePath);
    const parts = norm.split('/');
    parts.pop();
    const folderPath = parts.join('/');

    if (!folderPath) return;

    const existing = folders.get(folderPath);
    if (existing) existing.trackCount += 1;
    else {
      folders.set(folderPath, {
        path: folderPath,
        name: parts[parts.length - 1] || folderPath,
        trackCount: 1,
      });
    }
  });

  return Array.from(folders.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export function getSelectedFolderName(folderTree: FolderNode[], selectedFolder: string | null) {
  if (!selectedFolder) return 'All Library';
  return folderTree.find((folder) => folder.path === selectedFolder)?.name || 'Unknown Folder';
}

export function filterAndSortTracks({
  tracks,
  selectedFolder,
  query,
  fileFilter,
  sortColumn,
  sortDirection,
}: {
  tracks: Track[];
  selectedFolder: string | null;
  query: string;
  fileFilter: FileFilter;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
}) {
  let result = tracks;

  if (selectedFolder) {
    const normFolder = normalizePath(selectedFolder);
    result = result.filter((track) => normalizePath(track.filePath).startsWith(`${normFolder}/`));
  }

  const q = query.trim().toLowerCase();
  if (q) {
    result = result.filter((track) => {
      const title = (track.title || '').toLowerCase();
      const artist = (track.artist || '').toLowerCase();
      const album = (track.album || '').toLowerCase();
      const path = (track.filePath || '').toLowerCase();
      return title.includes(q) || artist.includes(q) || album.includes(q) || path.includes(q);
    });
  }

  if (fileFilter === 'missing-art') result = result.filter((track) => !track.hasCoverArt);
  if (fileFilter === 'untagged') {
    result = result.filter(
      (track) => !track.artist || track.artist.toLowerCase() === 'unknown artist' || !track.title,
    );
  }

  return [...result].sort((a, b) => {
    let cmp = 0;
    switch (sortColumn) {
      case 'title':
        cmp = (a.title || '').localeCompare(b.title || '');
        break;
      case 'artist':
        cmp = (a.artist || '').localeCompare(b.artist || '');
        break;
      case 'album':
        cmp = (a.album || '').localeCompare(b.album || '');
        break;
      case 'year':
        cmp = (a.year || 0) - (b.year || 0);
        break;
      case 'duration':
        cmp = (a.duration || 0) - (b.duration || 0);
        break;
    }
    return sortDirection === 'asc' ? cmp : -cmp;
  });
}

export function formatQuality(track: Track) {
  const format =
    track.fileFormat?.toUpperCase() || track.filePath.split('.').pop()?.toUpperCase() || '';
  return { format, isLossless: losslessFormats.has(format.toLowerCase()) };
}
