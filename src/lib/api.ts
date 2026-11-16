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

export function extractErrorMessage(
  err: unknown,
  fallback = 'Dogoggorri uumameera. Maaloo irra deebi’ii yaali.'
): string {
  if (typeof err === 'string') {
    const trimmed = err.trim();
    return trimmed && trimmed !== '[object Object]' ? trimmed : fallback;
  }
  if (err instanceof Error) {
    const msg = err.message?.trim();
    if (msg && msg !== '[object Object]') {
      return msg;
    }
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause) {
      return extractErrorMessage(cause, fallback);
    }
    return fallback;
  }
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if ('error' in obj && obj.error !== undefined && obj.error !== null) {
      const nested = extractErrorMessage(obj.error, '');
      if (nested) return nested;
    }
    if (typeof obj.message === 'string') {
      const msg = obj.message.trim();
      if (msg && msg !== '[object Object]') {
        return typeof obj.code === 'string' && obj.code.trim()
          ? `${msg} (${obj.code.trim()})`
          : msg;
      }
    }
    if (typeof obj.detail === 'string' && obj.detail.trim()) {
      return obj.detail.trim();
    }
    if (typeof obj.code === 'string' && obj.code.trim()) {
      return `Dogoggora serverii (${obj.code.trim()}). Maaloo irra deebi’ii yaali.`;
    }
  }
  return fallback;
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
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if ('error' in record && record.error !== undefined && record.error !== null) {
        record.error = extractErrorMessage(record.error);
      }
    }
    return parsed as T;
  } catch {
    throw new Error('Odeeffannoo dubbisuun hin danda’amne. Maaloo irra deebi’ii yaali.');
  }
}
