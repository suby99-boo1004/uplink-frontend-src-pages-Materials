// src/lib/api.ts
// 공통 API 클라이언트 (Bearer 토큰 + 쿠키 credentials 지원)
// - localStorage: uplink_access_token 사용
// - 모든 요청에 Authorization 자동 첨부
// - 401 발생 시 uplink:unauthorized 이벤트 발생

let _token: string | null = null;

function loadToken(): string | null {
  if (_token) return _token;
  try {
    const t = localStorage.getItem("uplink_access_token");
    _token = t && t.trim() ? t : null;
    return _token;
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  _token = token && token.trim() ? token : null;
  try {
    if (_token) localStorage.setItem("uplink_access_token", _token);
    else localStorage.removeItem("uplink_access_token");
  } catch {}
}

export type ApiOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
};

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = loadToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (!headers["Authorization"] && token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body,
    credentials: "include",
  });

  if (res.status === 401) {
    try {
      window.dispatchEvent(new CustomEvent("uplink:unauthorized"));
    } catch {}
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (!res.ok) {
    const msg = isJson ? JSON.stringify(await res.json()) : await res.text();
    throw new Error(msg || `HTTP ${res.status}`);
  }

  if (!isJson) return (await res.text()) as unknown as T;
  return (await res.json()) as T;
}
