// Modals, popovers, menus and bottom sheets.
import { h, icon } from './util.js';
import { isPhoneLayout, isTouchUI } from './device.js';

const layer = () => document.getElementById('layer');
let openPop = null;
let openSheet = null;

// Everything a keyboard user can reach inside `root`, in tab order.
const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
export function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden], [inert]') && el.getClientRects().length);
}
// Keeps Tab and Shift+Tab inside `root` (open dialogs), wrapping at either end.
export function trapTab(e, root) {
  if (e.key !== 'Tab') return;
  const list = focusables(root);
  if (!list.length) { e.preventDefault(); root.focus({ preventScroll: true }); return; }
  const first = list[0];
  const last = list[list.length - 1];
  const at = document.activeElement;
  if (e.shiftKey && (at === first || !root.contains(at))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (at === last || !root.contains(at))) { e.preventDefault(); first.focus(); }
}
// Puts focus back where it was before a dialog or popup opened, if that place still exists (quietly: quietFocus).
const stillThere = (targets) => targets.find((el) => el && el.isConnected && el.getClientRects().length);
function restoreFocus(...targets) {
  const t = stillThere(targets);
  if (t) t.focus({ preventScroll: true });
}
function restoreQuietly(...targets) {
  const t = stillThere(targets);
  if (t) quietFocus(t);
}
// Focus handed back after something done with a finger (a sheet put away, Back on a phone): it goes where it belongs,
// for screen readers, but without the keyboard's focus ring, which a browser draws after typing in a text box and
// which would be left as a stray box on the screen. The ring is back with the next key press (app.css .quiet-focus).
export function quietFocus(el) {
  el.classList.add('quiet-focus');
  const off = () => { el.classList.remove('quiet-focus'); el.removeEventListener('blur', off); document.removeEventListener('keydown', off, true); };
  el.addEventListener('blur', off);
  document.addEventListener('keydown', off, true);
  el.focus({ preventScroll: true, focusVisible: false });
}
// Whether the last thing done was a key press (or a finger, pen or mouse): a sheet opened from the keyboard gives focus
// back as dialogs do, one opened with a finger quietly.
let byKeys = false;
// And which kind of pointer went down last ('mouse', 'touch' or 'pen'): tooltips and hover-opened submenus are for
// a mouse only.
let lastPointer = 'mouse';
document.addEventListener('keydown', () => { byKeys = true; }, true);
document.addEventListener('pointerdown', (e) => { byKeys = false; lastPointer = e.pointerType || 'mouse'; }, true);

export function closePopover() {
  if (!openPop) return;
  const pop = openPop;
  openPop = null;
  const hadFocus = pop.contains(document.activeElement);
  pop.remove();
  if (pop._anchor && pop._anchor.hasAttribute('aria-expanded')) pop._anchor.setAttribute('aria-expanded', 'false');
  // Focus was inside the popup: send it back to the button that opened it, so it isn't lost on the page.
  if (hadFocus) restoreFocus(pop._anchor, pop._returnTo);
}

document.addEventListener('mousedown', (e) => {
  if (openPop && !openPop.contains(e.target) && !e.target.closest('[data-pop-anchor]')) closePopover();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (openPop) { const pop = openPop; const inside = pop.contains(document.activeElement); closePopover(); if (!inside) restoreFocus(pop._anchor, pop._returnTo); e.stopPropagation(); return; }
  if (openSheet) { openSheet._close(); e.stopPropagation(); return; }
  const modals = document.querySelectorAll('.modal-backdrop:not(.closing)');
  const top = modals[modals.length - 1];
  if (top && top._close) top._close();
});

