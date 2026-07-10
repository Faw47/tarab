import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateLibraryForMutation } from '../mutations';

describe('invalidateLibraryForMutation', () => {
  it('invalidates expected query targets for scan mutations', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

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
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    await invalidateLibraryForMutation(queryClient, 'rating');

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['library', 'tracks'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['library', 'search'],
    });
  });
});
