import { readdir, readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tauriConfig = JSON.parse(
  await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
);
const openerCapability = JSON.parse(
  await readFile(new URL('../src-tauri/capabilities/opener.json', import.meta.url), 'utf8'),
);
const cargoManifest = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const librarySource = await readFile(new URL('../src-tauri/src/library.rs', import.meta.url), 'utf8');
const droppedImportSource = await readFile(
  new URL('../src/features/library/useDroppedAudioImport.ts', import.meta.url),
  'utf8',
);
const releaseWorkflow = await readFile(
  new URL('../.github/workflows/release.yml', import.meta.url),
  'utf8',
);

const failures = [];
const expectedVersion = packageJson.version;
const cargoVersion = cargoManifest.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
const deepLinkSchemes = tauriConfig.plugins?.['deep-link']?.desktop?.schemes;
const fileAssociationExtensions = new Set(
  (tauriConfig.bundle?.fileAssociations ?? []).flatMap((association) => association.ext ?? []),
);
const requiredAudioExtensions = ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'aiff', 'opus'];

if (expectedVersion !== tauriConfig.version || expectedVersion !== cargoVersion) {
  failures.push(
    `Version mismatch: package=${expectedVersion}, Tauri=${tauriConfig.version}, Cargo=${cargoVersion}`,
  );
}

if (
  !Array.isArray(deepLinkSchemes) ||
  deepLinkSchemes.length !== 1 ||
  deepLinkSchemes[0] !== 'tarab'
) {
  failures.push('The desktop deep-link scheme must be exactly ["tarab"].');
}

if (
  !cargoManifest.includes(
    'tauri-plugin-single-instance = { version = "2.4.0", features = ["deep-link"] }',
  )
) {
  failures.push('The single-instance plugin must enable its deep-link feature.');
}

for (const extension of requiredAudioExtensions) {
  if (!fileAssociationExtensions.has(extension)) {
    failures.push(`Missing required audio file association: ${extension}`);
  }
}

const sameExtensionSet = (actual, expected) =>
  actual.length === expected.length && expected.every((extension) => actual.includes(extension));
const rustExtensionsBlock =
  librarySource.split('pub const SUPPORTED_EXTENSIONS:')[1]?.split('];')[0] ?? '';
