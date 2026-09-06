import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCoverArtPaletteMock } = vi.hoisted(() => ({
  getCoverArtPaletteMock: vi.fn(),
}));

vi.mock('../lib/tauri-commands', () => ({
  getCoverArtPalette: getCoverArtPaletteMock,
}));

import { useColorExtraction } from './use-color-extraction';

describe('useColorExtraction async lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores a palette response after the current cover path is cleared', async () => {
    let resolvePalette!: (value: { primary: string; secondary: string }) => void;
    const pending = new Promise<{ primary: string; secondary: string }>((resolve) => {
      resolvePalette = resolve;
    });
    getCoverArtPaletteMock.mockReturnValueOnce(pending);

    const initialProps: { filePath: string | null } = { filePath: '/music/old.mp3' };
    const { result, rerender } = renderHook(
      ({ filePath }: { filePath: string | null }) => useColorExtraction(filePath),
      { initialProps },
    );

    await waitFor(() => expect(getCoverArtPaletteMock).toHaveBeenCalledWith('/music/old.mp3'));
    rerender({ filePath: null });

    await act(async () => {
      resolvePalette({ primary: '#ff0000', secondary: '#0000ff' });
      await pending;
    });

    expect(result.current.primary).toBe('#38bdf8');
    expect(result.current.secondary).toBe('#f472b6');
    expect(result.current.background).toBe('#0a0a0a');
  });
});
