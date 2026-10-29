import type { Db } from './db';
import type { Storage } from './storage';

export type AppContext = { db: Db; storage: Storage; secret: string; isProd: boolean };

declare global {
  namespace Express {
    interface Request {
      ctx: AppContext;
      user?: { id: string; email: string; name: string; sessionId: string };
      ws?: { id: string; perms: Set<string>; roles: string[]; teams: string[]; membershipId: string };
    }
  }
}
