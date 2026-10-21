import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import { useAppSessionPersistence } from '../useAppSessionPersistence';

const { scheduleSessionSaveMock, flushSessionSaveMock } = vi.hoisted(() => ({
  scheduleSessionSaveMock: vi.fn(),
  flushSessionSaveMock: vi.fn(async () => undefined),
}));

vi.mock('../../../hooks/useSessionPersistence', () => ({
  useSessionPersistence: () => ({
    scheduleSessionSave: scheduleSessionSaveMock,
    flushSessionSave: flushSessionSaveMock,
    lastSavedPositionRef: { current: 0 },
    lastSessionSaveRef: { current: 0 },
  }),
}));

const initialPlayerState = usePlayerStore.getState();

describe('app session persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState(initialPlayerState, true);
  });

  it('saves when the volume booster changes', () => {
    renderHook(() => useAppSessionPersistence({ currentView: 'home', albumDetails: null }));
    scheduleSessionSaveMock.mockClear();

    act(() => usePlayerStore.getState().setBoosterLevel(1.6));

    expect(scheduleSessionSaveMock).toHaveBeenCalledWith(true);
  });
});
