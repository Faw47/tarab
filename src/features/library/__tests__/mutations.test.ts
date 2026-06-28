import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateLibraryForMutation } from '../mutations';

describe('invalidateLibraryForMutation', () => {
  it('invalidates expected query targets for scan mutations', async () => {
    const invalidateQueries = vi.fn(async () => undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    await invalidateLibraryForMutation(queryClient, 'scan');

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['library', 'tracks'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['library', 'track-count'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['library', 'search'],
    });
  });

  it('invalidates expected query targets for rating mutations', async () => {
    const invalidateQueries = vi.fn(async () => undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;

    await invalidateLibraryForMutation(queryClient, 'rating');

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['library', 'tracks'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['library', 'search'],
    });
  });
});
