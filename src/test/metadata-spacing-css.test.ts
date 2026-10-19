import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('mixed-script metadata spacing (FE-22)', () => {
  it('removes neo label tracking regardless of which script starts the value', () => {
    // `Live أهواك` resolves LTR with dir=auto. A :dir(rtl)-only reset leaves its
    // Arabic glyphs tracked. Native shaping needs WebView acceptance; this guard
    // ensures the stylesheet does not condition the reset on the first script.
    const css = readFileSync(join(__dirname, '../styles/neobrutalism.css'), 'utf8');
    expect(css).toMatch(
      /\[data-theme="neobrutalism"\]\s+\[dir="auto"\]\s*\{\s*letter-spacing:\s*normal\s*!important;/,
    );
  });
});
