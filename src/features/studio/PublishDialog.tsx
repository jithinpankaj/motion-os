import { useEffect, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { useCan, useWorkspace } from '../../lib/session';
import { ApprovalIndicator, Field, Modal, StatusBadge, timeAgo, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { CHANNEL_FORMATS } from '../../../shared/formats';
import { paramIssues } from '../../../shared/params';
import { detectFlashing } from '../../../shared/compat';
import { useStudio, save } from './store';

const CATEGORIES = ['Gradient', 'Mesh', 'Particles', 'Typography', 'Product', 'General'];

/** Draft → Review → Approved → Published. Each published version is immutable. */
export function PublishDialog({ projectId, template, onClose, onChanged }: { projectId: string; template: any; onClose: () => void; onChanged: () => void }) {
  const doc = useStudio((s) => s.doc)!;
  const ws = useWorkspace();
  const can = useCan();
  const [form, setForm] = useState({ name: template?.name ?? doc.meta.name, description: template?.description ?? doc.meta.description, category: template?.category ?? doc.meta.category ?? 'General', channels: (template?.channels ?? []) as string[], visibleTeamIds: (template?.visible_team_ids ?? []) as string[], changelog: '' });
  const [approvals, setApprovals] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const versions: any[] = template?.versions ?? [];
  const latest = versions[0];
  const loadApprovals = () => api('/approvals').then((r) => setApprovals(r.approvals.filter((a: any) => a.template_id === template?.id))).catch(() => {});
  useEffect(() => { if (template) loadApprovals(); }, [template?.id]);

  const issues = [...(!doc.exposed.length ? ['Define at least one editable parameter (Inspect → link icon).'] : []), ...paramIssues(doc)];
  const flashing = detectFlashing(doc);
  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setError(null);
    try { await fn(); toast('ok', ok); onChanged(); await loadApprovals(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const submit = () => run(async () => { await save(true); await api(`/projects/${projectId}/submit`, { body: form }); }, 'Submitted for review');
  const pending = approvals.find((a) => a.subject_id === latest?.id && a.status === 'pending');
  const step = (s: string) => ({ draft: 0, review: 1, approved: 2, published: 3, rejected: 1, deprecated: 3 } as Record<string, number>)[s] ?? 0;
  const cur = latest ? step(latest.status) : 0;

  return (
    <Modal open onClose={onClose} title="Publish template" subtitle="Turn this scene into a governed, reusable template for other teams." wide
      footer={<><button className="btn ghost" onClick={onClose}>Close</button><button className="btn primary" disabled={busy || issues.length > 0 || !can('template.submit')} onClick={submit}>{busy ? <span className="spinner" /> : <><Icon name="send" size={13} />Submit {latest ? 'new version' : ''} for review</>}</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24 }}>
        <div className="col" style={{ gap: 12 }}>
          <Field label="Template name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Description"><textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <div className="pgrid2">
            <Field label="Category"><select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Change description"><input className="input" placeholder="What changed in this version?" value={form.changelog} onChange={(e) => setForm({ ...form, changelog: e.target.value })} /></Field>
          </div>
          <Field label="Recommended channels" hint="None selected = suitable for all channels">
            <div className="row wrap" style={{ gap: 5 }}>{CHANNEL_FORMATS.map((c) => <button key={c.id} className="chip" aria-pressed={form.channels.includes(c.id)} onClick={() => setForm({ ...form, channels: form.channels.includes(c.id) ? form.channels.filter((x) => x !== c.id) : [...form.channels, c.id] })}>{c.name}</button>)}</div>
          </Field>
          <Field label="Visible to teams" hint="None selected = every team in the workspace">
            <div className="row wrap" style={{ gap: 5 }}>{ws?.teams && <TeamChips value={form.visibleTeamIds} onChange={(v) => setForm({ ...form, visibleTeamIds: v })} />}</div>
          </Field>
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div className="surface" style={{ padding: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Readiness</div>
            <div className="row" style={{ gap: 6, color: issues.length ? 'var(--warn)' : 'var(--ok)' }}><Icon name={issues.length ? 'alert' : 'check'} size={14} />{doc.exposed.length} editable parameter{doc.exposed.length === 1 ? '' : 's'}, {doc.exposed.filter((p) => p.locked).length} locked</div>
            {issues.map((i) => <div key={i} className="field-error" style={{ marginTop: 4 }}>{i}</div>)}
            <div className="row" style={{ gap: 6, marginTop: 6, color: flashing.length ? 'var(--danger)' : 'var(--ok)' }}><Icon name={flashing.length ? 'alert' : 'check'} size={14} />{flashing.length ? 'Potential flashing detected' : 'No harmful flashing detected'}</div>
            {flashing.map((f) => <div key={f} className="field-error">{f}</div>)}
            <div className="row" style={{ gap: 6, marginTop: 6 }}><Icon name="check" size={14} />Static fallback at {doc.fallback.staticFrame}s · reduced motion: {doc.fallback.reducedMotion}</div>
          </div>
          {latest && (
            <div className="surface col" style={{ padding: 12, gap: 10 }}>
              <div className="row between"><span className="eyebrow">Latest version v{latest.version}</span><StatusBadge status={latest.status} /></div>
              <ApprovalIndicator steps={[{ label: 'draft', state: cur > 0 ? 'done' : 'current' }, { label: 'review', state: latest.status === 'rejected' ? 'blocked' : cur > 1 ? 'done' : cur === 1 ? 'current' : 'todo' }, { label: 'approved', state: cur > 2 ? 'done' : cur === 2 ? 'current' : 'todo' }, { label: 'published', state: cur === 3 ? 'done' : 'todo' }]} />
              {pending && (pending.canDecide ? (
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm" disabled={busy} onClick={() => run(() => api(`/approvals/${pending.id}/decide`, { body: { decision: 'rejected' } }), 'Rejected')}>Reject</button>
                  <button className="btn sm primary" disabled={busy} onClick={() => run(() => api(`/approvals/${pending.id}/decide`, { body: { decision: 'approved' } }), 'Approved')}><Icon name="check" size={12} />Approve v{latest.version}</button>
                </div>
              ) : <div className="faint" style={{ fontSize: 12 }}>Waiting for an approver{pending.requested_by_name ? ` (requested by ${pending.requested_by_name})` : ''}. Submitters cannot approve their own work.</div>)}
              {latest.status === 'approved' && (can('template.publish') ? <button className="btn sm primary" disabled={busy} onClick={() => run(() => api(`/templates/${template.id}/publish`, { body: { versionId: latest.id } }), `v${latest.version} published to the library`)}><Icon name="send" size={12} />Publish v{latest.version}</button> : <div className="faint">Approved — someone with publish permission can release it.</div>)}
              {template?.status === 'published' && can('template.deprecate') && <button className="btn sm ghost" onClick={() => run(() => api(`/templates/${template.id}/status`, { body: { status: 'deprecated' } }), 'Template deprecated')}>Deprecate template</button>}
            </div>
          )}
          {versions.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              <span className="eyebrow">Version history</span>
              {versions.map((v) => <div key={v.id} className="row" style={{ fontSize: 12 }}><span className="mono" style={{ width: 28 }}>v{v.version}</span><StatusBadge status={v.status} /><span className="grow ellipsis faint">{v.changelog}</span><span className="faint">{timeAgo(v.created_at)}</span></div>)}
              <div className="field-hint">Published outputs and campaigns stay pinned to the version they used.</div>
            </div>
          )}
          {error && <div className="field-error" role="alert">{error}</div>}
        </div>
      </div>
    </Modal>
  );
}

function TeamChips({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [teams, setTeams] = useState<any[]>([]);
  useEffect(() => { api('/workspace').then((r) => setTeams(r.teams)).catch(() => {}); }, []);
  return <>{teams.map((t) => <button key={t.id} className="chip" aria-pressed={value.includes(t.id)} onClick={() => onChange(value.includes(t.id) ? value.filter((x) => x !== t.id) : [...value, t.id])}>{t.name}</button>)}</>;
}
