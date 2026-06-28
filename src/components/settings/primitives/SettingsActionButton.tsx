import { forwardRef } from 'react';

import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/store/settings-store';

type SettingsActionButtonTone = 'default' | 'danger' | 'ghost';
type SettingsActionButtonSize = 'sm' | 'md';

export interface SettingsActionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: SettingsActionButtonTone;
  size?: SettingsActionButtonSize;
}

export const SettingsActionButton = forwardRef<
  HTMLButtonElement,
  SettingsActionButtonProps
>(function SettingsActionButton(
  { className, tone = 'default', size = 'md', disabled, type = 'button', ...props },
  ref,
) {
  const isNeobrutalism = useSettingsStore((s) => s.theme === 'neobrutalism');

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        'group relative inline-flex items-center justify-center gap-2 transition-all duration-300 motion-reduce:transition-none',
        'focus-visible:outline-none',
        disabled && 'opacity-50 cursor-not-allowed',
        isNeobrutalism
          ? cn(
              'font-black uppercase tracking-[0.08em] rounded-none border-2 border-black shadow-[2px_2px_0_0_#000] text-black bg-white hover:bg-[var(--surface-highlight)] focus-visible:ring-2 focus-visible:ring-black transition-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none',
              size === 'sm' ? 'h-9 px-3 text-[11px]' : 'h-10 px-4 text-xs',
            )
          : cn(
              'h-8 rounded-full border border-white/[0.06] backdrop-blur-md font-medium focus-visible:ring-2 focus-visible:ring-white/30',
              size === 'sm' ? 'min-h-8 px-3 text-[12px]' : 'min-h-8 px-3.5 text-[13px]',
              tone === 'ghost'
                ? 'text-white/55 hover:bg-white/[0.04] hover:text-white/90'
                : 'text-white/95',
            ),
        className,
      )}
      style={
        isNeobrutalism
          ? undefined
          : tone === 'ghost'
            ? undefined
            : tone === 'danger'
              ? {
                background:
                  'linear-gradient(180deg, rgba(255,99,99,0.28) 0%, rgba(255,72,72,0.12) 55%, rgba(255,72,72,0.08) 100%)',
                boxShadow:
                  'inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.08), 0 2px 8px -4px rgba(0,0,0,0.3)',
              }
              : {
                background: [
                  'linear-gradient(180deg,',
                  `  color-mix(in oklch, var(--surface-tint, rgba(255,255,255,0.08)) 60%, rgba(255,255,255,0.13)) 0%,`,
                  `  color-mix(in oklch, var(--surface-tint, rgba(255,255,255,0.08)) 30%, rgba(255,255,255,0.06)) 50%,`,
                  `  color-mix(in oklch, var(--surface-tint, rgba(255,255,255,0.08)) 10%, rgba(255,255,255,0.04)) 100%`,
                  ')',
                ].join(''),
                boxShadow: [
                  'inset 0 1px 0 rgba(255,255,255,0.18)',
                  'inset 0 -1px 0 rgba(0,0,0,0.08)',
                  `0 0 14px -6px rgb(var(--hero-accent-rgb, 255 255 255) / 0.40)`,
                  '0 2px 8px -4px rgba(0,0,0,0.25)',
                ].join(', '),
              }
      }
      {...props}
    />
  );
});

SettingsActionButton.displayName = 'SettingsActionButton';
