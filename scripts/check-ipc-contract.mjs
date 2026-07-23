import { readFileSync } from 'node:fs';

const backendSource = readFileSync('src-tauri/src/lib.rs', 'utf8');
const frontendSource = readFileSync('src/lib/tauri-commands.ts', 'utf8');

const handlerBlock = backendSource.match(
  /let app_command_handler[^=]*=\s*tauri::generate_handler!\[([\s\S]*?)\n\s*\];/,
)?.[1];

if (!handlerBlock) {
  throw new Error('Could not locate the custom Tauri command handler');
}

const backendCommands = new Set(
  [...handlerBlock.matchAll(/^\s*(?:[a-z_][\w]*::)?([a-z_][\w]*)\s*,\s*$/gim)].map(
    (match) => match[1],
  ),
);
const frontendCommands = new Set(
  [...frontendSource.matchAll(/\binvoke\(\s*['"]([a-z_][\w]*)['"]/g)].map((match) => match[1]),
);

const backendOnlyCommands = new Set([
  'clear_progress',
  'get_cover_art_with_blurhash',
  'update_media_metadata',
  'update_progress',
]);

const missingFrontendWrappers = [...backendCommands]
  .filter((command) => !frontendCommands.has(command) && !backendOnlyCommands.has(command))
  .sort();
const missingBackendCommands = [...frontendCommands]
  .filter((command) => !backendCommands.has(command))
  .sort();

if (missingFrontendWrappers.length || missingBackendCommands.length) {
  const problems = [];
  if (missingFrontendWrappers.length) {
    problems.push(`missing frontend wrappers: ${missingFrontendWrappers.join(', ')}`);
  }
  if (missingBackendCommands.length) {
    problems.push(`frontend invokes unregistered commands: ${missingBackendCommands.join(', ')}`);
  }
  throw new Error(`Tauri IPC contract drift detected (${problems.join('; ')})`);
}

console.log(
  `IPC contract verified: ${frontendCommands.size} frontend wrappers map to registered Rust commands.`,
);
