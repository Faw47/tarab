import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GlassSystemProvider } from '../liquid-glass';

describe('GlassSystemProvider reduced-effects contract', () => {
  afterEach(() => {
    delete document.documentElement.dataset.reducedEffects;
  });

  it('exposes the app-level reduced-effects state on the document root', () => {
    const view = render(
      <GlassSystemProvider reducedEffects theme="neobrutalism">
        <div />
      </GlassSystemProvider>,
    );

    expect(document.documentElement.dataset.reducedEffects).toBe('true');
    view.rerender(
      <GlassSystemProvider reducedEffects={false} theme="neobrutalism">
        <div />
      </GlassSystemProvider>,
    );
    expect(document.documentElement.dataset.reducedEffects).toBeUndefined();
  });

  it('does not add the attribute when reduced effects are not forced', () => {
    render(
      <GlassSystemProvider reducedEffects={false}>
        <div />
      </GlassSystemProvider>,
    );
    expect(document.documentElement.dataset.reducedEffects).toBeUndefined();
  });
});