// Position `content` next to `anchor`. side: 'right' | 'left' | 'top' | 'bottom'
export function popover(anchor, content, { side = 'right', align = 'start', className = '', label = '', focus = true } = {}) {
  const returnTo = document.activeElement;
  closePopover();
  const isMenu = content.classList && content.classList.contains('menu');
  if (isMenu) menuSemantics(content);
  // A menu is its own widget; anything else (pickers, profile cards) is a small non-modal dialog.
  const name = label || (anchor && anchor.getAttribute && (anchor.getAttribute('aria-label') || anchor.getAttribute('data-tip'))) || '';
  const pop = h('div', { class: `popover ${className}`, role: isMenu ? null : 'dialog', 'aria-label': isMenu ? null : name || 'Popup', tabindex: '-1' }, content);
  pop._anchor = anchor && anchor.isConnected && anchor.matches('button, [role=button], a') ? anchor : null;
  pop._returnTo = returnTo;
  if (pop._anchor) pop._anchor.setAttribute('aria-expanded', 'true');
  pop.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    // Tab leaves a menu (like a native one); other popups keep focus inside until Esc.
    if (isMenu) { e.preventDefault(); closePopover(); restoreFocus(pop._anchor, pop._returnTo); } else trapTab(e, pop);
  });
  // The wheel over a popup scrolls the popup (a long menu), never the conversation or the page behind it.
  pop.addEventListener('wheel', (e) => {
    const box = e.target.closest && e.target.closest('.menu, .popover');
    if (!box || box.scrollHeight <= box.clientHeight) { e.preventDefault(); return; }
    const atTop = box.scrollTop <= 0 && e.deltaY < 0;
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 1 && e.deltaY > 0;
    if (atTop || atEnd) e.preventDefault();
  }, { passive: false });
  layer().append(pop);
  openPop = pop;
  const r = anchor.getBoundingClientRect();
  // Its layout size, not getBoundingClientRect(): the entry animation starts it scaled down (.97), which would place
  // it off centre and let the edge clamps push it a few pixels past the screen.
  const pr = { width: pop.offsetWidth, height: pop.offsetHeight };
  const gap = 8;
  let x;
  let y;
  // Above or below the anchor: lined up with its left edge, its right edge (align 'end') or its middle ('center').
  const along = () => (align === 'end' ? r.right - pr.width : align === 'center' ? r.left + r.width / 2 - pr.width / 2 : r.left);
  if (side === 'right') { x = r.right + gap; y = align === 'end' ? r.bottom - pr.height : r.top; }
  else if (side === 'left') { x = r.left - pr.width - gap; y = r.top; }
  else if (side === 'top') { x = along(); y = r.top - pr.height - gap; }
  else { x = along(); y = r.bottom + gap; }
  if (side === 'right' && x + pr.width > window.innerWidth - 8) x = r.left - pr.width - gap;
  if (side === 'left' && x < 8) x = r.right + gap;
  x = Math.max(8, Math.min(x, window.innerWidth - pr.width - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - pr.height - 8));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
  // Menus focus their first item; other popups take focus themselves unless something inside asks for it
  // (a search box), so keyboard users land inside instead of behind them.
  requestAnimationFrame(() => {
    if (!focus || openPop !== pop || pop.contains(document.activeElement)) return;
    const first = isMenu ? pop.querySelector('.menu-item') : null;
    (first || pop).focus({ preventScroll: true });
  });
  return pop;
}

// Roles and arrow keys for a .menu built by hand (the status menu) or by menuEl.
function menuSemantics(el) {
  if (el._menu) return;
  el._menu = true;
  if (!el.getAttribute('role')) el.setAttribute('role', 'menu');
  for (const it of el.querySelectorAll('.menu-item')) if (!it.getAttribute('role')) it.setAttribute('role', 'menuitem');
  for (const it of el.querySelectorAll('.menu-sep')) if (!it.getAttribute('role')) it.setAttribute('role', 'separator');
  el.addEventListener('keydown', (e) => {
    const btns = [...el.querySelectorAll('.menu-item:not(:disabled)')];
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement);
    let next = null;
    // A row with a submenu: → (or Enter, a click) opens it, its first item focused (subFlyout, below; a sheet's page).
    const at = btns[i];
    if (e.key === 'ArrowRight' && at && at._openSub) { e.preventDefault(); e.stopPropagation(); at._openSub({ focus: true }); return; }
    if (e.key === 'ArrowDown') next = btns[(i + 1) % btns.length];
    else if (e.key === 'ArrowUp') next = btns[(i - 1 + btns.length) % btns.length];
    else if (e.key === 'Home') next = btns[0];
    else if (e.key === 'End') next = btns[btns.length - 1];
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing a letter jumps to the next item that starts with it.
      const k = e.key.toLowerCase();
      const order = [...btns.slice(i + 1), ...btns.slice(0, i + 1)];
      next = order.find((b) => b.textContent.trim().toLowerCase().startsWith(k)) || null;
    }
    if (next) { e.preventDefault(); next.focus(); }
  });
}

