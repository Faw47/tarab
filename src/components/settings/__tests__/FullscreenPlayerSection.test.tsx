import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FullscreenPlayerSection } from '../sections/FullscreenPlayerSection';

const { settings } = vi.hoisted(() => ({
  settings: {
    theme: 'liquid-glass',
    fullscreenHideCoverArt: false,
    fullscreenLyricSize: 50,
    setFullscreenHideCoverArt: vi.fn(),
    setFullscreenLyricSize: vi.fn(),
    fullscreenLyricAlignment: 'center',
    setFullscreenLyricAlignment: vi.fn(),
    fullscreenBackgroundAnimation: 'pan',
    setFullscreenBackgroundAnimation: vi.fn(),
    fullscreenBackgroundBlur: 20,
    setFullscreenBackgroundBlur: vi.fn(),
  },
}));

vi.mock('../../../store/settings-store', () => ({
  useSettingsStore: (selector: (state: typeof settings) => unknown) => selector(settings),
}));

describe('FullscreenPlayerSection lyric size scale (FE-39)', () => {
  it('labels the 1–100 control as a relative scale instead of pixels', () => {
    render(<FullscreenPlayerSection />);

    const slider = screen.getByRole('slider', { name: 'Fullscreen lyric size' });
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '100');
    expect(screen.getByText('50 / 100')).toBeInTheDocument();
    expect(screen.getByText('Choose a relative size from 1 to 100.')).toBeInTheDocument();
    expect(screen.queryByText('50px')).not.toBeInTheDocument();
  });
});
