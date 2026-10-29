import { useEffect, useMemo, useRef, useState } from 'react';
import type { SceneDocument } from '../../../shared/scene/schema';
import { applyOperations, type AssistantReply } from '../../../shared/motion/assistant';
import { api, errorMessage } from '../../lib/api';
import { Icon } from '../../ui/Icon';
import { commit, undo, useEditor } from './store';

/**
 * Ask Claude: describe what you want in your own words ("when someone clicks the star, make it
 * bounce") and Claude makes the change. Every change is one undoable step and is listed in plain
 * words; anything Claude asked for that doesn't fit the file is reported instead of half-applied.
 */
type Msg = { role: 'user' | 'assistant'; text: string; changes?: string[]; problems?: string[]; after?: SceneDocument | null; error?: boolean };

export function AssistantPanel({ doc, onClose }: { doc: SceneDocument; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ configured: boolean } | null>(null);
  const current = useEditor((s) => s.doc);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { api('/assistant/status').then(setStatus).catch(() => setStatus({ configured: false })); input.current?.focus(); }, []);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);

  const ideas = useMemo(() => suggestions(doc), [doc.layers.length, doc.machine.animations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || busy) return;
    const history = [...msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.text })), { role: 'user' as const, text: t }].slice(-12);
    setMsgs((m) => [...m, { role: 'user', text: t }]);
    setText('');
    setBusy(true);
    try {
      const reply = await api<AssistantReply>('/assistant', { body: { doc: useEditor.getState().doc, messages: history } });
      const before = useEditor.getState().doc!;
      const result = reply.operations.length ? applyOperations(before, reply.operations) : { doc: before, changes: [], problems: [] };
      let after: SceneDocument | null = null;
      if (result.changes.length) { commit(() => result.doc); after = useEditor.getState().doc; }
      setMsgs((m) => [...m, { role: 'assistant', text: reply.reply, changes: result.changes, problems: result.problems, after }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: errorMessage(e), error: true }]);
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <aside className="ask" aria-label="Ask Claude">
      <div className="ask-h">
        <span className="ask-badge"><Icon name="sparkles" size={14} /></span>
        <div className="col" style={{ gap: 0, flex: 1 }}><b>Ask Claude</b><span className="faint" style={{ fontSize: 11.5 }}>Describe what you want — it makes the change</span></div>
        <button className="icon-btn" aria-label="Close Ask Claude" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      <div className="ask-list" ref={list} aria-live="polite">
        {status && !status.configured && (
          <div className="ask-note">
            <b>Claude isn’t connected on this server yet.</b> Whoever runs it can add an API key: copy <span className="mono">.env.example</span> to <span className="mono">.env</span>, set <span className="mono">ANTHROPIC_API_KEY</span>, and restart. Everything else in the editor works without it.
          </div>
        )}
        {!msgs.length && (
          <div className="ask-empty">
            <div className="faint" style={{ fontSize: 12.5 }}>Try something like:</div>
            {ideas.map((s) => <button key={s} className="ask-idea" onClick={() => void send(s)} disabled={busy || status?.configured === false}>{s}</button>)}
            <div className="faint" style={{ fontSize: 11.5 }}>Claude only changes this file, and every change can be undone.</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`ask-msg ${m.role} ${m.error ? 'err' : ''}`}>
            <div className="ask-bubble">{m.text}</div>
            {!!m.changes?.length && (
              <div className="ask-changes">
                {m.changes.map((c, j) => <div key={j}><Icon name="check" size={11} />{c}</div>)}
                <button className="btn sm ghost" disabled={!m.after || current !== m.after} title={m.after && current !== m.after ? 'You’ve changed things since — use the editor’s Undo instead' : undefined} onClick={() => { undo(); setMsgs((all) => all.map((x, j) => (j === i ? { ...x, after: null, changes: x.changes!.map((c) => `Undone: ${c}`) } : x))); }}>
                  <Icon name="undo" size={11} />Undo this
                </button>
              </div>
            )}
            {!!m.problems?.length && <div className="ask-problems">{m.problems.map((p, j) => <div key={j}><Icon name="alert" size={11} />{p}</div>)}</div>}
          </div>
        ))}
        {busy && <div className="ask-msg assistant"><div className="ask-bubble typing"><span /><span /><span /></div></div>}
      </div>
      <form className="ask-input" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
        <textarea ref={input} rows={2} value={text} maxLength={2000} placeholder="e.g. When someone clicks the star, make it spin — but only if Coins is more than 0" aria-label="Message to Claude"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }} disabled={status?.configured === false} />
        <button className="btn primary" type="submit" disabled={busy || !text.trim() || status?.configured === false} aria-label="Send"><Icon name="send" size={14} /></button>
      </form>
    </aside>
  );
}

/** Starter ideas that use the file's own names, so the first try works. */
function suggestions(doc: SceneDocument): string[] {
  const shapes = doc.layers.filter((l) => l.type !== 'group' && !l.locked && l.name !== 'Touch area');
  const thing = doc.layers.find((l) => l.name === 'Touch area') ? 'the button' : shapes.at(-1)?.name ?? 'the shape';
  const move = (doc.machine.animations.find((a) => a.loop === 'once') ?? doc.machine.animations[0])?.name;
  return [
    `When someone clicks ${thing}, make it bounce and play a pop sound`,
    `When the pointer hovers over ${thing}, make it grow a little; shrink back when it leaves`,
    move ? `Add a Coins counter starting at 3. Clicking takes one coin and plays ${move} — only if there’s at least 1 coin` : 'Add a switch called Liked and flip it on every click',
  ];
}
