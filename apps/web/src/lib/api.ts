import type { ApiResponse, PaginationMeta } from '@alora/shared';

/** Base URL of the Alora API, e.g. http://localhost:3001/api/v1 (set NEXT_PUBLIC_API_URL). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

/** A failed API call, carrying the API's error envelope ({ code, message, details }). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiResult<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  accessToken?: string | null;
  /** Auth endpoints: keep the refresh token in the API's httpOnly cookie (DECISIONS D-034). */
  cookieAuth?: boolean;
  signal?: AbortSignal;
  /** 'blob' for file downloads: `data` is the file (Blob) instead of an unwrapped envelope. */
  responseType?: 'json' | 'blob';
}

/** Calls the API and unwraps `{ success, data, meta }`; throws ApiError for error envelopes. */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  // FormData (file uploads) sets its own multipart Content-Type with the boundary.
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (options.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
  if (options.cookieAuth) headers['X-Auth-Transport'] = 'cookie';

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: isForm ? (options.body as FormData) : options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: options.cookieAuth ? 'include' : 'omit',
      cache: 'no-store',
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }

  if (response.status === 204) return { data: undefined as T };
  if (options.responseType === 'blob' && response.ok) return { data: (await response.blob()) as T };
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body) throw new ApiError(response.status, 'BAD_RESPONSE', 'The server sent an unexpected response.');
  if (!body.success) {
    throw new ApiError(response.status, body.error.code, body.error.message, body.error.details);
  }
  return { data: body.data, meta: body.meta };
}
