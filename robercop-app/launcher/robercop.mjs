#!/usr/bin/env node
// ROBer COP launcher: checks Node, installs and builds on first run (or after an update), optionally sets up Docling,
// starts the local server and opens the browser. Run with --help for options.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const MIN_NODE = [22, 13];

const HELP = `ROBer COP — local ROBINS-I V2 assessment workspace

Usage: node launcher/robercop.mjs [options]

  --data-dir <folder>   Where projects, PDFs and parsed text are stored (remembered for next time).
                        Default: Documents/ROBerCOP in your home folder.
  --port <number>       Local port (default 4317).
  --no-open             Do not open the browser.
  --rebuild             Rebuild the app before starting.
  --setup-docling       Install the optional Docling PDF parser (Python 3.10–3.13 required) and exit.
  --help                Show this help.
`;

function parseArgs(argv) {
  const opts = { open: true, rebuild: false, setupDocling: false, dataDir: null, port: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (!v) fail(`${a.split('=')[0]} needs a value.`);
      return v;
    };
    if (a === '--help' || a === '-h') {
      console.log(HELP);
      process.exit(0);
    } else if (a === '--no-open') opts.open = false;
    else if (a === '--rebuild') opts.rebuild = true;
    else if (a === '--setup-docling') opts.setupDocling = true;
    else if (a.startsWith('--data-dir')) opts.dataDir = resolve(value());
    else if (a.startsWith('--port')) opts.port = Number(value());
    else fail(`Unknown option ${a}.\n\n${HELP}`);
  }
  return opts;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function step(message) {
  console.log(`• ${message}`);
}

/** Runs a command with inherited output; npm and other .cmd shims need a shell on Windows. */
function run(command, args, options = {}) {
  const res = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: WIN, ...options });
  if (res.error) return { ok: false, error: res.error.message };
  return { ok: res.status === 0, status: res.status };
}

function capture(command, args) {
  const res = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', shell: WIN });
  return res.status === 0 ? (res.stdout || '').trim() : null;
}

// --- launcher settings (remembered data folder) -------------------------------------------------------------------

function settingsPath() {
  const base = WIN ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming') : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'ROBerCOP', 'launcher.json');
}

function readSettings() {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(s) {
  try {
    mkdirSync(dirname(settingsPath()), { recursive: true });
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
  } catch (e) {
    console.warn(`  (could not remember settings: ${e.message})`);
  }
}

// --- checks -------------------------------------------------------------------------------------------------------

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    fail(`ROBer COP needs Node.js ${MIN_NODE.join('.')} or newer (you have ${process.versions.node}).\n  Install the current LTS from https://nodejs.org and start again.`);
  }
}

function newestMtime(dir, skip = new Set(['node_modules', 'dist', '.venv', 'coverage'])) {
  let newest = 0;
  if (!existsSync(dir)) return newest;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
    const p = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p, skip) : statSync(p).mtimeMs);
  }
  return newest;
}

function ensureInstalled() {
  const marker = join(ROOT, 'node_modules', '.package-lock.json');
  const lock = join(ROOT, 'package-lock.json');
  if (existsSync(marker) && statSync(marker).mtimeMs >= statSync(lock).mtimeMs) return;
  step('Installing dependencies (first run or after an update; this takes a minute)…');
  const res = run('npm', ['install', '--no-audit', '--no-fund']);
  if (!res.ok) fail(`npm install failed${res.error ? `: ${res.error}` : ''}. Check your internet connection and try again.`);
}

function ensureBuilt(force) {
  const web = join(ROOT, 'apps', 'web', 'dist', 'index.html');
  const server = join(ROOT, 'apps', 'server', 'dist', 'server.mjs');
  const built = existsSync(web) && existsSync(server) ? Math.min(statSync(web).mtimeMs, statSync(server).mtimeMs) : 0;
  const sources = Math.max(newestMtime(join(ROOT, 'apps')), newestMtime(join(ROOT, 'packages')));
  if (!force && built > sources) return;
  step('Building the app…');
  const res = run('npm', ['run', 'build']);
  if (!res.ok) fail('The build failed; see the messages above.');
}

