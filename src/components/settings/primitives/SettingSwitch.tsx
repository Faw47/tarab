import { memo, useId } from 'react';

import { cn } from '@/lib/utils';

export interface SettingSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  isNeobrutalism?: boolean;
}

export const SettingSwitch = memo(function SettingSwitch({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  isNeobrutalism = false,
}: SettingSwitchProps) {
  const switchId = useId();
  const labelId = `${switchId}-label`;
  const descriptionId = description ? `${switchId}-description` : undefined;

  return (
    <div className="flex items-center justify-between py-3 group">
      <div className="pr-4 min-w-0">
        <p
          id={labelId}
          className={cn(
            'text-sm font-medium transition-colors',
            isNeobrutalism ? 'text-black group-hover:text-black' : 'text-text-primary group-hover:text-white',
          )}
        >
          {label}
        </p>
        {description && (
          <p
            id={descriptionId}
            className={cn('text-xs text-text-muted mt-0.5', isNeobrutalism && 'text-black')}
          >
            {description}
          </p>
        )}
      </div>

      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={descriptionId ? `${labelId} ${descriptionId}` : labelId}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          onChange(!checked);
        }}
        className={cn(
          'outline-none focus-visible:ring-2',
          disabled && 'cursor-not-allowed opacity-45',
          isNeobrutalism
            ? cn(
                'relative h-9 min-w-[4.5rem] shrink-0 rounded-none border-[3px] border-black px-3 text-[11px] font-black uppercase tracking-[0.14em] text-black shadow-[4px_4px_0_0_#000] transition-none',
                'focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                'active:not-disabled:translate-x-[3px] active:not-disabled:translate-y-[3px] active:not-disabled:shadow-none',
                disabled && 'shadow-[2px_2px_0_0_#000]',
                checked ? 'bg-[#84cc16]' : 'bg-white',
              )
            : cn(
                'relative h-6 w-12 shrink-0 transition-all duration-300',
                'focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                checked
                  ? 'rounded-full border border-primary/40 bg-gradient-to-r from-primary/85 to-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_0_14px_rgba(var(--color-primary-rgb),0.35)]'
                  : 'rounded-full border border-white/[0.06] bg-black/40 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_8px_rgba(0,0,0,0.08)]',
              ),
        )}
      >
        {!isNeobrutalism && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.35)] transition-transform duration-300',
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

SettingSwitch.displayName = 'SettingSwitch';

