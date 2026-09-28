/**
 * The dashboard's Content-Security-Policy (DECISIONS D-068). Scripts run only from this origin or with the per-request
 * nonce (Next.js adds it to its own inline scripts), so injected markup can't run code. Styles allow inline because
 * Leaflet and Recharts set style attributes. Network calls go only to this origin and the API (HTTP + WebSocket).
 */
export function buildCsp(nonce: string, opts: { apiUrl: string; dev: boolean }): string {
  const api = new URL(opts.apiUrl);
  const ws = `${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}`;
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    // 'unsafe-eval' only in development: React uses eval there for better error stacks.
    ['script-src', ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(opts.dev ? ["'unsafe-eval'"] : [])]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org']],
    ['font-src', ["'self'"]],
    // Dev also needs the hot-reload socket on this origin (ws: is not covered by 'self' in every browser).
    ['connect-src', ["'self'", api.origin, ws, ...(opts.dev ? ['ws:'] : [])]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  const policy = directives.map(([name, values]) => `${name} ${values.join(' ')}`);
  // Only when the API itself is HTTPS; upgrading a plain-http local setup would break it.
  if (api.protocol === 'https:') policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}
