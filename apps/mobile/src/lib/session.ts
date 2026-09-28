import { ApiError, apiRequest, type ApiResult, type Fetcher, type RequestOptions } from './api';

/** Where the refresh token lives between launches: the device keychain/keystore (expo-secure-store). */
export interface TokenStore {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
  mustChangePassword?: boolean;
}

export interface TwoFactorChallenge {
  requires2FA: true;
  twoFactorToken: string;
  expiresIn: number;
}

export type LoginOutcome = { kind: 'signed-in'; mustChangePassword: boolean } | { kind: 'two-factor'; twoFactorToken: string };

/** Lock the app after this long in the background (HIPAA automatic logoff, DESIGN.md §7.3; D-043). */
export const LOCK_AFTER_BACKGROUND_MS = 5 * 60_000;

/**
 * The caregiver app's session (DECISIONS D-043). The access token lives only in memory; the refresh token in the
 * device's secure storage, so a relaunch needs an unlock (biometrics/device passcode) rather than a password.
 * Renewal is single-flight. Being offline never discards the session; the API refusing the refresh token does.
 */
export class MobileSession {
  accessToken: string | null = null;
  private renewing: Promise<string | null> | null = null;

  constructor(
    private readonly store: TokenStore,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async hasSavedSession(): Promise<boolean> {
    return Boolean(await this.store.get());
  }

  async login(email: string, password: string): Promise<LoginOutcome> {
    const { data } = await apiRequest<Tokens | TwoFactorChallenge>(
      '/auth/login',
      { method: 'POST', body: { email, password } },
      this.fetcher,
    );
    if ('requires2FA' in data) return { kind: 'two-factor', twoFactorToken: data.twoFactorToken };
    await this.adopt(data);
    return { kind: 'signed-in', mustChangePassword: Boolean(data.mustChangePassword) };
  }

  async verifyTwoFactor(twoFactorToken: string, proof: { code?: string; recoveryCode?: string }): Promise<LoginOutcome> {
    const { data } = await apiRequest<Tokens>(
      '/auth/2fa/verify',
      { method: 'POST', body: { twoFactorToken, ...proof } },
      this.fetcher,
    );
    await this.adopt(data);
    return { kind: 'signed-in', mustChangePassword: Boolean(data.mustChangePassword) };
  }

  async adopt(tokens: Tokens): Promise<void> {
    this.accessToken = tokens.accessToken;
    await this.store.set(tokens.refreshToken);
  }

  /** A fresh access token from the saved refresh token, or null if the API no longer accepts it (then it's cleared). */
  renew(): Promise<string | null> {
    this.renewing ??= (async () => {
      try {
        const refreshToken = await this.store.get();
        if (!refreshToken) return null;
        try {
          const { data } = await apiRequest<Tokens>(
            '/auth/refresh',
            { method: 'POST', body: { refreshToken } },
            this.fetcher,
          );
          await this.adopt(data);
          return data.accessToken;
        } catch (error) {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            await this.clear();
            return null;
          }
          throw error; // offline or server trouble: keep the session, let the caller retry
        }
      } finally {
        this.renewing = null;
      }
    })();
    return this.renewing;
  }

  /** Authenticated call; renews once and retries on 401. */
  async request<T>(path: string, options: Omit<RequestOptions, 'accessToken'> = {}): Promise<ApiResult<T>> {
    if (!this.accessToken) await this.renew();
    try {
      return await apiRequest<T>(path, { ...options, accessToken: this.accessToken }, this.fetcher);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      const token = await this.renew();
      if (!token) throw error;
      return apiRequest<T>(path, { ...options, accessToken: token }, this.fetcher);
    }
  }

  /** Locking forgets the access token only; unlocking renews from the saved refresh token. */
  lock(): void {
    this.accessToken = null;
  }

  /** Signs out on the server (best effort) and forgets everything on the device. */
  async signOut(): Promise<void> {
    const refreshToken = await this.store.get();
    if (refreshToken) {
      await apiRequest('/auth/logout', { method: 'POST', body: { refreshToken } }, this.fetcher).catch(() => undefined);
    }
    await this.clear();
  }

  private async clear(): Promise<void> {
    this.accessToken = null;
    await this.store.clear();
  }
}

/** Whether the app must be unlocked again after coming back from the background. */
export function shouldLock(backgroundedAt: number | null, now: number): boolean {
  return backgroundedAt !== null && now - backgroundedAt >= LOCK_AFTER_BACKGROUND_MS;
}
