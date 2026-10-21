import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  [...frontendSource.matchAll(/\binvoke(?:<[^>()]*>)?\(\s*['"]([a-z_][\w]*)['"]/g)].map(
    (match) => match[1],
  ),
);

function frontendSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['__tests__', 'test', 'tests', 'stories'].includes(entry.name)) return [];
      return frontendSources(path);
    }
    if (!/\\.(?:ts|tsx|js|jsx)$/.test(entry.name)) return [];
    if (/\\.(?:test|stories)\\.(?:ts|tsx|js|jsx)$/.test(entry.name)) return [];
    if (path.replace(/\\\\/g, '/') === 'src/lib/tauri-commands.ts') return [];
    return [readFileSync(path, 'utf8')];
  });
}

const frontendUsageSource = frontendSources('src').join('\\n');
const frontendWrapperNames = [...frontendSource.matchAll(
  /export\\s+const\\s+([A-Za-z_$][\\w$]*)\\s*=/g,
)]
  .filter((match) => {
    const start = match.index ?? 0;
    const remainder = frontendSource.slice(start + match[0].length);
    const nextExport = remainder.search(/\\nexport\\s/);
    const body = nextExport < 0 ? remainder : remainder.slice(0, nextExport);
    return /\\binvoke(?:<[^>()]*>)?\\(/.test(body);
  })
  .map((match) => match[1]);
const unusedFrontendWrappers = frontendWrapperNames
  .filter((name) => !new RegExp(`\\\\b${name}\\\\b`).test(frontendUsageSource))
  .sort();

if (unusedFrontendWrappers.length) {
  throw new Error(`Unused Tauri IPC wrappers: ${unusedFrontendWrappers.join(', ')}`);
}

const backendOnlyCommands = new Set([
  'clear_progress',
  'get_cover_art_with_blurhash',
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

// Argument names. Tauri matches invoke arguments by name, converting each Rust parameter to
// camelCase; a renamed or missing key fails only at run time. Parameters Tauri injects (state,
// app handle, window) are not sent by the renderer, and Option parameters may be omitted.
const INJECTED_TYPE = /\b(State|AppHandle|Window|WebviewWindow|Webview)\b/;
const camelCase = (name) => name.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());

function rustSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return rustSources(path);
    return entry.name.endsWith('.rs') ? [readFileSync(path, 'utf8')] : [];
  });
}

/** Text between the parenthesis at `open` and its match. */
function balanced(text, open, left = '(', right = ')') {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === left) depth += 1;
    else if (text[index] === right) {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, index);
    }
  }
  return null;
}

/** Splits on commas that are not inside <>, (), [] or {}. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if ('<([{'.includes(char)) depth += 1;
    if ('>)]}'.includes(char)) depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

const backendArguments = new Map();
for (const source of rustSources('src-tauri/src')) {
  for (const match of source.matchAll(
    /#\[tauri::command[^\]]*\][\s\S]*?\bfn\s+([a-z_][\w]*)\s*(<[^>]*>)?\s*\(/g,
  )) {
    const params = balanced(source, match.index + match[0].length - 1);
    if (params === null) continue;
    const args = new Map();
    for (const param of splitTopLevel(params)) {
      const separator = param.indexOf(':');
      if (separator < 0) continue;
      const name = param
        .slice(0, separator)
        .replace(/^mut\s+/, '')
        .trim();
      const type = param.slice(separator + 1).trim();
      if (INJECTED_TYPE.test(type)) continue;
      args.set(camelCase(name.replace(/^_+/, '')), { optional: /^Option\s*</.test(type) });
    }
    backendArguments.set(match[1], args);
  }
}

const argumentProblems = [];
let checkedCalls = 0;
for (const match of frontendSource.matchAll(/\binvoke(?:<[^>()]*>)?\(\s*['"]([a-z_][\w]*)['"]/g)) {
  const command = match[1];
  const expected = backendArguments.get(command);
  if (!expected) continue;
  const callArgs = balanced(frontendSource, match.index + match[0].indexOf('('));
  const rest = callArgs
    ?.slice(callArgs.indexOf(command) + command.length + 1)
    .replace(/^\s*,?\s*/, '');
  let sent = new Set();
  if (rest?.startsWith('{')) {
    const body = balanced(rest, 0, '{', '}') ?? '';
    sent = new Set(
      splitTopLevel(body).map((entry) =>
        entry
          .replace(/^\.\.\./, '')
          .split(':')[0]
          .trim(),
      ),
    );
  } else if (rest) {
    // A non-literal argument object cannot be checked here.
    continue;
  }
  checkedCalls += 1;
  const missing = [...expected].filter(([name, { optional }]) => !optional && !sent.has(name));
  const unknown = [...sent].filter((name) => !expected.has(name));
  if (missing.length || unknown.length) {
    argumentProblems.push(
      `${command}: ${[
        missing.length ? `missing ${missing.map(([name]) => name).join(', ')}` : '',
        unknown.length ? `unknown ${unknown.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; ')}`,
    );
  }
}

if (argumentProblems.length) {
  throw new Error(`Tauri IPC argument drift detected (${argumentProblems.join('; ')})`);
}

console.log(
  `IPC contract verified: ${frontendCommands.size} frontend wrappers map to registered Rust commands; argument names checked for ${checkedCalls} calls.`,
);
