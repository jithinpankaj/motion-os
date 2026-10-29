import { useEffect, useReducer } from 'react';
import type { SceneDocument } from '../../shared/scene/schema';
import type { MotionRuntime } from '../../shared/motion/runtime';
import { Slider, Switch } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { useSound } from '../lib/sound';

/** Live controls for a running motion: toggles, buttons and sliders, plus what just happened. */
export function ControlWidgets({ doc, runtime, onReset, showLog = true }: { doc: SceneDocument; runtime: MotionRuntime | null; onReset?: () => void; showLog?: boolean }) {
  const [, force] = useReducer((x) => x + 1, 0);
  const muted = useSound((s) => s.muted), toggleMute = useSound((s) => s.toggle);
  useEffect(() => (runtime ? runtime.on(() => force()) : undefined), [runtime]);
  if (!runtime) return null;
  const inputs = doc.machine.inputs;
  const pointerRules = doc.machine.rules.filter((r) => r.when.type === 'pointer');
  const hasSound = doc.machine.rules.some((r) => r.do.some((a) => a.type === 'sound'));
  return (
    <div className="widgets">
      {!inputs.length && <div className="empty-hint">{pointerRules.length ? 'This motion has no controls — interact with it directly on the canvas.' : 'No controls yet. Add toggles, buttons or sliders in Interact.'}</div>}
      {inputs.map((i) => (
        <div key={i.id} className="widget">
          <span className="wn">{i.name}<span className="wt">{i.type === 'boolean' ? 'Toggle' : i.type === 'trigger' ? 'Button' : i.follow ? `${i.dragLayer ? 'Follows while you drag' : 'Follows the pointer'} ${i.follow === 'pointerX' ? 'left ↔ right' : 'up ↕ down'}` : `Slider · ${i.min ?? 0}–${i.max ?? 100}`}</span></span>
          {i.type === 'boolean' && <Switch checked={!!runtime.values[i.id]} onChange={(v) => runtime.setBoolean(i.id, v)} label={i.name} />}
          {i.type === 'trigger' && <button className="fire" onClick={() => runtime.fire(i.id)}>Press</button>}
          {i.type === 'number' && i.follow && <span className="badge"><Icon name={i.dragLayer ? 'drag' : 'crosshair'} size={11} /> {i.dragLayer ? 'drag on the canvas' : 'move your pointer'}</span>}
          {i.type === 'number' && !i.follow && (
            <div style={{ width: 150 }} className="row">
              <Slider value={Number(runtime.values[i.id] ?? 0)} min={i.min ?? 0} max={i.max ?? 100} step={(i.max ?? 100) - (i.min ?? 0) <= 2 ? 0.01 : 1} onChange={(v) => runtime.setNumber(i.id, v)} label={i.name} />
              <span className="mono faint" style={{ fontSize: 11, width: 34, textAlign: 'right' }}>{+Number(runtime.values[i.id] ?? 0).toFixed(2)}</span>
            </div>
          )}
        </div>
      ))}
      {pointerRules.length > 0 && <div className="empty-hint"><Icon name="crosshair" size={12} /> You can also click and hover things on the canvas.</div>}
      <div className="row between">
        {onReset && <button className="btn sm" onClick={onReset}><Icon name="restart" size={13} />Start over</button>}
        {hasSound && <button className="btn sm ghost" aria-pressed={!muted} onClick={toggleMute} title={muted ? 'Sounds are off' : 'Sounds are on'}><Icon name={muted ? 'mute' : 'sound'} size={13} />{muted ? 'Sound off' : 'Sound on'}</button>}
      </div>
      {showLog && runtime.log.length > 0 && (
        <div>
          <div className="sec-h" style={{ marginBottom: 4 }}>What just happened</div>
          <div className="log" aria-live="polite">{runtime.log.slice(-8).map((e, i) => <div key={i}>{e.text}</div>)}</div>
        </div>
      )}
    </div>
  );
}
