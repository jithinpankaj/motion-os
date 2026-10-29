import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';

/**
 * How it works: a short, friendly explainer for people opening Motion OS for the first time — the
 * four steps, a five-minute walkthrough, how to ask Claude for help, and the handful of words the
 * editor uses. It can open a starter file with the guided tour.
 */
const STEPS = [
  { icon: 'shapes', title: 'Design', what: 'What it looks like.', how: ['Add shapes, text and images from the left — or import a design (PNG, SVG, PDF, Figma).', 'Click to select, drag to move, pull a corner to resize, use the top dot to rotate.', 'Colours and sizes are on the right.'] },
  { icon: 'film', title: 'Animate', what: 'How it moves.', how: ['Select a layer and pick a one-click move: Pop, Bounce, Spin, Float, Squash…', 'Each move gets its own timeline at the bottom. Drag keyframes to change the timing.', 'Change things on the canvas while the playhead is somewhere and that becomes a keyframe.'] },
  { icon: 'crosshair', title: 'Interact', what: 'How it reacts.', how: ['Click New interaction and answer three questions: what people do, on what, and what should happen.', 'Every interaction reads like a sentence. Click an underlined word to change it.', 'Need a condition? Open the card and use “Only if…”.'] },
  { icon: 'play', title: 'Try it', what: 'Play with the result.', how: ['Hover, click and press keys on the canvas exactly as a visitor would.', '“What’s happening” tells you what ran — and in plain words why something didn’t.', 'Change switches and values there to test different situations.'] },
];
const WALKTHROUGH = [
  ['Start', 'Open the Living button starter (button below) or a blank file from Home.'],
  ['Design', 'Pick the big orange top and change its colour on the right.'],
  ['Animate', 'Select the sparkle and click Spin. A new move appears at the bottom.'],
  ['Interact', 'New interaction → “clicks” → the Touch area → “Play a move” → your new Spin move → Create.'],
  ['Try it', 'Click the button. If nothing happens, read “What’s happening” — it says why.'],
  ['Share', 'Press Add to Community, pick a category, and it’s live for everyone on this server to try and remix.'],
];
const WORDS = [
  ['Layer', 'One thing on the canvas — a shape, some text, an image, or a group of them.'],
  ['Move', 'A short animation, like “Bounce” or “Turn on”. Made of keyframes.'],
  ['Keyframe', 'A moment where you set how something looks. The app fills in the frames in between.'],
  ['Interaction', 'A sentence: when something happens (and only if…), do these steps.'],
  ['Switch & value', 'Something the file remembers: on/off switches, buttons, numbers, text, colours.'],
  ['State', 'Optional. A named pose like Rest, Hover or Pressed that an interaction can switch to.'],
  ['Touch area', 'An invisible shape around a component, so hovering and clicking anywhere on it works.'],
  ['Remix', 'Your own editable copy of someone else’s file. Theirs never changes.'],
];

export default function Learn() {
  const nav = useNavigate();
  const can = useCan();
  const [busy, setBusy] = useState(false);
  const starter = async () => {
    setBusy(true);
    try { const r = await api<{ id: string }>('/projects', { body: { name: 'My first button', preset: 'living-button' } }); nav(`/edit/${r.id}?tour=1`); }
    catch (e) { toast('danger', 'Couldn’t open the starter', errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="page-inner learn">
      <div className="eyebrow">How it works</div>
      <h1 className="h1" style={{ marginTop: 8 }}>Make things move — and react</h1>
      <p className="lead">Motion OS turns a design into something people can hover, click and play with. No code: you describe what should happen in plain sentences — or just ask Claude.</p>
      <div className="row wrap" style={{ gap: 8, marginTop: 18 }}>
        {can('scene.create') && <button className="btn primary" disabled={busy} onClick={starter}><Icon name="play" size={14} />Open a starter and take the tour</button>}
        <button className="btn" onClick={() => nav('/community?sort=presets')}><Icon name="globe" size={14} />Look at examples first</button>
      </div>

      <section className="section">
        <h2 className="h2">The four steps</h2>
        <div className="learn-steps">
          {STEPS.map((s, i) => (
            <div key={s.title} className="learn-step">
              <div className="row" style={{ gap: 10 }}><span className="learn-n">{i + 1}</span><Icon name={s.icon as any} size={16} /><b>{s.title}</b><span className="faint">{s.what}</span></div>
              <ul>{s.how.map((h) => <li key={h}>{h}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="h2">Your first interactive button, in five minutes</h2>
        <ol className="learn-walk">{WALKTHROUGH.map(([k, v]) => <li key={k}><b>{k}</b><span>{v}</span></li>)}</ol>
      </section>

      <section className="section">
        <h2 className="h2">Stuck? Ask Claude</h2>
        <div className="learn-ask">
          <p>Press <b><Icon name="sparkles" size={12} /> Ask Claude</b> in the editor and type what you want in your own words. Claude reads your file, makes the change, and tells you exactly what it did. Every change can be undone.</p>
          <div className="learn-examples">
            {['When someone clicks the star, make it bounce and play a pop sound.', 'Make the button grow a little when the pointer is over it.', 'Add a Coins counter that starts at 3. Each click takes a coin and plays Spin — only if there’s a coin left.', 'Change the heart to #ff3b5c.'].map((x) => <div key={x} className="learn-example">“{x}”</div>)}
          </div>
        </div>
      </section>

      <section className="section">
        <h2 className="h2">Words you’ll see</h2>
        <dl className="learn-words">{WORDS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </section>

      <section className="section">
        <h2 className="h2">Good to know</h2>
        <ul className="learn-tips">
          <li><b>Everything saves by itself.</b> Undo and redo are in the top bar (⌘Z / ⇧⌘Z).</li>
          <li><b>The ? button</b> in the editor replays the tour.</li>
          <li><b>Export</b> makes an MP4 or PNG of a move, or the whole file for developers.</li>
          <li><b>Customise</b> (in Design, with nothing selected) changes a component’s colours and words in one place.</li>
        </ul>
      </section>
    </div>
  );
}
