import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ['server/testing/globalSetup.ts'],
    environment: 'node', // client tests opt in with `// @vitest-environment jsdom`
    include: ['server/**/*.test.ts', 'scripts/**/*.test.ts', 'client/**/*.test.{ts,tsx}'],
  },
});
