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
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['library', 'albums'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['library', 'artists'],
    });
  });

  it('invalidates aggregate and playlist data after play statistics change', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();

    await invalidateLibraryForMutation(queryClient, 'play-stats');

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['library', 'albums'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['library', 'artists'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['playlists'],
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
