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
 * Called by the coordinator before user-driven play, seek, stop and device commands. The backend
 * cancels an active crossfade on each of them without emitting a transition, so a crossfade the
 * renderer started before the latest intervention is stale.
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
