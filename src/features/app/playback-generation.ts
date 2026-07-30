export interface GenerationEvent {
  generation: number;
}

let activeGeneration = 0;

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

export function resetPlaybackGenerationForTests(): void {
  activeGeneration = 0;
}
