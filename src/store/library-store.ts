import { create } from 'zustand';
import type { SortBy } from '../types';

export type LibrarySearchScope = 'all' | 'tracks' | 'albums' | 'artists' | 'lyrics';

const clampScanProgress = (progress: number): number => {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
};

interface LibraryState {
  searchQuery: string;
  searchScope: LibrarySearchScope;
  sortBy: SortBy;
  isScanning: boolean;
  scanProgress: number;
  processingTasks: { id: string; label: string; progress?: number; status: 'running' | 'done' }[];

  setSearchQuery: (query: string) => void;
  setSearchScope: (scope: LibrarySearchScope) => void;
  setSortBy: (sort: SortBy) => void;
  setIsScanning: (scanning: boolean) => void;
  setScanProgress: (progress: number) => void;
  startProcessing: (label: string) => string;
  updateProcessing: (id: string, progress?: number, status?: 'running' | 'done') => void;
  finishProcessing: (id: string) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  searchQuery: '',
  searchScope: 'all',
  sortBy: 'dateAdded',
  isScanning: false,
  scanProgress: 0,
  processingTasks: [],

  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  setSearchScope: (scope) => {
    set({ searchScope: scope });
  },

  setSortBy: (sort) => {
    set({ sortBy: sort });
  },

  setIsScanning: (scanning) => {
    set({ isScanning: scanning });
  },

  setScanProgress: (progress) => {
    set({ scanProgress: clampScanProgress(progress) });
  },

  startProcessing: (label) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    set((state) => ({
      processingTasks: [...state.processingTasks, { id, label, progress: 0, status: 'running' }],
    }));

    return id;
  },

  updateProcessing: (id, progress, status) => {
    set((state) => ({
      processingTasks: state.processingTasks.map((task) =>
        task.id === id
          ? {
              ...task,
              progress: progress ?? task.progress,
              status: status ?? task.status,
            }
          : task,
      ),
    }));
  },

  finishProcessing: (id) => {
    set((state) => ({
      processingTasks: state.processingTasks.map((task) =>
        task.id === id
          ? {
              ...task,
              progress: 100,
              status: 'done',
            }
          : task,
      ),
    }));

    setTimeout(() => {
      set((state) => ({
        processingTasks: state.processingTasks.filter((task) => task.id !== id),
      }));
    }, 2000);
  },
}));
