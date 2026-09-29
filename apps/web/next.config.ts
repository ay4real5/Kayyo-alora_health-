import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Security headers for the dashboard (DECISIONS D-034). The Content-Security-Policy needs a per-request nonce, so it is
 * set in src/proxy.ts (D-068); these are the headers that are the same on every response.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' }, // no clickjacking
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' }, // URLs may contain record ids
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  // Pages render patient data in the browser; never let shared caches keep them.
  { key: 'Cache-Control', value: 'no-store' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The shared package ships compiled ESM; let Next bundle it like app code.
  transpilePackages: ['@alora/shared'],
  // Docker image (docker/Dockerfile.web, D-070): a self-contained server traced from the monorepo root.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone' as const, outputFileTracingRoot: path.join(__dirname, '../..') }
    : {}),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
