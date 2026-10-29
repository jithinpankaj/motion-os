import { useEffect, useMemo, useState } from 'react';
import type { SceneDocument } from '../../../shared/scene/schema';
import { MOVES, type MoveKey } from '../../../shared/motion/moves';
import type { AssetResolver } from '../../engine/assets';
import type { MotionPlayerHandle } from '../../components/MotionPlayer';
import { toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { Stage } from './Stage';
import { finishDrawing } from './Draw';
import { setLayout, useLayout } from './layout';
import { addRule, applyMove, deleteAnimation, redo, setMode, undo, useEditor } from './store';

/**
 * The editor on iPad and phones: a drawing app. The artboard fills the screen and is ready to draw
 * on straight away, with the floating draw toolbar. "Animate" gives each drawn part a one-tap move
 * that plays when the file opens; Preview plays it. Interactions (tap, hover, conditions) and the
 * full panels are set up on a computer.
 */
const TOUCH_MOVES: MoveKey[] = ['drawOn', 'pop', 'fadeIn', 'float', 'wiggle', 'bounce', 'spin', 'pulse', 'slideUp', 'shake'];

export function TouchEditor({ doc, assets, playerRef, onRuntimeChange, saveLabel, saveState, readOnly, onBack, onExport, onShare }: {
  doc: SceneDocument; assets: AssetResolver; playerRef: React.Ref<MotionPlayerHandle>; onRuntimeChange: () => void;
  saveLabel: string; saveState: string; readOnly: boolean; onBack: () => void; onExport?: () => void; onShare?: () => void;
}) {
  const mode = useEditor((s) => s.mode);
  const canUndo = useEditor((s) => s.past.length > 0), canRedo = useEditor((s) => s.future.length > 0);
  const { drawing, moveSheet } = useLayout();
  const previewing = mode === 'try';

  // The artboard is always ready to draw on, except while previewing or picking a move.
  useEffect(() => {
    if (readOnly) return;
    if (mode !== 'design' && mode !== 'try') setMode('design');
    if (!previewing && !moveSheet && !drawing) setLayout({ drawing: true, drawLayer: null });
  }, [mode, previewing, moveSheet, drawing, readOnly]);

  return (
    <div className="ted">
      <header className="ted-top">
        <button className="icon-btn" aria-label="Back to files" onClick={onBack}><Icon name="chevronLeft" /></button>
        <div className="ted-title">
          <b className="ellipsis">{doc.meta.name}</b>
          <span><i className={`dot ${saveState === 'saved' ? '' : saveState === 'error' || saveState === 'conflict' ? 'bad' : 'busy'}`} />{saveLabel}</span>
        </div>
        <div className="grow" />
        {!previewing && <>
          <button className="icon-btn" aria-label="Undo" disabled={!canUndo} onClick={undo}><Icon name="undo" /></button>
          <button className="icon-btn" aria-label="Redo" disabled={!canRedo} onClick={redo}><Icon name="redo" /></button>
        </>}
        <button className={`btn preview-btn${previewing ? ' on' : ''}`} aria-pressed={previewing} aria-label={previewing ? 'Stop preview' : 'Preview'}
          onClick={() => { if (previewing) setMode('design'); else { finishDrawing(); setMode('try'); } }}>
          <Icon name={previewing ? 'x' : 'play'} size={13} />{previewing ? 'Done' : 'Preview'}
        </button>
        {onShare && <button className="icon-btn" aria-label="Share" onClick={onShare}><Icon name="globe" /></button>}
        {onExport && <button className="icon-btn" aria-label="Export" onClick={onExport}><Icon name="download" /></button>}
      </header>
      <div className="ted-stage">
        <Stage doc={doc} assets={assets} playerRef={playerRef} onRuntimeChange={onRuntimeChange} />
      </div>
      {moveSheet && !previewing && <MoveSheet doc={doc} onClose={() => setLayout({ moveSheet: false })} />}
    </div>
  );
}

/** Pick a drawn part, tap a move. Each move plays when the file opens. */
function MoveSheet({ doc, onClose }: { doc: SceneDocument; onClose: () => void }) {
  const parts = useMemo(() => [...doc.layers].reverse().filter((l) => l.type !== 'group' && l.visible && !l.locked && l.name !== 'Touch area'), [doc.layers]);
  const [target, setTarget] = useState<string | null>(() => useEditor.getState().selection ?? parts[0]?.id ?? null);
  const layer = doc.layers.find((l) => l.id === target) ?? null;
  const onIt = doc.machine.animations.filter((a) => a.tracks.some((t) => t.layerId === target));
  const moves = MOVES.filter((m) => TOUCH_MOVES.includes(m.key) && (!m.only || (layer && m.only.includes(layer.type))));

  const add = (key: MoveKey) => {
    if (!layer) return;
    const def = MOVES.find((m) => m.key === key)!;
    applyMove(key, layer.id, { into: 'new', name: def.name });
    const anim = useEditor.getState().activeAnim;
    if (anim) addRule({ when: { type: 'start' }, only: [], do: [{ type: 'play', animationId: anim, direction: 'forward', from: 'start' }] });
    toast('ok', `${def.name} added to ${layer.name}`, 'It plays when the file opens. Press Preview to watch.');
  };

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="sheet metal-graphite" role="dialog" aria-label="Animate">
        <div className="sheet-grip" aria-hidden />
        <div className="sheet-h"><b>Animate</b><button className="cb-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={14} /></button></div>
        {!parts.length && <p className="sheet-note">Draw something first. Each part you draw separately (with New part) can move on its own.</p>}
        {parts.length > 0 && <>
          <div className="sheet-label">Which part?</div>
          <div className="sheet-parts">{parts.map((l) => <button key={l.id} className="sheet-chip" aria-pressed={l.id === target} onClick={() => setTarget(l.id)}><Icon name={l.type === 'drawing' ? 'drawing' : 'shapes'} size={13} />{l.name}</button>)}</div>
          <div className="sheet-label">Tap a move</div>
          <div className="sheet-moves">{moves.map((m) => <button key={m.key} className="sheet-move" disabled={!layer} onClick={() => add(m.key)}><Icon name={m.icon} size={18} /><b>{m.name}</b><span>{m.hint}</span></button>)}</div>
          {onIt.length > 0 && <>
            <div className="sheet-label">On this part</div>
            <div className="sheet-parts">{onIt.map((a) => <span key={a.id} className="sheet-chip on">{a.name.split(' · ').pop()}<button aria-label={`Remove ${a.name}`} onClick={() => deleteAnimation(a.id)}><Icon name="x" size={11} /></button></span>)}</div>
          </>}
          <p className="sheet-note">Taps, hovers and other interactions are set up on a computer.</p>
        </>}
      </section>
    </div>
  );
}
