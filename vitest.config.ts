import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // client tests opt in with `// @vitest-environment jsdom`
    include: ['server/**/*.test.ts', 'client/**/*.test.{ts,tsx}'],
  },
});
