import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useScanCompletionFeedback } from '../useScanCompletionFeedback';

describe('useScanCompletionFeedback', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows restrained feedback only for the manual completion event', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useScanCompletionFeedback());

    act(() => {
      window.dispatchEvent(new CustomEvent('tarab:manual-scan-complete'));
    });

    expect(result.current.showScanComplete).toBe(true);
    expect(result.current.shellScanBurstKey).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1_800);
    });
    expect(result.current.showScanComplete).toBe(false);
  });
});
