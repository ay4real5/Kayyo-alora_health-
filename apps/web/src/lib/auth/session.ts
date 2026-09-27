import { apiRequest } from '../api';
import type { SessionTokens } from './types';

export const IDLE_LIMIT_MS = 15 * 60_000;
export const IDLE_WARNING_MS = 14 * 60_000;
const REFRESH_LOCK = 'alora-session-refresh';

type Renewer = () => Promise<SessionTokens>;

/**
 * Holds the browser session outside React (DECISIONS D-034):
 *  - the access token lives only here, in memory (never localStorage/sessionStorage);
 *  - the refresh token is in the API's httpOnly cookie, invisible to page scripts;
 *  - renewals are single-flight within a tab and serialised across tabs with the Web Locks API — two tabs
 *    renewing with the same cookie at once would look like token theft to the API;
 *  - a renewal is scheduled a minute before the access token expires, but only if the user was active
 *    recently, so an idle session is allowed to lapse (HIPAA auto-logoff).
 */
export class Session {
  accessToken: string | null = null;
  lastActivity = Date.now();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<string | null> | null = null;

  constructor(
    private readonly renewer: Renewer = defaultRenewer,
    private readonly lock: <T>(task: () => Promise<T>) => Promise<T> = withTabLock,
  ) {}

  adopt(tokens: SessionTokens): void {
    this.accessToken = tokens.accessToken;
    this.clearTimer();
    const renewInMs = Math.max(10_000, (tokens.accessTokenExpiresIn - 60) * 1000);
    this.timer = setTimeout(() => {
      if (Date.now() - this.lastActivity < IDLE_LIMIT_MS) void this.renew();
    }, renewInMs);
  }

  /** New access token from the refresh cookie, or null when the session is over. */
  renew(): Promise<string | null> {
    this.inflight ??= this.lock(async () => {
      try {
        const tokens = await this.renewer();
        this.adopt(tokens);
        return tokens.accessToken;
      } catch {
        this.clear();
        return null;
      }
    }).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  markActive(): void {
    this.lastActivity = Date.now();
  }

  idleFor(): number {
    return Date.now() - this.lastActivity;
  }

  clear(): void {
    this.accessToken = null;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

async function defaultRenewer(): Promise<SessionTokens> {
  const { data } = await apiRequest<SessionTokens>('/auth/refresh', { method: 'POST', body: {}, cookieAuth: true });
  return data;
}

function withTabLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(REFRESH_LOCK, task) as Promise<T>;
  }
  return task();
}
