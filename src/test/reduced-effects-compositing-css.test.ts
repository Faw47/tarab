import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, '../index.css'), 'utf8');

describe('liquid glass compositing policy', () => {
  it('disables utility and inline backdrop filters in Reduced Effects mode', () => {
    expect(css).toContain(':root[data-reduced-effects="true"]');
    expect(css).toContain('[class*="backdrop-blur-"]');
    expect(css).toContain('[style*="backdrop-filter"]');
    expect(css).toContain('backdrop-filter: none !important;');
  });

  it('removes descendant blur when a surface already has backdrop filtering', () => {
    expect(css).toMatch(
      /:where\\(\\[\\s\\S]*?backdrop-blur-[\\s\\S]*?\\)\\s*:where\\(\\[\\s\\S]*?backdrop-blur-[\\s\\S]*?\\)\\s*\\{[\\s\\S]*?backdrop-filter:\\s*none\\s*!important;/,
    );
  });

  it('stops the full-viewport grain layer in Reduced Effects mode', () => {
    expect(css).toMatch(/:root\\[data-reduced-effects=/);
    expect(css).toMatch(/\\.app-shell-grain::after\\s*\\{[^}]*opacity:\\s*0[^}]*animation:\\s*none/);
  });
});
