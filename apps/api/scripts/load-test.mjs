#!/usr/bin/env node
/**
 * Small load test for the API (P4-09, DECISIONS D-068). No dependencies: Node's fetch.
 *
 *   node scripts/load-test.mjs [--url http://localhost:3001/api/v1] [--concurrency 10] [--seconds 20]
 *
 * Signs in as demo users (FAKE data — never point this at production with real accounts), then keeps
 * `concurrency` requests in flight against a mix of the busiest read endpoints for `seconds`, and prints
 * per-endpoint count, errors and p50/p95/max latency. Uses the demo supervisor and billing logins.
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);
const API = args.url ?? 'http://localhost:3001/api/v1';
const CONCURRENCY = Number(args.concurrency ?? 10);
const SECONDS = Number(args.seconds ?? 20);
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Password-1!';

async function login(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body.success || !body.data.accessToken) throw new Error(`login failed for ${email}: ${JSON.stringify(body).slice(0, 200)}`);
  return body.data.accessToken;
}

const today = new Date().toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
const supervisor = await login('supervisor@demo.alora.test');
const billing = await login('billing.staff@demo.alora.test');
const endpoints = [
  ['patients list', supervisor, '/patients?limit=25'],
  ['patient search', supervisor, '/patients?limit=25&search=demo'],
  ['schedule week', supervisor, `/schedule/visits?from=${weekAgo}&to=${today}&limit=100`],
  ['evv review', supervisor, '/evv/records?limit=25'],
  ['messages', supervisor, '/messages/conversations'],
  ['notifications', supervisor, '/notifications?limit=10'],
  ['reports: utilization', supervisor, '/reports/visit-utilization'],
  ['reports: productivity', supervisor, '/reports/staff-productivity'],
  ['compliance dashboard', supervisor, '/compliance/dashboard'],
  ['billing readiness', billing, '/billing/ready-to-bill?limit=50'],
  ['claims list', billing, '/billing/claims?limit=25'],
  ['AR aging', billing, '/billing/reports/aging'],
];

const stats = new Map(endpoints.map(([name]) => [name, { ms: [], errors: 0, statuses: new Map() }]));
const deadline = Date.now() + SECONDS * 1000;
let next = 0;

async function worker() {
  while (Date.now() < deadline) {
    const [name, token, path] = endpoints[next++ % endpoints.length];
    const s = stats.get(name);
    const started = performance.now();
    try {
      const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
      await res.arrayBuffer();
      s.ms.push(performance.now() - started);
      if (!res.ok) {
        s.errors++;
        s.statuses.set(res.status, (s.statuses.get(res.status) ?? 0) + 1);
      }
    } catch {
      s.errors++;
    }
  }
}

console.log(`Load test: ${API}, ${CONCURRENCY} concurrent for ${SECONDS}s`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const rows = [...stats].map(([name, s]) => {
  const sorted = [...s.ms].sort((a, b) => a - b);
  return {
    endpoint: name,
    requests: sorted.length,
    errors: s.errors,
    p50_ms: Math.round(pct(sorted, 50)),
    p95_ms: Math.round(pct(sorted, 95)),
    max_ms: Math.round(sorted.at(-1) ?? 0),
    statuses: [...s.statuses].map(([k, v]) => `${k}×${v}`).join(' '),
  };
});
console.table(rows);
const total = rows.reduce((n, r) => n + r.requests, 0);
console.log(`${total} requests, ${(total / SECONDS).toFixed(1)}/s, ${rows.reduce((n, r) => n + r.errors, 0)} errors`);
