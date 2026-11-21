import { createContext, useContext, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { can, type Permission, type PublicUser } from '@corridor/core';
import { api, ApiError } from './api';

interface AuthContextValue {
  user: PublicUser | null;
  loading: boolean;
  can: (permission: Permission) => boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api.me()).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) => api.login({ username, password }),
    onSuccess: (data) => qc.setQueryData(['me'], data.user),
  });

  const value: AuthContextValue = {
    user: me.data ?? null,
    loading: me.isLoading,
    can: (permission) => can(me.data?.role, permission),
    login: async (username, password) => {
      await loginMutation.mutateAsync({ username, password });
    },
    logout: async () => {
      await api.logout().catch(() => undefined);
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
