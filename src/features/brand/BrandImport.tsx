import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { elementFromFile, readPdfForBrand, samplePixels, svgToAsset } from '../../lib/designImport';
import { Modal, Tabs, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { ensureFont, SCENE_FONTS } from '../../engine/fonts';
import {
  applyKitToTokens, closestFont, colorsInText, COLOR_ROLES, fontsInCss, fontsInDocument, inferTone, mergePalette, paletteFromPixels,
  PERSONALITIES, suggestRoles, AVAILABLE_FONTS, isMonoFont, type BrandFindings, type ColorRoleKey, type Personality,
} from '../../../shared/brandImport';
import type { BrandToken } from '../../../shared/brand';

type Source = 'website' | 'image' | 'pdf' | 'codes';

/**
 * Import brand colours, fonts, logo and tone from a website, a logo/image, a guidelines PDF or
 * pasted codes. Nothing is saved until the person reviews the findings and confirms.
 */
export function BrandImport({ open, onClose, brandId, tokens, onSaved }: { open: boolean; onClose: () => void; brandId: string; tokens: BrandToken[]; onSaved: () => void }) {
  const [source, setSource] = useState<Source>('website');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<BrandFindings | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [codes, setCodes] = useState('');

  const reset = () => { setFindings(null); setError(null); setBusy(null); setImageFile(null); };
  const close = () => { reset(); onClose(); };

  const fromWebsite = async () => {
    setError(null); setBusy('Reading your website…');
    try { setFindings((await api('/brand-import/website', { body: { url } })).findings); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };
  const fromImage = async (file: File) => {
    setError(null); setBusy('Finding colours…');
    try {
      const colors = paletteFromPixels(await samplePixels(file), 'image', 8);
      const tone = inferTone('', colors);
      setImageFile(file);
      setFindings({ source: 'image', name: file.name.replace(/\.[^.]+$/, ''), colors, fonts: [], voice: [], personality: tone.personality, personalityReason: tone.reason, notes: ['Fonts and tone can’t be read from an image. Pick them below, or import your website or guidelines too.'] });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const fromPdf = async (file: File) => {
    setError(null); setBusy('Opening guidelines…');
    try {
      const { text, pixels } = await readPdfForBrand(file, setBusy);
      const written = colorsInText(text, 'guidelines', 5);
      const notes: string[] = [];
      let colors = mergePalette(written, 10);
      if (colors.length < 3) {
        const fromPages = pixels.flatMap((px) => paletteFromPixels(px, 'page artwork', 6));
        colors = mergePalette([...written, ...fromPages], 10);
        notes.push(written.length ? 'Few colour codes were written in the document, so colours from the page artwork were added.' : 'No colour codes were found in the text, so colours come from the page artwork.');
      }
      if (!text.trim()) notes.push('This PDF has no selectable text (it may be scanned), so fonts and tone could not be read.');
      const tone = inferTone(text, colors);
      setFindings({ source: 'pdf', name: file.name.replace(/\.[^.]+$/, ''), colors, fonts: fontsInDocument(text), voice: tone.voice, personality: tone.personality, personalityReason: tone.reason, notes });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const fromCodes = () => {
    const colors = mergePalette(colorsInText(codes, 'pasted', 1), 10);
    if (!colors.length) { setError('No colour codes found. Paste values like #1a73e8, rgb(26,115,232) or RGB 26 115 232.'); return; }
    const fonts = [...new Set([...fontsInDocument(codes), ...fontsInCss(codes)])];
    const tone = inferTone(codes, colors);
    setError(null);
    setFindings({ source: 'codes', colors, fonts, voice: tone.voice, personality: tone.personality, personalityReason: tone.reason, notes: [] });
  };

  return (
    <Modal open={open} onClose={close} title={findings ? 'Review your brand' : 'Import your brand'} wide
      subtitle={findings ? 'Choose what to keep. Nothing changes until you save.' : 'Bring in your colours, fonts, logo and tone from what you already have.'}>
      {findings ? <Review findings={findings} imageFile={imageFile} tokens={tokens} brandId={brandId} onBack={reset} onSaved={() => { onSaved(); close(); }} /> : (
        <div className="col" style={{ gap: 16 }}>
          <Tabs value={source} onChange={(v) => { setSource(v); setError(null); }} label="Import from" tabs={[
            { value: 'website', label: <span className="row" style={{ gap: 6 }}><Icon name="globe" size={13} />Website</span> },
            { value: 'image', label: <span className="row" style={{ gap: 6 }}><Icon name="image" size={13} />Logo or image</span> },
            { value: 'pdf', label: <span className="row" style={{ gap: 6 }}><Icon name="file" size={13} />Guidelines PDF</span> },
            { value: 'codes', label: <span className="row" style={{ gap: 6 }}><Icon name="code" size={13} />Paste codes</span> },
          ]} />
          {source === 'website' && (
            <div className="col" style={{ gap: 10 }}>
              <p className="note" style={{ margin: 0 }}>We read your homepage’s colours, fonts, logo and description. Works best with your main marketing site.</p>
              <div className="row"><input className="input grow" placeholder="yourbrand.com" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && fromWebsite()} aria-label="Website address" /><button className="btn primary" disabled={!url.trim() || !!busy} onClick={fromWebsite}>Import</button></div>
            </div>
          )}
          {source === 'image' && (
            <label className="drop" style={{ minHeight: 180 }}>
              <Icon name="image" size={22} /><div className="big" style={{ fontSize: 15 }}>Upload your logo or a key visual</div><div className="faint" style={{ fontSize: 12 }}>PNG, JPG, WebP or SVG — we extract its palette</div>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" onChange={(e) => e.target.files?.[0] && fromImage(e.target.files[0])} aria-label="Upload logo or image" />
            </label>
          )}
          {source === 'pdf' && (
            <label className="drop" style={{ minHeight: 180 }}>
              <Icon name="file" size={22} /><div className="big" style={{ fontSize: 15 }}>Upload your brand guidelines</div><div className="faint" style={{ fontSize: 12 }}>We look for HEX, RGB and CMYK codes and font names, and sample the page artwork</div>
              <input type="file" accept="application/pdf,.pdf" onChange={(e) => e.target.files?.[0] && fromPdf(e.target.files[0])} aria-label="Upload guidelines PDF" />
            </label>
          )}
          {source === 'codes' && (
            <div className="col" style={{ gap: 10 }}>
              <textarea className="input" rows={6} style={{ height: 'auto', padding: 10, fontFamily: 'var(--mono)', fontSize: 12 }} placeholder={'#0B1F3A  #FF5A36  #F5F1EA\nrgb(22, 163, 160)\nHeadline font: Space Grotesk'} value={codes} onChange={(e) => setCodes(e.target.value)} aria-label="Colour codes" />
              <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!codes.trim()} onClick={fromCodes}>Use these</button>
            </div>
          )}
          {busy && <div className="row"><span className="spinner" /><span className="muted">{busy}</span></div>}
          {error && <div className="field-error" role="alert">{error}</div>}
        </div>
      )}
    </Modal>
  );
}

function Review({ findings, imageFile, tokens, brandId, onBack, onSaved }: { findings: BrandFindings; imageFile: File | null; tokens: BrandToken[]; brandId: string; onBack: () => void; onSaved: () => void }) {
  const [keep, setKeep] = useState(() => new Set(findings.colors.slice(0, 8).map((c) => c.hex)));
  const kept = findings.colors.filter((c) => keep.has(c.hex));
  const [roles, setRoles] = useState<Partial<Record<ColorRoleKey, string>>>(() => suggestRoles(findings.colors.slice(0, 8)));
  const fonts = findings.fonts;
  const nonMono = fonts.filter((f) => !isMonoFont(f));
  const [display, setDisplay] = useState(nonMono[0] ?? fonts[0] ?? '');
  const [body, setBody] = useState(nonMono[1] ?? nonMono[0] ?? '');
  const svgs = findings.logoSvgs ?? [];
  const [logo, setLogo] = useState<string | 'none' | 'image'>(svgs.length ? 'svg:0' : findings.logoUrl ?? (imageFile ? 'image' : 'none'));
  const [personality, setPersonality] = useState<Personality>(findings.personality);
  const [voice, setVoice] = useState(findings.voice.join(', '));
  const [saving, setSaving] = useState(false);
  const toggle = (hex: string) => setKeep((s) => { const n = new Set(s); n.has(hex) ? n.delete(hex) : n.add(hex); return n; });
  const resolveFont = (f: string) => (f ? closestFont(f) : null);
  useEffect(() => { SCENE_FONTS.forEach((f) => ensureFont(f.family)); }, []);
  const choices = useMemo(() => [...new Set([...fonts, ...AVAILABLE_FONTS])], [fonts]);

  const save = async () => {
    setSaving(true);
    try {
      let logoAssetId: string | null | undefined;
      if (logo === 'image' && imageFile) logoAssetId = (await elementFromFile(imageFile, 'logo')).id;
      else if (logo.startsWith('svg:')) logoAssetId = (await svgToAsset(svgs[Number(logo.slice(4))], `${findings.name ?? 'Brand'} logo`, 1024, 'logo')).id;
      else if (logo !== 'none' && logo !== 'image' && !logo.startsWith('svg:')) {
        // Remote logos are fetched by the server (private addresses blocked), then rasterised for scenes.
        const r = await api('/brand-import/remote-asset', { body: { url: logo, name: `${findings.name ?? 'Brand'} logo`, kind: 'logo' } });
        logoAssetId = r.id;
        if (r.mime === 'image/svg+xml') {
          const a = await api(`/assets/${r.id}`);
          const text = await (await fetch(a.asset.url)).text();
          logoAssetId = (await svgToAsset(text, `${findings.name ?? 'Brand'} logo`, 1024, 'logo')).id;
        }
      }
      const next = applyKitToTokens(tokens, {
        roles: Object.fromEntries(Object.entries(roles).filter(([, v]) => v && keep.has(v))) as any,
        displayFont: display ? resolveFont(display)!.family : undefined,
        bodyFont: body ? resolveFont(body)!.family : undefined,
        logoAssetId, personality,
        voice: voice.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6),
      });
      const label = findings.source === 'website' ? `website${findings.name ? ` (${findings.name})` : ''}` : findings.source === 'pdf' ? `guidelines “${findings.name}”` : findings.source === 'image' ? `image “${findings.name}”` : 'pasted codes';
      await api(`/brands/${brandId}/tokens`, { method: 'PUT', body: { tokens: next, note: `Imported from ${label}` } });
      toast('ok', 'Brand kit updated', 'New motion uses these colours, fonts and personality.');
      onSaved();
    } catch (e) { toast('danger', 'Could not save', errorMessage(e)); } finally { setSaving(false); }
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      {findings.notes.map((n, i) => <div key={i} className="note warn">{n}</div>)}
      <div className="found">
        <div className="col" style={{ gap: 14 }}>
          <div className="col" style={{ gap: 8 }}>
            <span className="label">Colours found <span className="faint">· tap to include or skip</span></span>
            {findings.colors.length ? <div className="swatches">{findings.colors.map((c) => <button key={c.hex} className={`swatch ${keep.has(c.hex) ? '' : 'off'}`} aria-pressed={keep.has(c.hex)} title={`${c.hex} · ${c.name ?? c.source}`} aria-label={`${keep.has(c.hex) ? 'Skip' : 'Include'} ${c.hex}`} style={{ background: c.hex }} onClick={() => toggle(c.hex)} />)}</div> : <div className="note">No colours found.</div>}
          </div>
          <div className="col" style={{ gap: 8 }}>
            <span className="label">Assign roles</span>
            {COLOR_ROLES.map((r) => (
              <div key={r.key} className="found-row">
                <span className="label">{r.label}</span>
                <div className="role-pick" role="radiogroup" aria-label={r.label}>
                  {kept.map((c) => <button key={c.hex} role="radio" aria-checked={roles[r.key] === c.hex} aria-pressed={roles[r.key] === c.hex} aria-label={`${r.label}: ${c.hex}`} style={{ background: c.hex }} onClick={() => setRoles((x) => ({ ...x, [r.key]: c.hex }))} />)}
                  <button className="chip" style={{ height: 24, padding: '0 8px', width: 'auto', fontSize: 11 }} aria-pressed={!roles[r.key] || !keep.has(roles[r.key]!)} onClick={() => setRoles((x) => ({ ...x, [r.key]: undefined }))}>keep current</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="col" style={{ gap: 14 }}>
          <div className="col" style={{ gap: 8 }}>
            <span className="label">Fonts {fonts.length ? <span className="faint">· found {fonts.join(', ')}</span> : <span className="faint">· none found, choose below</span>}</span>
            {([['Headlines', display, setDisplay], ['Body', body, setBody]] as const).map(([label, v, set]) => {
              const m = resolveFont(v);
              return (
                <div key={label} className="found-row">
                  <span className="label">{label}</span>
                  <div className="col" style={{ gap: 4 }}>
                    <select className="input" value={v} onChange={(e) => set(e.target.value)} aria-label={`${label} font`}>
                      <option value="">Keep current</option>
                      {choices.map((f) => <option key={f} value={f}>{f}{AVAILABLE_FONTS.includes(f) ? '' : ' (from your brand)'}</option>)}
                    </select>
                    {m && !m.exact && <span className="note">{v} isn’t installed here yet, so motion uses <b style={{ fontFamily: m.family }}>{m.family}</b>, the closest match.</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="col" style={{ gap: 8 }}>
            <span className="label">Logo</span>
            <div className="row wrap" style={{ gap: 8 }}>
              {svgs.map((svg, i) => <LogoChoice key={`svg${i}`} selected={logo === `svg:${i}`} onClick={() => setLogo(`svg:${i}`)} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} label="Logo from page" />)}
              {imageFile && <LogoChoice selected={logo === 'image'} onClick={() => setLogo('image')} src={URL.createObjectURL(imageFile)} label="This image" />}
              {(findings.logoCandidates ?? []).slice(0, 5).map((u) => <LogoChoice key={u} selected={logo === u} onClick={() => setLogo(u)} src={u} label={new URL(u).pathname.split('/').pop() ?? 'logo'} />)}
              <button className="chip" aria-pressed={logo === 'none'} onClick={() => setLogo('none')}>Don’t change</button>
            </div>
          </div>
          <div className="col" style={{ gap: 8 }}>
            <span className="label">Motion personality <span className="faint">· suggested: {PERSONALITIES.find((p) => p.key === findings.personality)?.label}</span></span>
            <div className="note">{findings.personalityReason}</div>
            <div className="persona" role="radiogroup" aria-label="Motion personality">
              {PERSONALITIES.map((p) => <button key={p.key} role="radio" aria-checked={personality === p.key} onClick={() => setPersonality(p.key)}><span className="pn">{p.label}</span><span className="pd">{p.description}</span></button>)}
            </div>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <span className="label">Voice words <span className="faint">· comma separated</span></span>
            <input className="input" value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="clear, confident, warm" aria-label="Voice words" />
            {findings.description && <div className="note">“{findings.description.slice(0, 180)}{findings.description.length > 180 ? '…' : ''}”</div>}
          </div>
        </div>
      </div>
      <div className="row between" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
        <button className="btn ghost" onClick={onBack}>Start over</button>
        <button className="btn primary lg" disabled={saving} onClick={save}>{saving ? <span className="spinner" /> : 'Save to brand kit'}</button>
      </div>
    </div>
  );
}

function LogoChoice({ src, label, selected, onClick }: { src: string; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button className="element" aria-pressed={selected} onClick={onClick} title={label} style={{ width: 84 }}>
      <img src={src} alt={label} referrerPolicy="no-referrer" />
    </button>
  );
}
