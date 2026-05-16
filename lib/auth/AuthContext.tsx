import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, setStoredToken, USE_FIRESTORE_ADMIN_DATA, type ApiUser } from '../api/adminData';
import { hasStoredAuthToken, HttpError, getStoredActiveShopId, setStoredActiveShopId } from '../api/client';
import { SHOP_IDS, type ShopId } from '../shops';
import { observeFirebaseAuth } from '../firebase/auth';
import { loginForFirebaseAuth, normalizeLocalLogin } from './adminLogin';

export type AuthUser = ApiUser;

type PendingShopLogin = { token: string; user: AuthUser };

interface AuthContextValue {
  user: AuthUser | null;
  pendingShopLogin: PendingShopLogin | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (
    email: string,
    password: string
  ) => Promise<
    | { success: true; needsShopSelection?: false }
    | { success: true; needsShopSelection: true }
    | { success: false; error: string }
  >;
  completeShopSelection: (shopId: string) => void;
  cancelPendingShopLogin: () => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function effectiveShopIds(shops: string[] | undefined): ShopId[] {
  if (!shops?.length) return [];
  return shops.map((s) => String(s).trim()).filter((s): s is ShopId => SHOP_IDS.includes(s as ShopId));
}

function needsPostLoginShopPick(u: AuthUser | undefined): boolean {
  return effectiveShopIds(u?.shops).length > 1;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [pendingShopLogin, setPendingShopLogin] = useState<PendingShopLogin | null>(null);
  /** Block UI only when REST mode and a token might be valid (session restore). Firebase paints immediately. */
  const [isLoading, setIsLoading] = useState(
    () => !USE_FIRESTORE_ADMIN_DATA && hasStoredAuthToken()
  );

  const refreshUser = useCallback(async () => {
    const maxAttempts = 6;
    const delayMs = 400;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await authApi.me();
        setUser(response.user);
        setPendingShopLogin(null);
        return;
      } catch (err) {
        if (err instanceof HttpError && err.status === 401) {
          if (!USE_FIRESTORE_ADMIN_DATA) {
            setStoredToken('');
          }
          setUser(null);
          setPendingShopLogin(null);
          return;
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    setUser(null);
    setPendingShopLogin(null);
  }, []);

  useEffect(() => {
    if (USE_FIRESTORE_ADMIN_DATA) {
      setIsLoading(false);
      return observeFirebaseAuth(({ appUser }) => {
        setUser(appUser as AuthUser | null);
        setPendingShopLogin(null);
      });
    }
    if (!hasStoredAuthToken()) {
      setUser(null);
      setPendingShopLogin(null);
      setIsLoading(false);
      return;
    }
    void refreshUser().finally(() => setIsLoading(false));
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const response = await authApi.login(
        USE_FIRESTORE_ADMIN_DATA ? loginForFirebaseAuth(email) : normalizeLocalLogin(email),
        password
      );
      if (!USE_FIRESTORE_ADMIN_DATA && needsPostLoginShopPick(response.user)) {
        setPendingShopLogin({ token: response.token, user: response.user });
        return { success: true as const, needsShopSelection: true as const };
      }
      if (!USE_FIRESTORE_ADMIN_DATA && response.user?.shops?.length) {
        const allowed = effectiveShopIds(response.user.shops);
        const allowedSet = new Set(allowed);
        const current = getStoredActiveShopId();
        if (allowed.length && !allowedSet.has(current as ShopId)) {
          setStoredActiveShopId(allowed[0]!);
        }
      }
      setUser(response.user);
      if (!USE_FIRESTORE_ADMIN_DATA) {
        setStoredToken(response.token);
      }
      return { success: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      return {
        success: false as const,
        error: message,
      };
    }
  }, []);

  const completeShopSelection = useCallback((shopId: string) => {
    setPendingShopLogin((pending) => {
      if (!pending) return null;
      if (!SHOP_IDS.includes(shopId as ShopId)) return pending;
      if (!effectiveShopIds(pending.user.shops).includes(shopId as ShopId)) return pending;
      setStoredActiveShopId(shopId);
      setStoredToken(pending.token);
      setUser(pending.user);
      return null;
    });
  }, []);

  const cancelPendingShopLogin = useCallback(() => {
    setPendingShopLogin(null);
  }, []);

  const logout = useCallback(() => {
    setPendingShopLogin(null);
    authApi.logout();
    if (USE_FIRESTORE_ADMIN_DATA) {
      setUser(null);
      return;
    }
    void refreshUser();
  }, [refreshUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      pendingShopLogin,
      isAuthenticated: !!user,
      isLoading,
      login,
      completeShopSelection,
      cancelPendingShopLogin,
      logout,
      refreshUser,
    }),
    [user, pendingShopLogin, isLoading, login, completeShopSelection, cancelPendingShopLogin, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
