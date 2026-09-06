const ALWAYS_CLEANUP_CONDITION = 'if: $' + '{{ always() }}';
const WINDOWS_SIGNING_CONFIG_PATH = 'src-tauri/tauri.windows-signing.json';

function workflowStep(workflow, name) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf(`      - name: ${name}`);
  if (start < 0) return null;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('      - ')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function workflowJob(workflow, name) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) return null;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}[a-zA-Z0-9_-]+:$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function checkCredentialSteps(workflow, platform, expectedSteps, credentialPattern, failures) {
  const blocks = [];
  for (const [name, expectedSecrets] of expectedSteps) {
    const block = workflowStep(workflow, name);
    if (!block) {
      failures.push(`Missing required ${platform} credential step: ${name}`);
      continue;
    }
    blocks.push(block);

    const scopedSecrets = [...block.matchAll(/secrets\.([A-Z_]+)/g)].map((match) => match[1]);
    for (const secret of expectedSecrets) {
      if (!block.includes(`secrets.${secret}`)) {
        failures.push(`${platform} credential step "${name}" is missing secrets.${secret}.`);
      }
    }
    for (const secret of scopedSecrets) {
      if (!expectedSecrets.includes(secret)) {
        failures.push(
          `${platform} credential step "${name}" receives unnecessary secrets.${secret}.`,
        );
      }
    }
  }

  let workflowOutsideCredentialSteps = workflow;
  for (const block of blocks) {
    workflowOutsideCredentialSteps = workflowOutsideCredentialSteps.replace(block, '');
  }
  if (credentialPattern.test(workflowOutsideCredentialSteps)) {
    failures.push(`${platform} credentials must be scoped only to their required signing steps.`);
  }
}

