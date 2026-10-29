import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../ui/Icon';

/**
 * A one-minute guided tour of the editor for first-time users: a spotlight on each part with a short
 * plain-language card. It shows once automatically and can be replayed from the “?” button.
 */
export const TOUR_KEY = 'mos.tour.v1';
type Step = { target?: string; title: string; body: string; icon: string };
const STEPS: Step[] = [
  { icon: 'sparkles', title: 'Welcome to Motion OS', body: 'You’re going to make something that moves and reacts. Here’s a quick one minute tour. You can skip it and replay it any time with the ? button.' },
  { target: '.modes', icon: 'layers', title: 'Four steps, left to right', body: 'Design what it looks like → Animate how it moves → Interact to make it react → Try it to play with the result. Switch between them here whenever you like.' },
  { target: '.ed-left', icon: 'shapes', title: 'Your layers', body: 'Add shapes, text and images at the top, or import a design. Below is every layer in the file. Click one to select it.' },
  { target: '.stage-box', icon: 'crosshair', title: 'The canvas', body: 'Click something to select it. Drag to move it, pull a corner to resize, and use the dot on top to rotate.' },
  { target: '.ed-right', icon: 'settings', title: 'Settings for what you picked', body: 'Colours, sizes and positions live here. In Animate this becomes one-click moves like Bounce or Spin; in Interact it lists your interactions as plain sentences.' },
  { target: '[data-tour="ask"]', icon: 'sparkles', title: 'Ask Claude', body: 'Not sure how? Type what you want, like “when someone clicks the star, make it spin”, and Claude makes the change. You can always undo it.' },
  { target: '[data-tour="share"]', icon: 'globe', title: 'Share it', body: 'When you’re happy, add it to the Community so others can try it and remix their own copy. Everything saves automatically as you go.' },
];

export function Tour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = STEPS[i];
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
  const W = 340, pad = 14;
  let left = innerWidth / 2 - W / 2, top = innerHeight / 2 - 110;
  if (rect) {
    const roomRight = innerWidth - rect.right, roomLeft = rect.left;
    if (rect.height > innerHeight * 0.5) { left = roomRight > W + pad * 2 ? rect.right + pad : roomLeft > W + pad * 2 ? rect.left - W - pad : rect.left + pad; top = Math.max(pad, rect.top + 40); }
    else { left = Math.min(Math.max(pad, rect.left), innerWidth - W - pad); top = rect.bottom + pad + 220 > innerHeight ? rect.top - 230 : rect.bottom + pad; }
  }
  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-label={`Tour step ${i + 1} of ${STEPS.length}: ${step.title}`}>
      {rect ? <div className="tour-spot" style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }} /> : <div className="tour-dim" />}
      <div className="tour-card" style={{ left, top, width: W }} key={i}>
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
