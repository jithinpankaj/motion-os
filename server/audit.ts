import type { Request } from 'express';
import type { Db } from './db';

export async function audit(db: Db, req: Request, action: string, subjectType: string, subjectId: string, data: object = {}) {
  await db.query(
    `INSERT INTO audit_events (workspace_id, actor_id, action, subject_type, subject_id, data) VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.ws?.id ?? null, req.user?.id ?? null, action, subjectType, subjectId, JSON.stringify(data)],
  );
}

export async function usage(db: Db, req: Request, kind: string, subjectId: string | null, data: object = {}) {
  if (!req.ws) return;
  await db.query(`INSERT INTO usage_events (workspace_id, user_id, kind, subject_id, data) VALUES ($1, $2, $3, $4, $5)`, [req.ws.id, req.user?.id ?? null, kind, subjectId, JSON.stringify(data)]);
}