const rustExtensions = Array.from(
  rustExtensionsBlock.matchAll(/["']([a-z0-9]+)["']/g),
  (match) => match[1],
);
const droppedExtensionsBlock =
  droppedImportSource
    .split('export const SUPPORTED_DROPPED_AUDIO_EXTENSIONS = [')[1]
    ?.split('] as const')[0] ?? '';
const droppedExtensions = Array.from(
  droppedExtensionsBlock.matchAll(/["']([a-z0-9]+)["']/g),
  (match) => match[1],
);
if (!sameExtensionSet([...fileAssociationExtensions], requiredAudioExtensions)) {
  failures.push('Desktop file associations must match the supported audio extension list exactly.');
}
if (!sameExtensionSet(rustExtensions, requiredAudioExtensions)) {
  failures.push('The native library scanner extensions must match the supported audio extension list.');
}
if (!sameExtensionSet(droppedExtensions, requiredAudioExtensions)) {
  failures.push('Dropped-file import extensions must match the supported audio extension list.');
}

const mainWindow = (tauriConfig.app?.windows ?? []).find((window) => window.label === 'main');
if (mainWindow?.visible !== false) {
  failures.push(
    'The main window must start hidden so --minimized launches do not flash a visible window (QA-11).',
  );
}
// A menu button is not functional if the opener capability rejects its exact destination.
const allowedHelpUrl = 'https://github.com/Faw47/tarab#readme';
const openerUrlPermissions = openerCapability.permissions.filter(
  (permission) =>
    typeof permission === 'object' && permission.identifier === 'opener:allow-open-url',
);
if (
  openerCapability.windows?.length !== 1 ||
  openerCapability.windows[0] !== 'main' ||
  openerUrlPermissions.length !== 1 ||
  openerUrlPermissions[0].allow?.length !== 1 ||
  openerUrlPermissions[0].allow[0]?.url !== allowedHelpUrl
) {
  failures.push('The main-window opener must allow exactly the Tarab Help README URL (QA-10).');
}

const capabilityDirectory = new URL('../src-tauri/capabilities/', import.meta.url);
for (const filename of await readdir(capabilityDirectory)) {
  if (!filename.endsWith('.json')) continue;
  const capability = JSON.parse(await readFile(new URL(filename, capabilityDirectory), 'utf8'));
  if (
    capability.permissions.some((permission) => {
      const id = typeof permission === 'string' ? permission : permission.identifier;
      return (
        id === 'opener:allow-reveal-item-in-dir' ||
        id === 'opener:allow-open-path' ||
        id === 'opener:default'
      );
    })
  ) {
    failures.push(
      `File reveal and folder opening must use scoped native commands (SEC-06): ${filename}.`,
    );
  }
}

if (mainWindow?.backgroundThrottling !== 'disabled') {
  failures.push(
    'The main window must set backgroundThrottling to "disabled": it owns queue advance, media-key handling and tray quit while hidden.',
  );
}

if (tauriConfig.bundle?.createUpdaterArtifacts !== false) {
  failures.push(
    'Updater artifacts must remain disabled until an updater release channel is configured.',
  );
}

// WebView2 serves Tauri's custom schemes as http://<scheme>.localhost, so those exact local hosts
// are allowed; any other HTTP or HTTPS source is not.
const localSchemeHosts = new Set(['http://asset.localhost', 'http://cover-art.localhost']);
const cspSources = (tauriConfig.app?.security?.csp ?? '')
  .split(';')
  .flatMap((directive) => directive.trim().split(/\s+/).slice(1));
if (
  cspSources.some(
    (source) => /^https?:/i.test(source) && !localSchemeHosts.has(source.toLowerCase()),
  )
) {
  failures.push('The production CSP must not permit arbitrary HTTP or HTTPS connections.');
}

const remoteActionReferences = [...releaseWorkflow.matchAll(/^\s*-?\s*uses:\s*([^#\s]+)/gm)].map(
  (match) => match[1],
);
for (const actionReference of remoteActionReferences) {
  if (actionReference.startsWith('./')) {
    continue;
  }

  const separator = actionReference.lastIndexOf('@');
  const revision = separator >= 0 ? actionReference.slice(separator + 1) : '';
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    failures.push(
      `Release workflow action must use an immutable 40-character commit: ${actionReference}`,
    );
  }
}

// Release builds must unwind: parse_guard catches parser panics on malformed media files, which
// panic = "abort" would turn into a crash on every scan of that folder.
const releaseProfile =
  cargoManifest.split(/^\[profile\.release\]\s*(?:#.*)?$/m)[1]?.split(/^\[/m)[0] ?? '';
if (/^\s*panic\s*=\s*["']abort["']/m.test(releaseProfile)) {
  failures.push(
    'The release profile must not set panic = "abort" (see src-tauri/src/parse_guard.rs).',
  );
}

// Signing secrets must be scoped to the steps that use them. A job-level (or workflow-level) env
// exposes them to dependency install and build scripts in every later step.
let envIndent = null;
const secretReference = /\$\{\{\s*secrets\./;
for (const line of releaseWorkflow.split('\n')) {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) continue;
  const indent = line.length - line.trimStart().length;
  if (envIndent !== null && indent <= envIndent) envIndent = null;
  if (/^env:\s*\{/.test(trimmed) && indent <= 4 && secretReference.test(line)) {
    failures.push(`Release secrets must be set in step-level env, not job env: ${trimmed}`);
    continue;
  }
  if (/^env:\s*(#.*)?$/.test(trimmed) && indent <= 4) {
    envIndent = indent;
    continue;
  }
  if (envIndent !== null && secretReference.test(line)) {
    failures.push(`Release secrets must be set in step-level env, not job env: ${trimmed}`);
  }
  // A secret written to GITHUB_ENV is visible to every later step.
  if (secretReference.test(line) && /GITHUB_ENV/.test(line)) {
    failures.push(`Release secrets must not be written to GITHUB_ENV: ${trimmed}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Release configuration error: ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Release configuration verified for Tarab ${expectedVersion}: deep links, ${requiredAudioExtensions.length} file associations, CSP, updater policy, and ${remoteActionReferences.length} immutable action references.`,
);
