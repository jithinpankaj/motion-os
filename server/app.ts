import { assistantRoutes } from './routes/assistant';
import express, { Router } from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { AppContext } from './context';
import './context';
import { loadUser, requireWorkspace } from './auth';
import { errorHandler } from './http';
import { authRoutes } from './routes/auth';
import { workspaceRoutes } from './routes/workspace';
import { projectRoutes } from './routes/projects';
import { assetRoutes, fileRoutes } from './routes/assets';
import { exportRoutes } from './routes/exports';
import { importRoutes } from './routes/imports';
import { communityRoutes, publicCommunityRoutes } from './routes/community';

export function createApp(ctx: AppContext) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.ctx = ctx;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: '6mb' }));
  app.use(loadUser);
  app.use(fileRoutes());

  const api = Router();
  api.use(authRoutes());
  api.use(publicCommunityRoutes());
  const tenant = Router();
  tenant.use(requireWorkspace);
  for (const r of [workspaceRoutes, projectRoutes, assetRoutes, exportRoutes, importRoutes, communityRoutes, assistantRoutes]) tenant.use(r());
  api.use(tenant);
  app.use('/api', api);
  app.use('/api', (_req, res) => { res.status(404).json({ error: { code: 'not_found', message: 'Unknown API route' } }); });

  const dist = path.resolve('dist');
  if (ctx.isProd && existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('/*path', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
