import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8').trim();
const pkg = JSON.parse(read('package.json'));
const expectedNode = read('.nvmrc').replace(/^v/, '');
const minNodeMajor = Number(/^>=([0-9]+)/.exec(pkg.engines?.node ?? '')?.[1] ?? 0);
const expectedPnpm = String(pkg.packageManager ?? '').split('@')[1];
const actualNode = process.versions.node;

function readPnpmVersion() {
  const candidates = ['pnpm'];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(join(process.env.LOCALAPPDATA, 'pnpm', 'pnpm.CMD'));
  }

  const errors = [];
  for (const candidate of candidates) {
    try {
      if (process.platform === 'win32' && /\.cmd$/i.test(candidate)) {
        return execSync(`"${candidate}" --version`, { encoding: 'utf8' }).trim();
      }
      return execFileSync(candidate, ['--version'], { encoding: 'utf8' }).trim();
    } catch (error) {
      errors.push(`${candidate}: ${error.code ?? error.message}`);
    }
  }
  return 'unavailable: ' + errors.join('; ');
}

const actualPnpm = readPnpmVersion();
const failures = [];
const warnings = [];

if (actualNode !== expectedNode) {
  const actualNodeMajor = Number(actualNode.split('.')[0]);
  const message = `Node ${actualNode} is active, expected ${expectedNode} from .nvmrc`;
  if (minNodeMajor > 0 && actualNodeMajor >= minNodeMajor) warnings.push(message);
  else failures.push(message);
}

if (expectedPnpm && actualPnpm !== expectedPnpm) {
  const localPnpm = process.platform === 'win32' && process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'pnpm', 'pnpm.CMD')
    : '';
  const message = `pnpm ${actualPnpm} is active, expected ${expectedPnpm} from packageManager`;
  if (actualPnpm.startsWith('unavailable:') && localPnpm && existsSync(localPnpm)) warnings.push(message);
  else failures.push(message);
}

const binSuffix = process.platform === 'win32' ? '.cmd' : '';
for (const bin of ['tsc', 'vitest', 'biome']) {
  if (!existsSync(join(root, 'node_modules', '.bin', `${bin}${binSuffix}`))) {
    failures.push(`Missing local binary: node_modules/.bin/${bin}${binSuffix}`);
  }
}

if (warnings.length > 0) {
  console.warn(warnings.map((warning) => `- ${warning}`).join('\n'));
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log('dev-doctor ok');
