import { defineConfig } from 'vitest/config';

// Vitest monorepo config (root-level).
// `npm test` at repo root runs tests across all workspaces:
//   - packages/notify-panel/test/**/*.test.ts
//   - extensions/*/test/**/*.test.ts (future)
// Tests run against each package's src/ directly, no build artifacts needed.
export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'extensions/**/test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.ts', 'extensions/*/src/**/*.ts'],
      exclude: ['**/index.ts', '**/*.d.ts'],
    },
  },
});
