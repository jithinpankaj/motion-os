import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { mountMotion, type MotionHandle } from '../../embed/runtime';
import { Icon } from '../../ui/Icon';
import { EmptyState, Segmented, Switch } from '../../ui/controls';

/** A working local integration: a mock product page embedding a version-pinned motion config. */
export default function EmbedExample() {
  const [sp] = useSearchParams();
  const [config, setConfig] = useState<any>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'system' | 'reduce' | 'full'>('system');
  const [noWebgl, setNoWebgl] = useState(false);
  const [info, setInfo] = useState<MotionHandle | null>(null);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = sp.get('template');
    if (!t) return;
    api(`/templates/${t}/delivery`, { query: { version: sp.get('version') } }).then((d) => { setConfig(d.config); setText(JSON.stringify(d.config, null, 2)); }).catch((e) => setError(errorMessage(e)));
  }, [sp]);
  useEffect(() => {
    if (!config || !host.current) return;
    let h: MotionHandle | null = null;
    try {
      h = mountMotion(host.current, config, { reducedMotion: mode === 'system' ? undefined : mode === 'reduce', forceFallback: noWebgl, assets: apiResolver({ type: 'template_version', id: config.template.versionId }) });
      setInfo(h); setError(null);
    } catch (e: any) { setError(e.message); }
    return () => h?.destroy();
  }, [config, mode, noWebgl]);
  const loadPasted = () => { try { setConfig(JSON.parse(text)); } catch { setError('Configuration is not valid JSON'); } };

  return (
    <div className="page-inner">
      <div className="row between wrap" style={{ alignItems: 'flex-end' }}>
        <div><div className="eyebrow">Developer delivery · local example</div><h1 className="h1" style={{ marginTop: 8 }}>Embed runtime</h1><p className="muted" style={{ margin: '6px 0 0', maxWidth: 560 }}>A mock product page mounting a version-pinned config with <span className="mono">mountMotion()</span>. Scene JSON is validated before rendering; reduced-motion and no-WebGL viewers get fallbacks.</p></div>
        <Link className="btn" to="/explore"><Icon name="explore" size={14} />Pick another template</Link>
      </div>
      {!config && !sp.get('template') && <EmptyState icon="code" title="Paste a configuration">Copy one from a template's Developer tab in the playground, then paste it below.</EmptyState>}
      {error && <div className="field-error" role="alert" style={{ marginTop: 14 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 24, marginTop: 24 }}>
        <div className="panel" style={{ overflow: 'hidden' }}>
          <div className="row" style={{ height: 44, padding: '0 16px', borderBottom: '1px solid var(--line)', gap: 18 }}><b>Acme</b><span className="faint">Product</span><span className="faint">Pricing</span><span className="grow" /><span className="btn sm">Sign up</span></div>
          <div ref={host} style={{ position: 'relative', aspectRatio: '16 / 9', background: '#000' }} />
          <div style={{ padding: 24 }} className="col"><div className="h2">Your product, in motion.</div><div className="muted">The hero above is the embedded Motion OS template{config ? ` “${config.template.name}” v${config.template.version}` : ''}.</div></div>
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div className="surface col" style={{ padding: 14, gap: 10 }}>
            <span className="eyebrow">Simulate viewer</span>
            <Segmented label="Motion preference" value={mode} onChange={setMode} options={[{ value: 'system', label: 'System' }, { value: 'reduce', label: 'Prefers reduced' }, { value: 'full', label: 'Full' }]} />
            <label className="row between"><span>Device without WebGL</span><Switch label="Simulate no WebGL" checked={noWebgl} onChange={setNoWebgl} /></label>
            {info && <div className="row" style={{ gap: 6 }}><span className={`badge ${info.mode === 'webgl' ? 'ok' : 'warn'}`}>{info.mode}</span>{info.warnings.map((w) => <span key={w} className="badge warn">{w}</span>)}</div>}
          </div>
          <div className="col" style={{ gap: 6 }}>
            <span className="eyebrow">Configuration</span>
            <textarea className="textarea mono" style={{ fontSize: 10.5, minHeight: 260 }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Embed configuration JSON" />
            <button className="btn" onClick={loadPasted}>Mount pasted configuration</button>
          </div>
        </div>
      </div>
    </div>
  );
}
