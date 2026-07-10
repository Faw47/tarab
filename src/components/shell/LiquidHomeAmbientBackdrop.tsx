/**
 * Full-viewport liquid ambient: current-track blurred art when playing, palette-only wash when idle.
 * Rendered in the app shell under TopBar + all main views (Library, Queue, Settings, etc.).
 */

import { clsx } from 'clsx';
import { memo } from 'react';

import { useDominantColor } from '@/hooks/use-dominant-color';
import { useSettingsStore } from '@/store/settings-store';

const HERO_GLOW = 'var(--hero-glow)';

export interface LiquidHomeAmbientBackdropProps {
  coverUrl: string | null | undefined;
}

export const LiquidHomeAmbientBackdrop = memo(function LiquidHomeAmbientBackdrop({
  coverUrl,
}: LiquidHomeAmbientBackdropProps) {
  const reducedEffects = useSettingsStore((s) => s.reducedEffects);
  const localAccent = useDominantColor(coverUrl ?? null);

  return (
    <div className="pointer-events-none fixed inset-0 z-[4] overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-[#0d0b09]" />

      {!coverUrl ? (
        <div
          className="absolute inset-0"
          style={{
            background: [
              'radial-gradient(55% 45% at 20% 18%, color-mix(in srgb, var(--surface-tint) 42%, transparent) 0%, transparent 58%)',
              'radial-gradient(50% 42% at 78% 72%, color-mix(in srgb, var(--hero-accent) 14%, transparent) 0%, transparent 52%)',
              'radial-gradient(70% 55% at 50% 100%, color-mix(in srgb, var(--shell-blob-b, transparent) 22%, transparent) 0%, transparent 45%)',
            ].join(', '),
          }}
        />
      ) : null}

      {coverUrl ? (
        <>
          <img
            key={coverUrl}
            src={coverUrl}
            alt=""
            className={clsx(
              'absolute inset-0 h-full w-full object-cover',
              reducedEffects
                ? 'scale-[1.06] blur-[14px] saturate-[1.15] opacity-[0.16]'
                : 'scale-[1.22] blur-[12px] saturate-[1.65] opacity-[0.26] contrast-[1.08]',
            )}
            draggable={false}
          />
          {!reducedEffects && (
            <img
              key={`${coverUrl}-glow`}
              src={coverUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover scale-[1.45] blur-[24px] saturate-[1.4] opacity-[0.12]"
              draggable={false}
            />
          )}
        </>
      ) : null}

      <div
        className="absolute inset-0 transition-[background] duration-700"
        style={{
          background: `radial-gradient(52% 38% at 26% 18%, ${HERO_GLOW} 0%, transparent 72%)`,
        }}
      />

      <div
        className="absolute inset-0 transition-[background] duration-700"
        style={{
          background: `radial-gradient(38% 28% at 26% 18%, color-mix(in srgb, ${localAccent} 14%, transparent) 0%, transparent 70%)`,
        }}
      />

      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(13,11,9,0.10) 0%, rgba(13,11,9,0.46) 48%, rgba(13,11,9,0.88) 100%)',
        }}
      />
    </div>
  );
});

LiquidHomeAmbientBackdrop.displayName = 'LiquidHomeAmbientBackdrop';
