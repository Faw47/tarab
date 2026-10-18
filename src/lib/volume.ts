import { usePlayerStore } from '../store/player-store';
import { reportError } from './report-error';
import { setVolume as setAudioVolume } from './tauri-commands';

/** Below this the output counts as muted. */
export const MUTED_THRESHOLD = 0.001;
const DEFAULT_RESTORE_VOLUME = 0.8;
/**
 * Levels below this are not remembered for unmute: dragging a slider to zero passes through 1-9%,
 * and unmuting to that would sound like nothing happened.
 */
const MIN_REMEMBERED_VOLUME = 0.1;

// One restore level for every volume control and the M shortcut, so unmute returns to the
// same level wherever it was muted (FE-16).
let lastAudibleVolume = DEFAULT_RESTORE_VOLUME;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/** Sets the store and the audio engine; every volume control goes through this. */
export async function applyVolume(value: number, source = 'volume'): Promise<void> {
  const next = clamp01(value);
  if (next >= MIN_REMEMBERED_VOLUME) lastAudibleVolume = next;
  usePlayerStore.getState().setVolume(next);
  try {
    await setAudioVolume(next);
  } catch (error) {
    reportError('Could not set the volume', { source, error });
  }
}

export function isMuted(volume: number): boolean {
  return volume <= MUTED_THRESHOLD;
}

/** Mutes, or restores the last audible level. */
export function toggleMute(source = 'volume'): Promise<void> {
  const current = usePlayerStore.getState().volume;
  if (isMuted(current)) return applyVolume(lastAudibleVolume, source);
  if (current >= MIN_REMEMBERED_VOLUME) lastAudibleVolume = current;
  return applyVolume(0, source);
}

export function stepVolume(delta: number, source = 'volume'): Promise<void> {
  // Round to whole percents so repeated steps do not accumulate floating-point drift.
  const stepped = Math.round((usePlayerStore.getState().volume + delta) * 100) / 100;
  return applyVolume(stepped, source);
}

/** Test seam: forget the remembered level. */
export function resetVolumeMemoryForTests(): void {
  lastAudibleVolume = DEFAULT_RESTORE_VOLUME;
}
