import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/store/settings-store';
import { memo, useId } from 'react';
import { LiquidGlassSurface } from '../glass/LiquidGlassSurface';

interface SettingToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  className?: string;
}

/**
 * A standard toggle switch component for settings.
 * Accessible with proper ARIA roles and keyboard support.
 * Themed automatically based on the global theme setting.
 */
export const SettingToggle = memo(function SettingToggle({
  label,
  description,
  checked,
  onChange,
  className,
}: SettingToggleProps) {
  const switchId = useId();
  const labelId = `${switchId}-label`;
  const isNeobrutalism = useSettingsStore((s) => s.theme === 'neobrutalism');

  return (
    <div className={cn('flex items-center justify-between py-3 group', className)}>
      <div className="flex flex-col pr-4">
        <span
          id={labelId}
          className={cn(
            'text-sm font-medium transition-colors',
            isNeobrutalism
              ? 'text-black group-hover:text-black'
              : 'text-text-primary group-hover:text-white',
          )}
        >
          {label}
        </span>
        {description && (
          <span
            className={cn(
              'text-xs mt-0.5 leading-normal',
              isNeobrutalism ? 'text-black/70' : 'text-text-muted',
            )}
          >
            {description}
          </span>
        )}
      </div>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        onClick={() => onChange(!checked)}
        className={cn(
          'focus-visible:outline-none focus-visible:ring-2',
          isNeobrutalism
            ? cn(
                'relative h-9 min-w-[4.5rem] shrink-0 overflow-visible rounded-none border-[3px] border-black px-3 text-[11px] font-black uppercase tracking-[0.14em] text-black shadow-[4px_4px_0_0_#000] transition-none',
                'focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                'active:translate-x-[3px] active:translate-y-[3px] active:shadow-none',
                checked ? 'bg-[#84cc16]' : 'bg-white',
              )
            : cn(
                'relative h-6 w-12 shrink-0 overflow-hidden transition-all duration-300',
                'rounded-full focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                'border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_8px_rgba(0,0,0,0.08)]',
                checked
                  ? 'bg-primary/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_12px_rgba(var(--color-primary-rgb),0.3)]'
                  : 'bg-black/40 backdrop-blur-md',
              ),
        )}
      >
        {!isNeobrutalism && (
          <div className="absolute inset-0 z-0 mix-blend-screen opacity-90"><LiquidGlassSurface interactive={checked} /></div>
        )}
        {!isNeobrutalism && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-1 left-1 z-10 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-300',
              checked ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        )}
        {isNeobrutalism && (
          <span aria-hidden="true" className="pointer-events-none relative z-10">
            {checked ? 'ON' : 'OFF'}
          </span>
        )}
      </button>
    </div>
  );
});

SettingToggle.displayName = 'SettingToggle';
