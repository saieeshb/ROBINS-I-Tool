import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/server/test/**/*.test.ts', 'apps/web/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.manual.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['packages/rules/src/**', 'packages/shared/src/**'],
      reporter: ['text', 'html']
    }
  }
});
