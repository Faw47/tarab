import { z } from 'zod';

export const AppThemeSchema = z.enum(['liquid-glass', 'neobrutalism']);
export const NavModeSchema = z.enum(['iconRail', 'topNav']);

export const GlobalShortcutsSchema = z.object({
  playPause: z.string(),
  next: z.string(),
  previous: z.string(),
});

export const SettingsSchema = z
  .object({
    theme: AppThemeSchema,
    lyricsEnabled: z.boolean(),
    backgroundEnabled: z.boolean(),
    libraryFolders: z.array(z.string()),
    outputDevice: z.string(),
    exclusiveMode: z.boolean(),
    normalizeVolume: z.boolean(),
    replayGain: z.boolean(),
    autoWatch: z.boolean(),
    followSymlinks: z.boolean(),
    downloadArtwork: z.boolean(),
    autoLyrics: z.boolean(),
    compactMode: z.boolean(),
    reducedEffects: z.boolean(),
    gapless: z.boolean(),
    crossfadeSeconds: z.number().min(0).max(12),
    miniPlayerVolumeVisible: z.boolean(),
    miniPlayerCollapsed: z.boolean(),
    desktopStatusIconEnabled: z.boolean(),
    desktopMediaKeysEnabled: z.boolean(),
    desktopMiniWindowEnabled: z.boolean(),
    hideToStatusIconOnClose: z.boolean(),
    shuffleHistorySize: z.number().int().min(5).max(300),
    smartShuffleEnabled: z.boolean().optional(),
    cacheSizeLimitMb: z.number().int().min(50).max(1000),
    clearCacheOnStartup: z.boolean(),
    fullscreenPlayerLayout: z.boolean(),
    navMode: NavModeSchema,
    fullscreenHideCoverArt: z.boolean(),
    fullscreenLyricSize: z.number().int().min(1).max(100),
    fullscreenLyricAlignment: z.enum(['left', 'center', 'right']),
    fullscreenBackgroundAnimation: z.enum(['pan', 'pulse', 'none']),
    fullscreenBackgroundBlur: z.number().min(0).max(50),
    globalShortcutsEnabled: z.boolean(),
    shortcuts: GlobalShortcutsSchema,
    autostartEnabled: z.boolean(),
  })
  .partial();

export type ValidatedSettings = z.infer<typeof SettingsSchema>;
