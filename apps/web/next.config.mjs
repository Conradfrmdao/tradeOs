/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript sources compiled to CJS; transpiling it
  // here keeps one copy of the types and the copy rules across both apps.
  transpilePackages: ['@tradeos/shared'],
  poweredByHeader: false,
};

export default nextConfig;
