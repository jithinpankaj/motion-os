import { useEffect, useMemo, useState } from 'react';
import type { Action, BuiltinSound } from '../../../../shared/scene/schema';
import { BUILTIN_SOUNDS } from '../../../../shared/scene/schema';
import { toast } from '../../../ui/controls';
import { api } from '../../../lib/api';
import { apiResolver } from '../../../lib/assets';
import { SOUND_LABELS, playSound } from '../../../lib/sound';
import { Icon } from '../../../ui/Icon';

/** Choose a built-in sound or one of your uploaded sounds, hear it, and set how loud it is. */
export function SoundPicker({ a, onChange }: { a: Extract<Action, { type: 'sound' }>; onChange: (a: Action) => void }) {
  const [mine, setMine] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const resolver = useMemo(() => apiResolver(), []);
  const load = () => api('/assets', { query: { kind: 'audio' } }).then((r) => setMine(r.assets.map((x: any) => ({ id: x.id, name: x.name })))).catch(() => {});
  useEffect(() => { void load(); }, []);
  const upload = async (f: File) => {
    setBusy(true);
    try {
      const r = await api<{ id: string }>('/assets', { raw: f, query: { name: f.name.replace(/\.[^.]+$/, '').slice(0, 160) || 'Sound', kind: 'audio', category: 'sound' } });
      await load();
      onChange({ ...a, sound: null, assetId: r.id });
    } catch (e) { toast('danger', 'Couldn’t add that sound', e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const value = a.assetId ? `asset:${a.assetId}` : a.sound ?? '';
  return <>
    <select value={value} onChange={(e) => { const v = e.target.value; if (v === 'upload') return; onChange(v.startsWith('asset:') ? { ...a, sound: null, assetId: v.slice(6) } : { ...a, sound: v as BuiltinSound, assetId: null }); }} aria-label="Sound">
      <optgroup label="Built-in">{BUILTIN_SOUNDS.map((k) => <option key={k} value={k}>{SOUND_LABELS[k]}</option>)}</optgroup>
      {(mine.length > 0 || a.assetId) && <optgroup label="Your sounds">{mine.map((m) => <option key={m.id} value={`asset:${m.id}`}>{m.name}</option>)}{a.assetId && !mine.some((m) => m.id === a.assetId) && <option value={`asset:${a.assetId}`}>Uploaded sound</option>}</optgroup>}
    </select>
    <button className="icon-btn sm" title="Hear it" aria-label="Hear this sound" onClick={() => playSound({ builtin: a.sound, assetId: a.assetId, volume: a.volume }, resolver, { force: true })}><Icon name="sound" size={12} /></button>
    <label className="row faint" style={{ gap: 4, fontSize: 11.5 }} title="Volume">
      <input type="range" min={0} max={1} step={0.05} value={a.volume} onChange={(e) => onChange({ ...a, volume: Number(e.target.value) })} aria-label="Volume" style={{ width: 64 }} />
    </label>
    <label className="btn sm ghost" style={{ cursor: busy ? 'wait' : 'pointer' }} title="Upload an MP3, WAV or OGG file">
      <Icon name="upload" size={11} />{busy ? 'Adding…' : 'Upload'}
      <input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,.mp3,.wav,.ogg" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
    </label>
  </>;
}
