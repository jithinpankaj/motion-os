import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { openDb } from './db';
import { localStorage } from './storage';
import { createApp } from './app';
import { ensureGlobals } from './services/workspace';
import { seedDemo } from './seed';
import { ensurePresetPosts } from './routes/community';

// Local settings (like ANTHROPIC_API_KEY for “Ask Claude”) live in .env, which is never committed.
if (existsSync('.env')) process.loadEnvFile('.env');
const dataDir = path.resolve(process.env.DATA_DIR ?? '.data');
mkdirSync(dataDir, { recursive: true });
const secretFile = path.join(dataDir, 'secret');
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const secret = process.env.APP_SECRET ?? readFileSync(secretFile, 'utf8').trim();
const isProd = process.env.NODE_ENV === 'production';

const db = await openDb(path.join(dataDir, 'pg'));
const storage = localStorage(path.join(dataDir, 'objects'), secret);
await ensureGlobals(db);
await ensurePresetPosts(db);
if (!isProd || process.env.SEED_DEMO === '1') await seedDemo(db, storage);

const port = Number(process.env.PORT ?? 8787);
const server = createApp({ db, storage, secret, isProd }).listen(port, () => console.log(`[motion-os] api listening on http://localhost:${port}`));
const shutdown = async () => { server.close(); await db.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