// Menu items: { label, icon, hint, danger, action } | '-' (separator) | { header: 'Text' }
//   | { label, icon, value, submenu: () => items }: a row that opens more choices (Notifications ›, Mute ›…), showing
//     the one in force (value). Beside the menu on a desktop or tablet (a flyout: subFlyout); on a sheet, a second
//     page of the sheet with a Back row (sheetMenu). Long menus stay short this way.
// done: what picking one puts away first (the popup, or the sheet it's in).
// openSub(row, item, { focus }): how a submenu opens here (the flyout, unless the sheet passes its own).
function menuEl(items, done = closePopover, openSub = subFlyout) {
  const list = items.filter(Boolean);
  // (Separators only between things: a group that came out empty leaves none at the top, the bottom or twice.)
  const tidy = list.filter((it, i) => it !== '-' || (i > 0 && list[i - 1] !== '-' && i < list.length - 1));
  const el = h('div', { class: 'menu', role: 'menu' }, tidy.map((it) => {
    if (it === '-') return h('div', { class: 'menu-sep', role: 'separator' });
    if (it.header) return h('div', { class: 'menu-header', role: 'presentation' }, it.header);
    if (it.submenu) {
      const row = h('button', {
        class: 'menu-item has-sub', role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
        onclick: () => row._openSub({ focus: byKeys || !matchMedia('(hover: hover)').matches }),
      }, it.icon ? icon(it.icon, 'ic menu-ic') : null, h('span', { class: 'menu-label' }, it.label),
      it.value ? h('span', { class: 'menu-value' }, it.value) : null, icon('chevronRight', 'ic menu-sub'));
      row._openSub = (o = {}) => openSub(row, it, o);
      return row;
    }
    return h('button', {
      class: `menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}`,
      role: it.checked !== undefined ? 'menuitemradio' : 'menuitem',
      'aria-checked': it.checked !== undefined ? String(!!it.checked) : null,
      onclick: () => { done(); it.action(); },
    }, it.icon ? icon(it.icon, 'ic menu-ic') : null, h('span', { class: 'menu-label' }, it.label),
    it.checked ? icon('check', 'ic menu-check') : it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null);
  }));
  menuSemantics(el);
  if (openSub === subFlyout) hoverSubmenus(el);
  return el;
}

