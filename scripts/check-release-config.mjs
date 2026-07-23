import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tauriConfig = JSON.parse(
  await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
);
const cargoManifest = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
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
const requiredAudioExtensions = ['mp3', 'flac', 'aiff', 'wav', 'ogg', 'm4a', 'aac', 'alac', 'wma'];

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

if (tauriConfig.bundle?.createUpdaterArtifacts !== false) {
  failures.push(
    'Updater artifacts must remain disabled until an updater release channel is configured.',
  );
}

if (
  tauriConfig.app?.security?.csp?.includes('http:') ||
  tauriConfig.app?.security?.csp?.includes('https:')
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

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Release configuration error: ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Release configuration verified for Tarab ${expectedVersion}: deep links, ${requiredAudioExtensions.length} file associations, CSP, updater policy, and ${remoteActionReferences.length} immutable action references.`,
);
