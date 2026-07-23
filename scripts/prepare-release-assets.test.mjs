import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareReleaseAssets } from './prepare-release-assets.mjs';

const testDirectories = [];

async function createTestDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'tarab-release-assets-'));
  testDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    testDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('prepareReleaseAssets', () => {
  it('stages flat assets and writes verified checksums', async () => {
    const root = await createTestDirectory();
    const source = join(root, 'artifacts');
    const destination = join(root, 'release-assets');
    await mkdir(join(source, 'macos'), { recursive: true });
    await mkdir(join(source, 'windows'), { recursive: true });
    await writeFile(join(source, 'macos', 'Tarab.dmg'), 'mac artifact');
    await writeFile(join(source, 'windows', 'Tarab.exe'), 'windows artifact');

    const result = await prepareReleaseAssets(source, destination);

    expect(result.assetCount).toBe(2);
    expect(await readFile(join(destination, 'Tarab.dmg'), 'utf8')).toBe('mac artifact');
    expect(await readFile(join(destination, 'Tarab.exe'), 'utf8')).toBe('windows artifact');
    const checksums = await readFile(join(destination, 'SHA256SUMS.txt'), 'utf8');
    expect(checksums).toMatch(/^[0-9a-f]{64} {2}Tarab\.dmg$/m);
    expect(checksums).toMatch(/^[0-9a-f]{64} {2}Tarab\.exe$/m);
    expect(checksums).not.toContain('SHA256SUMS.txt');
  });

  it('rejects duplicate flat asset names', async () => {
    const root = await createTestDirectory();
    const source = join(root, 'artifacts');
    await mkdir(join(source, 'x64'), { recursive: true });
    await mkdir(join(source, 'arm64'), { recursive: true });
    await writeFile(join(source, 'x64', 'Tarab.exe'), 'x64');
    await writeFile(join(source, 'arm64', 'Tarab.exe'), 'arm64');

    await expect(prepareReleaseAssets(source, join(root, 'release-assets'))).rejects.toThrowError(
      'Duplicate release asset name: Tarab.exe',
    );
  });

  it('rejects a downloaded checksum file', async () => {
    const root = await createTestDirectory();
    const source = join(root, 'artifacts');
    await mkdir(source);
    await writeFile(join(source, 'SHA256SUMS.txt'), 'untrusted checksum');

    await expect(prepareReleaseAssets(source, join(root, 'release-assets'))).rejects.toThrowError(
      'Downloaded artifacts must not contain SHA256SUMS.txt.',
    );
  });
});
