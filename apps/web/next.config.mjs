import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript sources compiled to CJS; transpiling it
  // here keeps one copy of the types and the copy rules across both apps.
  transpilePackages: ['@tradeos/shared'],
  poweredByHeader: false,

  // Workspace packages live above this directory, so tracing has to start at
  // the repository root or their files are left out of the function bundle.
  outputFileTracingRoot: repoRoot,

  // Prisma's query engine is a native binary. The bundler cannot see it
  // through a require, so it is named explicitly — without this the deployed
  // function starts fine and then fails on the first query.
  outputFileTracingIncludes: {
    '/api/[...path]': [
      '../../packages/db/generated/**/*',
      '../../packages/db/schema.prisma',
    ],
  },

  // Keep Prisma out of the bundle and load it at runtime, which is what makes
  // the traced engine file resolvable.
  serverExternalPackages: ['@prisma/client', '@tradeos/db'],
};

export default nextConfig;
