import { render } from '@testing-library/react';
import { Home, Library } from 'lucide-react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { motionState, settingsState } = vi.hoisted(() => ({
  motionState: { enabled: [] as boolean[] },
  settingsState: {
    theme: 'liquid-glass' as string,
    reducedEffects: false,
    backgroundEnabled: true,
  },
}));

vi.mock('@/store/settings-store', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/hooks/use-liquid-control-motion', () => ({
  useLiquidControlMotionHorizontal: ({ enabled }: { enabled: boolean }) => {
    motionState.enabled.push(enabled);
  },
}));

vi.mock('@/hooks/use-liquid-segmented-pill', () => ({
  applyHorizontalPillDom: vi.fn(),
  useLiquidSegmentedPillHorizontal: () => ({
    pillStyle: { left: 0, width: 0, opacity: 0 },
    isDragging: false,
    pillLayoutFromDom: false,
    dragPreviewIndex: null,
    pillGeometryRef: { current: null },
    suppressNextTabClickRef: { current: false },
    listProps: {
      onPointerDownCapture: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUpCapture: vi.fn(),
      onPointerCancelCapture: vi.fn(),
      onLostPointerCapture: vi.fn(),
    },
  }),
}));

import { SlidingTabGroup } from './SlidingTabGroup';

const tabs = [
  { view: 'home' as const, label: 'Home', icon: Home },
  { view: 'library' as const, label: 'Library', icon: Library },
];

const cases = [
  ['liquid motion', 'liquid-glass', false, true, true],
  ['reduced effects', 'liquid-glass', true, true, false],
  ['background disabled', 'liquid-glass', false, false, false],
  ['neobrutalism', 'neobrutalism', false, true, false],
] as const;

describe('SlidingTabGroup visual-motion policy', () => {
  beforeEach(() => {
    settingsState.theme = 'liquid-glass';
    settingsState.reducedEffects = false;
    settingsState.backgroundEnabled = true;
    motionState.enabled = [];
  });

  it.each(
    cases,
  )('%s controls the GPU pill loop', (_label, theme, reducedEffects, backgroundEnabled, expected) => {
    settingsState.theme = theme;
    settingsState.reducedEffects = reducedEffects;
    settingsState.backgroundEnabled = backgroundEnabled;

    render(<SlidingTabGroup tabs={tabs} currentView={tabs[0].view} onNavigate={vi.fn()} />);

    expect(motionState.enabled.length).toBeGreaterThan(0);
    expect(motionState.enabled.every((enabled) => enabled === expected)).toBe(true);
  });
});
