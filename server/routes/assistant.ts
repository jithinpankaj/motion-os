import { Router } from 'express';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { requirePerm, requireUser } from '../auth';
import { HttpError, parse, rateLimit } from '../http';
import { deserializeScene } from '../../shared/scene/serialize';
import { ASSISTANT_SYSTEM, AssistantReplySchema, describeFileForAssistant, type AssistantReply } from '../../shared/motion/assistant';

/**
 * "Ask Claude" — the editor's chat helper. The browser sends the current file and the conversation;
 * the server asks Claude (the API key never leaves the server) for a short reply plus a list of
 * edit operations in a fixed schema. The browser applies and checks those operations itself, as one
 * undoable change. Nothing Claude returns is ever run as code.
 */
const MODEL = 'claude-opus-5-5';
const limit = rateLimit({ name: 'assistant', windowMs: 60_000, max: 12, key: (r) => r.user?.id ?? r.ip ?? 'x' });

/** Is a Claude credential available to the SDK (env var, auth token, or an `ant auth login` profile)? */
export function assistantConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || existsSync(path.join(homedir(), '.config', 'anthropic')));
}

type Asker = (system: string, messages: Anthropic.Beta.BetaMessageParam[]) => Promise<{ reply: AssistantReply | null; refused: boolean }>;
let client: Anthropic | null = null;
const askClaude: Asker = async (system, messages) => {
  client ??= new Anthropic();
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    // If a safety classifier declines, the API retries on a fallback model inside the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(AssistantReplySchema) },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  if (response.stop_reason === 'refusal') return { reply: null, refused: true };
  return { reply: response.parsed_output ?? null, refused: false };
};
let asker: Asker = askClaude;
/** Tests replace the call to Claude with a canned answer. */
export function setAssistantAskerForTests(fn: Asker | null) { asker = fn ?? askClaude; }

export function assistantRoutes() {
  const r = Router();
  r.get('/assistant/status', requireUser, (_req, res) => { res.json({ configured: assistantConfigured(), model: MODEL }); });

  r.post('/assistant', requirePerm('scene.edit'), limit, async (req, res) => {
    const body = parse(z.object({
      doc: z.unknown(),
      messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(2000) })).min(1).max(20),
    }), req.body);
    if (body.messages.at(-1)!.role !== 'user') throw new HttpError(400, 'bad_request', 'The last message must be from you');
    if (asker === askClaude && !assistantConfigured()) {
      throw new HttpError(503, 'assistant_not_configured', 'Claude isn’t connected on this server yet. Add ANTHROPIC_API_KEY to the .env file and restart the server.');
    }
    const doc = deserializeScene(body.doc);
    // Earlier turns as plain text; the latest request carries the current file, so Claude always sees it as it is now.
    const history: Anthropic.Beta.BetaMessageParam[] = body.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.text }));
    const last = body.messages.at(-1)!.text;
    const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: 'user', content: `The file right now:\n${describeFileForAssistant(doc)}\n\nWhat I’d like: ${last}` }];
    try {
      const { reply, refused } = await asker(ASSISTANT_SYSTEM, messages);
      if (refused) { res.json({ reply: 'Sorry — I can’t help with that one. Try describing the animation or interaction you want.', operations: [] }); return; }
      if (!reply) throw new HttpError(502, 'assistant_unreadable', 'Claude’s answer couldn’t be read. Please try again.');
      res.json(reply);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new HttpError(503, 'assistant_not_configured', 'The Claude API key on this server was rejected. Check ANTHROPIC_API_KEY in .env.');
      if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'assistant_busy', 'Claude is busy right now — try again in a moment.');
      if (e instanceof Anthropic.APIConnectionError) throw new HttpError(502, 'assistant_unreachable', 'Couldn’t reach Claude. Check the server’s internet connection.');
      if (e instanceof Anthropic.APIError) throw new HttpError(502, 'assistant_error', `Claude returned an error (${e.status ?? 'unknown'}). Please try again.`);
      throw e;
    }
  });
  return r;
}
