import { beforeEach, describe, expect, it } from 'vitest';
import { useLibraryStore } from './library-store';

const initialLibraryState = useLibraryStore.getState();

describe('library store scan progress', () => {
  beforeEach(() => {
    useLibraryStore.setState(initialLibraryState, true);
  });

  it('clamps scan progress to the visible progress range', () => {
    useLibraryStore.getState().setScanProgress(10_000_000);
    expect(useLibraryStore.getState().scanProgress).toBe(100);

    useLibraryStore.getState().setScanProgress(-5);
    expect(useLibraryStore.getState().scanProgress).toBe(0);
  });

  it('treats non-finite scan progress as zero', () => {
    useLibraryStore.getState().setScanProgress(Number.NaN);

    expect(useLibraryStore.getState().scanProgress).toBe(0);
  });
});
