// What kind of screen the app is on, for the few things phones and tablets do differently. The same two media
// queries are in app.css, so the styles and the code always agree (change them together):
//  - phone layout: a narrow window, or a short touch screen (a phone held sideways) — one column, with the servers
//    and channels in a drawer;
//  - touch UI: a finger is the main pointer (phones and tablets) — bigger tap targets, long-press and gestures.
// A desktop with a mouse matches neither, and looks and works as it always has.
export const PHONE_LAYOUT = '(max-width: 760px), (pointer: coarse) and (max-height: 500px)';
export const TOUCH_UI = '(pointer: coarse)';

const query = (q) => (typeof matchMedia === 'function' ? matchMedia(q) : null);
const matches = (q) => { const m = query(q); return !!(m && m.matches); };

export const isPhoneLayout = () => matches(PHONE_LAYOUT);
export const isTouchUI = () => matches(TOUCH_UI);

// Calls fn() whenever either answer changes (a phone turned sideways, a window narrowed). Returns a function that
// stops listening.
export function onDeviceChange(fn) {
  const list = [query(PHONE_LAYOUT), query(TOUCH_UI)].filter(Boolean);
  for (const m of list) m.addEventListener('change', fn);
  return () => { for (const m of list) m.removeEventListener('change', fn); };
}
