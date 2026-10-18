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
      [...readFileSync(path, 'utf8').matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)]
        .filter((match) => Number(match[1]) < 12)
        .map((match) => `${path}: ${match[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  it('has no rem font size below 0.75rem in the library stylesheet', () => {
    const css = readFileSync(join(SRC, 'components/library/library-view.css'), 'utf8');
    const small = [...css.matchAll(/font-size:\s*(\d*\.\d+)rem/g)].filter(
      (match) => Number(match[1]) < 0.75,
    );
    expect(small.map((match) => match[0])).toEqual([]);
  });
});
