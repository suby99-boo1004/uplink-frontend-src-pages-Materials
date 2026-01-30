import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, setToken } from "./api";

export type User = {
  id: number;
  email: string;
  name: string;
  role_id: number;
  role_code?: string | null;
  department_id?: number | null;
  status: string;
};

type AuthState = {
  loading: boolean;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  async function refreshMe() {
    try {
      const me = await api<User>("/api/auth/me", { method: "GET" });
      setUser(me);
    } catch {
      setUser(null);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshMe();
  }, []);

  useEffect(() => {
    // api.ts에서 401을 감지하면 'uplink:unauthorized' 이벤트를 발생시킵니다.
    // 여기서 토큰/유저 상태를 정리하여 로그인 화면으로 자연스럽게 유도합니다.
    const onUnauthorized = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener("uplink:unauthorized", onUnauthorized as any);
    return () => window.removeEventListener("uplink:unauthorized", onUnauthorized as any);
  }, []);

  async function login(email: string, password: string) {
    setLoading(true);
    try {
      const res = await api<{ access_token: string; token_type: string; user: any }>(
        "/api/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }) }
      );
      setToken(res.access_token);
      await refreshMe();
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  const value = useMemo(() => ({ loading, user, login, logout }), [loading, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("AuthProvider가 필요합니다.");
  return ctx;
}
