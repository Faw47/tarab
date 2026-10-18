import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('reduced motion in index.css (FE-30)', () => {
  it('runs the tarab-fade-up animation only under prefers-reduced-motion: no-preference', () => {
    // An unlayered rule after the reduced-motion block wins by source order, so the animation
    // itself must sit behind the media query rather than rely on a later override.
    const css = readFileSync(join(__dirname, '../index.css'), 'utf8');
    const uses = [...css.matchAll(/animation:\s*tarab-fade-up\b/g)];
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      const before = css.slice(0, use.index);
      const lastMedia = before.lastIndexOf('@media');
      expect(before.slice(lastMedia)).toMatch(/^@media \(prefers-reduced-motion: no-preference\)/);
      // No closing brace at column 0 between the media query and the rule.
      expect(before.slice(lastMedia)).not.toMatch(/\n\}/);
    }
  });
});
