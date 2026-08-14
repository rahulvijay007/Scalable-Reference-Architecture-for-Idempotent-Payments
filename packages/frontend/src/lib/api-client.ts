import { ApiResponse, AuthResponse } from '@payment-platform/shared';
import { useAuthStore } from './auth-store';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const { refreshToken, user, setSession, clearSession } = useAuthStore.getState();

  if (!refreshToken) {
    clearSession();
    throw new ApiClientError(401, 'MISSING_REFRESH_TOKEN', 'No refresh token available');
  }

  const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  const body: ApiResponse<AuthResponse> = await res.json();

  if (!res.ok || !body.success || !body.data) {
    clearSession();
    throw new ApiClientError(401, 'REFRESH_FAILED', 'Session expired, please log in again');
  }

  setSession({ accessToken: body.data.accessToken, refreshToken: body.data.refreshToken, user: user ?? body.data.user });
  return body.data.accessToken;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  skipAuth?: boolean;
}

/**
 * Thin fetch wrapper matching the backend's ApiResponse<T> envelope. On a
 * 401 with TOKEN_EXPIRED it refreshes the access token once and retries the
 * original request before giving up. Returns the full envelope so callers
 * that need pagination metadata (list endpoints put page/limit/total there,
 * not in `data`) can read it.
 */
export async function apiRequestFull<T>(
  path: string,
  options: RequestOptions = {},
  _isRetry = false
): Promise<ApiResponse<T>> {
  const { accessToken } = useAuthStore.getState();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (!options.skipAuth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const body: ApiResponse<T> = await res.json();

  if (!res.ok || !body.success) {
    const code = body.error?.code || 'UNKNOWN_ERROR';

    if (res.status === 401 && code === 'TOKEN_EXPIRED' && !_isRetry && !options.skipAuth) {
      // Coalesce concurrent refreshes into a single in-flight request
      refreshPromise = refreshPromise || refreshAccessToken().finally(() => {
        refreshPromise = null;
      });

      try {
        await refreshPromise;
        return apiRequestFull<T>(path, options, true);
      } catch {
        if (typeof window !== 'undefined') {
          window.location.href = '/login';
        }
        throw new ApiClientError(401, 'SESSION_EXPIRED', 'Your session has expired, please log in again');
      }
    }

    throw new ApiClientError(res.status, code, body.error?.message || 'Request failed', body.error?.details);
  }

  return body;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const body = await apiRequestFull<T>(path, options);
  return body.data as T;
}
