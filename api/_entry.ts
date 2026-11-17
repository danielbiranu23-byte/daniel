import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Request, Response } from 'express';
import { createApp, flushDbSync } from '../server.js';

let appPromise: ReturnType<typeof createApp> | null = null;

function normalizeVercelApiUrl(req: IncomingMessage): void {
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

function sendJsonError(res: ServerResponse, statusCode: number, message: string): void {
  if (res.headersSent || res.writableEnded) return;
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: message }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    normalizeVercelApiUrl(req);

    if (!appPromise) {
      appPromise = createApp().catch((err) => {
        appPromise = null;
        throw err;
      });
    }
    const app = await appPromise;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      res.once('finish', done);
      res.once('close', done);
      app(req as Request, res as Response, (err?: unknown) => {
        if (err) {
          const message =
            err instanceof Error && err.message && err.message !== '[object Object]'
              ? err.message
              : 'Dogoggorri serverii uumameera. Maaloo irra deebi’ii yaali.';
          sendJsonError(res, 500, message);
        }
        done();
      });
    });
    await flushDbSync();
  } catch (err) {
    appPromise = null;
    const message =
      err instanceof Error && err.message && err.message !== '[object Object]'
        ? err.message
        : typeof err === 'string' && err.trim()
          ? err
          : 'Serveriin API yeroof hojjechuu hin dandeenye. Maaloo irra deebi’ii yaali.';
    sendJsonError(res, 500, message);
  }
}
