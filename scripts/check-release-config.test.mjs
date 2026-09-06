import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkReleaseWorkflowSecurity } from './release-workflow-policy.mjs';

const releaseWorkflow = (
  await readFile(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8')
).replaceAll('\r\n', '\n');
const ciWorkflow = (
  await readFile(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
).replaceAll('\r\n', '\n');
const windowsSigningScript = (
  await readFile(resolve(process.cwd(), 'scripts/prepare-windows-signing.ps1'), 'utf8')
).replaceAll('\r\n', '\n');
const autostartCapability = JSON.parse(
  await readFile(resolve(process.cwd(), 'src-tauri/capabilities/autostart.json'), 'utf8'),
);
const matrixRunnerExpression = '$' + '{{ matrix.runner }}';
const windowsCertificateExpression = '$' + '{{ secrets.WINDOWS_CERTIFICATE }}';
const appleIdExpression = '$' + '{{ secrets.APPLE_ID }}';
const alwaysExpression = '$' + '{{ always() }}';
const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));

describe('release workflow signing policy', () => {
  it('accepts the reviewed Apple and Windows secret lifecycle', () => {
    expect(checkReleaseWorkflowSecurity(releaseWorkflow, windowsSigningScript)).toEqual([]);
  });

  it('rejects a Windows signing config path mismatch', () => {
    const unsafeWorkflow = releaseWorkflow.replace(
      'src-tauri/tauri.windows-signing.json',
      'src-tauri/tauri-missing-signing.json',
    );

    expect(checkReleaseWorkflowSecurity(unsafeWorkflow, windowsSigningScript)).toContain(
      'The Windows signing helper and workflow must use the generated src-tauri/tauri.windows-signing.json path.',
    );
  });

  it('rejects broad macOS keychain access', () => {
    const unsafeWorkflow = releaseWorkflow.replace('-T /usr/bin/codesign', '-A');

    expect(checkReleaseWorkflowSecurity(unsafeWorkflow, windowsSigningScript)).toContain(
      'The macOS certificate import must grant key access only to /usr/bin/codesign.',
    );
  });

  it('rejects an unlocked release packaging command', () => {
    const unsafeWorkflow = releaseWorkflow.replace(' -- --locked', '');

    expect(checkReleaseWorkflowSecurity(unsafeWorkflow, windowsSigningScript)).toContain(
      'Every release Tauri packaging command must forward --locked to Cargo.',
    );
  });

  it('rejects missing Windows timestamp URL validation', () => {
    const unsafeScript = windowsSigningScript.replace(
      '  $timestampUri.Scheme -ine "https" -or',
      '  $timestampUri.Scheme -ine "http" -or',
    );

    expect(checkReleaseWorkflowSecurity(releaseWorkflow, unsafeScript)).toContain(
      'The Windows signing helper must require an absolute HTTPS timestamp URL without embedded credentials.',
    );
  });

  it('rejects GNU-only macOS utility flags', () => {
    const unsafeWorkflow = releaseWorkflow
      .replace('base64 -D', 'base64 --decode')
      .replace(
        "find src-tauri/target/universal-apple-darwin/release/bundle/dmg -type f -name '*.dmg' -print -quit",
        "find src-tauri/target/universal-apple-darwin/release/bundle/dmg -maxdepth 1 -name '*.dmg' -print -quit",
      );

    expect(checkReleaseWorkflowSecurity(unsafeWorkflow, windowsSigningScript)).toContain(
      'The macOS release job must use BSD-compatible base64 and find commands.',
    );
  });
  it('rejects Apple credentials inherited by dependency and test steps', () => {
    const leakedWorkflow = releaseWorkflow.replace(
      '    runs-on: macos-15\n    steps:',
      [
        '    runs-on: macos-15',
        '    env:',
        `      APPLE_ID: ${appleIdExpression}`,
        '    steps:',
      ].join('\n'),
    );

    expect(checkReleaseWorkflowSecurity(leakedWorkflow, windowsSigningScript)).toContain(
      'Apple credentials must be scoped only to their required signing steps.',
    );
  });

  it('rejects Windows credentials inherited by dependency and test steps', () => {
    const leakedWorkflow = releaseWorkflow.replace(
      `    runs-on: ${matrixRunnerExpression}\n    steps:`,
      [
        `    runs-on: ${matrixRunnerExpression}`,
        '    env:',
        `      WINDOWS_CERTIFICATE: ${windowsCertificateExpression}`,
        '    steps:',
      ].join('\n'),
    );

    expect(checkReleaseWorkflowSecurity(leakedWorkflow, windowsSigningScript)).toContain(
      'Windows credentials must be scoped only to their required signing steps.',
    );
  });

  it('rejects conditional Windows cleanup', () => {
    const conditionalCleanup = releaseWorkflow.replace(
      `      - name: Remove Windows signing certificate\n        if: ${alwaysExpression}`,
      '      - name: Remove Windows signing certificate\n        if: success()',
    );

    expect(checkReleaseWorkflowSecurity(conditionalCleanup, windowsSigningScript)).toContain(
      'The Windows signing certificate must have an unconditional cleanup step.',
    );
  });

  it('rejects a helper that can retain the temporary PFX after failure', () => {
    const unsafeScript = windowsSigningScript.replace(
      '    Remove-Item -LiteralPath $certificatePath -Force\n  }\n  if ($null -ne $certificateBytes)',
      '    Write-Error "PFX cleanup removed"\n  }\n  if ($null -ne $certificateBytes)',
    );

    expect(checkReleaseWorkflowSecurity(releaseWorkflow, unsafeScript)).toContain(
      'The Windows signing helper must remove the temporary PFX in a finally block.',
    );
  });

  it('rejects a helper that does not remove its imported certificate', () => {
    const unsafeScript = windowsSigningScript.replace(
      '          Remove-Item -LiteralPath $storePath -Force',
      '          Write-Error "Certificate cleanup removed"',
    );

    expect(checkReleaseWorkflowSecurity(releaseWorkflow, unsafeScript)).toContain(
      'The Windows signing helper cleanup must remove imported certificates, the PFX, manifest, and generated config.',
    );
  });
});