export function checkReleaseWorkflowSecurity(releaseWorkflow, windowsSigningScript) {
  const workflow = releaseWorkflow.replaceAll('\r\n', '\n');
  const signingScript = windowsSigningScript.replaceAll('\r\n', '\n');
  const failures = [];

  checkCredentialSteps(
    workflow,
    'Apple',
    new Map([
      [
        'Require Apple signing and notarization credentials',
        [
          'APPLE_CERTIFICATE',
          'APPLE_CERTIFICATE_PASSWORD',
          'APPLE_ID',
          'APPLE_PASSWORD',
          'APPLE_TEAM_ID',
          'KEYCHAIN_PASSWORD',
        ],
      ],
      [
        'Import Developer ID certificate',
        ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD', 'KEYCHAIN_PASSWORD'],
      ],
      [
        'Build signed and notarized Universal 2 DMG',
        ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID'],
      ],
    ]),
    /\b(?:APPLE_CERTIFICATE(?:_PASSWORD)?|APPLE_ID|APPLE_PASSWORD|APPLE_TEAM_ID|KEYCHAIN_PASSWORD)\b/,
    failures,
  );

  const macosJob = workflowJob(workflow, 'macos');
  if (!macosJob) {
    failures.push('Missing macOS release job.');
  } else {
    const rustTestIndex = macosJob.indexOf('name: Test Rust backend on macOS');
    const credentialCheckIndex = macosJob.indexOf(
      'name: Require Apple signing and notarization credentials',
    );
    const keychainImportIndex = macosJob.indexOf('name: Import Developer ID certificate');
    const signedBuildIndex = macosJob.indexOf('name: Build signed and notarized Universal 2 DMG');
    const keychainCleanupIndex = macosJob.indexOf('name: Remove release keychain');
    if (
      !(
        rustTestIndex >= 0 &&
        rustTestIndex < credentialCheckIndex &&
        credentialCheckIndex < keychainImportIndex &&
        keychainImportIndex < signedBuildIndex &&
        signedBuildIndex < keychainCleanupIndex
      )
    ) {
      failures.push('The macOS keychain must be created after tests and removed after build.');
    }
    if (
      macosJob.includes('base64 --decode') ||
      !macosJob.includes('base64 -D') ||
      macosJob.includes('-maxdepth 1')
    ) {
      failures.push('The macOS release job must use BSD-compatible base64 and find commands.');
    }
    if (
      macosJob.includes('security import') &&
      (!macosJob.includes('-T /usr/bin/codesign') ||
        /security import[^\n]*\s-A(?:\s|$)/.test(macosJob))
    ) {
      failures.push(
        'The macOS certificate import must grant key access only to /usr/bin/codesign.',
      );
    }
    if (macosJob.includes('GITHUB_ENV')) {
      failures.push('The macOS release job must not persist Apple values through GITHUB_ENV.');
    }
  }

  const keychainCleanupStep = workflowStep(workflow, 'Remove release keychain');
  if (
    !keychainCleanupStep?.includes(ALWAYS_CLEANUP_CONDITION) ||
    !keychainCleanupStep.includes('security delete-keychain')
  ) {
    failures.push('The macOS release keychain must have an unconditional cleanup step.');
  }

  checkCredentialSteps(
    workflow,
    'Windows',
    new Map([
      [
        'Build signed NSIS installer',
        ['WINDOWS_CERTIFICATE', 'WINDOWS_CERTIFICATE_PASSWORD', 'WINDOWS_TIMESTAMP_URL'],
      ],
    ]),
    /\b(?:WINDOWS_CERTIFICATE(?:_PASSWORD)?|WINDOWS_TIMESTAMP_URL)\b/,
    failures,
  );

  const windowsJob = workflowJob(workflow, 'windows');
  if (!windowsJob) {
    failures.push('Missing Windows release job.');
  } else {
    const rustTestIndex = windowsJob.indexOf('name: Test Rust backend on Windows');
    const signedBuildIndex = windowsJob.indexOf('name: Build signed NSIS installer');
    const certificateCleanupIndex = windowsJob.indexOf('name: Remove Windows signing certificate');
    const signatureCheckIndex = windowsJob.indexOf(
      'name: Verify application architecture and Authenticode signatures',
    );
    if (
      !(
        rustTestIndex >= 0 &&
        rustTestIndex < signedBuildIndex &&
        signedBuildIndex < certificateCleanupIndex &&
        certificateCleanupIndex < signatureCheckIndex
      )
    ) {
      failures.push(
        'The Windows certificate must be imported after tests and removed immediately after build.',
      );
    }
    if (windowsJob.includes('GITHUB_ENV')) {
      failures.push('The Windows release job must not persist signing values through GITHUB_ENV.');
    }
  }

  const windowsBuildStep = workflowStep(workflow, 'Build signed NSIS installer');
  const prepareIndex = windowsBuildStep?.indexOf('./scripts/prepare-windows-signing.ps1') ?? -1;
  const clearIndex =
    windowsBuildStep?.indexOf(
      'Remove-Item Env:WINDOWS_CERTIFICATE, Env:WINDOWS_CERTIFICATE_PASSWORD, Env:WINDOWS_TIMESTAMP_URL',
    ) ?? -1;
  const tauriBuildIndex = windowsBuildStep?.indexOf('pnpm tauri build') ?? -1;
  if (!(prepareIndex >= 0 && prepareIndex < clearIndex && clearIndex < tauriBuildIndex)) {
    failures.push(
      'The signed Windows build step must import the temporary certificate and clear raw secrets before invoking Tauri.',
    );
  }

  const workflowConfigPath = windowsBuildStep?.match(/--config\s+([^\s]+)/)?.[1];
  const scriptConfigPath = signingScript.match(
    /\$configurationPath\s*=\s*Join-Path\s+\$PSScriptRoot\s+"([^"]+)"/,
  )?.[1];
  if (
    workflowConfigPath !== WINDOWS_SIGNING_CONFIG_PATH ||
    scriptConfigPath !== '../src-tauri/tauri.windows-signing.json'
  ) {
    failures.push(
      'The Windows signing helper and workflow must use the generated src-tauri/tauri.windows-signing.json path.',
    );
  }

  const tauriBuildCommands = workflow
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) => line.startsWith('run: pnpm tauri build') || line.startsWith('pnpm tauri build'),
    );
  if (
    tauriBuildCommands.length === 0 ||
    tauriBuildCommands.some((line) => !line.includes('-- --locked'))
  ) {
    failures.push('Every release Tauri packaging command must forward --locked to Cargo.');
  }

  const windowsCleanupStep = workflowStep(workflow, 'Remove Windows signing certificate');
  if (
    !windowsCleanupStep?.includes(ALWAYS_CLEANUP_CONDITION) ||
    !windowsCleanupStep.includes('prepare-windows-signing.ps1 -Cleanup')
  ) {
    failures.push('The Windows signing certificate must have an unconditional cleanup step.');
  }

  if (
    !signingScript.includes('[switch]$Cleanup') ||
    !signingScript.includes('$env:RUNNER_TEMP') ||
    !signingScript.includes('[IO.Path]::GetFullPath($WorkDirectory)') ||
    !signingScript.includes('$WorkDirectory.StartsWith($runnerTempPrefix') ||
    !signingScript.includes('Import-PfxCertificate') ||
    !signingScript.includes('Cert:\\CurrentUser\\My')
  ) {
    failures.push(
      'The Windows signing helper must use a temporary CurrentUser certificate import.',
    );
  }
  if (
    !signingScript.includes('[UriKind]::Absolute') ||
    !signingScript.includes('$timestampUri.Scheme -ine "https"') ||
    !signingScript.includes('$timestampUri.UserInfo')
  ) {
    failures.push(
      'The Windows signing helper must require an absolute HTTPS timestamp URL without embedded credentials.',
    );
  }
  if (!/finally\s*\{[\s\S]*Remove-Item -LiteralPath \$certificatePath -Force/.test(signingScript)) {
    failures.push('The Windows signing helper must remove the temporary PFX in a finally block.');
  }
  if (
    !signingScript.includes('Remove-Item -LiteralPath $storePath -Force') ||
    !signingScript.includes(
      '$cleanupPaths = @($certificatePath, $manifestTempPath, $configurationPath)',
    ) ||
    !signingScript.includes('$cleanupPaths += $manifestPath')
  ) {
    failures.push(
      'The Windows signing helper cleanup must remove imported certificates, the PFX, manifest, and generated config.',
    );
  }

  return failures;
}