// ---- submenus beside a menu (desktops and tablets)
// The flyout sits inside the popup (so a click in it is a click inside, and closing the popup takes it too), to the
// right of its row, or to the left where there's no room. Hovering a row opens its flyout after a moment, and another
// row closes it; → or Enter opens it from the keyboard with its first item focused, ← or Esc closes it and puts focus
// back on its row.
const SUB_HOVER_MS = 150;
function closeFlyout(menuBox, { refocus = false } = {}) {
  const fly = menuBox && menuBox._fly;
  if (!fly) return;
  menuBox._fly = null;
  fly.remove();
  fly._row.setAttribute('aria-expanded', 'false');
  fly._row.classList.remove('sub-open');
  if (refocus) fly._row.focus({ preventScroll: true });
}
function subFlyout(row, it, { focus = false } = {}) {
  const parent = row.closest('.menu');
  const pop = row.closest('.popover');
  if (!parent || !pop) return;
  if (parent._fly && parent._fly._row === row) {
    if (focus) { const f = parent._fly.querySelector('.menu-item:not(:disabled)'); if (f) f.focus({ preventScroll: true }); }
    return;
  }
  closeFlyout(parent);
  const sub = menuEl(it.submenu() || []);
  sub.classList.add('menu-flyout');
  sub.setAttribute('aria-label', it.label);
  sub._row = row;
  parent._fly = sub;
  row.setAttribute('aria-expanded', 'true');
  row.classList.add('sub-open');
  sub.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFlyout(parent, { refocus: true }); }
  });
  sub.addEventListener('mouseenter', () => clearTimeout(parent._hoverT));
  pop.append(sub);
  // Viewport coordinates, then made relative to the popup it sits in (position: absolute there).
  const r = row.getBoundingClientRect();
  const pr = parent.getBoundingClientRect();
  const box = pop.getBoundingClientRect();
  const w = sub.offsetWidth;
  const ht = sub.offsetHeight;
  let x = pr.right - 4;
  if (x + w > innerWidth - 8) x = Math.max(8, pr.left - w + 4);
  const y = Math.max(8, Math.min(r.top - 6, innerHeight - ht - 8));
  sub.style.left = `${x - box.left}px`;
  sub.style.top = `${y - box.top}px`;
  if (focus) { const f = sub.querySelector('.menu-item:not(:disabled)'); if (f) f.focus({ preventScroll: true }); }
}
// Hover: a submenu row opens its flyout after a moment; any other row of the same menu closes it after the same
// moment (moving the pointer across to the flyout passes over nothing else, and entering it keeps it).
function hoverSubmenus(el) {
  el.addEventListener('mouseover', (e) => {
    if (lastPointer !== 'mouse') return;
    const row = e.target.closest && e.target.closest('.menu-item');
    if (!row || row.parentElement !== el) return;
    clearTimeout(el._hoverT);
    if (el._fly && el._fly._row === row) return;
    el._hoverT = setTimeout(() => {
      if (!el.isConnected) return;
      if (row._openSub) row._openSub({ focus: false });
      else closeFlyout(el);
    }, SUB_HOVER_MS);
  });
  el.addEventListener('mouseleave', () => clearTimeout(el._hoverT));
  // Arrowing to another row of this menu puts an open flyout away.
  el.addEventListener('focusin', (e) => { if (el._fly && e.target !== el._fly._row && e.target.parentElement === el) closeFlyout(el); });
}

// In the phone layout a menu is a sheet from the bottom of the screen, its items a finger's height apart (sheetMenu);
// { sheet: false } keeps it a popup there too (one on the picture viewer, the message box's +, whose pickers open
// beside it).
export function menu(anchor, items, opts = {}) {
  if (opts.sheet !== false && isPhoneLayout()) return sheetMenu(items, { label: opts.label || nameOf(anchor) || 'Options', returnTo: anchor });
  return popover(anchor, menuEl(items), { side: 'bottom', ...opts });
}
const nameOf = (el) => (el && el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('data-tip'))) || '';

