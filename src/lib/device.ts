import { useEffect, useState } from 'react';

/**
 * Touch-first devices (iPad, phones): no hover and a coarse pointer. An iPad with a trackpad
 * reports a fine pointer and gets the full desktop editor. `?desktop=1` forces the desktop editor.
 */
const QUERY = '(hover: none) and (pointer: coarse)';
const forced = () => { try { return new URLSearchParams(location.search).get('desktop') === '1'; } catch { return false; } };
export function isTouchDevice() { return typeof matchMedia !== 'undefined' && matchMedia(QUERY).matches && !forced(); }

export function useTouchDevice() {
  const [touch, setTouch] = useState(isTouchDevice);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia(QUERY);
    const on = () => setTouch(m.matches && !forced());
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return touch;
}
