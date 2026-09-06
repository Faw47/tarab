import { readFile } from 'node:fs/promises';
import { checkReleaseWorkflowSecurity } from './release-workflow-policy.mjs';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tauriConfig = JSON.parse(
  await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
);
const mediaFormats = JSON.parse(
  await readFile(new URL('../media-formats.json', import.meta.url), 'utf8'),
);
const openerCapability = JSON.parse(
  await readFile(new URL('../src-tauri/capabilities/opener.json', import.meta.url), 'utf8'),
);
const autostartCapability = JSON.parse(
  await readFile(new URL('../src-tauri/capabilities/autostart.json', import.meta.url), 'utf8'),
);
const cargoManifest = await readFile(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const releaseWorkflow = (
  await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
).replaceAll('\r\n', '\n');
const ciWorkflow = (
  await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
).replaceAll('\r\n', '\n');
const windowsSigningScript = await readFile(
  new URL('./prepare-windows-signing.ps1', import.meta.url),
  'utf8',
);
const pnpmWorkspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
const pnpmLock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');

const failures = [];
const expectedVersion = packageJson.version;
const configuredWindows = tauriConfig.app?.windows ?? [];
const mainWindow = configuredWindows.find((window) => window.label === 'main');
const miniWindow = configuredWindows.find((window) => window.label === 'mini-player');
const cargoVersion = cargoManifest.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
const deepLinkSchemes = tauriConfig.plugins?.['deep-link']?.desktop?.schemes;
const fileAssociationExtensions = new Set(
  (tauriConfig.bundle?.fileAssociations ?? []).flatMap((association) => association.ext ?? []),
);
const requiredAudioExtensions = mediaFormats.audioExtensions;
const reviewedLifecycleBuilds = ['esbuild@0.27.3', '@swc/core@1.15.18'];
const expectedInstallCommand = 'run: pnpm install --frozen-lockfile --ignore-scripts';
const expectedRebuildCommand = `run: pnpm rebuild ${reviewedLifecycleBuilds.join(' ')}`;
const reviewedTauriCliVersion = '2.11.4';

if (mainWindow?.visible !== false || miniWindow?.visible !== false) {
  failures.push('Main and mini windows must start hidden; native setup owns initial visibility.');
}
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

if (
  !Array.isArray(requiredAudioExtensions) ||
  requiredAudioExtensions.length === 0 ||
  new Set(requiredAudioExtensions).size !== requiredAudioExtensions.length ||
  requiredAudioExtensions.some((extension) => !/^[a-z0-9]+$/.test(extension))
) {
  failures.push('media-formats.json must contain unique lowercase ASCII audio extensions.');
} else {
  for (const extension of requiredAudioExtensions) {
    if (!fileAssociationExtensions.has(extension)) {
      failures.push(`Missing required audio file association: ${extension}`);
    }
  }
  for (const extension of fileAssociationExtensions) {
    if (!requiredAudioExtensions.includes(extension)) {
      failures.push(`Unsupported audio file association is advertised: ${extension}`);
    }
  }
}

const openerPermissionIds = (openerCapability.permissions ?? []).map((permission) =>
  typeof permission === 'string' ? permission : permission.identifier,
);
const openerUrlPermission = (openerCapability.permissions ?? []).find(
  (permission) =>
    typeof permission !== 'string' && permission.identifier === 'opener:allow-open-url',
);
if (
  openerPermissionIds.length !== 1 ||
  openerPermissionIds[0] !== 'opener:allow-open-url' ||
  JSON.stringify(openerUrlPermission?.allow) !==
    JSON.stringify([{ url: 'https://github.com/Faw47/tarab#readme' }])
) {
  failures.push('Renderer opener capability must allow only the exact Tarab Help URL.');
}

const autostartPermissionIds = (autostartCapability.permissions ?? []).map((permission) =>
  typeof permission === 'string' ? permission : permission.identifier,
);
const requiredAutostartPermissions = [
  'autostart:allow-is-enabled',
  'autostart:allow-enable',
  'autostart:allow-disable',
];
if (
  autostartCapability.identifier !== 'autostart' ||
  JSON.stringify(autostartCapability.windows) !== JSON.stringify(['main']) ||
  autostartPermissionIds.length !== requiredAutostartPermissions.length ||
  requiredAutostartPermissions.some((permission) => !autostartPermissionIds.includes(permission))
) {
  failures.push(
    'Autostart capability must target only the main window and allow is-enabled, enable, and disable.',
  );
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

if (packageJson.devDependencies?.['@tauri-apps/cli'] !== reviewedTauriCliVersion) {
  failures.push(
    `The Tauri CLI must be pinned to ${reviewedTauriCliVersion} to match the reviewed Rust Tauri 2.11 toolchain.`,
  );
}

if (packageJson.packageManager !== 'pnpm@9.15.2') {
  failures.push('The reviewed lifecycle policy requires packageManager pnpm@9.15.2.');
}

if (/^\s*(?:allowBuilds|onlyBuiltDependencies|neverBuiltDependencies):/m.test(pnpmWorkspace)) {
  failures.push(
    'pnpm 9 lifecycle policy must not be declared in pnpm-workspace.yaml, where it is ignored.',
  );
}

for (const dependency of reviewedLifecycleBuilds) {
  const lockfileEntry = dependency.startsWith('@') ? `  '${dependency}':` : `  ${dependency}:`;
  if (!pnpmLock.includes(lockfileEntry)) {
    failures.push(`Reviewed lifecycle dependency is not pinned in pnpm-lock.yaml: ${dependency}`);
  }
}

const checkLifecycleCommands = (workflow, workflowName, requireInstall = true) => {
  const installCommands = workflow
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('run: pnpm install'));
  const rebuildCommands = workflow
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('run: pnpm rebuild'));
  if (
    (requireInstall && installCommands.length === 0) ||
    installCommands.some((line) => line !== expectedInstallCommand)
  ) {
    failures.push(`Every ${workflowName} dependency install must disable all lifecycle scripts.`);
  }
  if (
    rebuildCommands.length !== installCommands.length ||
    rebuildCommands.some((line) => line !== expectedRebuildCommand)
  ) {
    failures.push(
      `Each ${workflowName} install must rebuild only the exact reviewed esbuild and @swc/core versions.`,
    );
  }
};

