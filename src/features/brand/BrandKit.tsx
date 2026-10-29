import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { apiResolver } from '../../lib/assets';
import { useBrandKit, invalidateBrand } from '../../lib/brand';
import { elementFromFile } from '../../lib/designImport';
import { useCan } from '../../lib/session';
import { ColorField } from '../../ui/color';
import { toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { ensureFont, SCENE_FONTS } from '../../engine/fonts';
import { BrandImport } from './BrandImport';
import { ElementMaker, useElements } from './Elements';
import { applyKitToTokens, AVAILABLE_FONTS, COLOR_ROLES, PERSONALITIES, type ColorRoleKey, type Personality } from '../../../shared/brandImport';
import { contrastRatio } from '../../../shared/util/color';

/** The brand kit: colours by role, fonts, logo, motion personality, voice and reusable elements. */
export default function BrandKit() {
  const { tokens, version, loaded, kit, brandId, reload } = useBrandKit();
  const can = useCan();
  const edit = can('brand.edit');
  const [sp, setSp] = useSearchParams();
  const [importing, setImporting] = useState(sp.get('import') === '1');
  const [making, setMaking] = useState(false);
  const elements = useElements();
  const [draft, setDraft] = useState<{ roles: Partial<Record<ColorRoleKey, string>>; display: string; body: string; personality: Personality; voice: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (loaded) setDraft({ roles: { ...kit.colors } as any, display: kit.displayFont, body: kit.bodyFont, personality: kit.personality, voice: kit.voice.join(', ') });
  }, [loaded, kit]);
  useEffect(() => {
    setLogoUrl(null);
    if (kit.logoAssetId) apiResolver().resolve(kit.logoAssetId).then((a) => setLogoUrl('url' in a ? a.url : null));
  }, [kit.logoAssetId]);

  // Scene fonts are registered on demand; load them so the samples render in the real typeface.
  useEffect(() => { SCENE_FONTS.forEach((f) => ensureFont(f.family)); }, []);

  const dirty = useMemo(() => !!draft && (
    COLOR_ROLES.some((r) => draft.roles[r.key] !== kit.colors[r.key]) || draft.display !== kit.displayFont || draft.body !== kit.bodyFont || draft.personality !== kit.personality || draft.voice !== kit.voice.join(', ')
  ), [draft, kit]);

  const persist = async (patch: { logoAssetId?: string | null } = {}, note = 'Edited brand kit') => {
    if (!draft || !brandId) return;
    setSaving(true);
    try {
      const next = applyKitToTokens(tokens as any, { roles: draft.roles, displayFont: draft.display, bodyFont: draft.body, personality: draft.personality, voice: draft.voice.split(',').map((s) => s.trim()).filter(Boolean), ...patch });
      await api(`/brands/${brandId}/tokens`, { method: 'PUT', body: { tokens: next, note } });
      invalidateBrand(); reload();
      toast('ok', 'Brand kit saved');
    } catch (e) { toast('danger', 'Could not save', errorMessage(e)); } finally { setSaving(false); }
  };
  const uploadLogo = async (f: File) => {
    try { const r = await elementFromFile(f, 'logo'); await persist({ logoAssetId: r.id }, 'New logo'); }
    catch (e) { toast('danger', 'Logo upload failed', errorMessage(e)); }
  };
  const uploadElements = async (files: FileList | null) => {
    if (!files?.length) return;
    try { for (const f of [...files].slice(0, 12)) await elementFromFile(f); elements.reload(); toast('ok', 'Elements added'); }
    catch (e) { toast('danger', 'Upload failed', errorMessage(e)); }
  };

  const night = draft?.roles['color.night'] ?? '#000000', paper = draft?.roles['color.paper'] ?? '#ffffff';
  const contrast = contrastRatio(night, paper);
  return (
    <div className="page-inner">
      <div className="row between wrap" style={{ alignItems: 'flex-end', gap: 16 }}>
        <div>
          <div className="eyebrow">Brand kit</div>
          <h1 className="h1" style={{ marginTop: 8 }}>Your brand, ready for motion</h1>
          <p className="lead">Every motion you create uses these colours, fonts, logo and personality automatically.</p>
        </div>
        <div className="row">
          {edit && dirty && <button className="btn primary lg" disabled={saving} onClick={() => persist()}>{saving ? <span className="spinner" /> : 'Save changes'}</button>}
          {edit && <button className={`btn lg ${dirty ? '' : 'primary'}`} onClick={() => setImporting(true)}><Icon name="download" />Import brand</button>}
        </div>
      </div>

      {loaded && version <= 1 && edit && (
        <div className="callout" style={{ marginTop: 22 }}>
          <Icon name="sparkles" />
          <div className="grow"><div style={{ fontWeight: 600 }}>Your kit still has the starter brand</div><div className="note">Import from your website, logo, guidelines PDF or colour codes — it takes about a minute.</div></div>
          <button className="btn primary" onClick={() => setImporting(true)}>Import brand</button>
        </div>
      )}

      {!draft ? <div className="kit" style={{ marginTop: 26 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 220 }} />)}</div> : (
        <div className="kit" style={{ marginTop: 26 }}>
          <section className="panel kit-card" style={{ gridColumn: '1 / -1' }}>
            <h3>Colours {contrast < 4.5 && <span className="badge warn">Text on background contrast {contrast.toFixed(1)}:1 — aim for 4.5:1</span>}</h3>
            <div className="roles" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
              {COLOR_ROLES.map((r) => (
                <div key={r.key} className="role">
                  <div className="chipc" style={{ background: draft.roles[r.key] ?? 'transparent', color: contrastRatio(draft.roles[r.key] ?? '#000000', '#ffffff') > 3 ? '#fff' : '#000' }}>{draft.roles[r.key] ?? '—'}</div>
                  {edit ? <ColorField label={r.label} value={draft.roles[r.key] ?? '#000000'} onChange={(v) => setDraft({ ...draft, roles: { ...draft.roles, [r.key]: v } })} swatches={kit.palette.map((c) => ({ label: c, value: c }))} />
                    : <span className="rl">{r.label}</span>}
                </div>
              ))}
            </div>
          </section>

          <section className="panel kit-card">
            <h3>Fonts</h3>
            {([['Headlines', 'display'], ['Body', 'body']] as const).map(([label, k]) => (
              <div key={k} className="col" style={{ gap: 6 }}>
                <div className="row between"><span className="label">{label}</span>
                  {edit ? <select className="input" style={{ width: 180 }} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} aria-label={`${label} font`}>{AVAILABLE_FONTS.map((f) => <option key={f}>{f}</option>)}</select> : <span className="muted">{draft[k]}</span>}
                </div>
                <div className="font-sample" style={{ fontFamily: draft[k], fontSize: k === 'display' ? 28 : 16, fontWeight: k === 'display' ? 650 : 400, color: k === 'body' ? 'var(--text-2)' : undefined }}>{k === 'display' ? 'Create once. Move everywhere.' : 'Body copy stays calm and readable in every format.'}</div>
              </div>
            ))}
            <span className="note">Brand fonts not listed here are matched to the closest available font when imported.</span>
          </section>

          <section className="panel kit-card">
            <h3>Logo {edit && <label className="btn sm"><Icon name="upload" />{logoUrl ? 'Replace' : 'Upload'}<input type="file" hidden accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} /></label>}</h3>
            <div className="logo-box">{logoUrl ? <img src={logoUrl} alt="Brand logo" /> : <span className="faint" style={{ fontSize: 12 }}>No logo yet</span>}</div>
            <span className="note">Transparent PNG or SVG works best. Used by “Show my logo” in Create.</span>
          </section>

          <section className="panel kit-card">
            <h3>Motion personality</h3>
            <div className="persona" role="radiogroup" aria-label="Motion personality">
              {PERSONALITIES.map((p) => <button key={p.key} role="radio" aria-checked={draft.personality === p.key} disabled={!edit} onClick={() => setDraft({ ...draft, personality: p.key })}><span className="pn">{p.label}</span><span className="pd">{p.description}</span></button>)}
            </div>
            <span className="note">Sets the default speed, bounce and energy of everything your team creates.</span>
          </section>

          <section className="panel kit-card">
            <h3>Voice</h3>
            <input className="input" value={draft.voice} disabled={!edit} onChange={(e) => setDraft({ ...draft, voice: e.target.value })} placeholder="clear, confident, warm" aria-label="Voice words" />
            <div className="row wrap" style={{ gap: 6 }}>{[...new Set(draft.voice.split(',').map((s) => s.trim()).filter(Boolean))].map((w) => <span key={w} className="badge">{w}</span>)}</div>
            <span className="note">A few words that describe how your brand sounds. Used to suggest headlines and the personality above.</span>
          </section>

          <section className="panel kit-card" style={{ gridColumn: '1 / -1' }}>
            <h3>Elements
              {can('asset.upload') && <span className="row" style={{ gap: 6 }}>
                <label className="btn sm"><Icon name="upload" />Upload<input type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={(e) => uploadElements(e.target.files)} /></label>
                <button className="btn sm" onClick={() => setMaking(true)}><Icon name="shapes" />Create a shape</button>
              </span>}
            </h3>
            {!elements.list ? <div className="skel" style={{ height: 90 }} /> : !elements.list.length
              ? <div className="note">Icons, stickers, badges and shapes you reuse. Add them to any motion from Create → Add an element.</div>
              : <div className="elements">{elements.list.map((e) => <div key={e.id} className="element" title={e.name}><img src={e.url} alt={e.name} /></div>)}</div>}
          </section>
        </div>
      )}

      <div className="row" style={{ marginTop: 22, gap: 16 }}>
        <Link to="/brand/advanced" className="faint" style={{ fontSize: 12.5 }}>Advanced: every token, easing, springs and version history →</Link>
      </div>

      {brandId && <BrandImport open={importing} onClose={() => { setImporting(false); if (sp.get('import')) setSp({}, { replace: true }); }} brandId={brandId} tokens={tokens as any} onSaved={() => { invalidateBrand(); reload(); }} />}
      <ElementMaker open={making} onClose={() => setMaking(false)} brand={kit} onCreated={() => elements.reload()} />
    </div>
  );
}
