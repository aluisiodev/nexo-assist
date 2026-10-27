import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mesmo alias do apps/web/tsconfig.json.
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL('./apps/web/src/', import.meta.url)) }],
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
