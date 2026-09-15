import path from 'node:path';

/**
 * Loads the repo .env before any module that reads process.env is imported.
 * `src/config.ts` exits the process on invalid configuration, so this has to
 * run first — which is why it is a setupFile rather than an import.
 */
process.loadEnvFile(path.resolve(__dirname, '../../../.env'));
process.env.NODE_ENV = 'test';
