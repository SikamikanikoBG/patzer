import { defineConfig } from 'vitest/config';

// Root-level runner for both workspaces. Server tests live in server/test so
// they never land in server/dist; web tests can sit next to their components.
export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts', 'web/src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
