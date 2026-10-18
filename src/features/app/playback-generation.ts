export interface GenerationEvent {
  generation: number;
}

let activeGeneration = 0;
let interventionEpoch = 0;

export function setActivePlaybackGeneration(generation: number): void {
  if (Number.isSafeInteger(generation) && generation > 0) {
    activeGeneration = generation;
  }
}

export function getActivePlaybackGeneration(): number {
  return activeGeneration;
}

export function isCurrentPlaybackGeneration(payload: GenerationEvent): boolean {
  return payload.generation === activeGeneration;
}

/**
 * Called by the coordinator before commands that replace or stop the current source (play, stop,
 * adjacent track, editor preview). The backend handles them after any crossfade the renderer
 * already requested, so that crossfade's events are stale.
 */
export function notePlaybackIntervention(): void {
  interventionEpoch += 1;
}

export function getPlaybackInterventionEpoch(): number {
  return interventionEpoch;
}

export function resetPlaybackGenerationForTests(): void {
  activeGeneration = 0;
  interventionEpoch = 0;
}
