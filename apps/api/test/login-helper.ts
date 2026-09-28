import type { Agent } from 'supertest';
import { base32Decode, timeStep, totpAt } from '../src/modules/auth/two-factor/totp.js';

/**
 * Logs in and returns an access token. Admins must use 2FA (D-045): for them this does exactly what a new admin
 * does — set up 2FA with an authenticator code, then refresh for an unrestricted token.
 */
export async function loginForTests(http: Agent, email: string, password: string): Promise<string> {
  const login = (await http.post('/api/v1/auth/login').send({ email, password })).body.data as {
    accessToken: string;
    refreshToken: string;
    mustEnable2fa?: boolean;
  };
  if (!login.mustEnable2fa) return login.accessToken;
  const auth = { Authorization: `Bearer ${login.accessToken}` };
  const { secret } = (await http.post('/api/v1/auth/2fa/setup').set(auth).send({})).body.data as { secret: string };
  const code = totpAt(base32Decode(secret), timeStep());
  await http.post('/api/v1/auth/2fa/enable').set(auth).send({ code }).expect(200);
  const refreshed = (await http.post('/api/v1/auth/refresh').send({ refreshToken: login.refreshToken }).expect(200)).body
    .data as { accessToken: string; mustEnable2fa: boolean };
  if (refreshed.mustEnable2fa) throw new Error('2FA setup did not lift the restriction');
  return refreshed.accessToken;
}
