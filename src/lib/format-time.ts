/**
 * Format seconds to mm:ss or hh:mm:ss format
 */
export const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return '0:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Format milliseconds to mm:ss.xx format for lyrics
 */
export const formatLyricsTime = (ms: number): string => {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const centiseconds = Math.floor((ms % 1000) / 10);

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
};

/**
 * Parse LRC timestamp [mm:ss.xx] to milliseconds
 */
export const parseLrcTimestamp = (timestamp: string): number => {
  const match = timestamp.match(/\[(\d+):(\d+)\.(\d+)\]/);
  if (!match) return 0;

  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const centiseconds = parseInt(match[3], 10);

  return (minutes * 60 + seconds) * 1000 + centiseconds * 10;
};

/**
 * Parse enhanced LRC word timestamp <mm:ss.xx> to milliseconds
 */
export const parseWordTimestamp = (timestamp: string): number => {
  const match = timestamp.match(/<(\d+):(\d+)\.(\d+)>/);
  if (!match) return 0;

  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const centiseconds = parseInt(match[3], 10);

  return (minutes * 60 + seconds) * 1000 + centiseconds * 10;
};

/**
 * Generate a unique ID
 */
export const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};
