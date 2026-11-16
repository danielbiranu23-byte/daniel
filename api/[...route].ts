import type { Request, Response } from 'express';
import { createApp } from '../server';

let appPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(req: Request, res: Response) {
  try {
    if (req.url && !req.url.startsWith('/api')) {
      req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
    }
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
