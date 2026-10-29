import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { useCan } from '../../lib/session';
import { toast } from '../../ui/controls';
import { Icon } from '../../ui/Icon';

/**
 * How it works: a short, friendly explainer for people opening Motion OS for the first time. The
 * four steps, a five minute walkthrough, how to ask Claude, and the few words the editor uses.
 * It can open a starter file with the guided tour.
 */
const STEPS = [
  { title: 'Design', what: 'What it looks like', how: 'Add shapes, text and images, or import a design. Colours and sizes live on the right.' },
  { title: 'Animate', what: 'How it moves', how: 'Select a layer and pick a one click move like Pop, Bounce or Spin. Fine tune it on the timeline.' },
  { title: 'Interact', what: 'How it reacts', how: 'Answer three questions: what people do, on what, and what should happen. It reads like a sentence.' },
  { title: 'Try it', what: 'Play with it', how: 'Hover and click the canvas like a visitor would. What’s happening explains every result.' },
];
const WALKTHROUGH = [
  ['Start', 'Open the Living button starter, or a blank file from Home.'],
  ['Design', 'Select the big orange top and change its colour on the right.'],
  ['Animate', 'Select the sparkle and click Spin. A new move appears on the timeline.'],
  ['Interact', 'New interaction, then “clicks”, the Touch area, “Play a move”, Spin, and Create.'],
  ['Try it', 'Click the button. If nothing happens, What’s happening tells you why.'],
  ['Share', 'Press Add to Community and pick a category. Everyone on this server can try it.'],
];
const EXAMPLES = [
  'When someone clicks the star, make it bounce and play a pop sound.',
  'Make the button grow a little when the pointer is over it.',
  'Add a Coins counter that starts at 3. Each click spends one and plays Spin.',
  'Change the heart to #ff3b5c.',
];
const WORDS = [
  ['Layer', 'One thing on the canvas: a shape, text, an image, or a group.'],
  ['Move', 'A short animation, like Bounce or Turn on.'],
  ['Keyframe', 'A moment where you set how something looks. Motion OS fills in the rest.'],
  ['Interaction', 'When something happens, and only if a condition holds, do these steps.'],
  ['Switch and value', 'Something the file remembers, like on or off, a number, or a colour.'],
  ['State', 'An optional named pose, like Rest, Hover or Pressed.'],
  ['Touch area', 'An invisible shape that makes a whole component easy to hover and click.'],
  ['Remix', 'Your own editable copy of someone else’s file. Theirs never changes.'],
];
const TIPS = [
  ['Saves by itself', 'Undo and redo are in the top bar, or ⌘Z and ⇧⌘Z.'],
  ['Replay the tour', 'The info button in the editor starts it again.'],
  ['Export', 'A video or still of any move, or the whole file for developers.'],
  ['Customise', 'Change a component’s colours and words in one place.'],
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
      <header className="ed-hero">
        <div className="eyebrow">How it works</div>
        <h1 className="display">Make things move,<br />then make them react.</h1>
        <p className="lead">Turn a design into something people can hover, click and play with. No code. Describe what should happen in plain sentences, or simply ask Claude.</p>
        <div className="row wrap" style={{ gap: 10, marginTop: 32 }}>
          {can('scene.create') && <button className="btn primary lg" disabled={busy} onClick={starter}><Icon name="play" size={14} />Open a starter and take the tour</button>}
          <button className="btn lg" onClick={() => nav('/community?sort=presets')}>Look at examples first</button>
        </div>
      </header>

      <section className="ed-section">
        <div className="ed-section-h"><h2 className="h2">Four steps</h2></div>
        <div className="learn-steps">
          {STEPS.map((s, i) => (
            <div key={s.title} className="learn-step">
              <span className="learn-n">{String(i + 1).padStart(2, '0')}</span>
              <div className="learn-step-t">{s.title}</div>
              <div className="faint">{s.what}</div>
              <p>{s.how}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="ed-section split">
        <div className="ed-section-h"><h2 className="h2">Your first interactive button, in five minutes</h2></div>
        <ol className="learn-walk">{WALKTHROUGH.map(([k, v]) => <li key={k}><b>{k}</b><span>{v}</span></li>)}</ol>
      </section>

      <section className="ed-section split">
        <div className="ed-section-h">
          <h2 className="h2">Stuck? Ask Claude</h2>
          <p className="learn-side">Press Ask Claude in the editor and say what you want in your own words. Claude makes the change and tells you what it did. Every change can be undone.</p>
        </div>
        <div className="learn-examples">{EXAMPLES.map((x) => <div key={x} className="learn-example">“{x}”</div>)}</div>
      </section>

      <section className="ed-section split">
        <div className="ed-section-h"><h2 className="h2">Words you’ll see</h2></div>
        <dl className="learn-words">{WORDS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </section>

      <section className="ed-section split">
        <div className="ed-section-h"><h2 className="h2">Good to know</h2></div>
        <dl className="learn-words">{TIPS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </section>
    </div>
  );
}