checkLifecycleCommands(releaseWorkflow, 'release');
checkLifecycleCommands(ciWorkflow, 'CI');

const expectedCargoAuditCommand = 'run: cargo install cargo-audit --version 0.22.1 --locked';
for (const [workflowName, workflow] of [
  ['release', releaseWorkflow],
  ['CI', ciWorkflow],
]) {
  const auditCommands = workflow
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('run: cargo install cargo-audit'));
  if (auditCommands.length !== 1 || auditCommands[0] !== expectedCargoAuditCommand) {
    failures.push(`${workflowName} must install cargo-audit 0.22.1 with --locked.`);
  }
}

failures.push(...checkReleaseWorkflowSecurity(releaseWorkflow, windowsSigningScript));

const getRemoteActionReferences = (workflow) =>
  [...workflow.matchAll(/^\s*-?\s*uses:\s*([^#\s]+)/gm)].map((match) => match[1]);
const releaseActionReferences = getRemoteActionReferences(releaseWorkflow);
const ciActionReferences = getRemoteActionReferences(ciWorkflow);
for (const [workflowName, actionReferences] of [
  ['Release', releaseActionReferences],
  ['CI', ciActionReferences],
]) {
  for (const actionReference of actionReferences) {
    if (actionReference.startsWith('./')) {
      continue;
    }

    const separator = actionReference.lastIndexOf('@');
    const revision = separator >= 0 ? actionReference.slice(separator + 1) : '';
    if (!/^[0-9a-f]{40}$/.test(revision)) {
      failures.push(
        `${workflowName} workflow action must use an immutable 40-character commit: ${actionReference}`,
      );
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Release configuration error: ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Release configuration verified for Tarab ${expectedVersion}: scoped signing credentials, pinned lifecycle builds, deep links, ${requiredAudioExtensions.length} file associations, CSP, updater policy, and ${releaseActionReferences.length + ciActionReferences.length} immutable release/CI action references.`,
);