// Right-click menu at the pointer. On a touch screen (a long press) and in the phone layout, a sheet instead.
export function contextMenu(e, items, opts = {}) {
  e.preventDefault();
  if (opts.sheet !== false && (isPhoneLayout() || isTouchUI())) {
    const at = e.currentTarget && e.currentTarget.nodeType === 1 ? e.currentTarget : e.target;
    return sheetMenu(items, { label: opts.label || 'Options', returnTo: at && at.closest ? at.closest('button, [tabindex]') || at : null });
  }
  const pt = h('span', { style: { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', width: '1px', height: '1px' } });
  document.body.append(pt);
  const pop = popover(pt, menuEl(items), { side: 'bottom', className: 'ctx' });
  pt.remove();
  return pop;
}

// ---- bottom sheets (phones and tablets)
// A panel that slides up from the bottom of the screen, for picking with a finger (a message's long-press actions).
// It closes on a tap outside it, a swipe down, Esc and the back gesture (app.js phoneNav: Back closes it like the
// other things that cover the screen), keeps Tab inside while it's open, and when it closes with focus inside, focus
// goes to returnTo (or back to what had it before): quietly when it was opened with a finger (quietFocus).
export function sheet(content, { label = 'Actions', returnTo = null, onClose } = {}) {
  closePopover();
  const opener = document.activeElement;
  const keys = byKeys;
  if (openSheet) openSheet._close({ replaced: true });
  let closed = false;
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabindex: '-1' },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }), content);
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, box);
  // replaced: another sheet takes this one's place (and its step in the history).
  function close({ replaced = false } = {}) {
    if (closed) return;
    closed = true;
    if (openSheet === backdrop) openSheet = null;
    const hadFocus = backdrop.contains(document.activeElement) || document.activeElement === document.body;
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 180);
    if (onClose) onClose({ replaced });
    if (hadFocus && !replaced) (keys ? restoreFocus : restoreQuietly)(returnTo, opener);
  }
  // Pages: push(content, label) shows more choices in the same sheet (a submenu, the message sheet's More…), with a
  // Back row at the top; Back, Esc and the back gesture go back a page before they close the sheet. (Something
  // replacing the sheet, or picking an item, still closes it at once: close() itself.)
  const pages = [];
  const content_ = () => [...box.childNodes].filter((n) => !(n.classList && n.classList.contains('sheet-grip')));
  function push(next, title) {
    pages.push({ kids: content_(), label: box.getAttribute('aria-label'), from: document.activeElement });
    for (const n of content_()) n.remove();
    const back = h('button', { class: 'sheet-back', 'aria-label': `Back to ${box.getAttribute('aria-label')}`, onclick: () => pop() }, icon('chevronLeft'), h('span', null, title));
    box.append(back, ...[next].flat());
    box.setAttribute('aria-label', title);
    box.scrollTop = 0;
    requestAnimationFrame(() => {
      if (closed) return;
      const first = box.querySelector('.menu-item:not(:disabled), .sheet-row, .sheet-quick') || back;
      (keys ? (el) => el.focus({ preventScroll: true }) : quietFocus)(first);
    });
  }
  function pop() {
    const was = pages.pop();
    if (!was) return;
    for (const n of content_()) n.remove();
    box.append(...was.kids);
    box.setAttribute('aria-label', was.label);
    const to = stillThere([was.from]);
    if (to) (keys ? (el) => el.focus({ preventScroll: true }) : quietFocus)(to);
    else box.focus({ preventScroll: true });
  }
  // (With no argument: Esc, Back. With one: replaced by another sheet, which closes it outright.)
  backdrop._close = (o) => (pages.length && !o ? pop() : close(o));
  box.addEventListener('keydown', (e) => trapTab(e, box));
  swipeToClose(box, close);
  layer().append(backdrop);
  openSheet = backdrop;
  // The sheet itself takes focus, so screen readers start at its name.
  requestAnimationFrame(() => { if (!closed && !box.contains(document.activeElement)) box.focus({ preventScroll: true }); });
  return { close: () => close(), box, push, back: pop };
}
// A menu as a bottom sheet: the same items (or a .menu built by hand, the status menu) and the same arrow keys, each
// item putting the sheet away as it's picked. A menu opened from one of them takes its place.
// A submenu row pushes its choices as a second page of the sheet, with a Back row (sheet().push).
export function sheetMenu(items, { label = 'Options', returnTo = null } = {}) {
  let sh = null;
  const done = () => { closePopover(); if (sh) sh.close(); };
  const page = (list) => {
    const m = menuEl(list, done, (row, it) => sh.push(page(it.submenu() || []), it.label));
    m.classList.add('sheet-menu');
    return m;
  };
  const el = Array.isArray(items) ? page(items) : items;
  el.classList.add('sheet-menu');
  menuSemantics(el);
  sh = sheet(el, { label, returnTo });
  sh.box._close = sh.close; // (what closes it, for a menu built by hand)
  return sh.box;
}
// Swiping a sheet down puts it away: it follows the finger and goes if pulled far or fast enough, else it springs
// back. Only while its list is scrolled to the top, so a long list still scrolls.
function swipeToClose(box, close) {
  let g = null; // { y, dy, t, v, on }
  box.addEventListener('touchstart', (e) => {
    g = e.touches.length === 1 && box.scrollTop <= 0 ? { y: e.touches[0].clientY, dy: 0, t: e.timeStamp, v: 0, on: false } : null;
  }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (!g) return;
    const dy = e.touches[0].clientY - g.y;
    if (!g.on) {
      // Upwards (or a move the page has already taken as a scroll) is the list's.
      if (dy <= 0 || !e.cancelable) { g = null; return; }
      g.on = true;
      box.classList.add('dragging');
    }
    e.preventDefault();
    const dt = e.timeStamp - g.t;
    if (dt > 0) g.v = 0.6 * ((dy - g.dy) / dt) + 0.4 * g.v; // px per ms, smoothed
    g.dy = dy; g.t = e.timeStamp;
    box.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  const end = (e) => {
    const was = g;
    g = null;
    if (!was || !was.on) return;
    box.classList.remove('dragging');
    // (The closing animation slides it on down from where the finger left it.)
    if (e.type === 'touchend' && (was.dy > Math.min(120, box.offsetHeight / 3) || was.v > 0.5)) close();
    else box.style.transform = '';
  };
  box.addEventListener('touchend', end);
  box.addEventListener('touchcancel', end);
}
// Tooltips for anything with data-tip (icon buttons). Shown on hover with a mouse and on keyboard focus; never from a
// finger or a pen: a tap makes the browser report a hover too, which would leave a tip standing over the screen until
// the next tap (lastPointer, from the pointer that went down last). hideTip is also called when the view changes
// (app.js setView), so a tip never outlives the screen it was for.
let tipEl = null;
let tipTimer = 0;
export function hideTip() { clearTimeout(tipTimer); if (tipEl) { tipEl.remove(); tipEl = null; } }
const noHover = () => typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
function showTip(target) {
  hideTip();
  const text = target.dataset.tip;
  if (!text) return;
  tipTimer = setTimeout(() => {
    if (!document.body.contains(target)) return;
    tipEl = h('div', { class: 'tooltip', role: 'tooltip' }, text);
    document.body.append(tipEl);
    const r = target.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    const side = target.dataset.tipSide || 'top';
    let x = r.left + r.width / 2 - t.width / 2;
    let y = r.top - t.height - 8;
    if (side === 'right') { x = r.right + 10; y = r.top + r.height / 2 - t.height / 2; }
    if (side === 'left') { x = r.left - t.width - 10; y = r.top + r.height / 2 - t.height / 2; }
    if (side === 'bottom' || y < 6) y = r.bottom + 8;
    tipEl.style.left = Math.max(6, Math.min(x, innerWidth - t.width - 6)) + 'px';
    tipEl.style.top = y + 'px';
  }, 350);
}
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (!t || lastPointer === 'touch' || lastPointer === 'pen' || noHover()) { hideTip(); return; }
  showTip(t);
});
document.addEventListener('focusin', (e) => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (t && t.matches(':focus-visible')) showTip(t); else hideTip();
});
document.addEventListener('mousedown', hideTip, true);
document.addEventListener('pointerup', hideTip, true);
document.addEventListener('scroll', hideTip, true);

