import { describe, expect, it } from 'vitest';
import { ApiError, OfflineError } from './api';
import { LOCK_AFTER_BACKGROUND_MS, MobileSession, shouldLock, type TokenStore } from './session';

function memoryStore(initial: string | null = null): TokenStore & { value: string | null } {
  return {
    value: initial,
    async get() {
      return this.value;
    },
    async set(v) {
      this.value = v;
    },
    async clear() {
      this.value = null;
    },
  };
}

type Route = (body: Record<string, unknown>, auth: string | null) => { status: number; body: unknown } | 'offline';

/** A fake fetch that answers per path and records calls. */
function fakeApi(routes: Record<string, Route>) {
  const calls: { path: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const path = url.replace(/^.*\/api\/v1/, '');
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
    calls.push({ path, body, auth });
    const answer = routes[path]?.(body, auth) ?? { status: 404, body: { success: false, error: { code: 'NOT_FOUND', message: 'nope' } } };
    if (answer === 'offline') throw new TypeError('Network request failed');
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as typeof fetch;
  return { fetcher, calls };
}

const tokens = (n: number) => ({
  success: true,
  data: { accessToken: `access-${n}`, refreshToken: `refresh-${n}`, accessTokenExpiresIn: 900, refreshTokenExpiresAt: '2030-01-01T00:00:00Z' },
});
const unauthorized = { status: 401, body: { success: false, error: { code: 'UNAUTHORIZED', message: 'Session ended' } } };

describe('MobileSession', () => {
  it('login keeps the access token in memory and the refresh token in secure storage', async () => {
    const store = memoryStore();
    const { fetcher } = fakeApi({ '/auth/login': () => ({ status: 200, body: tokens(1) }) });
    const session = new MobileSession(store, fetcher);
    expect(await session.login('a@b.test', 'pw')).toEqual({ kind: 'signed-in', mustChangePassword: false });
    expect(session.accessToken).toBe('access-1');
    expect(store.value).toBe('refresh-1');
  });

  it('two-factor login returns the challenge, then verify signs in', async () => {
    const { fetcher } = fakeApi({
      '/auth/login': () => ({ status: 200, body: { success: true, data: { requires2FA: true, twoFactorToken: 'tf', expiresIn: 300 } } }),
      '/auth/2fa/verify': (b) => (b.code === '123456' ? { status: 200, body: tokens(2) } : unauthorized),
    });
    const session = new MobileSession(memoryStore(), fetcher);
    expect(await session.login('a@b.test', 'pw')).toEqual({ kind: 'two-factor', twoFactorToken: 'tf' });
    await expect(session.verifyTwoFactor('tf', { code: '000000' })).rejects.toBeInstanceOf(ApiError);
    expect((await session.verifyTwoFactor('tf', { code: '123456' })).kind).toBe('signed-in');
  });

  it('renews once for concurrent callers and rotates the stored refresh token', async () => {
    const store = memoryStore('refresh-0');
    const { fetcher, calls } = fakeApi({ '/auth/refresh': () => ({ status: 200, body: tokens(1) }) });
    const session = new MobileSession(store, fetcher);
    const [a, b] = await Promise.all([session.renew(), session.renew()]);
    expect([a, b]).toEqual(['access-1', 'access-1']);
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
    expect(store.value).toBe('refresh-1');
  });

  it('forgets the session when the API refuses the refresh token, but not when offline', async () => {
    const refused = memoryStore('old');
    const s1 = new MobileSession(refused, fakeApi({ '/auth/refresh': () => unauthorized }).fetcher);
    expect(await s1.renew()).toBeNull();
    expect(refused.value).toBeNull();

    const kept = memoryStore('old');
    const s2 = new MobileSession(kept, fakeApi({ '/auth/refresh': () => 'offline' }).fetcher);
    await expect(s2.renew()).rejects.toBeInstanceOf(OfflineError);
    expect(kept.value).toBe('old');
  });

  it('request renews once on 401 and retries with the new token', async () => {
    const { fetcher, calls } = fakeApi({
      '/auth/refresh': () => ({ status: 200, body: tokens(2) }),
      '/auth/me': (_b, auth) => (auth === 'Bearer access-2' ? { status: 200, body: { success: true, data: { id: 'u1' } } } : unauthorized),
    });
    const session = new MobileSession(memoryStore('refresh-1'), fetcher);
    session.accessToken = 'stale';
    expect((await session.request<{ id: string }>('/auth/me')).data.id).toBe('u1');
    expect(calls.map((c) => c.path)).toEqual(['/auth/me', '/auth/refresh', '/auth/me']);
  });

  it('locking drops only the access token; signing out revokes and clears everything', async () => {
    const store = memoryStore('refresh-1');
    const { fetcher, calls } = fakeApi({ '/auth/logout': () => ({ status: 204, body: {} }) });
    const session = new MobileSession(store, fetcher);
    session.accessToken = 'access-1';
    session.lock();
    expect(session.accessToken).toBeNull();
    expect(await session.hasSavedSession()).toBe(true);
    await session.signOut();
    expect(calls[0]).toMatchObject({ path: '/auth/logout', body: { refreshToken: 'refresh-1' } });
    expect(store.value).toBeNull();
  });
});

describe('shouldLock', () => {
  it('locks after five minutes in the background', () => {
    expect(shouldLock(null, 1_000_000)).toBe(false);
    expect(shouldLock(0, LOCK_AFTER_BACKGROUND_MS - 1)).toBe(false);
    expect(shouldLock(0, LOCK_AFTER_BACKGROUND_MS)).toBe(true);
  });
});
