import { ChevronDown } from 'lucide-react';
import {
  Children,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  isValidElement,
  memo,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { liquidGlassSettingsSliderWellClassName } from '@/lib/liquid-glass-settings-ui';
import { rangeProgressStyle } from '@/lib/range-progress-style';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/store/settings-store';

const useSettingsTheme = (explicit?: boolean) => {
  const storeThemeIsNeobrutalism = useSettingsStore((s) => s.theme === 'neobrutalism');
  return explicit ?? storeThemeIsNeobrutalism;
};

export interface SettingsSectionProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  isNeobrutalism?: boolean;
}

export const SettingsSection = memo(function SettingsSection({
  title,
  description,
  icon,
  actions,
  children,
  className,
  isNeobrutalism: explicitTheme,
}: SettingsSectionProps) {
  const isNeobrutalism = useSettingsTheme(explicitTheme);

  return (
    <section
      className={cn(
        'overflow-visible',
        isNeobrutalism
          ? 'rounded-none border-2 border-black bg-[var(--surface-card)] shadow-[6px_6px_0_0_#000]'
          : 'rounded-2xl border border-white/[0.07] bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_18px_45px_rgba(0,0,0,0.22)] backdrop-blur-2xl',
        className,
      )}
    >
      <div
        className={cn(
          'flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5',
          isNeobrutalism
            ? 'border-b-2 border-black bg-white'
            : 'border-b border-white/[0.07] bg-black/10',
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <div
              className={cn(
                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center',
                isNeobrutalism
                  ? 'border-2 border-black bg-[var(--accent)] text-black shadow-[3px_3px_0_0_#000]'
                  : 'rounded-full border border-white/[0.08] bg-white/[0.06] text-primary',
              )}
            >
              {icon}
            </div>
          ) : null}
          <div className="min-w-0">
            <h3
              className={cn(
                'text-sm font-semibold leading-tight text-text-primary',
                isNeobrutalism && 'uppercase tracking-[0.08em]',
              )}
            >
              {title}
            </h3>
            {description ? (
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn(isNeobrutalism ? 'divide-y-2 divide-black' : 'divide-y divide-white/[0.06]')}>
        {children}
      </div>
    </section>
  );
});

export interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  isNeobrutalism?: boolean;
}

export const SettingsRow = memo(function SettingsRow({
  label,
  description,
  meta,
  control,
  children,
  disabled = false,
  className,
  isNeobrutalism: explicitTheme,
}: SettingsRowProps) {
  const isNeobrutalism = useSettingsTheme(explicitTheme);

  return (
    <div
      className={cn(
        'grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5',
        disabled && 'opacity-60',
        isNeobrutalism ? 'bg-[var(--surface-card)]' : 'bg-transparent',
        className,
      )}
    >
      <div className="min-w-0">
        <div
          className={cn(
            'text-sm font-medium leading-snug text-text-primary',
            isNeobrutalism && 'font-bold uppercase tracking-[0.04em]',
          )}
        >
          {label}
        </div>
        {description ? (
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">{description}</p>
        ) : null}
        {meta ? <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {control ? (
        <div className="flex min-w-0 items-center justify-start sm:justify-end">{control}</div>
      ) : null}
      {children ? <div className="min-w-0 sm:col-span-2">{children}</div> : null}
    </div>
  );
});

export const SettingsControlGroup = memo(function SettingsControlGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}>{children}</div>;
});

export interface SettingsSwitchProps {
  label?: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  isNeobrutalism?: boolean;
}

export const SettingsSwitch = memo(function SettingsSwitch({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  isNeobrutalism: explicitTheme,
}: SettingsSwitchProps) {
  const id = useId();
  const isNeobrutalism = useSettingsTheme(explicitTheme);
  const switchControl = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={label ? id : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center transition-colors disabled:cursor-not-allowed',
        isNeobrutalism
          ? cn(
              'rounded-none border-2 border-black shadow-[3px_3px_0_0_#000]',
              checked ? 'bg-[var(--accent)]' : 'bg-white',
            )
          : cn(
              'rounded-full border border-white/[0.10] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
              checked ? 'bg-primary/80' : 'bg-white/10',
            ),
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform transition-transform',
          isNeobrutalism ? 'border-2 border-black bg-black' : 'rounded-full bg-white shadow-sm',
          checked ? 'translate-x-5' : 'translate-x-1',
        )}
      />
    </button>
  );

  if (!label && !description) return switchControl;

  return (
    <SettingsRow
      label={<span id={id}>{label}</span>}
      description={description}
      disabled={disabled}
      control={switchControl}
      isNeobrutalism={isNeobrutalism}
    />
  );
});

