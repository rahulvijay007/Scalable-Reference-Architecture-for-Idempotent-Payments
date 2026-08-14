import { useMutation } from '@tanstack/react-query';
import { AuthResponse, LoginRequest, RegisterRequest } from '@payment-platform/shared';
import { apiRequest } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';

export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);

  return useMutation({
    mutationFn: (data: LoginRequest) =>
      apiRequest<AuthResponse>('/api/auth/login', { method: 'POST', body: data, skipAuth: true }),
    onSuccess: (data) => setSession(data),
  });
}

export function useRegister() {
  const setSession = useAuthStore((s) => s.setSession);

  return useMutation({
    mutationFn: (data: RegisterRequest) =>
      apiRequest<AuthResponse>('/api/auth/register', { method: 'POST', body: data, skipAuth: true }),
    onSuccess: (data) => setSession(data),
  });
}

export function useLogout() {
  const { refreshToken, clearSession } = useAuthStore();

  return useMutation({
    mutationFn: async () => {
      if (refreshToken) {
        await apiRequest('/api/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
      }
    },
    onSettled: () => clearSession(),
  });
}
