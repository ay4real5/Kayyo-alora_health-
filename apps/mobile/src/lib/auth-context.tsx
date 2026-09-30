import * as LocalAuthentication from 'expo-local-authentication';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { ApiError, OfflineError, type ApiResult, type RequestOptions } from './api';
import { secureTokenStore } from './secure-token-store';
import { MobileSession, shouldLock, type LoginOutcome, type Tokens } from './session';

export interface Me {
  id: string;
  firstName: string;
  lastName: string;
  agencyTimezone: string;
  /** For "call the office" (D-080). */
  agency?: { name: string; phone: string | null };
  is2faEnabled: boolean;
  is2faRequired: boolean;
  mustChangePassword: boolean;
  roles: string[];
  permissions: string[];
}

type Status = 'loading' | 'signed-out' | 'locked' | 'signed-in';

interface AuthValue {
  status: Status;
  user: Me | null;
  mustChangePassword: boolean;
  login(email: string, password: string): Promise<LoginOutcome>;
  verifyTwoFactor(token: string, code: string): Promise<LoginOutcome>;
  /** Biometrics or the device passcode, then renew the saved session. Returns an error message, or null. */
  unlock(): Promise<string | null>;
  signOut(): Promise<void>;
  /** The API ends other sessions and returns fresh tokens for this one. */
  passwordChanged(tokens: Tokens): Promise<void>;
  request<T>(path: string, options?: Omit<RequestOptions, 'accessToken'>): Promise<ApiResult<T>>;
  /** A valid access token for calls request() can't make (multipart photo upload, binary attachment fetch). */
  accessToken(): Promise<string | null>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** Plain-language message for anything thrown by the API client. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof OfflineError) return error.message;
  return 'Something went wrong. Please try again.';
}

/**
 * Session state for the caregiver app (DECISIONS D-043): signed out → signed in → locked after 5 minutes in the
 * background (or on relaunch) → unlocked with biometrics/device passcode. Admins who must set up 2FA are sent to the
 * web — the app doesn't do 2FA setup.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new MobileSession(secureTokenStore()));
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<Me | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    void session.hasSavedSession().then((saved) => setStatus(saved ? 'locked' : 'signed-out'));
  }, [session]);

  // Lock after a while in the background (HIPAA automatic logoff).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active') {
        if (shouldLock(backgroundedAt.current, Date.now())) {
          session.lock();
          setUser(null);
          setStatus((s) => (s === 'signed-in' ? 'locked' : s));
        }
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, [session]);

  const finish = useCallback(
    async (outcome: LoginOutcome): Promise<LoginOutcome> => {
      if (outcome.kind !== 'signed-in') return outcome;
      const { data } = await session.request<Me>('/auth/me');
      if (data.is2faRequired && !data.is2faEnabled) {
        await session.signOut();
        throw new Error('Your role needs two-factor authentication. Set it up in the Primordial Health web dashboard first.');
      }
      setUser(data);
      setMustChangePassword(Boolean(data.mustChangePassword));
      setStatus('signed-in');
      return outcome;
    },
    [session],
  );

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      mustChangePassword,
      login: async (email, password) => finish(await session.login(email, password)),
      verifyTwoFactor: async (token, code) => finish(await session.verifyTwoFactor(token, { code })),
      unlock: async () => {
        const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Primordial Health' });
        if (!result.success) return result.error === 'not_enrolled' ? 'Set a passcode on this phone to unlock Primordial Health.' : null;
        try {
          const token = await session.renew();
          if (!token) {
            setStatus('signed-out');
            return 'Your session has ended. Please sign in again.';
          }
          const { data } = await session.request<Me>('/auth/me');
          setUser(data);
          setMustChangePassword(Boolean(data.mustChangePassword));
          setStatus('signed-in');
          return null;
        } catch (error) {
          return errorMessage(error);
        }
      },
      signOut: async () => {
        await session.signOut();
        setUser(null);
        setMustChangePassword(false);
        setStatus('signed-out');
      },
      passwordChanged: async (tokens) => {
        await session.adopt(tokens);
        setMustChangePassword(false);
      },
      request: (path, options) => session.request(path, options),
      accessToken: () => session.token(),
    }),
    [status, user, mustChangePassword, session, finish],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
