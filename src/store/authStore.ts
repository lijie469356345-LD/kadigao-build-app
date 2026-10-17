import { create } from 'zustand';
import { User } from '../types';
import { useDataCacheStore } from './dataCacheStore';

interface AuthStore {
  user: User | null;
  token: string | null;
  isLoggedIn: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
}

// 兼容历史缓存/旧响应中的布尔型 isAdmin（true/false、1/0），统一归一化为 '是'/'否' 字符串
const normalizeIsAdmin = (user: User | null): User | null => {
  if (!user) return user;
  const v = user.isAdmin as unknown;
  if (v === true || v === 1) return { ...user, isAdmin: '是' };
  if (v === false || v === 0) return { ...user, isAdmin: '否' };
  return user;
};

const getStoredAuth = () => {
  try {
    const storedUser = localStorage.getItem('user');
    const storedToken = localStorage.getItem('token');
    if (storedUser && storedToken) {
      return {
        user: normalizeIsAdmin(JSON.parse(storedUser) as User),
        token: storedToken,
        isLoggedIn: true,
      };
    }
  } catch (error) {
    console.error('Failed to parse stored user:', error);
  }
  return {
    user: null,
    token: null,
    isLoggedIn: false,
  };
};

export const useAuthStore = create<AuthStore>((set) => ({
  ...getStoredAuth(),
  login: (user, token) => {
    const normalized = { ...normalizeIsAdmin(user) } as User;
    localStorage.setItem('user', JSON.stringify(normalized));
    localStorage.setItem('token', token);
    set({ user: normalized, token, isLoggedIn: true });
  },
  logout: () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    useDataCacheStore.getState().clearCache();
    set({ user: null, token: null, isLoggedIn: false });
  },
}));
