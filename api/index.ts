import type { Request, Response } from 'express';
import { createApp } from '../server';

let appPromise: ReturnType<typeof createApp> | null = null;

function normalizeVercelApiUrl(req: Request): void {
  const rawUrl = req.url || '/api';
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    const vercelPath = parsed.searchParams.get('__vercel_path');
    if (vercelPath !== null) {
      parsed.searchParams.delete('__vercel_path');
      const cleanPath = vercelPath.replace(/^\/+/, '');
      const remainingSearch = parsed.searchParams.toString();
      req.url = `/api${cleanPath ? `/${cleanPath}` : ''}${remainingSearch ? `?${remainingSearch}` : ''}`;
      return;
    }
  } catch {
    // Fall back to simple prefix check below
  }
  if (!rawUrl.startsWith('/api')) {
    req.url = `/api${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
  }
}

export default async function handler(req: Request, res: Response) {
  try {
    normalizeVercelApiUrl(req);

    if (!appPromise) {
      appPromise = createApp().catch((err) => {
        appPromise = null;
        throw err;
      });
    }
    const app = await appPromise;
    return await new Promise<void>((resolve) => {
      res.on('finish', resolve);
      res.on('close', resolve);
      app(req, res, (err?: unknown) => {
        if (err && !res.headersSent) {
          const message =
            err instanceof Error && err.message && err.message !== '[object Object]'
              ? err.message
              : 'Dogoggorri serverii uumameera. Maaloo irra deebi’ii yaali.';
          res.status(500).json({ error: message });
        }
        resolve();
      });
    });
  } catch (err) {
    appPromise = null;
    if (!res.headersSent) {
      const message =
        err instanceof Error && err.message && err.message !== '[object Object]'
          ? err.message
          : typeof err === 'string' && err.trim()
            ? err
            : 'Serveriin API yeroof hojjechuu hin dandeenye. Maaloo irra deebi’ii yaali.';
      res.status(500).json({ error: message });
    }
  }
}
