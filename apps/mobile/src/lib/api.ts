/**
 * Alora API client for the caregiver app. Same envelope as the web ({ success, data, meta } / { success, error }).
 * The app uses body tokens, never cookies (DECISIONS D-043).
 */

/** e.g. http://192.168.1.20:3001/api/v1 — a phone can't reach "localhost" on the developer's computer. */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never reached the API (no signal, airplane mode). Distinct from the API saying no. */
export class OfflineError extends Error {
  constructor() {
    super("Can't reach Alora. Check your connection.");
    this.name = 'OfflineError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string | null;
}

export interface ApiResult<T> {
  data: T;
  meta?: { page: number; limit: number; total: number; totalPages: number };
}

export type Fetcher = typeof fetch;

export async function apiRequest<T>(path: string, options: RequestOptions = {}, fetcher: Fetcher = fetch): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetcher(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new OfflineError();
  }
  if (response.status === 204) return { data: undefined as T };
  const body = (await response.json().catch(() => null)) as
    | { success: true; data: T; meta?: ApiResult<T>['meta'] }
    | { success: false; error: { code: string; message: string; details?: unknown } }
    | null;
  if (!response.ok || !body || !body.success) {
    const error = body && !body.success ? body.error : null;
    throw new ApiError(response.status, error?.message ?? 'Something went wrong', error?.code, error?.details);
  }
  return { data: body.data, meta: body.meta };
}
