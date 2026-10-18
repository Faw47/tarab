import { create } from 'zustand';
import type { LibraryFacet } from '../components/library/library-view-model';
import type { SettingsPage } from '../types';

/**
 * One-shot requests from native menus and commands for the view they open. A request waits here
 * until its view consumes it, so it also works when the view mounts after the navigation.
 */
interface NavigationIntentState {
  libraryFacet: LibraryFacet | null;
  createPlaylist: boolean;
  settingsPage: SettingsPage | null;
  requestLibraryFacet: (facet: LibraryFacet) => void;
  requestCreatePlaylist: () => void;
  requestSettingsPage: (page: SettingsPage) => void;
  consumeLibraryFacet: () => LibraryFacet | null;
  consumeCreatePlaylist: () => boolean;
  consumeSettingsPage: () => SettingsPage | null;
}

export const useNavigationIntentStore = create<NavigationIntentState>()((set, get) => ({
  libraryFacet: null,
  createPlaylist: false,
  settingsPage: null,
  requestLibraryFacet: (facet) => set({ libraryFacet: facet }),
  requestCreatePlaylist: () => set({ createPlaylist: true }),
  requestSettingsPage: (page) => set({ settingsPage: page }),
  consumeLibraryFacet: () => {
    const facet = get().libraryFacet;
    if (facet) set({ libraryFacet: null });
    return facet;
  },
  consumeCreatePlaylist: () => {
    const requested = get().createPlaylist;
    if (requested) set({ createPlaylist: false });
    return requested;
  },
  consumeSettingsPage: () => {
    const page = get().settingsPage;
    if (page) set({ settingsPage: null });
    return page;
  },
}));
