import type { ReactNode } from 'react';
import type { ChannelFormat } from '../../shared/formats';

const bar = (w: number | string, o = 0.18) => <span style={{ display: 'block', height: 7, width: w, borderRadius: 4, background: `rgba(255,255,255,${o})` }} />;
const dot = (s = 22) => <span style={{ width: s, height: s, borderRadius: '50%', background: 'linear-gradient(135deg,#777,#333)', flex: 'none' }} />;

/**
 * Destination-realistic chrome (generic, unbranded) around a preview. The motion itself is
 * never stretched: children render at the destination's exact aspect ratio.
 */
export function FormatFrame({ format, children, width, showSafe, brandName = 'yourbrand' }: { format: ChannelFormat; children: ReactNode; width: number; showSafe?: boolean; brandName?: string }) {
  const aspect = format.width / format.height;
  const media = (w: number) => (
    <div style={{ position: 'relative', width: w, height: w / aspect, overflow: 'hidden', background: '#000' }}>
      {children}
      {showSafe && <SafeArea format={format} />}
    </div>
  );
  const shell = { background: '#0e0e10', border: '1px solid var(--line-2)', overflow: 'hidden' } as const;
  switch (format.chrome) {
    case 'ig-post':
      return (
        <div style={{ ...shell, width, borderRadius: 12 }}>
          <div className="row" style={{ padding: '9px 10px', gap: 8 }}>{dot()}<span style={{ fontSize: 11.5, fontWeight: 600 }}>{brandName}</span><span className="faint" style={{ fontSize: 10.5 }}>Sponsored</span></div>
          {media(width)}
          <div style={{ padding: '9px 10px 11px' }} className="col">
            <div className="row" style={{ gap: 10 }}>{['♡', '◯', '➤'].map((s) => <span key={s} className="faint">{s}</span>)}</div>
            {bar('70%')}{bar('45%', 0.1)}
          </div>
        </div>
      );
    case 'ig-story':
      return (
        <div style={{ ...shell, width, borderRadius: 18, position: 'relative' }}>
          {media(width)}
          <div style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', gap: 3 }}>{[1, 0.45, 0.45].map((o, i) => <span key={i} style={{ flex: 1, height: 2, borderRadius: 2, background: `rgba(255,255,255,${o})` }} />)}</div>
          <div className="row" style={{ position: 'absolute', top: 16, left: 10, gap: 7 }}>{dot(20)}<span style={{ fontSize: 11, fontWeight: 600, textShadow: '0 1px 4px #000' }}>{brandName}</span></div>
          <div style={{ position: 'absolute', bottom: 12, left: 10, right: 10, height: 30, borderRadius: 99, border: '1px solid rgba(255,255,255,.5)', fontSize: 10.5, display: 'flex', alignItems: 'center', padding: '0 12px', color: 'rgba(255,255,255,.75)' }}>Send message</div>
        </div>
      );
    case 'linkedin':
      return (
        <div style={{ ...shell, width, borderRadius: 10 }}>
          <div className="row" style={{ padding: 10, gap: 8 }}>{dot(30)}<div className="col" style={{ gap: 4 }}>{bar(90, 0.35)}{bar(60, 0.12)}</div></div>
          <div className="col" style={{ padding: '0 10px 10px', gap: 5 }}>{bar('92%', 0.14)}{bar('60%', 0.14)}</div>
          {media(width)}
          <div className="row" style={{ padding: '9px 12px', justifyContent: 'space-between' }}>{['Like', 'Comment', 'Repost', 'Send'].map((s) => <span key={s} className="faint" style={{ fontSize: 10.5 }}>{s}</span>)}</div>
        </div>
      );
    case 'web-hero':
    case 'web-banner':
      return (
        <div style={{ ...shell, width, borderRadius: 10 }}>
          <div className="row" style={{ height: 24, padding: '0 9px', gap: 5, borderBottom: '1px solid var(--line)' }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 7, height: 7, borderRadius: '50%', background: c, opacity: 0.7 }} />)}
            <span style={{ marginLeft: 10, height: 12, flex: 1, maxWidth: 220, borderRadius: 4, background: 'rgba(255,255,255,.07)' }} />
          </div>
          <div className="row" style={{ height: 26, padding: '0 12px', gap: 14 }}>{bar(40, 0.35)}<span className="grow" />{bar(28, 0.12)}{bar(28, 0.12)}{bar(28, 0.12)}</div>
          {media(width)}
          {format.chrome === 'web-banner' && <div className="col" style={{ padding: 12, gap: 6 }}>{bar('80%', 0.08)}{bar('65%', 0.08)}{bar('72%', 0.08)}</div>}
        </div>
      );
    case 'app-banner':
    case 'app-popup': {
      const phoneW = format.chrome === 'app-banner' ? width : width * 1.18;
      return (
        <div style={{ ...shell, width: phoneW, borderRadius: 22, padding: 8, background: '#060607' }}>
          <div style={{ borderRadius: 16, overflow: 'hidden', background: '#111114', position: 'relative' }}>
            <div className="row between" style={{ height: 20, padding: '0 12px', fontSize: 9.5 }} aria-hidden><span>9:41</span><span className="faint">● ● ●</span></div>
            {format.chrome === 'app-banner' ? (
              <>
                <div style={{ padding: '6px 10px' }}>{bar(70, 0.35)}</div>
                <div style={{ padding: '6px 10px' }}><div style={{ borderRadius: 10, overflow: 'hidden' }}>{media(phoneW - 36)}</div></div>
                <div className="col" style={{ padding: 10, gap: 8 }}>{[0, 1, 2].map((i) => <div key={i} className="row">{dot(26)}<div className="col grow" style={{ gap: 4 }}>{bar('70%', 0.14)}{bar('45%', 0.08)}</div></div>)}</div>
              </>
            ) : (
              <div style={{ position: 'relative', padding: '30px 14px 40px', background: 'repeating-linear-gradient(0deg, #141418 0 40px, #18181c 40px 80px)' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)' }} />
                <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,.6)' }}>
                  {media(phoneW - 44)}
                  <span style={{ position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,0,0,.5)', display: 'grid', placeItems: 'center', fontSize: 11 }}>✕</span>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }
    case 'slide':
    default:
      return (
        <div style={{ ...shell, width, borderRadius: 6, position: 'relative' }}>
          {media(width)}
          <span className="mono" style={{ position: 'absolute', right: 8, bottom: 6, fontSize: 9, color: 'rgba(255,255,255,.55)' }}>12 / 24</span>
        </div>
      );
  }
}

export function SafeArea({ format }: { format: Pick<ChannelFormat, 'safe'> }) {
  const s = format.safe;
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: `${s.left * 100}%`, right: `${s.right * 100}%`, top: `${s.top * 100}%`, bottom: `${s.bottom * 100}%`, border: '1px dashed rgba(143,176,255,.65)', borderRadius: 2 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: `${s.top * 100}%`, background: 'rgba(143,176,255,.08)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${s.bottom * 100}%`, background: 'rgba(143,176,255,.08)' }} />
    </div>
  );
}
