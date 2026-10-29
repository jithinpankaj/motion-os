import { Router } from 'express';
import { z } from 'zod';
import { requirePerm } from '../auth';
import { badRequest, notFound, parse } from '../http';
import { audit } from '../audit';
import { ColorSchema, EasingSchema, GradientStopSchema } from '../../shared/scene/schema';
import { uid } from '../../shared/util/random';

const VALUE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  color: ColorSchema,
  typography: z.object({ family: z.string().min(1).max(80), weight: z.number().int().min(100).max(900), tracking: z.number().min(-0.2).max(1) }),
  duration: z.number().min(0).max(30),
  easing: EasingSchema,
  spring: z.object({ stiffness: z.number().min(1).max(2000), damping: z.number().min(0).max(200), mass: z.number().min(0.1).max(20) }),
  intensity: z.number().min(0).max(1),
  particles: z.number().int().min(0).max(200000),
  gradient: z.array(GradientStopSchema).min(2).max(6),
  behaviour: z.union([z.boolean(), z.string().max(80), z.number()]),
  accessibility: z.union([z.boolean(), z.string().max(80), z.number()]),
};
const TokenSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/, 'token keys look like color.primary'),
  category: z.enum(Object.keys(VALUE_SCHEMAS) as [string, ...string[]]),
  value: z.unknown(),
  description: z.string().max(200).default(''),
});

export function brandRoutes() {
  const r = Router();

  const loadBrand = async (req: any) => {
    const b = await req.ctx.db.one(`SELECT * FROM brands WHERE id = $1 AND workspace_id = $2`, [req.params.id, req.ws.id]);
    if (!b) throw notFound('Brand');
    return b;
  };

  r.get('/brands/:id/tokens', requirePerm('brand.view'), async (req, res) => {
    const b = await loadBrand(req);
    const tokens = await req.ctx.db.query(`SELECT key, category, value, description, updated_at FROM brand_tokens WHERE brand_id = $1 ORDER BY category, key`, [b.id]);
    const rules = await req.ctx.db.query(`SELECT id, kind, config, description FROM brand_rules WHERE brand_id = $1`, [b.id]);
    res.json({ brand: { id: b.id, name: b.name, version: b.token_version }, tokens, rules });
  });

  r.put('/brands/:id/tokens', requirePerm('brand.edit'), async (req, res) => {
    const body = parse(z.object({ tokens: z.array(TokenSchema).max(300), note: z.string().max(300).default('') }), req.body);
    const issues: { key: string; message: string }[] = [];
    const keys = new Set<string>();
    for (const t of body.tokens) {
      if (keys.has(t.key)) issues.push({ key: t.key, message: 'duplicate key' });
      keys.add(t.key);
      const v = VALUE_SCHEMAS[t.category].safeParse(t.value);
      if (!v.success) issues.push({ key: t.key, message: v.error.issues[0]?.message ?? 'invalid value' });
    }
    if (issues.length) throw badRequest('Some tokens are invalid', issues);
    const b = await loadBrand(req);
    const { db } = req.ctx;
    const version = b.token_version + 1;
    await db.tx(async (tx) => {
      await tx.query(`DELETE FROM brand_tokens WHERE brand_id = $1 AND NOT (key = ANY($2::text[]))`, [b.id, [...keys]]);
      for (const t of body.tokens) {
        await tx.query(
          `INSERT INTO brand_tokens (id, brand_id, workspace_id, key, category, value, description) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (brand_id, key) DO UPDATE SET category = EXCLUDED.category, value = EXCLUDED.value, description = EXCLUDED.description, updated_at = now()`,
          [uid('tok'), b.id, req.ws!.id, t.key, t.category, JSON.stringify(t.value), t.description],
        );
      }
      await tx.query(`UPDATE brands SET token_version = $2 WHERE id = $1`, [b.id, version]);
      await tx.query(`INSERT INTO token_versions (id, brand_id, workspace_id, version, snapshot, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [uid('tv'), b.id, req.ws!.id, version, JSON.stringify(body.tokens), body.note, req.user!.id]);
    });
    await audit(db, req, 'brand.tokens.update', 'brand', b.id, { version, note: body.note });
    res.json({ ok: true, version });
  });

  r.get('/brands/:id/versions', requirePerm('brand.view'), async (req, res) => {
    const b = await loadBrand(req);
    const rows = await req.ctx.db.query(`SELECT v.version, v.note, v.created_at, u.name AS author, jsonb_array_length(v.snapshot) AS count FROM token_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.brand_id = $1 ORDER BY v.version DESC`, [b.id]);
    res.json({ versions: rows });
  });

  r.post('/brands/:id/versions/:version/restore', requirePerm('brand.edit'), async (req, res) => {
    const b = await loadBrand(req);
    const { db } = req.ctx;
    const v = await db.one(`SELECT snapshot FROM token_versions WHERE brand_id = $1 AND version = $2`, [b.id, Number(req.params.version)]);
    if (!v) throw notFound('Token version');
    const version = b.token_version + 1;
    await db.tx(async (tx) => {
      await tx.query(`DELETE FROM brand_tokens WHERE brand_id = $1`, [b.id]);
      for (const t of v.snapshot) await tx.query(`INSERT INTO brand_tokens (id, brand_id, workspace_id, key, category, value, description) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [uid('tok'), b.id, req.ws!.id, t.key, t.category, JSON.stringify(t.value), t.description ?? '']);
      await tx.query(`UPDATE brands SET token_version = $2 WHERE id = $1`, [b.id, version]);
      await tx.query(`INSERT INTO token_versions (id, brand_id, workspace_id, version, snapshot, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [uid('tv'), b.id, req.ws!.id, version, JSON.stringify(v.snapshot), `Restored v${req.params.version}`, req.user!.id]);
    });
    await audit(db, req, 'version.restore', 'brand_tokens', b.id, { restored: Number(req.params.version), newVersion: version });
    res.json({ ok: true, version });
  });

  return r;
}
