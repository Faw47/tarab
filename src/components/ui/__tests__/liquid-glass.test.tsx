import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GlassCard, GlassSystemProvider } from '../liquid-glass';

describe('Reduced Effects compositing', () => {
  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.reducedEffects;
  });

  it('removes inline backdrop blur from a GlassCard', () => {
    render(<GlassCard data-testid="glass-card" reducedEffects />);

    const card = screen.getByTestId('glass-card');
    expect(card.style.backdropFilter).toBe('none');
    expect(card.style.getPropertyValue('-webkit-backdrop-filter')).toBe('none');
  });

  it('marks the document while app-level Reduced Effects is enabled', () => {
    const { unmount } = render(
      <GlassSystemProvider reducedEffects>
        <div>content</div>
      </GlassSystemProvider>,
    );

    expect(document.documentElement.dataset.reducedEffects).toBe('true');
    unmount();
    expect(document.documentElement.dataset.reducedEffects).toBeUndefined();
  });
});