// ---- long press on a row (touch screens)
// Channels, conversations, people, the server bar and the nav rows have their menus on a right-click (their own
// oncontextmenu, which opens a sheet on a touch screen: contextMenu above). iOS never reports a long press as one, so
// a finger held still on such a row for a moment sends it one, at the finger, with a short buzz. The tap that ends the
// press doesn't also go through, so holding a voice channel never joins its call. Android does report one itself:
// whichever comes first opens the menu, once. Messages have their own long press (app.js initLongPress).
const ROW_PRESS = '.ch-row, [data-nav], .member, .rail-btn, .dm-row, .conv-card, .cat-toggle';
const ROW_PRESS_MS = 450;
let rowPress = null; // { el, target, x, y, timer, done }
let eatClick = null; // { el, until }: the click that the lift after a long press would make on that row
const endRowPress = () => { if (rowPress && !rowPress.done) clearTimeout(rowPress.timer); };
document.addEventListener('touchstart', (e) => {
  endRowPress();
  rowPress = null;
  if (e.touches.length !== 1 || !isTouchUI() || !e.target.closest) return;
  const el = e.target.closest(ROW_PRESS);
  if (!el || e.target.closest('.msg, input, textarea, select, [contenteditable="true"]')) return;
  const t = e.touches[0];
  const p = { el, target: e.target, x: t.clientX, y: t.clientY, done: false };
  p.timer = setTimeout(() => {
    if (rowPress !== p || p.done || !p.target.isConnected) return;
    p.done = true;
    try { if (navigator.vibrate) navigator.vibrate(10); } catch { /* not allowed here */ }
    p.target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2 }));
  }, ROW_PRESS_MS);
  rowPress = p;
}, { passive: true, capture: true });
document.addEventListener('touchmove', (e) => {
  if (!rowPress || rowPress.done) return;
  const t = e.touches[0];
  if (e.touches.length > 1 || Math.hypot(t.clientX - rowPress.x, t.clientY - rowPress.y) > 10) { endRowPress(); rowPress = null; }
}, { passive: true, capture: true });
document.addEventListener('touchend', (e) => {
  const p = rowPress;
  endRowPress();
  rowPress = null;
  if (!p || !p.done) return;
  // The press opened a menu: the lift isn't a tap on the row (nor on the sheet that's now under the finger).
  if (e.cancelable) e.preventDefault();
  eatClick = { el: p.el, until: Date.now() + 700 };
}, { passive: false, capture: true });
document.addEventListener('touchcancel', () => { endRowPress(); rowPress = null; }, { passive: true, capture: true });
document.addEventListener('scroll', () => { if (rowPress && !rowPress.done) { endRowPress(); rowPress = null; } }, { passive: true, capture: true });
document.addEventListener('click', (e) => {
  const eat = eatClick;
  if (!eat || Date.now() > eat.until || !eat.el.contains(e.target)) return;
  eatClick = null;
  e.preventDefault();
  e.stopPropagation();
}, true);
// Android's own long-press right-click: the first one wins. Ours already opened the menu: the browser's is dropped.
// The browser's came first: ours is called off.
document.addEventListener('contextmenu', (e) => {
  if (!e.isTrusted || !rowPress) return;
  if (rowPress.done) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  clearTimeout(rowPress.timer);
  rowPress.done = true;
}, true);

