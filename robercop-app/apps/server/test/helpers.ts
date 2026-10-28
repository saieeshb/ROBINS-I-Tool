import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { createServices, type Services } from '../src/services/index.js';
import { buildApp } from '../src/app.js';

export const FIXTURE_PDF = resolve(__dirname, 'fixtures', 'sample-study.pdf');

export interface TestEnv {
  app: FastifyInstance;
  services: Services;
  dataDir: string;
  api: <T = any>(method: string, url: string, body?: unknown, reviewer?: string) => Promise<{ status: number; body: T }>;
  upload: (url: string, file: string, fields: Record<string, string>, reviewer?: string) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

export async function setup(overrides: Record<string, unknown> = {}): Promise<TestEnv> {
  const dataDir = mkdtempSync(join(tmpdir(), 'robercop-test-'));
  const config = loadConfig({ dataDir, pythonPath: null, ...overrides });
  const services = createServices(config);
  const app = await buildApp(services);
  const host = `127.0.0.1:${config.port}`;
  const api = async (method: string, url: string, body?: unknown, reviewer = 'Alice') => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      headers: { host, 'x-robercop': '1', 'x-reviewer': encodeURIComponent(reviewer), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      payload: body !== undefined ? JSON.stringify(body) : undefined
    });
    let parsed: unknown = res.body;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      /* non-JSON */
    }
    return { status: res.statusCode, body: parsed as any };
  };
  const upload = async (url: string, file: string, fields: Record<string, string>, reviewer = 'Alice') => {
    const boundary = '----robercop' + Math.random().toString(16).slice(2);
    const parts: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.split('/').pop()}"\r\nContent-Type: application/pdf\r\n\r\n`));
    parts.push(readFileSync(file));
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { host, 'x-robercop': '1', 'x-reviewer': encodeURIComponent(reviewer), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat(parts)
    });
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };
  return {
    app,
    services,
    dataDir,
    api,
    upload,
    close: async () => {
      await app.close();
      services.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
}
