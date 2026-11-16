export function getAuthToken(): string {
  return localStorage.getItem('qajeelcha_auth_token') || '';
}

export function setAuthToken(token: string): void {
  if (token) {
    localStorage.setItem('qajeelcha_auth_token', token);
  } else {
    localStorage.removeItem('qajeelcha_auth_token');
  }
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAuthToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export async function safeJson<T = Record<string, any>>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<')) {
    throw new Error(
      !res.ok
        ? 'Qunnamtiin serverii yeroof hin milkoofne. Maaloo sekondii muraasa booda irra deebi’ii yaali.'
        : 'Serveriin API deebii JSON hin kennine. Maaloo page haaromsi (Refresh) ykn "Google Waliin Seeni" fayyadami.'
    );
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error('Odeeffannoo dubbisuun hin danda’amne. Maaloo irra deebi’ii yaali.');
  }
}