// Icon-only button with a tooltip and an accessible label.
export function ibtn(name, label, onclick, { cls = '', side, active = false, attrs = {} } = {}) {
  return h('button', {
    class: `icon-btn ${cls}${active ? ' active' : ''}`.trim(),
    'aria-label': label, 'data-tip': label, 'data-tip-side': side || null,
    'aria-pressed': active ? 'true' : null,
    onclick, ...attrs,
  }, icon(name));
}

let dialogSeq = 0;
export function modal({ title, label, body, actions = [], size = 'md', onClose, className = '', dismissable = true }) {
  closePopover();
  // A dialog opened from a sheet (a menu's item, on a phone) takes its place rather than opening behind it.
  if (openSheet) openSheet._close(); // (focus goes back where it came from, which this one gives it back to)
  // Where focus goes back to on close. If this dialog was opened from inside another one that is closing
  // (Back / Next between dialogs), fall back to whatever opened that one.
  const opener = document.activeElement;
  const parent = opener && opener.closest && opener.closest('.modal-backdrop');
  const fallback = parent ? parent._opener : null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const hadFocus = backdrop.contains(document.activeElement) || document.activeElement === document.body;
    backdrop.classList.add('closing');
    setTimeout(() => backdrop.remove(), 140);
    if (onClose) onClose();
    // Only take focus back if no newer dialog opened on top in the meantime (it has focus now).
    const newer = [...document.querySelectorAll('.modal-backdrop:not(.closing)')].some((b) => backdrop.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (hadFocus && !newer) restoreFocus(opener, fallback);
  };
  const titleId = `dlg-${++dialogSeq}`;
  const box = h('div', {
    class: `modal modal-${size} ${className}`, role: 'dialog', 'aria-modal': 'true', tabindex: '-1',
    'aria-labelledby': title ? titleId : null, 'aria-label': title ? null : label || 'Dialog',
  },
  title ? h('div', { class: 'modal-head' }, h('h2', { id: titleId }, title),
    dismissable ? h('button', { class: 'icon-btn modal-x', 'aria-label': 'Close', onclick: close }, icon('close')) : null) : null,
  h('div', { class: 'modal-body' }, body),
  actions.length ? h('div', { class: 'modal-foot' }, actions.map((a) => h('button', {
    class: `btn ${a.kind || 'ghost'}`,
    type: a.submit ? 'submit' : 'button',
    onclick: async (e) => {
      if (!a.action) return close();
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const keep = await a.action();
        if (keep !== false) close();
      } catch (err) {
        showError(box, err.message);
      } finally { btn.disabled = false; }
    },
  }, a.label))) : null);
  const backdrop = h('div', { class: 'modal-backdrop', onmousedown: (e) => { if (dismissable && e.target === backdrop) close(); } }, box);
  backdrop._close = dismissable ? close : () => {};
  backdrop._opener = opener && opener.isConnected && !(parent && parent.classList.contains('closing')) ? opener : fallback || opener;
  backdrop.dataset.locked = dismissable ? '' : '1';
  layer().append(backdrop);
  // Focus the first field; dialogs without one focus themselves so screen readers start at the title.
  const first = box.querySelector('input:not([type=file]), textarea, select');
  setTimeout(() => {
    if (closed || box.contains(document.activeElement)) return;
    if (first && !className.includes('mys-modal')) first.focus({ preventScroll: true });
    else box.focus({ preventScroll: true });
  }, 30);
  box.addEventListener('keydown', (e) => {
    // Tab stays inside the dialog that's on top.
    if (e.key === 'Tab' && !openPop) trapTab(e, box);
    // enter submits primary
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'INPUT') {
      const primary = box.querySelector('.modal-foot .btn.primary, .modal-foot .btn.danger');
      if (primary) { e.preventDefault(); primary.click(); }
    }
  });
  return { close, box };
}

