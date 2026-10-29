import { useEffect, useReducer } from 'react';
import type { SceneDocument } from '../../../../shared/scene/schema';
import { VAR_LABEL, describeCondition, fmtValue, type CondTrace } from '../../../../shared/motion/logic';
import type { MotionRuntime, RuleTrace } from '../../../../shared/motion/runtime';
import { Icon } from '../../../ui/Icon';
import { selectRule, setMode } from '../store';
import { ValueInput } from './Actions';

/**
 * The live debugger in Try it: the current state and transition, the latest events, which
 * interactions ran (and, in plain words, why the others didn't), the steps running now, and every
 * variable — which you can override while testing.
 */
const OUTCOME: Record<RuleTrace['outcome'], { label: string; tone: 'ok' | 'bad' | 'wait' | 'mute' }> = {
  ran: { label: 'Ran', tone: 'ok' }, conditions: { label: 'Didn’t run', tone: 'bad' }, wrongState: { label: 'Not from this state', tone: 'mute' },
  disabled: { label: 'Switched off', tone: 'mute' }, outranked: { label: 'Outranked', tone: 'mute' }, blocked: { label: 'Held back by a more important one', tone: 'bad' },
  waiting: { label: 'Waiting for its turn', tone: 'wait' }, queued: { label: 'Waiting in line', tone: 'wait' }, ignored: { label: 'Ignored — it was still running', tone: 'mute' },
};

export function Debugger({ doc, runtime }: { doc: SceneDocument; runtime: MotionRuntime }) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => runtime.on(() => force()), [runtime]);
  // Progress bars and running steps change between events, so refresh a few times a second.
  useEffect(() => { const id = setInterval(force, 150); return () => clearInterval(id); }, []);
  const st = doc.machine.states?.find((s) => s.id === runtime.state);
  const tr = runtime.transitionInfo();
  const entries = runtime.trace.slice(-4).reverse();
  const jobs = runtime.debugJobs().filter((j) => !j.done || j.steps.length).slice(-3).reverse();
  return (
    <div className="dbg">
      <div className="sec">
        <div className="sec-h">What’s happening</div>
        {doc.machine.states?.length ? (
          <div className="dbg-state">
            <span className="faint">It’s</span><b>{st?.name ?? '—'}</b>
            {tr && tr.progress < 1 && <span className="dbg-tr"><span className="faint">{tr.from} → {tr.to}</span><span className="bar"><span style={{ width: `${tr.progress * 100}%` }} /></span></span>}
          </div>
        ) : null}
        {!entries.length && <div className="empty-hint">Hover, click or press keys on the canvas — each thing you do shows up here with what it set off.</div>}
        {entries.map((e) => {
          const shown = e.rules.filter((r) => r.outcome === 'ran' || r.outcome === 'conditions' || r.outcome === 'blocked' || r.outcome === 'queued' || r.outcome === 'waiting' || r.outcome === 'ignored');
          const skipped = e.rules.length - shown.length;
          return (
            <div key={e.id} className="dbg-ev">
              <div className="dbg-ev-h"><b>{e.event.label}</b><span className="faint mono">{e.t.toFixed(1)}s</span></div>
              {shown.map((r) => (
                <div key={r.ruleId} className={`dbg-line ${OUTCOME[r.outcome].tone}`}>
                  <span className="dbg-mark">{r.outcome === 'ran' ? '✓' : OUTCOME[r.outcome].tone === 'wait' ? '…' : '✗'}</span>
                  <span>
                    <button className="link-btn" onClick={() => { setMode('interact'); selectRule(r.ruleId); }} title="Open this interaction">{r.label}</button>
                    {r.outcome === 'ran' ? ' ran.' : r.outcome === 'conditions' ? ' didn’t run — ' : ` — ${OUTCOME[r.outcome].label.toLowerCase()}.`}
                    {r.outcome !== 'ran' && r.why?.length ? <span className="dbg-why"> {r.why.join(' ')}</span> : null}
                    {r.conditions && r.conditions.cond.type === 'group' && r.conditions.cond.items.length > 0 && (
                      <details className="dbg-checks"><summary>Show the checks</summary><TraceTree t={r.conditions} doc={doc} /></details>
                    )}
                  </span>
                </div>
              ))}
              {skipped > 0 && <div className="faint" style={{ fontSize: 11 }}>{skipped} other interaction{skipped === 1 ? '' : 's'} didn’t apply here (another state, switched off, or another one won).</div>}
            </div>
          );
        })}
      </div>

      <div className="sec">
        <div className="sec-h">Right now</div>
        {!jobs.length && <div className="empty-hint">The steps of an interaction show here as they run: done ✓, playing ▶, or waiting.</div>}
        {jobs.map((j) => (
          <div key={j.id} className="dbg-job">
            <div className="faint" style={{ fontSize: 11.5 }}>{j.label}{j.done ? ' · finished' : ''}</div>
            {j.steps.map((s, i) => (
              <div key={i} className={`dbg-step ${s.status}`}>
                <span>{s.text}</span>
                <span className="dbg-st">{s.status === 'done' ? '✓' : s.status === 'running' ? '▶' : 'Waiting'}</span>
              </div>
            ))}
            {!j.done && j.pending.map((p, i) => <div key={`p${i}`} className="dbg-step pending"><span>{p}</span><span className="dbg-st">Next</span></div>)}
          </div>
        ))}
      </div>

      <div className="sec">
        <div className="sec-h">Switches & values <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 450 }}>try changing them</span></div>
        {!doc.machine.inputs.length && <div className="empty-hint">This file has no switches or values.</div>}
        {doc.machine.inputs.map((i) => (
          <div key={i.id} className="dbg-var rule">
            <span className="grow"><b>{i.name}</b> <span className="faint">{VAR_LABEL[i.type]}</span></span>
            {i.type === 'trigger'
              ? <button className="btn sm" onClick={() => runtime.fire(i.id)}>Press</button>
              : <><span className="mono faint" style={{ minWidth: 48, textAlign: 'right' }}>{fmtValue(runtime.values[i.id], i)}</span><ValueInput type={i.type} options={i.options} min={i.min} max={i.max} value={runtime.values[i.id] ?? i.default} onChange={(v) => runtime.setVar(i.id, v)} /></>}
          </div>
        ))}
        <div className="empty-hint">Changes here are just for testing — <b>Start over</b> puts everything back.</div>
      </div>
    </div>
  );
}

function TraceTree({ t, doc, depth = 0 }: { t: CondTrace; doc: SceneDocument; depth?: number }) {
  if (t.cond.type !== 'group') return <div className={`dbg-c ${t.pass ? 'ok' : 'bad'}`} style={{ paddingLeft: depth * 12 }}><span>{describeCondition(t.cond, doc)}</span><span>{t.pass ? '✓' : '✗'}</span></div>;
  return (
    <div>
      {depth > 0 && <div className={`dbg-c group ${t.pass ? 'ok' : 'bad'}`} style={{ paddingLeft: (depth - 1) * 12 }}><span>{t.cond.op === 'all' ? 'All of' : t.cond.op === 'any' ? 'Any of' : 'None of'}</span><span>{t.pass ? '✓' : '✗'}</span></div>}
      {t.children?.map((c, i) => <TraceTree key={i} t={c} doc={doc} depth={depth + 1} />)}
    </div>
  );
}
