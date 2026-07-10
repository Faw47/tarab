// Track metadata
export interface Track {
  id: string;
  _queueId?: string; // Unique ID when track is in the queue to handle duplicates
  title: string;
  artist: string;
  albumArtist?: string | null;
  album: string;
  year: number | null;
  trackNumber?: number | null;
  discNumber?: number | null;
  duration: number; // seconds
  filePath: string;
  hasCoverArt: boolean;
  coverArt?: string; // cover-art:// URL or base64 (legacy)
  coverArtHash?: string | null;
  blurhash?: string | null;
  fileFormat?: string;
  bitrate?: number;
  sampleRate?: number;
  fileSize?: number;
  dateAdded: number; // timestamp
  rating?: number | null; // 0-5, null = unrated
  playCount?: number;
  lastPlayed?: number | null;
}

// Playlist types
export type PlaylistType = 'Manual' | 'Smart' | 'FolderSync';

export interface SmartPlaylistRule {
  type:
    | 'RecentlyAdded'
    | 'MostPlayed'
    | 'TopRated'
    | 'ByArtist'
    | 'ByAlbum'
    | 'ByGenre'
    | 'ByYear'
    | 'LongerThan'
    | 'ShorterThan';
  days?: number;
  minPlays?: number;
  minRating?: number;
  artist?: string;
  album?: string;
  genre?: string;
  startYear?: number;
  endYear?: number;
  seconds?: number;
}

// Backend-serialized smart playlist rule (matches Rust enum)
export type BackendSmartPlaylistRule =
  | { RecentlyAdded: { days: number } }
  | { MostPlayed: { min_plays: number } }
  | { TopRated: { min_rating: number } }
  | { ByArtist: { artist: string } }
  | { ByAlbum: { album: string } }
  | { ByGenre: { genre: string } }
  | { ByYear: { start_year: number; end_year: number } }
  | { LongerThan: { seconds: number } }
  | { ShorterThan: { seconds: number } };

export interface Playlist {
  id: string;
  name: string;
  playlistType: PlaylistType;
  trackIds: string[];
  smartRules?: BackendSmartPlaylistRule[];
  folderPath?: string;
  createdAt: number;
  updatedAt: number;
  isPinned?: boolean;
  pinnedAt?: number | null;
  lastSyncedAt?: number | null;
  syncError?: string | null;
}

export type PlaylistRuleConfig = BackendSmartPlaylistRule;

export interface PlaylistSummary {
  id: string;
  name: string;
  playlistType: PlaylistType;
  trackCount: number;
  missingCount: number;
  smartRules?: BackendSmartPlaylistRule[];
  folderPath?: string;
  createdAt: number;
  updatedAt: number;
  isPinned?: boolean;
  pinnedAt?: number | null;
  lastSyncedAt?: number | null;
  syncError?: string | null;
}

export interface PlaylistEntry {
  trackId: string;
  position: number;
  available: boolean;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  duration?: number | null;
  filePath?: string | null;
  hasCoverArt: boolean;
  coverArtHash?: string | null;
  blurhash?: string | null;
}

export interface PlaylistDetail {
  id: string;
  name: string;
  playlistType: PlaylistType;
  trackCount: number;
  missingCount: number;
  smartRules?: BackendSmartPlaylistRule[];
  folderPath?: string;
  createdAt: number;
  updatedAt: number;
  isPinned?: boolean;
  pinnedAt?: number | null;
  lastSyncedAt?: number | null;
  syncError?: string | null;
  trackIds: string[];
  entries: PlaylistEntry[];
}

// Full tag info for editor
export interface TagInfo {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: number;
  trackNumber?: number;
  totalTracks?: number;
  discNumber?: number;
  totalDiscs?: number;
  genre?: string;
  composer?: string;
  comment?: string;
  hasCoverArt: boolean;
  filePath: string;
  fileFormat: string;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  durationSecs: number;
  extraTags?: Record<string, string>;
}

export type TagClearField =
  | 'title'
  | 'artist'
  | 'album'
  | 'albumArtist'
  | 'year'
  | 'trackNumber'
  | 'totalTracks'
  | 'discNumber'
  | 'totalDiscs'
  | 'genre'
  | 'composer'
  | 'comment';

export interface TagUpdate {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  year?: number | null;
  trackNumber?: number | null;
  totalTracks?: number | null;
  discNumber?: number | null;
  totalDiscs?: number | null;
  genre?: string | null;
  composer?: string | null;
  comment?: string | null;
  clearFields?: TagClearField[];
  coverArtBase64?: string;
  coverArtMime?: string;
  extraTags?: Record<string, string>;
}

// Lyrics types
export interface LyricWord {
  text: string;
  startTime: number; // milliseconds
  endTime: number; // milliseconds
}

export interface LyricWordRun {
  word: LyricWord;
  prefix: string;
  suffix?: string;
}

export interface LyricLine {
  startTime: number; // milliseconds
  endTime: number; // milliseconds
  text: string;
  words: LyricWord[];
  runs?: LyricWordRun[];
}

export interface ParsedLyrics {
  lines: LyricLine[];
  isEnhanced: boolean;
}

// Loop mode
export type LoopMode = 'off' | 'all' | 'one';

// Sort options
export type SortBy = 'title' | 'artist' | 'album' | 'dateAdded';

// View types
export type View = 'library' | 'player' | 'playlist' | 'settings';

export type SettingsPage = 'library' | 'playback' | 'appearance' | 'desktop' | 'storage';

// Tauri command response types
export interface TrackMetadata {
  title: string;
  artist: string;
  album_artist?: string | null;
  album: string;
  year: number | null;
  duration_secs: number;
  file_path: string;
  has_cover_art: boolean;
  file_format: string;
  bitrate: number | null;
  sample_rate: number | null;
  file_size: number | null;
}

// Context menu
export interface ContextMenuPosition {
  x: number;
  y: number;
}

export type DesktopControlAction =
  | 'toggle-play'
  | 'play'
  | 'pause'
  | 'next'
  | 'previous'
  | 'show-main'
  | 'toggle-mini'
  | 'quit';

export interface DesktopSeekPayload {
  positionSecs: number;
}

export interface DesktopPlaybackSnapshot {
  track: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface DesktopNativeUiState {
  trackLabel: string | null;
  isPlaying: boolean;
  hasTrack: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  statusIconEnabled: boolean;
  mediaKeysEnabled: boolean;
  miniWindowEnabled: boolean;
  hideToStatusIconOnClose: boolean;
}

export interface DesktopMediaSessionSyncPayload {
  enabled: boolean;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  artworkDataBase64: string | null;
  isPlaying: boolean;
  position: number;
  duration: number | null;
  shuffle: boolean;
  repeatMode: LoopMode;
  playbackRate: number;
}
