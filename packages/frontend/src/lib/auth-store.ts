import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { UserInfo } from '@payment-platform/shared';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserInfo | null;
  setSession: (session: { accessToken: string; refreshToken: string; user: UserInfo }) => void;
  clearSession: () => void;
}

// Tokens live in localStorage (via zustand's persist middleware) rather than
// an httpOnly cookie. This is a known tradeoff for this iteration - see
// README's "Security Notes" - since the backend's auth routes return tokens
// in the JSON body rather than setting cookies. Upgrade path: switch to
// httpOnly cookies + CSRF protection if this ever handles real card data.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      setSession: ({ accessToken, refreshToken, user }) => set({ accessToken, refreshToken, user }),
      clearSession: () => set({ accessToken: null, refreshToken: null, user: null }),
    }),
    { name: 'payment-platform-auth' }
  )
);
