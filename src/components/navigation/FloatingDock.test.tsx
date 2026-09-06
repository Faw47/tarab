import { describe, expect, it } from 'vitest';
import { normalizeDockActiveView, shouldEnableDockLiquid } from './FloatingDock';

describe('FloatingDock navigation state', () => {
  it('maps the search mode to the Library destination for active-state rendering', () => {
    expect(normalizeDockActiveView('search')).toBe('library');
    expect(normalizeDockActiveView('album')).toBe('library');
    expect(normalizeDockActiveView('queue')).toBe('queue');
  });

  it('disables liquid dock effects for neobrutalism and reduced-effects mode', () => {
    expect(shouldEnableDockLiquid('liquid-glass', false)).toBe(true);
    expect(shouldEnableDockLiquid('liquid-glass', true)).toBe(false);
    expect(shouldEnableDockLiquid('neobrutalism', false)).toBe(false);
  });
});