// --- Docling (optional parser) ------------------------------------------------------------------------------------

function venvPython() {
  return WIN ? join(ROOT, 'python', '.venv', 'Scripts', 'python.exe') : join(ROOT, 'python', '.venv', 'bin', 'python');
}

function findPython() {
  const candidates = WIN ? [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3']], ['python', []]] : [['python3.12', []], ['python3.11', []], ['python3', []], ['python', []]];
  for (const [cmd, pre] of candidates) {
    const v = capture(cmd, [...pre, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])']);
    if (!v) continue;
    const [maj, min] = v.split('.').map(Number);
    if (maj === 3 && min >= 10 && min <= 13) return { cmd, pre, version: v };
  }
  return null;
}

function setupDocling() {
  const py = venvPython();
  const req = join(ROOT, 'python', 'requirements.txt');
  if (!existsSync(py)) {
    if (capture('uv', ['--version'])) {
      step('Creating the Python environment with uv…');
      if (!run('uv', ['venv', join(ROOT, 'python', '.venv'), '--python', '3.12']).ok) fail('uv could not create the Python environment.');
    } else {
      const found = findPython();
      if (!found) fail('Python 3.10–3.13 was not found. Install Python 3.12 from https://www.python.org (or install uv) and run this again.');
      step(`Creating the Python environment with Python ${found.version}…`);
      if (!run(found.cmd, [...found.pre, '-m', 'venv', join(ROOT, 'python', '.venv')]).ok) fail('Could not create the Python environment.');
    }
  }
  step('Installing Docling (several hundred MB; this can take a while)…');
  const pip = capture('uv', ['--version']) ? run('uv', ['pip', 'install', '--python', py, '-r', req]) : run(py, ['-m', 'pip', 'install', '--upgrade', '-r', req]);
  if (!pip.ok) fail('Installing Docling failed; see the messages above.');
  step('Downloading Docling models…');
  const tools = WIN ? join(ROOT, 'python', '.venv', 'Scripts', 'docling-tools.exe') : join(ROOT, 'python', '.venv', 'bin', 'docling-tools');
  if (!run(tools, ['models', 'download'], { shell: false }).ok) {
    console.warn('  Model download failed. Docling will try again on first use; until then ROBer COP uses its built-in parser.');
  }
  const check = capture(py, [join(ROOT, 'python', 'docling_worker.py'), '--check']);
  console.log(check && check.includes('"ok"') ? '✔ Docling is ready. ROBer COP will use it for new PDFs.' : '✖ Docling did not pass its self-check; the built-in parser will be used.');
}

// --- start --------------------------------------------------------------------------------------------------------

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : WIN ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* the URL is printed anyway */
  }
}

async function alreadyRunning(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    return body?.app === 'ROBer COP' ? body : null;
  } catch {
    return null;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  checkNode();
  const saved = readSettings();
  if (opts.dataDir) saveSettings({ ...saved, dataDir: opts.dataDir });
  const dataDir = opts.dataDir ?? process.env.ROBERCOP_DATA_DIR ?? saved.dataDir ?? null;
  const port = opts.port ?? Number(process.env.ROBERCOP_PORT ?? saved.port ?? 4317);

  ensureInstalled();
  if (opts.setupDocling) return setupDocling();
  ensureBuilt(opts.rebuild);

  const url = `http://127.0.0.1:${port}`;
  const running = await alreadyRunning(port);
  if (running) {
    console.log(`ROBer COP is already running at ${url} (data: ${running.dataDir}).`);
    if (opts.open) openBrowser(url);
    return;
  }

  const env = { ...process.env, ROBERCOP_PORT: String(port) };
  if (dataDir) env.ROBERCOP_DATA_DIR = dataDir;
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'apps', 'server', 'dist', 'server.mjs')], {
    cwd: ROOT,
    env,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  });
  child.on('message', (m) => {
    if (m?.type === 'ready') {
      console.log('\nLeave this window open while you work. Close it (or press Ctrl+C) to stop ROBer COP; your work is saved continuously.\n');
      if (opts.open) openBrowser(m.url);
    }
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
}

await main();
