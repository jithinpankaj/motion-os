import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const forbidden = (message = 'You do not have permission to do that') => new HttpError(403, 'forbidden', message);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const conflict = (message: string, details?: unknown) => new HttpError(409, 'conflict', message, details);

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('Validation failed', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'too_large', message: 'Upload exceeds the size limit' } });
    return;
  }
  if (err?.name === 'SceneValidationError') {
    res.status(400).json({ error: { code: 'invalid_scene', message: err.message, details: err.issues } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side. Your work has not been discarded.' } });
}

/** Fixed-window rate limiter (in-memory; swap for Redis in multi-instance deployments). */
export function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string; name: string }) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const k = `${opts.name}:${opts.key(req)}`;
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.reset < now) hits.set(k, (h = { n: 0, reset: now + opts.windowMs }));
    h.n++;
    if (h.n > opts.max) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' } });
      return;
    }
    next();
  };
}
