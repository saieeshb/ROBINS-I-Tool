import { loadConfig } from './config.js';
import { createServices } from './services/index.js';
import { buildApp } from './app.js';

const dataArg = process.argv.find((a) => a.startsWith('--data-dir='));
const config = loadConfig(dataArg ? { dataDir: dataArg.slice('--data-dir='.length) } : {});
const services = createServices(config);

// Recovery after an unclean stop: requeue interrupted parse jobs and mark interrupted assistant runs.
const requeued = services.parsing.recover();
const interrupted = services.ai.recover();

const app = await buildApp(services, { logger: process.env.ROBERCOP_LOG === '1' });
try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Is ROBer COP already running? Open http://127.0.0.1:${config.port}`);
    process.exit(2);
  }
  throw err;
}
const url = `http://127.0.0.1:${config.port}`;
console.log(`ROBer COP is running at ${url}`);
console.log(`Data directory: ${config.dataDir}`);
if (requeued || interrupted) console.log(`Recovered after restart: ${requeued} parse job(s) requeued, ${interrupted} assistant run(s) marked interrupted.`);
if (!config.webDist) console.log('Web app not built: run "npm run build" (or use the Vite dev server on port 5173).');
process.send?.({ type: 'ready', url });

const shutdown = async () => {
  await app.close();
  services.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
