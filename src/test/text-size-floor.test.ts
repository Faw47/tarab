import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// docs/design/design_language.md: supporting text uses 12 px as the minimum size (FE-30).
const SRC = join(__dirname, '..');

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return ext.test(name) ? [path] : [];
  });
}

describe('12 px text floor (FE-30)', () => {
  it('has no Tailwind text size below 12 px in components', () => {
    const offenders = files(SRC, /\.tsx$/).flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/text-\[(\d*\.?\d+)(px|r?em)\]/g)]
        .filter((match) => Number(match[1]) * (match[2] === 'px' ? 1 : 16) < 12)
        .map((match) => `${path}: ${match[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  it('has no font size below 12 px in any stylesheet', () => {
    const offenders = files(SRC, /\.css$/).flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/font-size:\s*(\d*\.?\d+)(px|r?em)\b/g)]
        .filter((match) => Number(match[1]) * (match[2] === 'px' ? 1 : 16) < 12)
        .map((match) => `${path}: ${match[0]}`),
    );
    expect(offenders).toEqual([]);
  });
});
