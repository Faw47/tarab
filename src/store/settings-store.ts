import { create } from 'zustand';
import { createJSONStorage, devtools, persist } from 'zustand/middleware';
import { SettingsSchema } from '../lib/validation/settings';
import { createTauriZustandStorage } from '../platform/tauri-zustand-storage';

export type NavMode = 'iconRail' | 'topNav';
export type AppTheme = 'liquid-glass' | 'neobrutalism';

interface SettingsState {
  theme: AppTheme;
  lyricsEnabled: boolean;
  backgroundEnabled: boolean;
  libraryFolders: string[];
  outputDevice: string;
  autoWatch: boolean;
  followSymlinks: boolean;
  downloadArtwork: boolean;
  autoLyrics: boolean;
  compactMode: boolean;
  reducedEffects: boolean;
  /** Exaggerate liquid tab glass (stretch / refraction / glare); also `?debugLiquidGlass=1`. */
  debugLiquidControlGlass: boolean;
  gapless: boolean;
  crossfadeSeconds: number;
  miniPlayerVolumeVisible: boolean;
  miniPlayerCollapsed: boolean;
  desktopStatusIconEnabled: boolean;
  desktopMediaKeysEnabled: boolean;
  desktopMiniWindowEnabled: boolean;
  hideToStatusIconOnClose: boolean;
  shuffleHistorySize: number;
  smartShuffleEnabled: boolean;
  cacheSizeLimitMb: number;
  clearCacheOnStartup: boolean;
  fullscreenPlayerLayout: boolean;
  navMode: NavMode;
  fullscreenHideCoverArt: boolean;

  fullscreenLyricSize: number;
  fullscreenLyricAlignment: 'left' | 'center' | 'right';
  fullscreenBackgroundAnimation: 'pan' | 'pulse' | 'none';
  fullscreenBackgroundBlur: number;

  globalShortcutsEnabled: boolean;
  shortcuts: {
    playPause: string;
    next: string;
    previous: string;
  };
  autostartEnabled: boolean;

  // Actions
  setLyricsEnabled: (enabled: boolean) => void;
  toggleLyrics: () => void;
  setBackgroundEnabled: (enabled: boolean) => void;
  addLibraryFolder: (folder: string) => void;
  removeLibraryFolder: (folder: string) => void;
  setLibraryFolders: (folders: string[]) => void;
  setOutputDevice: (device: string) => void;
  setAutoWatch: (enabled: boolean) => void;
  setFollowSymlinks: (enabled: boolean) => void;
  setDownloadArtwork: (enabled: boolean) => void;
  setAutoLyrics: (enabled: boolean) => void;
  setCompactMode: (enabled: boolean) => void;
  setReducedEffects: (enabled: boolean) => void;
  setDebugLiquidControlGlass: (enabled: boolean) => void;
  setGapless: (enabled: boolean) => void;
  setCrossfadeSeconds: (seconds: number) => void;
  setMiniPlayerVolumeVisible: (visible: boolean) => void;
  setMiniPlayerCollapsed: (collapsed: boolean) => void;
  setDesktopStatusIconEnabled: (enabled: boolean) => void;
  setDesktopMediaKeysEnabled: (enabled: boolean) => void;
  setDesktopMiniWindowEnabled: (enabled: boolean) => void;
  setHideToStatusIconOnClose: (enabled: boolean) => void;
  setShuffleHistorySize: (size: number) => void;
  setSmartShuffleEnabled: (enabled: boolean) => void;
  setCacheSizeLimitMb: (size: number) => void;
  setClearCacheOnStartup: (value: boolean) => void;
  setFullscreenPlayerLayout: (enabled: boolean) => void;
  setNavMode: (mode: NavMode) => void;
  setFullscreenHideCoverArt: (enabled: boolean) => void;

  setFullscreenLyricSize: (size: number) => void;
  setFullscreenLyricAlignment: (alignment: 'left' | 'center' | 'right') => void;