export interface SettingsSegmentedControlOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function SettingsSegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  isNeobrutalism: explicitTheme,
}: {
  value: T;
  onChange: (value: T) => void;
  options: SettingsSegmentedControlOption<T>[];
  ariaLabel: string;
  className?: string;
  isNeobrutalism?: boolean;
}) {
  const isNeobrutalism = useSettingsTheme(explicitTheme);

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex min-w-0 items-center gap-1 p-1',
        isNeobrutalism
          ? 'border-2 border-black bg-white'
          : 'rounded-full border border-white/[0.08] bg-black/20 backdrop-blur-xl',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'min-w-0 px-3 py-1.5 text-xs font-semibold transition-colors',
              isNeobrutalism
                ? cn(
                    'rounded-none uppercase tracking-[0.08em]',
                    active ? 'bg-[var(--accent)] text-black' : 'bg-transparent text-black/65',
                  )
                : cn(
                    'rounded-full',
                    active ? 'bg-primary/75 text-white shadow-sm' : 'text-white/55 hover:text-white/85',
                  ),
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export const SettingsSlider = memo(function SettingsSlider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  valueLabel,
  onCommit,
  isNeobrutalism: explicitTheme,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  valueLabel?: string;
  onCommit?: () => void;
  isNeobrutalism?: boolean;
}) {
  const isNeobrutalism = useSettingsTheme(explicitTheme);
  const input = (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      onMouseUp={onCommit}
      onTouchEnd={onCommit}
      aria-label={label}
      className="w-full cursor-pointer accent-primary [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/10"
      style={rangeProgressStyle(value, min, max) as CSSProperties}
    />
  );

  return (
    <div className="min-w-[12rem] space-y-2">
      {valueLabel ? <div className="text-right text-xs font-semibold text-text-muted">{valueLabel}</div> : null}
      {isNeobrutalism ? <div className="settings-neo-volume w-full">{input}</div> : <div className={liquidGlassSettingsSliderWellClassName()}>{input}</div>}
    </div>
  );
});

interface SettingsSelectOption {
  value: string;
  label: ReactNode;
}

const getSettingsSelectOptions = (children: ReactNode): SettingsSelectOption[] =>
  Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const element = child as ReactElement<{ value?: string | number; children?: ReactNode }>;
    const value = element.props.value;
    if (value === undefined) return [];
    return [{ value: String(value), label: element.props.children }];
  });

export const SettingsSelect = memo(function SettingsSelect({
  className,
  isNeobrutalism: explicitTheme,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  'aria-label': ariaLabel,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { isNeobrutalism?: boolean }) {
  const isNeobrutalism = useSettingsTheme(explicitTheme);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = getSettingsSelectOptions(children);
  const selectedValue = String(value ?? defaultValue ?? options[0]?.value ?? '');
  const selectedOption = options.find((option) => option.value === selectedValue) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const handleGlobalClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, [open]);

  const commitValue = (nextValue: string) => {
    onChange?.({ target: { value: nextValue }, currentTarget: { value: nextValue } } as unknown as React.ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };

  if (isNeobrutalism) {
    return (
      <div className="relative min-w-[12rem]">
        <select
          {...props}
          value={value}
          defaultValue={defaultValue}
          disabled={disabled}
          onChange={onChange}
          aria-label={ariaLabel}
          className={cn(
            'w-full appearance-none rounded-none border-2 border-black bg-white px-3 py-2 pr-10 text-sm text-black outline-none transition-colors focus:ring-2 focus:ring-black',
            className,
          )}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          size={16}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-black"
        />
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn('relative min-w-[12rem]', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className="library-v2-tab relative flex min-h-10 w-full items-center justify-between gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-4 py-2 text-left text-[0.81rem] font-medium text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none backdrop-blur-md transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/30 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 truncate">{selectedOption?.label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 top-full z-[100] mt-2 flex w-full min-w-[10rem] flex-col gap-0.5 rounded-xl border border-white/[0.08] bg-[rgba(18,16,15,0.85)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_12px_30px_-10px_rgba(8,6,4,0.8)] backdrop-blur-2xl"
        >
          {options.map((option) => {
            const selected = option.value === selectedValue;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={(event) => {
                  event.stopPropagation();
                  commitValue(option.value);
                }}
                className={cn(
                  'w-full rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[0.81rem] font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white',
                  selected && 'bg-white/[0.10] font-semibold text-[var(--hero-accent,#fff)]',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
export const SettingsDangerRow = memo(function SettingsDangerRow({
  action,
  ...props
}: Omit<SettingsRowProps, 'control'> & { action: ReactNode }) {
  const isNeobrutalism = useSettingsTheme(props.isNeobrutalism);

  return (
    <SettingsRow
      {...props}
      isNeobrutalism={isNeobrutalism}
      className={cn(
        isNeobrutalism ? 'bg-red-100' : 'bg-red-500/[0.035]',
        props.className,
      )}
      control={action}
    />
  );
});





