import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiquidControlMotionHorizontal } from './use-liquid-control-motion';
import type { LiquidPillHorizontalGeom } from './use-liquid-segmented-pill';

const requestAnimationFrameMock = vi.hoisted(() => vi.fn(() => 1));

const createOptions = () => {
  const root = document.createElement('nav');
  document.body.append(root);
  return {
    enabled: true,
    rootRef: { current: root as HTMLElement | null },
    pillStyle: { left: 0, width: 120, opacity: 1 },
    pillLayoutFromDom: false,
    pillGeometryRef: { current: null as LiquidPillHorizontalGeom | null },
    isDragging: false,
    hoveringRef: { current: false },
    pressingRef: { current: false },
    activeIndex: 0,
  };
};

describe('useLiquidControlMotionHorizontal canvas lifecycle', () => {
  beforeEach(() => {
    requestAnimationFrameMock.mockClear();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('does not start a RAF loop when the liquid canvas is absent', () => {
    const options = createOptions();

    const view = renderHook(() => useLiquidControlMotionHorizontal(options));

    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
    view.unmount();
  });

  it('starts one RAF loop when the liquid canvas is already mounted', () => {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-liquid-shell-canvas', '');
    document.body.append(canvas);

    const options = createOptions();
    const view = renderHook(() => useLiquidControlMotionHorizontal(options));

    expect(requestAnimationFrameMock).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('does not duplicate a pending RAF when the browser returns handle zero', async () => {
    requestAnimationFrameMock.mockReturnValue(0);
    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-liquid-shell-canvas', '');
    document.body.append(canvas);

    const options = createOptions();
    const view = renderHook(() => useLiquidControlMotionHorizontal(options));
    canvas.setAttribute('data-liquid-shell-canvas', 'ready');

    await waitFor(() => expect(requestAnimationFrameMock).toHaveBeenCalledOnce());
    view.unmount();
  });
});
