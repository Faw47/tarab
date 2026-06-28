import type { QueryClient } from '@tanstack/react-query';

let client: QueryClient | null = null;

export const setLibraryQueryClient = (queryClient: QueryClient) => {
  client = queryClient;
};

export const getLibraryQueryClient = (): QueryClient | null => client;
