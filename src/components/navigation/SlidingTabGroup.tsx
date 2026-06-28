import type { LucideIcon } from 'lucide-react';
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { useLiquidControlMotionHorizontal } from '@/hooks/use-liquid-control-motion';
import { applyHorizontalPillDom, useLiquidSegmentedPillHorizontal } from '@/hooks/use-liquid-segmented-pill';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/store/settings-store';

import type { NavView } from './FloatingDock';

export interface SlidingTabGroupProps {
  tabs: Array<{ view: NavView; label: string; icon: LucideIcon }>;
  currentView: string;
  onNavigate: (view: NavView) => void;
}

export const SlidingTabGroup = memo(function SlidingTabGroup({
  tabs,
  currentView,
  onNavigate,
}: SlidingTabGroupProps) {
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const hoveringRef = useRef(false);
  const pressingRef = useRef(false);

  const useGpuLiquidPill = useSettingsStore((s) => s.theme === 'liquid-glass' && !s.reducedEffects);

  const activeIndex = useMemo(
    () => Math.max(0, tabs.findIndex((t) => t.view === currentView)),
    [tabs, currentView],
  );

  const onCommitIndex = useCallback(
    (index: number) => {
      const tab = tabs[index];
      if (tab) onNavigate(tab.view);
    },
    [tabs, onNavigate],
  );

  const {
    pillStyle,
    isDragging,
    pillLayoutFromDom,
    dragPreviewIndex,
    pillGeometryRef,
    suppressNextTabClickRef,
    listProps,
  } = useLiquidSegmentedPillHorizontal({
    rootRef: navRef,
    pillElementRef: pillRef,
    tabSelector: 'button',
    activeIndex: activeIndex >= 0 ? activeIndex : 0,
    onCommitIndex,
    syncDependencies: [currentView, tabs],
  });

  const listPropsWrapped = useMemo(
    () => ({
      ...listProps,
      onPointerDownCapture: (e: ReactPointerEvent<HTMLElement>) => {
        pressingRef.current = true;
        listProps.onPointerDownCapture(e);
      },
      onPointerUpCapture: (e: ReactPointerEvent<HTMLElement>) => {
        listProps.onPointerUpCapture(e);
        pressingRef.current = false;
      },
      onPointerCancelCapture: (e: ReactPointerEvent<HTMLElement>) => {
        listProps.onPointerCancelCapture(e);
        pressingRef.current = false;
      },
      onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => {
        listProps.onLostPointerCapture(e);
        pressingRef.current = false;
      },
    }),
    [listProps],
  );

  useLiquidControlMotionHorizontal({
    enabled: useGpuLiquidPill,
    rootRef: navRef,
    pillStyle,
    pillLayoutFromDom,
    pillGeometryRef,
    isDragging,
    hoveringRef,
    pressingRef,
    activeIndex: activeIndex >= 0 ? activeIndex : 0,
  });

  useLayoutEffect(() => {
    if (!pillLayoutFromDom) return;
    const el = pillRef.current;
    const g = pillGeometryRef.current;
    if (el && g) applyHorizontalPillDom(el, g.left, g.width);
  }, [pillLayoutFromDom, dragPreviewIndex, isDragging, pillGeometryRef]);

  /*
   * Always keep a visible DOM pill: the GPU composite runs on AppShellLiquidWebGL’s canvas (z-0),
   * while TopBar stacks above (z-10+), so the GL pill sits under the header and is not seen through
   * opaque chrome. CSS provides the actual selection chrome until header/stacking is refactored for
   * see-through glass over the shell.
   */
  const domPillStyle = useMemo((): CSSProperties => {
    return {
      ...(pillLayoutFromDom
        ? {}
        : { left: pillStyle.left, width: pillStyle.width, opacity: pillStyle.opacity }),
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
    };
  }, [pillLayoutFromDom, pillStyle.left, pillStyle.width, pillStyle.opacity]);

  return (
    <nav
      ref={navRef}
      aria-label="Primary sections"
      className="relative flex min-w-0 items-center gap-1 rounded-full border border-white/[0.04] bg-white/[0.02] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      onPointerEnter={() => {
        hoveringRef.current = true;
      }}
      onPointerLeave={() => {
        hoveringRef.current = false;
      }}
      {...listPropsWrapped}
    >
      <div
        ref={pillRef}
        className={cn(
          'pointer-events-none absolute bottom-1 top-1 rounded-full motion-reduce:transition-none',
          isDragging || pillLayoutFromDom
            ? 'transition-none'
            : 'transition-[left,width,opacity] duration-200 ease-out',
        )}
        style={domPillStyle}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-2 top-0 h-px rounded-full"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
            opacity: 0.7,
          }}
        />
      </div>

      {tabs.map((tab, tabIndex) => {
        const isCommitted = currentView === tab.view;
        const isPreviewed = dragPreviewIndex === tabIndex;
        const isActive = dragPreviewIndex !== null ? isPreviewed : isCommitted;

        return (
          <button
            key={tab.view}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              if (suppressNextTabClickRef.current) {
                suppressNextTabClickRef.current = false;
                return;
              }
              onNavigate(tab.view);
            }}
            className={cn(
              'relative z-10 flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5',
              'text-[13px] font-medium transition-colors duration-300 motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
              isActive ? 'text-white' : 'text-white/50 hover:bg-white/[0.04] hover:text-white/90',
            )}
            style={isActive ? { color: 'var(--hero-accent, #fff)' } : undefined}
          >
            <tab.icon className="h-4 w-4 shrink-0" />
            <span className={isActive ? 'text-white' : undefined}>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
});

SlidingTabGroup.displayName = 'SlidingTabGroup';
