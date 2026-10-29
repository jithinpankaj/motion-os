import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../ui/Icon';
import { useTourImage, type TourImage } from './tourImages';

/**
 * A one-minute guided tour of the editor for first-time users: a spotlight on each part with a short
 * plain-language card. It shows once automatically and can be replayed from the “?” button.
 */
export const TOUR_KEY = 'mos.tour.v1';
type Step = { target?: string; title: string; body: string; icon: string; img: TourImage; alt: string };
const STEPS: Step[] = [
  { img: 'overview', alt: 'The whole editor: layers on the left, the canvas in the middle, settings on the right.', icon: 'sparkles', title: 'Welcome to Motion OS', body: 'You’re going to make something that moves and reacts. Here’s a quick one minute tour. You can skip it and replay it any time with the ? button.' },
  { img: 'workspaces', alt: 'The same file in Design, Animate (with a timeline) and Interact (with interaction sentences).', target: '.modes', icon: 'layers', title: 'Three workspaces', body: 'Design what it looks like, Animate how it moves, Interact to make it react. Press Preview (top right) any time to play with the result.' },
  { img: 'layers', alt: 'The creation rail beside the layer tree, with groups folded open.', target: '.ed-left', icon: 'shapes', title: 'Your layers', body: 'Every layer in the file, as a tree. Add new things from the rail on its left. Fold groups, search by name, and right-click a layer for more.' },
  { img: 'canvas', alt: 'A selected shape with corner handles, a rotate dot and a small action bar above it.', target: '.stage-box', icon: 'crosshair', title: 'The canvas', body: 'Click something to select it. Drag to move it, pull a corner to resize, and use the dot on top to rotate.' },
  { img: 'inspector', alt: 'The Appearance section for a selected shape: fill, colour, outline and opacity.', target: '.ed-right', icon: 'settings', title: 'Settings for what you picked', body: 'Only what fits your selection shows here: colours and sizes for a shape, type settings for text, the canvas when nothing is selected. In Animate this becomes one-click moves like Bounce or Spin; in Interact it lists your interactions as plain sentences.' },
  { img: 'ask', alt: 'The Ask Claude panel with suggested ideas and a request typed in.', target: '[data-tour="ask"]', icon: 'sparkles', title: 'Ask Claude', body: 'Not sure how? Type what you want, like “when someone clicks the star, make it spin”, and Claude makes the change. You can always undo it.' },
  { img: 'share', alt: 'The Share menu open, showing Add to Community and Copy link.', target: '[data-tour="share"]', icon: 'globe', title: 'Share it', body: 'When you’re happy, Share adds it to the Community so others can try it and remix their own copy. Everything saves automatically as you go.' },
];

export function Tour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];
  const img = useTourImage(step.img);
  useLayoutEffect(() => {
    const measure = () => { const el = step.target ? document.querySelector(step.target) : null; setRect(el ? el.getBoundingClientRect() : null); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step.target]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); if (e.key === 'ArrowRight' || e.key === 'Enter') next(); if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1)); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const finish = () => { try { localStorage.setItem(TOUR_KEY, 'done'); } catch { /* private mode */ } onDone(); };
  const next = () => (i < STEPS.length - 1 ? setI(i + 1) : finish());
  // Place the card beside the spotlight, inside the window.
  const W = 372, CARD_H = 450, pad = 14;
  let left = innerWidth / 2 - W / 2, top = innerHeight / 2 - CARD_H / 2;
  if (rect) {
    const roomRight = innerWidth - rect.right, roomLeft = rect.left;
    if (rect.height > innerHeight * 0.5) { left = roomRight > W + pad * 2 ? rect.right + pad : roomLeft > W + pad * 2 ? rect.left - W - pad : rect.left + pad; top = Math.max(pad, rect.top + 40); }
    else { left = Math.min(Math.max(pad, rect.left), innerWidth - W - pad); top = rect.bottom + pad + CARD_H > innerHeight ? rect.top - CARD_H - pad : rect.bottom + pad; }
  }
  top = Math.max(pad, Math.min(top, innerHeight - CARD_H - pad));
  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label={`Tour step ${i + 1} of ${STEPS.length}: ${step.title}`}>
      {rect ? <div className="tour-spot" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} /> : <div className="tour-dim" />}
      <div className="tour-card" style={{ left, top, width: W }} key={i}>
        {img && <img className="tour-img" src={img} alt={step.alt} width={340} height={190} />}
        <div className="row" style={{ gap: 10 }}><span className="tour-ic"><Icon name={step.icon as any} size={16} /></span><b>{step.title}</b></div>
        <p>{step.body}</p>
        <div className="row" style={{ gap: 6 }}>
          <span className="tour-dots" aria-hidden>{STEPS.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</span>
          <div className="grow" />
          <button className="btn sm ghost" onClick={finish}>Skip</button>
          {i > 0 && <button className="btn sm" onClick={() => setI(i - 1)}>Back</button>}
          <button className="btn sm primary" onClick={next} autoFocus>{i === STEPS.length - 1 ? 'Start making' : 'Next'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const tourSeen = () => { try { return localStorage.getItem(TOUR_KEY) === 'done'; } catch { return true; } };
