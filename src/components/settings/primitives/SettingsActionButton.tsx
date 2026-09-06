import { forwardRef } from 'react';

import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/store/settings-store';

type SettingsActionButtonTone = 'default' | 'danger' | 'ghost';
type SettingsActionButtonSize = 'sm' | 'md';

export interface SettingsActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: SettingsActionButtonTone;
  size?: SettingsActionButtonSize;
}

export const SettingsActionButton = forwardRef<HTMLButtonElement, SettingsActionButtonProps>(
  function SettingsActionButton(
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
          'group relative inline-flex items-center justify-center gap-2 transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-emphasis)] motion-reduce:transition-none',
          'focus-visible:outline-none',
          disabled && 'opacity-50 cursor-not-allowed',
          isNeobrutalism
            ? cn(
                'font-black uppercase tracking-[0.08em] rounded-none transition-none active:translate-x-[2px] active:translate-y-[2px] active:shadow-none',
                tone === 'danger'
                  ? 'border-2 border-[var(--neo-ink)] shadow-[var(--neo-shadow-xs)] text-[var(--neo-ink)] bg-[var(--signal-danger)] hover:bg-[var(--signal-danger)] focus-visible:ring-2 focus-visible:ring-[var(--neo-ink)]'
                  : tone === 'ghost'
                    ? 'border-2 border-transparent shadow-none text-[var(--neo-ink)] bg-transparent hover:bg-[var(--neo-utility-hover)] focus-visible:ring-2 focus-visible:ring-[var(--neo-ink)]'
                    : 'border-2 border-[var(--neo-ink)] shadow-[var(--neo-shadow-xs)] text-[var(--neo-ink)] bg-[var(--neo-paper)] hover:bg-[var(--surface-highlight)] focus-visible:ring-2 focus-visible:ring-[var(--neo-ink)]',
                size === 'sm' ? 'h-9 px-3 text-xs' : 'h-10 px-4 text-sm',
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
                      'linear-gradient(180deg, color-mix(in oklch, var(--signal-danger) 28%, transparent) 0%, color-mix(in oklch, var(--signal-danger) 12%, transparent) 55%, color-mix(in oklch, var(--signal-danger) 8%, transparent) 100%)',
                    boxShadow:
                      'inset 0 1px 0 color-mix(in oklch, var(--type-primary) 15%, transparent), inset 0 -1px 0 color-mix(in oklch, var(--glass-shadow) 8%, transparent), 0 2px 8px -4px color-mix(in oklch, var(--glass-shadow) 30%, transparent)',
                  }
                : {
                    background: 'var(--settings-control-background)',
                    boxShadow: 'var(--settings-control-shadow)',
                  }
        }
        {...props}
      />
    );
  },
);

SettingsActionButton.displayName = 'SettingsActionButton';
