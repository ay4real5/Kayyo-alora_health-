'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiRequest, type ApiResult, type RequestOptions } from '../api';
import { IDLE_LIMIT_MS, IDLE_WARNING_MS, Session } from './session';
import type { LoginOutcome, Me, SessionTokens, TwoFactorChallenge } from './types';

type Status = 'loading' | 'anonymous' | 'authenticated';
type LogoutReason = 'user' | 'idle' | 'expired';

interface AuthContextValue {
  status: Status;
  user: Me | null;
  /** True during the last minute before the idle logout. */
  idleWarning: boolean;
  login(email: string, password: string): Promise<LoginOutcome>;
  verifyTwoFactor(twoFactorToken: string, proof: { code?: string; recoveryCode?: string }): Promise<LoginOutcome>;
  logout(reason?: LogoutReason): Promise<void>;
  /** Authenticated API call; renews the access token once and retries on 401. */
  request<T>(path: string, options?: Omit<RequestOptions, 'accessToken'>): Promise<ApiResult<T>>;
  can(permission: string): boolean;
  /** Takes over the fresh tokens the API issues after a password change and reloads the profile. */
  adoptTokens(tokens: SessionTokens): Promise<void>;
  /** The current access token, for the Socket.IO handshake only (sockets can't use the request helper). */
  currentAccessToken(): string | null;
  /** Renews the access token and reloads the user — after enabling 2FA, so the setup-only restriction lifts. */
  refreshSession(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** React face of `Session`: who is signed in, and the HIPAA idle logout (DECISIONS D-034). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new Session());
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<Me | null>(null);
  const [idleWarning, setIdleWarning] = useState(false);

  const endLocally = useCallback(() => {
    session.clear();
    setUser(null);
    setStatus('anonymous');
    setIdleWarning(false);
  }, [session]);

  const loadUser = useCallback(async () => {
    const { data } = await apiRequest<Me>('/auth/me', { accessToken: session.accessToken });
    setUser(data);
    setStatus('authenticated');
  }, [session]);

  // First load: resume the session from the refresh cookie if there is one.
  useEffect(() => {
    let cancelled = false;
    void session.renew().then(async (token) => {
      if (cancelled) return;
      if (!token) return endLocally();
      await loadUser().catch(endLocally);
    });
    return () => {
      cancelled = true;
    };
  }, [session, loadUser, endLocally]);

  const logout = useCallback(
    async (reason: LogoutReason = 'user') => {
      try {
        await apiRequest('/auth/logout', { method: 'POST', body: {}, cookieAuth: true });
      } catch {
        // Ending the local session matters more than the server acknowledging it.
      }
      endLocally();
      // A full page load (not client-side navigation) is deliberate: it wipes every in-memory cache — React
      // Query data may contain PHI — so nothing survives for the next person using this browser.
      window.location.assign(reason === 'user' ? '/login' : `/login?reason=${reason}`);
    },
    [endLocally],
  );

  // HIPAA auto-logoff after 15 minutes without keyboard/mouse/touch activity (DESIGN.md §7.3).
  useEffect(() => {
    if (status !== 'authenticated') return;
    const markActive = () => {
      session.markActive();
      setIdleWarning(false);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, markActive, { passive: true }));
    const timer = setInterval(() => {
      const idle = session.idleFor();
      if (idle >= IDLE_LIMIT_MS) void logout('idle');
      else setIdleWarning(idle >= IDLE_WARNING_MS);
    }, 5_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, markActive));
      clearInterval(timer);
    };
  }, [status, session, logout]);

  const finishSignIn = useCallback(
    async (tokens: SessionTokens): Promise<LoginOutcome> => {
      session.markActive();
      session.adopt(tokens);
      await loadUser();
      return {
        kind: 'signed-in',
        mustChangePassword: Boolean(tokens.mustChangePassword),
        mustEnable2fa: Boolean(tokens.mustEnable2fa),
      };
    },
    [session, loadUser],
  );

  const login = useCallback(
    async (email: string, password: string): Promise<LoginOutcome> => {
      const { data } = await apiRequest<SessionTokens | TwoFactorChallenge>('/auth/login', {
        method: 'POST',
        body: { email, password },
        cookieAuth: true,
      });
      if ('requires2FA' in data) return { kind: 'two-factor', twoFactorToken: data.twoFactorToken };
      return finishSignIn(data);
    },
    [finishSignIn],
  );

  const verifyTwoFactor = useCallback(
    async (twoFactorToken: string, proof: { code?: string; recoveryCode?: string }) => {
      const { data } = await apiRequest<SessionTokens>('/auth/2fa/verify', {
        method: 'POST',
        body: { twoFactorToken, ...proof },
        cookieAuth: true,
      });
      return finishSignIn(data);
    },
    [finishSignIn],
  );

  const request = useCallback(
    async <T,>(path: string, options: Omit<RequestOptions, 'accessToken'> = {}) => {
      try {
        return await apiRequest<T>(path, { ...options, accessToken: session.accessToken });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        const token = await session.renew();
        if (!token) {
          void logout('expired');
          throw error;
        }
        return apiRequest<T>(path, { ...options, accessToken: token });
      }
    },
    [session, logout],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      idleWarning,
      login,
      verifyTwoFactor,
      logout,
      request,
      can: (permission) => Boolean(user?.permissions.includes(permission)),
      adoptTokens: async (tokens) => {
        session.adopt(tokens);
        await loadUser(); // the cached user still says mustChangePassword until /auth/me is reloaded
      },
      currentAccessToken: () => session.accessToken,
      refreshSession: async () => {
        await session.renew();
        await loadUser();
      },
    }),
    [status, user, idleWarning, login, verifyTwoFactor, logout, request, session, loadUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
