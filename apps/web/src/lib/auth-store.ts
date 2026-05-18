'use client';

import { create } from 'zustand';
import type { Role } from '@tripbng/shared';

export interface AuthUser {
  id: string;
  userCode: string;
  email: string;
  fullName: string;
  role: Role;
  agencyId: string | null;
  distributorId: string | null;
  twoFactorEnabled: boolean;
  permissions: string[];
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  hydrated: boolean;
  setAuth: (user: AuthUser, accessToken: string) => void;
  setAccessToken: (token: string) => void;
  setHydrated: () => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  hydrated: false,
  setAuth: (user, accessToken) => set({ user, accessToken }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setHydrated: () => set({ hydrated: true }),
  clear: () => set({ user: null, accessToken: null }),
}));