describe('desktop capability policy', () => {
  it('keeps open-at-login commands on the main window with no missing permissions', () => {
    expect(autostartCapability.identifier).toBe('autostart');
    expect(autostartCapability.windows).toEqual(['main']);
    expect(autostartCapability.permissions).toEqual([
      'autostart:allow-is-enabled',
      'autostart:allow-enable',
      'autostart:allow-disable',
    ]);
  });
});

describe('workflow supply-chain policy', () => {
  it('pins the Tauri CLI to the reviewed Rust toolchain', () => {
    expect(packageJson.devDependencies['@tauri-apps/cli']).toBe('2.11.4');
  });
  it('pins every remote CI and release action to a commit', () => {
    for (const workflow of [releaseWorkflow, ciWorkflow]) {
      const references = [...workflow.matchAll(/^\s*-?\s*uses:\s*([^#\s]+)/gm)].map(
        (match) => match[1],
      );
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) {
        if (reference.startsWith('./')) continue;
        expect(reference.slice(reference.lastIndexOf('@') + 1)).toMatch(/^[0-9a-f]{40}$/);
      }
    }
  });

  it('uses the reviewed lifecycle policy in CI', () => {
    const installCommands = ciWorkflow
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('run: pnpm install'));
    const rebuildCommands = ciWorkflow
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('run: pnpm rebuild'));

    expect(installCommands).toEqual(['run: pnpm install --frozen-lockfile --ignore-scripts']);
    expect(rebuildCommands).toEqual(['run: pnpm rebuild esbuild@0.27.3 @swc/core@1.15.18']);
  });

  it('runs CI on the repository branch conventions', () => {
    expect(ciWorkflow).toContain("      - 'agent/**'");
    expect(ciWorkflow).toContain("      - 'codex/**'");
  });

  it('pins cargo-audit in CI and release workflows', () => {
    for (const workflow of [releaseWorkflow, ciWorkflow]) {
      const auditCommands = workflow
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('run: cargo install cargo-audit'));
      expect(auditCommands).toEqual(['run: cargo install cargo-audit --version 0.22.1 --locked']);
    }
  });
});
