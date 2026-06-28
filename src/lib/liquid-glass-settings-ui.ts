import { cn } from '@/lib/utils';

/** TopBar SearchBar–style `<select>` (liquid-glass theme only). */
export const liquidGlassSettingsSelectClassName = (className?: string) =>
  cn(
    'w-full appearance-none px-4 py-2.5 pr-10 outline-none transition-all cursor-pointer',
    'rounded-full border border-white/[0.06] bg-black/20 text-[14px] font-medium text-text-primary backdrop-blur-md',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_8px_rgba(0,0,0,0.1)]',
    'focus-visible:border-white/[0.15] focus-visible:bg-black/35 focus-visible:ring-2 focus-visible:ring-white/25',
    className,
  );

/** Nested stat / quota panels inside settings cards. */
export const liquidGlassSettingsInsetPanelClassName = (className?: string) =>
  cn(
    'rounded-xl border border-white/[0.06] bg-black/20 backdrop-blur-md',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_8px_rgba(0,0,0,0.08)]',
    className,
  );

/** Rounded track shell for range inputs (echoes SearchBar pill). */
export const liquidGlassSettingsSliderWellClassName = (className?: string) =>
  cn(
    'rounded-full border border-white/[0.06] bg-black/15 px-3 py-2.5 backdrop-blur-md',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_8px_rgba(0,0,0,0.06)]',
    className,
  );

export const liquidGlassSettingsBadgePillClassName = (className?: string) =>
  cn(
    'rounded-full border border-white/[0.06] bg-black/30 px-2.5 py-1 text-sm font-bold text-[var(--hero-accent)] backdrop-blur-md',
    className,
  );

export const liquidGlassSettingsIconChipClassName = (className?: string) =>
  cn(
    'rounded-full border border-white/[0.06] bg-black/30 p-2 text-[var(--hero-accent)] backdrop-blur-md',
    className,
  );

/** SearchBar-style single-line text field for dialogs / shortcut fields. */
export const liquidGlassSettingsTextInputClassName = (className?: string) =>
  cn(
    'min-w-0 rounded-full border border-white/[0.06] bg-black/20 px-4 py-2.5 text-[14px] font-medium text-text-primary outline-none backdrop-blur-md',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_8px_rgba(0,0,0,0.1)]',
    'placeholder:text-white/35 focus-visible:border-white/[0.15] focus-visible:bg-black/35 focus-visible:ring-2 focus-visible:ring-white/25',
    className,
  );
