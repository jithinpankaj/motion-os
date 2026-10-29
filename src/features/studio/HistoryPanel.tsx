import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { Icon } from '../../ui/Icon';
import { Modal, timeAgo, toast } from '../../ui/controls';
import { diffScenes, type Change } from '../../../shared/diff';
import { useStudio, save } from './store';
import { useCan } from '../../lib/session';

const short = (v: unknown) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > 28 ? s.slice(0, 26) + '…' : s; };

export function HistoryPanel({ projectId, onRestored }: { projectId: string; onRestored: () => void }) {
  const [versions, setVersions] = useState<any[]>([]);
  const [note, setNote] = useState('');
  const [pick, setPick] = useState<string[]>([]);
  const [diff, setDiff] = useState<{ a: any; b: any; changes: Change[] } | null>(null);
  const doc = useStudio((s) => s.doc)!;
  const can = useCan();
  const nav = useNavigate();
  const load = () => api(`/projects/${projectId}/versions`).then((r) => setVersions(r.versions)).catch(() => {});
  useEffect(() => { load(); }, [projectId]);

  const snapshot = async () => {
    await save(true);
    try { await api(`/projects/${projectId}/versions`, { body: { note } }); setNote(''); load(); toast('ok', 'Version saved'); } catch (e) { toast('danger', 'Could not save version', errorMessage(e)); }
  };
  const restore = async (v: any) => {
    if (!confirm(`Restore v${v.version}? Your current draft is saved as a new version first, so nothing is lost.`)) return;
    try { await save(true); await api(`/projects/${projectId}/versions/${v.id}/restore`, { method: 'POST' }); toast('ok', `Restored v${v.version}`); onRestored(); load(); } catch (e) { toast('danger', 'Restore failed', errorMessage(e)); }
  };
  const branch = async (v: any) => {
    const name = prompt('Name for the new branch project', `${doc.meta.name} — branch of v${v.version}`);
    if (!name) return;
    const r = await api(`/projects/${projectId}/versions/${v.id}/branch`, { body: { name } });
    toast('ok', 'Branch created'); nav(`/studio/${r.id}`);
  };
  const compare = async () => {
    const [x, y] = await Promise.all(pick.map((id) => id === 'draft' ? Promise.resolve({ version: { version: 'draft', doc } }) : api(`/projects/${projectId}/versions/${id}`)));
    const [a, b] = [x.version, y.version].sort((m: any, n: any) => (m.version === 'draft' ? 1 : n.version === 'draft' ? -1 : m.version - n.version));
    setDiff({ a, b, changes: diffScenes(a.doc, b.doc) });
  };
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));

  return (
    <div style={{ padding: 12 }} className="col">
      {can('scene.edit') && (
        <div className="row" style={{ gap: 6 }}>
          <input className="input sm" placeholder="Describe this version" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Version note" />
          <button className="btn sm primary" onClick={snapshot}>Save version</button>
        </div>
      )}
      <div className="row between"><span className="eyebrow">Versions</span><button className="btn sm" disabled={pick.length !== 2} onClick={compare}><Icon name="compare" size={12} />Compare {pick.length}/2</button></div>
      <label className="row surface" style={{ padding: '8px 10px', gap: 8 }}>
        <input type="checkbox" checked={pick.includes('draft')} onChange={() => toggle('draft')} aria-label="Select current draft for comparison" />
        <span className="grow"><b style={{ fontWeight: 560 }}>Current draft</b></span>
      </label>
      {versions.map((v) => (
        <div key={v.id} className="surface col" style={{ padding: '8px 10px', gap: 4 }}>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={pick.includes(v.id)} onChange={() => toggle(v.id)} aria-label={`Select v${v.version} for comparison`} />
            <span className="grow"><b style={{ fontWeight: 560 }}>v{v.version}</b> <span className="faint">{v.branch !== 'main' ? v.branch : ''}</span></span>
            <span className="faint mono" style={{ fontSize: 10.5 }}>{timeAgo(v.created_at)}</span>
          </label>
          <div className="muted" style={{ fontSize: 12, paddingLeft: 22 }}>{v.note || 'No description'} · {v.author}</div>
          {can('scene.edit') && <div className="row" style={{ gap: 4, paddingLeft: 18 }}><button className="btn sm ghost" onClick={() => restore(v)}><Icon name="history" size={12} />Restore</button><button className="btn sm ghost" onClick={() => branch(v)}><Icon name="branch" size={12} />Branch</button></div>}
        </div>
      ))}
      {!versions.length && <div className="faint">No saved versions yet. Versions are immutable snapshots — submitting for review creates one automatically.</div>}
      <Modal open={!!diff} onClose={() => setDiff(null)} title={`Compare v${diff?.a.version} → ${diff?.b.version === 'draft' ? 'draft' : 'v' + diff?.b.version}`} subtitle={`${diff?.changes.length ?? 0} changes`} wide>
        <div className="col" style={{ gap: 2 }}>
          {diff?.changes.map((c, i) => (
            <div key={i} className="row" style={{ gap: 10, padding: '5px 0', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}>
              <span className={`badge ${c.kind === 'added' ? 'ok' : c.kind === 'removed' ? 'danger' : 'info'}`}>{c.kind}</span>
              <b style={{ fontWeight: 560, minWidth: 120 }}>{c.scope}</b>
              <span className="mono grow">{c.path}</span>
              {c.kind === 'changed' && c.from !== undefined && <span className="mono faint">{short(c.from)} → {short(c.to)}</span>}
            </div>
          ))}
          {diff && !diff.changes.length && <div className="faint">These versions are identical.</div>}
        </div>
      </Modal>
    </div>
  );
}