  setFullscreenBackgroundAnimation: (animation: 'pan' | 'pulse' | 'none') => void;
  setFullscreenBackgroundBlur: (blur: number) => void;
  setTheme: (theme: AppTheme) => void;
  setGlobalShortcutsEnabled: (enabled: boolean) => void;
  setShortcut: (key: 'playPause' | 'next' | 'previous', value: string) => void;
  setAutostartEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  devtools(
    persist(
      (set) => ({
        theme: 'liquid-glass',
        lyricsEnabled: true,
        backgroundEnabled: true,
        libraryFolders: [],
        outputDevice: 'system',
        autoWatch: true,
        followSymlinks: false,
        downloadArtwork: true,
        autoLyrics: true,
        compactMode: false,
        reducedEffects: false,
        debugLiquidControlGlass: false,
        gapless: true,
        crossfadeSeconds: 0,
        miniPlayerVolumeVisible: false,
        miniPlayerCollapsed: false,
        desktopStatusIconEnabled: true,
        desktopMediaKeysEnabled: true,
        desktopMiniWindowEnabled: false,
        hideToStatusIconOnClose: true,
        shuffleHistorySize: 50,
        smartShuffleEnabled: false,
        cacheSizeLimitMb: 200,
        clearCacheOnStartup: false,
        fullscreenPlayerLayout: true,
        navMode: 'topNav',
        fullscreenHideCoverArt: false,

        fullscreenLyricSize: 50,
        fullscreenLyricAlignment: 'center',
        fullscreenBackgroundAnimation: 'pan',
        fullscreenBackgroundBlur: 15,

        globalShortcutsEnabled: false,
        shortcuts: {
          playPause: 'CommandOrControl+Alt+Space',
          next: 'CommandOrControl+Alt+Right',
          previous: 'CommandOrControl+Alt+Left',
        },
        autostartEnabled: false,

        setLyricsEnabled: (enabled) =>
          set({ lyricsEnabled: enabled }, false, 'settings/setLyricsEnabled'),

        toggleLyrics: () =>
          set((state) => ({ lyricsEnabled: !state.lyricsEnabled }), false, 'settings/toggleLyrics'),

        setBackgroundEnabled: (enabled) =>
          set({ backgroundEnabled: enabled }, false, 'settings/setBackgroundEnabled'),

        addLibraryFolder: (folder) =>
          set(
            (state) => ({
              libraryFolders: state.libraryFolders.includes(folder)
                ? state.libraryFolders
                : [...state.libraryFolders, folder],
            }),
            false,
            'settings/addLibraryFolder',
          ),

        removeLibraryFolder: (folder) =>
          set(
            (state) => ({
              libraryFolders: state.libraryFolders.filter((f) => f !== folder),
            }),
            false,
            'settings/removeLibraryFolder',
          ),

        setLibraryFolders: (folders) =>
          set({ libraryFolders: folders }, false, 'settings/setLibraryFolders'),

        setOutputDevice: (device) =>
          set({ outputDevice: device }, false, 'settings/setOutputDevice'),
        setAutoWatch: (enabled) => set({ autoWatch: enabled }, false, 'settings/setAutoWatch'),
        setFollowSymlinks: (enabled) =>
          set({ followSymlinks: enabled }, false, 'settings/setFollowSymlinks'),
        setDownloadArtwork: (enabled) =>
          set({ downloadArtwork: enabled }, false, 'settings/setDownloadArtwork'),
        setAutoLyrics: (enabled) => set({ autoLyrics: enabled }, false, 'settings/setAutoLyrics'),
        setCompactMode: (enabled) =>
          set({ compactMode: enabled }, false, 'settings/setCompactMode'),
        setReducedEffects: (enabled) =>
          set({ reducedEffects: enabled }, false, 'settings/setReducedEffects'),
        setDebugLiquidControlGlass: (enabled) =>
          set({ debugLiquidControlGlass: enabled }, false, 'settings/setDebugLiquidControlGlass'),
        setGapless: (enabled) => set({ gapless: enabled }, false, 'settings/setGapless'),
        setCrossfadeSeconds: (seconds) =>
          set(
            { crossfadeSeconds: Math.max(0, Math.min(12, seconds)) },
            false,
            'settings/setCrossfadeSeconds',
          ),
        setMiniPlayerVolumeVisible: (visible) =>
          set({ miniPlayerVolumeVisible: visible }, false, 'settings/setMiniPlayerVolumeVisible'),
        setMiniPlayerCollapsed: (collapsed) =>
          set({ miniPlayerCollapsed: collapsed }, false, 'settings/setMiniPlayerCollapsed'),
        setDesktopStatusIconEnabled: (enabled) =>
          set({ desktopStatusIconEnabled: enabled }, false, 'settings/setDesktopStatusIconEnabled'),
        setDesktopMediaKeysEnabled: (enabled) =>
          set({ desktopMediaKeysEnabled: enabled }, false, 'settings/setDesktopMediaKeysEnabled'),
        setDesktopMiniWindowEnabled: (enabled) =>
          set({ desktopMiniWindowEnabled: enabled }, false, 'settings/setDesktopMiniWindowEnabled'),
        setHideToStatusIconOnClose: (enabled) =>
          set({ hideToStatusIconOnClose: enabled }, false, 'settings/setHideToStatusIconOnClose'),
        setShuffleHistorySize: (size) =>
          set(
            { shuffleHistorySize: Math.max(5, Math.min(300, Math.round(size))) },
            false,
            'settings/setShuffleHistorySize',
          ),
        setSmartShuffleEnabled: (enabled) =>
          set({ smartShuffleEnabled: enabled }, false, 'settings/setSmartShuffleEnabled'),
        setCacheSizeLimitMb: (size) =>
          set(
            { cacheSizeLimitMb: Math.max(50, Math.min(1000, Math.round(size))) },
            false,
            'settings/setCacheSizeLimitMb',
          ),
        setClearCacheOnStartup: (value) =>
          set({ clearCacheOnStartup: value }, false, 'settings/setClearCacheOnStartup'),
        setFullscreenPlayerLayout: (enabled) =>
          set({ fullscreenPlayerLayout: enabled }, false, 'settings/setFullscreenPlayerLayout'),
        setNavMode: (mode) => set({ navMode: mode }, false, 'settings/setNavMode'),
        setFullscreenHideCoverArt: (enabled) =>
          set({ fullscreenHideCoverArt: enabled }, false, 'settings/setFullscreenHideCoverArt'),

        setFullscreenLyricSize: (size) =>
          set(
            { fullscreenLyricSize: Math.max(1, Math.min(100, Math.round(size))) },
            false,
            'settings/setFullscreenLyricSize',
          ),
        setFullscreenLyricAlignment: (alignment) =>
          set(
            { fullscreenLyricAlignment: alignment },
            false,
            'settings/setFullscreenLyricAlignment',
          ),

        setFullscreenBackgroundAnimation: (animation) =>
          set(
            { fullscreenBackgroundAnimation: animation },
            false,
            'settings/setFullscreenBackgroundAnimation',
          ),
        setFullscreenBackgroundBlur: (blur) =>
          set(
            { fullscreenBackgroundBlur: Math.max(0, Math.min(50, blur)) },
            false,
            'settings/setFullscreenBackgroundBlur',
          ),
        setTheme: (theme) => set({ theme }, false, 'settings/setTheme'),
        setGlobalShortcutsEnabled: (enabled) =>
          set({ globalShortcutsEnabled: enabled }, false, 'settings/setGlobalShortcutsEnabled'),
        setShortcut: (key, value) =>
          set(
            (state) => ({
              shortcuts: { ...state.shortcuts, [key]: value },
            }),
            false,
            'settings/setShortcut',
          ),
        setAutostartEnabled: (enabled) =>
          set({ autostartEnabled: enabled }, false, 'settings/setAutostartEnabled'),
      }),
      {
        name: 'tarab-settings',
        storage: createJSONStorage(() => createTauriZustandStorage('settings.json')),
        version: 5,
        migrate: (persisted, version) => {
          let incoming = (persisted as Partial<SettingsState>) ?? {};
          if ((version ?? 0) < 2) {
            incoming = {
              ...incoming,
              desktopStatusIconEnabled: incoming.desktopStatusIconEnabled ?? true,
              desktopMediaKeysEnabled: incoming.desktopMediaKeysEnabled ?? true,
              desktopMiniWindowEnabled: incoming.desktopMiniWindowEnabled ?? false,
              hideToStatusIconOnClose: incoming.hideToStatusIconOnClose ?? true,
            } as Partial<SettingsState>;
          }
          if ((version ?? 0) < 3) {
            incoming = {
              ...incoming,
              smartShuffleEnabled: incoming.smartShuffleEnabled ?? true,
              theme: incoming.theme ?? 'liquid-glass',
              navMode: incoming.navMode ?? 'iconRail',
            } as Partial<SettingsState>;
          }
          if ((version ?? 0) < 4) {
            incoming = {
              ...incoming,
              globalShortcutsEnabled: incoming.globalShortcutsEnabled ?? false,
              autostartEnabled: incoming.autostartEnabled ?? false,
              shortcuts: incoming.shortcuts ?? { playPause: 'Space', next: 'MediaNextTrack', previous: 'MediaPreviousTrack' }
            } as Partial<SettingsState>;
          }
          if ((version ?? 0) < 5) {
            incoming = {
              ...incoming,
              desktopMiniWindowEnabled: false,
            } as Partial<SettingsState>;
          }
          const parsed = SettingsSchema.safeParse(incoming);
          if (parsed.success) {
            return parsed.data as SettingsState;
          }
          console.warn('Failed to parse some settings from storage', parsed.error);
          return incoming as SettingsState;
        },
      },
    ),
    { name: 'tarab/settings-store', enabled: import.meta.env.DEV },
  ),
);
