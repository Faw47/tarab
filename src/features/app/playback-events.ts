/**
 * Payload shapes for native playback events. Keep these in sync with the serde structs in
 * `src-tauri/src/audio/events.rs`.
 */

/** `PlaybackPositionEvent`: emitted as `playback-position` and `playback-seeked`. */
export interface PlaybackPositionEventPayload {
  generation: number;
  position: number;
}

export interface ParsedPlaybackPosition {
  position: number;
  /** `null` for legacy numeric payloads, which carry no generation. */
  generation: number | null;
}

/**
 * Accepts the native `{ generation, position }` payload and the legacy bare-number payload.
 * Returns `null` for anything else, so callers never store a non-numeric position.
 */
export function parsePlaybackPositionPayload(raw: unknown): ParsedPlaybackPosition | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { position: raw, generation: null } : null;
  }
  if (typeof raw !== 'object' || raw === null) return null;

  const { position, generation } = raw as Partial<PlaybackPositionEventPayload>;
  if (typeof position !== 'number' || !Number.isFinite(position)) return null;
  if (typeof generation !== 'number' || !Number.isSafeInteger(generation)) return null;
  return { position, generation };
}
