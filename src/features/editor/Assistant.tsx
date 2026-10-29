import { useEffect, useMemo, useRef, useState } from 'react';
import type { SceneDocument } from '../../../shared/scene/schema';
import { applyOperations, type AssistantReply } from '../../../shared/motion/assistant';
import { previewDoc } from '../../../shared/motion/runtime';
import type { AssetResolver } from '../../engine/assets';
import { HubPreview } from '../../components/MotionCard';
import { api, errorMessage } from '../../lib/api';
import { Tip } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { commit, undo, useEditor } from './store';

/**
 * Ask Claude: describe what you want in your own words ("when someone clicks the star, make it
 * bounce") and Claude makes the change. Every change is one undoable step and is listed in plain
 * words; anything Claude asked for that doesn't fit the file is reported instead of half-applied.
 */
type Msg = { role: 'user' | 'assistant'; text: string; about?: string; changes?: string[]; problems?: string[]; after?: SceneDocument | null; error?: boolean };

export function AssistantPanel({ doc, assets, onClose }: { doc: SceneDocument; assets: AssetResolver; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [useSelection, setUseSelection] = useState(true);
  const [status, setStatus] = useState<{ configured: boolean } | null>(null);
  const current = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selection);
  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { api('/assistant/status').then(setStatus).catch(() => setStatus({ configured: false })); input.current?.focus(); }, []);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);
  useEffect(() => { const el = input.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 168)}px`; } }, [text]);

  const ideas = useMemo(() => suggestions(doc), [doc.layers.length, doc.machine.animations.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const offline = status?.configured === false;
  const lastChange = [...msgs].reverse().find((m) => m.after);

  const send = async (raw: string) => {
    const t = raw.trim();
    if (!t || busy) return;
    const about = useSelection && selected ? selected.name : undefined;
    // The selected layer travels with the message, so "make it bounce" means the thing you're pointing at.
    const asked = about ? `${t}\n\n(The selected layer is “${about}”.)` : t;
    const history = [...msgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: m.role === 'user' && m.about ? `${m.text}\n\n(The selected layer is “${m.about}”.)` : m.text })), { role: 'user' as const, text: asked }].slice(-12);
    setMsgs((m) => [...m, { role: 'user', text: t, about }]);
    setText('');
    setIdeasOpen(false);
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
  const undoChange = (i: number) => {
    undo();
    setMsgs((all) => all.map((x, j) => (j === i ? { ...x, after: null, changes: x.changes!.map((c) => `Undone: ${c}`) } : x)));
  };
  const pickIdea = (s: string) => { setText(s); setIdeasOpen(false); requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(s.length, s.length); }); };

  return (
    <aside className={`ask${busy ? ' is-busy' : ''}`} aria-label="Ask Claude" aria-busy={busy}>
      <div className="ai-inner">
        <div className="ask-h">
          <span className="ai-orb" aria-hidden />
          <div className="col" style={{ gap: 0, flex: 1, minWidth: 0 }}><b>Ask Claude</b><span className="ai-sub">{busy ? 'Working on it…' : 'Describe it. Claude makes the change'}</span></div>
          <Tip label="Close"><button className="icon-btn" aria-label="Close Ask Claude" onClick={onClose}><Icon name="x" size={14} /></button></Tip>
        </div>

        <div className="ask-list" ref={list} aria-live="polite">
          {offline && (
            <div className="ask-note">
              <b>Claude isn’t connected on this server yet.</b> Whoever runs it can add an API key: copy <span className="code">.env.example</span> to <span className="code">.env</span>, set <span className="code">ANTHROPIC_API_KEY</span>, and restart. Everything else in the editor works without it.
            </div>
          )}
          {!msgs.length && (
            <div className="ask-empty">
              <div className="ai-hello">What should happen?</div>
              <div className="ai-sub">Try one of these. They use this file’s own names.</div>
              {ideas.map((s) => <button key={s} className="ask-idea" onClick={() => pickIdea(s)} disabled={busy || offline}><Icon name="sparkles" size={13} /><span>{s}</span></button>)}
              <div className="ai-sub" style={{ marginTop: 4 }}>Claude only changes this file, and every change can be undone.</div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`ask-msg ${m.role} ${m.error ? 'err' : ''}`}>
              {m.role === 'user' && m.about && <span className="ai-about"><Icon name="crosshair" size={11} />{m.about}</span>}
              <div className="ask-bubble">{m.text}</div>
              {!!m.changes?.length && (
                <div className="ask-changes">
                  {m.after && m === lastChange && current === m.after && (
                    <div className="ai-preview" style={{ aspectRatio: `${m.after.canvas.width} / ${m.after.canvas.height}`, width: `min(100%, ${Math.round(168 * m.after.canvas.width / m.after.canvas.height)}px)` }}>
                      <ResultPreview doc={m.after} assets={assets} />
                      <span className="ai-preview-tag">Result</span>
                    </div>
                  )}
                  {m.changes.map((c, j) => <div key={j} className="ai-change"><Icon name="check" size={11} />{c}</div>)}
                  <button className="btn sm ghost" disabled={!m.after || current !== m.after} title={m.after && current !== m.after ? 'You’ve changed things since. Use the editor’s Undo instead' : undefined} onClick={() => undoChange(i)}>
                    <Icon name="undo" size={11} />Undo this
                  </button>
                </div>
              )}
              {!!m.problems?.length && <div className="ask-problems">{m.problems.map((p, j) => <div key={j}><Icon name="alert" size={11} />{p}</div>)}</div>}
            </div>
          ))}
          {busy && <div className="ask-msg assistant"><div className="ask-bubble typing" aria-label="Claude is working"><span /><span /><span /></div></div>}
        </div>

        {ideasOpen && msgs.length > 0 && (
          <div className="ai-ideas" role="list" aria-label="Ideas">
            {ideas.map((s) => <button key={s} role="listitem" className="ask-idea" onClick={() => pickIdea(s)}><Icon name="sparkles" size={13} /><span>{s}</span></button>)}
          </div>
        )}

        <form className="ai-composer" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <textarea ref={input} className="ai-input" rows={2} value={text} maxLength={2000} placeholder="Describe what should happen" aria-label="Message to Claude"
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }} disabled={offline} />
          <div className="ai-tray">
            <Tip label="New conversation" side="top">
              <button type="button" className="ai-key square" aria-label="New conversation" disabled={!msgs.length || busy} onClick={() => { setMsgs([]); setIdeasOpen(false); input.current?.focus(); }}><Icon name="plus" size={15} /></button>
            </Tip>
            {msgs.length > 0 && <button type="button" className="ai-key" aria-pressed={ideasOpen} disabled={offline} onClick={() => setIdeasOpen((v) => !v)}><Icon name="sparkles" size={14} />Ideas</button>}
            {selected && (
              <Tip label={useSelection ? 'Claude will know you mean this layer' : 'Not telling Claude about the selection'} side="top">
                <button type="button" className="ai-key" aria-pressed={useSelection} onClick={() => setUseSelection((v) => !v)}>
                  <Icon name="crosshair" size={14} /><span className="ellipsis" style={{ maxWidth: 110 }}>{selected.name}</span>
                </button>
              </Tip>
            )}
            {!msgs.length && !selected && <span className="ai-hint">Enter to send · Shift+Enter for a new line</span>}
            <span className="grow" />
            <button className="ai-send" type="submit" disabled={busy || !text.trim() || offline} aria-label="Send">
              {busy ? <span className="spinner" /> : <Icon name="send" size={15} />}
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}

/** A live look at the file after Claude's change — the artwork as it is, in its own colours. */
function ResultPreview({ doc, assets }: { doc: SceneDocument; assets: AssetResolver }) {
  const [hot, setHot] = useState(false);
  const view = useMemo(() => previewDoc(doc), [doc]);
  return <div style={{ position: 'absolute', inset: 0 }} onPointerEnter={() => setHot(true)} onPointerLeave={() => setHot(false)}><HubPreview doc={view} assets={assets} active={hot} label="Result of Claude’s change" style={{ width: '100%', height: '100%', display: 'block' }} /></div>;
}

/** Starter ideas that use the file's own names, so the first try works. */
function suggestions(doc: SceneDocument): string[] {
  const shapes = doc.layers.filter((l) => l.type !== 'group' && !l.locked && l.name !== 'Touch area');
  const thing = doc.layers.find((l) => l.name === 'Touch area') ? 'the button' : shapes.at(-1)?.name ?? 'the shape';
  const move = (doc.machine.animations.find((a) => a.loop === 'once') ?? doc.machine.animations[0])?.name;
  return [
    `When someone clicks ${thing}, make it bounce and play a pop sound`,
    `When the pointer hovers over ${thing}, make it grow a little; shrink back when it leaves`,
    move ? `Add a Coins counter starting at 3. Clicking takes one coin and plays ${move}, but only if there’s at least 1 coin` : 'Add a switch called Liked and flip it on every click',
  ];
}