// Shows an error in a dialog and ties it to the field it's about (`input`, or the field that has focus,
// or the dialog's only field), so screen readers read it with that field.
export function showError(box, message, input) {
  let err = box.querySelector('.form-error');
  if (!err) {
    err = h('div', { class: 'form-error', role: 'alert' });
    (box.querySelector('.modal-body') || box).append(err);
  }
  if (!err.id) err.id = `err-${++dialogSeq}`;
  err.textContent = message;
  const fields = [...box.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), textarea, select')];
  const target = input || (fields.includes(document.activeElement) ? document.activeElement : fields.length === 1 ? fields[0] : null);
  if (target) markInvalid(target, err);
}

// aria-invalid + aria-describedby on `input` pointing at `err`, cleared again as soon as the person edits it.
export function markInvalid(input, err) {
  if (!err.id) err.id = `err-${++dialogSeq}`;
  input.setAttribute('aria-invalid', 'true');
  const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter((x) => x && x !== err.id);
  input.setAttribute('aria-describedby', [...ids, err.id].join(' '));
  if (!input._clearsError) {
    input._clearsError = true;
    input.addEventListener('input', () => clearInvalid(input));
  }
}
export function clearInvalid(input) {
  input.removeAttribute('aria-invalid');
  const ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter((x) => x && !x.startsWith('err-'));
  if (ids.length) input.setAttribute('aria-describedby', ids.join(' ')); else input.removeAttribute('aria-describedby');
}

export function confirmDialog({ title, text, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title,
      body: h('p', { class: 'muted-p' }, text),
      size: 'sm',
      onClose: () => { if (!done) resolve(false); },
      actions: [
        { label: 'Cancel' },
        { label: confirm, kind: danger ? 'danger' : 'primary', action: () => { done = true; resolve(true); } },
      ],
    });
  });
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
}
