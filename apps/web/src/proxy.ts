import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from './lib/csp';

/**
 * A fresh nonce and Content-Security-Policy for every page request (D-068; see
 * node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md). Next.js reads the policy from the request
 * headers and puts the nonce on its own scripts; the root layout renders per request so that always happens.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const intake = request.nextUrl.pathname.startsWith('/intake/');
  const csp = buildCsp(nonce, {
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1',
    dev: process.env.NODE_ENV === 'development',
    // The public "I need care" form can be embedded on the agency's own website (D-098).
    ...(intake ? { frameAncestors: ["'self'", ...(process.env.INTAKE_FRAME_ANCESTORS ?? '').split(/\s+/).filter(Boolean)] } : {}),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only — not static files or prefetches (they don't execute on their own).
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
