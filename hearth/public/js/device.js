// What kind of screen the app is on, for the few things phones and tablets do differently. The same media queries
// are in app.css, so the styles and the code always agree (change them together):
//  - phone layout: a narrow window, or a short touch screen (a phone held sideways) — one column, with the servers
//    and channels in a drawer;
//  - touch UI: a finger is the main pointer (phones and tablets) — bigger tap targets, long-press and gestures;
//  - a phone: both at once — pictures in the chat as big as the screen allows (a computer, its window narrow or its
//    screen a touch screen, keeps the usual size).
// A desktop with a mouse matches none, and looks and works as it always has.
export const PHONE_LAYOUT = '(max-width: 760px), (pointer: coarse) and (max-height: 500px)';
export const TOUCH_UI = '(pointer: coarse)';
export const PHONE = '(max-width: 760px) and (pointer: coarse), (pointer: coarse) and (max-height: 500px)';

const query = (q) => (typeof matchMedia === 'function' ? matchMedia(q) : null);
const matches = (q) => { const m = query(q); return !!(m && m.matches); };

export const isPhoneLayout = () => matches(PHONE_LAYOUT);
export const isTouchUI = () => matches(TOUCH_UI);
export const isPhone = () => matches(PHONE);

// Calls fn() whenever either answer changes (a phone turned sideways, a window narrowed). Returns a function that
// stops listening.
export function onDeviceChange(fn) {
  const list = [query(PHONE_LAYOUT), query(TOUCH_UI)].filter(Boolean);
  for (const m of list) m.addEventListener('change', fn);
  return () => { for (const m of list) m.removeEventListener('change', fn); };
}
