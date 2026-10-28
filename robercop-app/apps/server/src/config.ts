import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  dataDir: string;
  dbPath: string;
  documentsDir: string;
  parsedDir: string;
  runsDir: string;
  packagesDir: string;
  tmpDir: string;
  host: string;
  port: number;
  /** Directory with the built web app (served at /). */
  webDist: string | null;
  /** Repository root of the app (for the Python worker and MCP entry). */
  appRoot: string;
  /** Command used to start the bundled MCP server (node + script). */
  mcpCommand: { command: string; args: string[] };
  pythonPath: string | null;
  claudePath: string;
  appVersion: string;
}

function defaultDataDir(): string {
  const docs = join(homedir(), 'Documents');
  return join(existsSync(docs) ? docs : homedir(), 'ROBerCOP');
}

function findAppRoot(): string {
  // Works from src/ (tsx) and from dist/ (bundled).
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'launcher')) && existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

export function loadConfig(overrides: Partial<AppConfig> & { dataDir?: string } = {}): AppConfig {
  const appRoot = overrides.appRoot ?? findAppRoot();
  const dataDir = resolve(overrides.dataDir ?? process.env.ROBERCOP_DATA_DIR ?? defaultDataDir());
  const dirs = {
    documentsDir: join(dataDir, 'documents'),
    parsedDir: join(dataDir, 'parsed'),
    runsDir: join(dataDir, 'runs'),
    packagesDir: join(dataDir, 'packages'),
    tmpDir: join(dataDir, 'tmp')
  };
  for (const d of [dataDir, ...Object.values(dirs)]) mkdirSync(d, { recursive: true });

  const distWeb = join(appRoot, 'apps', 'web', 'dist');
  const builtMcp = join(appRoot, 'apps', 'server', 'dist', 'mcp.mjs');
  const srcMcp = join(appRoot, 'apps', 'server', 'src', 'mcp', 'main.ts');
  const mcpCommand = existsSync(builtMcp)
    ? { command: process.execPath, args: ['--disable-warning=ExperimentalWarning', builtMcp] }
    : { command: process.execPath, args: ['--disable-warning=ExperimentalWarning', '--import', 'tsx', srcMcp] };

  const venvPython =
    process.platform === 'win32' ? join(appRoot, 'python', '.venv', 'Scripts', 'python.exe') : join(appRoot, 'python', '.venv', 'bin', 'python');

  return {
    dataDir,
    dbPath: join(dataDir, 'robercop.sqlite'),
    ...dirs,
    host: '127.0.0.1',
    port: Number(process.env.ROBERCOP_PORT ?? 4317),
    webDist: existsSync(join(distWeb, 'index.html')) ? distWeb : null,
    appRoot,
    mcpCommand,
    pythonPath: process.env.ROBERCOP_PYTHON ?? (existsSync(venvPython) ? venvPython : null),
    claudePath: process.env.ROBERCOP_CLAUDE ?? 'claude',
    appVersion: '0.1.0',
    ...overrides
  };
}
