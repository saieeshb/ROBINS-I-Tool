import { defineConfig } from 'vitest/config';

// Live tests call the installed Claude Code client and use subscription quota. Run explicitly: npm run test:live
export default defineConfig({
  test: { include: ['apps/server/test/**/*.manual.test.ts'], environment: 'node', testTimeout: 600000 }
});
