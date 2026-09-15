import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The integration suite drives a real database, so tests inside a file run
    // in order and files never run concurrently against each other.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
