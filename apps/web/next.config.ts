import type { NextConfig } from 'next';

/**
 * Security headers for the dashboard (DECISIONS D-034). A strict Content-Security-Policy with nonces is part of
 * the security pass (P4-09); these are the safe defaults that need no per-request work.
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
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
