import { memo, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/store/settings-store';

export interface SettingsNavTabProps {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  /** When a liquid segmented strip handles pointer-up, skip one click to avoid double navigation. */
  liquidStripSuppressClickRef?: RefObject<boolean>;
}

export const SettingsNavTab = memo(function SettingsNavTab({
  active,
  label,
  icon,
  onClick,
  liquidStripSuppressClickRef,
}: SettingsNavTabProps) {
  const isNeobrutalism = useSettingsStore((s) => s.theme === 'neobrutalism');

  return (
    <button
      type="button"
      onClick={() => {
        if (liquidStripSuppressClickRef?.current) {
          liquidStripSuppressClickRef.current = false;
          return;
        }
        onClick();
      }}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative z-10 flex w-full items-center justify-start gap-3 transition-all duration-300 motion-reduce:transition-none',
        isNeobrutalism
          ? 'h-auto rounded-none px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black'
          : 'rounded-xl px-3.5 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
        isNeobrutalism
          ? active
            ? 'translate-x-0 translate-y-0 border-[3px] border-black bg-[#facc15] text-black shadow-[4px_4px_0_0_#000] transition-none'
            : 'border-[3px] border-black bg-white text-black shadow-[4px_4px_0_0_#000] transition-none hover:bg-[#84cc16]'
          : active
            ? 'text-white'
            : 'text-white/50 hover:bg-white/[0.04] hover:text-white/90',
      )}
    >
      <span
        className={cn(
          'shrink-0 transition-[transform,color] duration-300',
          isNeobrutalism
            ? active
              ? 'scale-110 text-black'
              : 'text-black group-hover:scale-110'
            : active
              ? 'scale-105'
              : 'text-white/45 group-hover:scale-105 group-hover:text-white/70',
        )}
        style={
          !isNeobrutalism && active
            ? { color: 'var(--hero-accent, #fff)' }
            : undefined
        }
      >
        {icon}
      </span>

      <span
        className={cn(
          isNeobrutalism
            ? 'text-sm font-black uppercase tracking-[0.08em] text-inherit'
            : 'text-[13px] font-medium tracking-normal',
          !isNeobrutalism && active && 'text-white',
        )}
      >
        {label}
      </span>
    </button>
  );
});

SettingsNavTab.displayName = 'SettingsNavTab';
