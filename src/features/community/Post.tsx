import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { seedCommunityAssets } from '../../lib/community';
import { useCan } from '../../lib/session';
import { mapResolver } from '../../engine/assets';
import { MotionPlayer, type MotionPlayerHandle } from '../../components/MotionPlayer';
import { ControlWidgets } from '../../components/ControlWidgets';
import { EmptyState, timeAgo, toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { deserializeScene } from '../../../shared/scene/serialize';
import { MOTION_PRESETS } from '../../../shared/motion/presets';
import type { SceneDocument } from '../../../shared/scene/schema';

/** A community post as a playground: play with its controls, then remix a copy into your files. */
export default function Post() {
  const { id } = useParams();
  const [data, setData] = useState<{ post: any; doc: SceneDocument; assets: any } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const player = useRef<MotionPlayerHandle | null>(null);
  const [, bump] = useReducer((x) => x + 1, 0);
  const onChange = useCallback(() => bump(), []);
  const can = useCan();
  const nav = useNavigate();
  useEffect(() => {
    api(`/community/${id}`, { noWorkspace: true }).then((r) => { seedCommunityAssets(id!, r.assets); setData({ post: r.post, doc: deserializeScene(r.post.doc), assets: r.assets }); }).catch((e) => setError(errorMessage(e)));
  }, [id]);
  const assets = useMemo(() => mapResolver(data?.assets ?? {}), [data?.assets]);
  // Ensure the runtime widgets render once the player mounts.
  useEffect(() => { const t = setTimeout(bump, 60); return () => clearTimeout(t); }, [data]);
  if (error) return <div className="page-inner"><EmptyState icon="alert" title="This post isn’t available">{error}<div style={{ marginTop: 12 }}><Link className="btn" to="/community">Back to the community</Link></div></EmptyState></div>;
  if (!data) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><div className="spinner" /></div>;
  const { post, doc } = data;
  const tip = post.isPreset ? MOTION_PRESETS.find((p) => p.key === post.presetKey)?.tip : null;
  const remix = async () => {
    setBusy(true);
    try { const r = await api(`/community/${post.id}/remix`, { method: 'POST' }); toast('ok', 'Remixed into your files', 'It’s your own copy — change anything.'); nav(`/edit/${r.id}`); }
    catch (e) { toast('danger', 'Couldn’t remix', errorMessage(e)); } finally { setBusy(false); }
  };
  const like = async () => {
    try { const r = await api(`/community/${post.id}/like`, { method: 'POST', noWorkspace: true }); setData({ ...data, post: { ...post, liked: r.liked, likeCount: r.likeCount } }); } catch (e) { toast('danger', 'Couldn’t like', errorMessage(e)); }
  };
  const unpublish = async () => {
    if (!confirm('Unpublish this post? Remixes people already made are not affected.')) return;
    try { await api(`/community/${post.id}`, { method: 'DELETE' }); toast('ok', 'Unpublished'); nav('/community'); } catch (e) { toast('danger', 'Couldn’t unpublish', errorMessage(e)); }
  };
  const ratio = doc.canvas.width / doc.canvas.height;
  return (
    <div className="page-inner" style={{ paddingTop: 24 }}>
      <Link to="/community" className="faint" style={{ fontSize: 12.5 }}>← Community</Link>
      <div className="create-layout" style={{ marginTop: 14 }}>
        <div className="stage" style={{ position: 'relative' }}>
          <div className="stage-frame" style={{ aspectRatio: String(ratio), width: ratio >= 1 ? '100%' : undefined, height: ratio < 1 ? 'min(calc(100vh - 220px), 760px)' : undefined }}>
            <MotionPlayer ref={player} doc={doc} assets={assets} label={`${post.title} — interactive preview`} style={{ position: 'absolute', inset: 0 }} onChange={onChange} />
          </div>
        </div>
        <div className="tune">
          <div>
            <div className="row" style={{ gap: 8 }}>{post.isPreset && <span className="badge info">Starter preset</span>}{post.tags.map((t: string) => <Link key={t} to={`/community?tag=${encodeURIComponent(t)}`} className="badge">#{t}</Link>)}</div>
            <h1 className="h1" style={{ marginTop: 10 }}>{post.title}</h1>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>by {post.author} · {timeAgo(post.publishedAt)}{post.remixOf && <> · remix of <Link to={`/community/${post.remixOf.id}`}>{post.remixOf.title}</Link></>}</div>
            {(post.description || tip) && <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 10 }}>{post.description}</p>}
          </div>
          {tip && <div className="callout"><Icon name="info" /><div className="grow" style={{ fontSize: 13 }}>{tip}</div></div>}
          <div className="panel" style={{ padding: 14 }}>
            <div className="sec-h" style={{ marginBottom: 10 }}>Play with it</div>
            <ControlWidgets doc={doc} runtime={player.current?.runtime ?? null} onReset={() => player.current?.reset()} />
          </div>
          <div className="row" style={{ gap: 8 }}>
            {can('scene.create') && <button className="btn primary lg grow" disabled={busy} onClick={remix}>{busy ? <span className="spinner" /> : <><Icon name="branch" />Remix into my files</>}</button>}
            <button className="btn lg" aria-pressed={post.liked} onClick={like}><Icon name="sparkles" />{post.liked ? 'Liked' : 'Like'} · {post.likeCount}</button>
          </div>
          <div className="faint" style={{ fontSize: 12 }}>{post.remixCount} remix{post.remixCount === 1 ? '' : 'es'} · {doc.machine.inputs.length} control{doc.machine.inputs.length === 1 ? '' : 's'} · {doc.machine.rules.length} rule{doc.machine.rules.length === 1 ? '' : 's'} · {doc.machine.animations.length} move{doc.machine.animations.length === 1 ? '' : 's'}</div>
          {post.mine && <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={unpublish}>Unpublish</button>}
        </div>
      </div>
    </div>
  );
}
