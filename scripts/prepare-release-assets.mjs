import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, opendir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function listFiles(rootDirectory) {
  const files = [];
  const directories = [rootDirectory];

  while (directories.length > 0) {
    const directory = directories.pop();
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      } else {
        throw new Error(`Release artifacts must be regular files: ${entryPath}`);
      }
    }
  }

  return files.sort();
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function prepareReleaseAssets(sourceDirectory, destinationDirectory) {
  const source = resolve(sourceDirectory);
  const destination = resolve(destinationDirectory);
  const sourceFiles = await listFiles(source);
  if (sourceFiles.length === 0) {
    throw new Error(`No release artifacts were found in ${source}`);
  }

  const names = new Set();
  for (const sourceFile of sourceFiles) {
    const name = basename(sourceFile);
    if (name === 'SHA256SUMS.txt') {
      throw new Error('Downloaded artifacts must not contain SHA256SUMS.txt.');
    }
    if (names.has(name)) {
      throw new Error(`Duplicate release asset name: ${name}`);
    }
    names.add(name);
  }

  await mkdir(destination);
  const checksumLines = [];
  for (const sourceFile of sourceFiles) {
    const name = basename(sourceFile);
    const destinationFile = join(destination, name);
    await copyFile(sourceFile, destinationFile);
    checksumLines.push(`${await sha256(destinationFile)}  ${name}`);
  }

  const checksumPath = join(destination, 'SHA256SUMS.txt');
  await writeFile(checksumPath, `${checksumLines.join('\n')}\n`, 'utf8');

  const writtenChecksums = await readFile(checksumPath, 'utf8');
  if (writtenChecksums !== `${checksumLines.join('\n')}\n`) {
    throw new Error('The written checksum file does not match the computed checksums.');
  }
  for (const checksumLine of checksumLines) {
    const expectedDigest = checksumLine.slice(0, 64);
    const name = checksumLine.slice(66);
    const actualDigest = await sha256(join(destination, name));
    if (actualDigest !== expectedDigest) {
      throw new Error(`Checksum verification failed for ${name}`);
    }
  }

  return {
    assetCount: sourceFiles.length,
    checksumPath,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) {
    throw new Error(
      'Usage: node scripts/prepare-release-assets.mjs <artifact-directory> <release-directory>',
    );
  }

  const result = await prepareReleaseAssets(process.argv[2], process.argv[3]);
  console.log(`Prepared ${result.assetCount} release assets and verified ${result.checksumPath}.`);
}
