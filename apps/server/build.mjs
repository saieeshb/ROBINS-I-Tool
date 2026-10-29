// Bundles the server and the read-only MCP source server into dist/ so they run on plain Node without TypeScript
// tooling. Third-party packages stay external (installed in node_modules); the workspace packages are bundled.
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@robercop/'));
const dist = join(here, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: [...external, ...external.map((d) => `${d}/*`)],
  logLevel: 'warning'
};

await build({ ...common, entryPoints: [join(here, 'src', 'main.ts')], outfile: join(dist, 'server.mjs') });
await build({ ...common, entryPoints: [join(here, 'src', 'mcp', 'main.ts')], outfile: join(dist, 'mcp.mjs') });
cpSync(join(here, 'src', 'ai', 'reference'), join(dist, 'reference'), { recursive: true });
console.log('Built apps/server/dist/server.mjs and apps/server/dist/mcp.mjs');
