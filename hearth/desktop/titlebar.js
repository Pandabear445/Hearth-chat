// The title bar strip (titlebar.html). It shows the app's name and opens the app's menu; the window's own
// buttons are the system's. main.js tells it when the window is focused, maximized or full screen, and which colours to use.
(() => {
  const q = new URLSearchParams(location.search);
  const name = (q.get('name') || '').trim().slice(0, 40);
  if (name) document.getElementById('name').textContent = name;
  document.body.classList.toggle('mac', q.get('platform') === 'darwin');
  const brand = document.getElementById('brand');
  const bridge = window.hearthTitlebar;
  brand.addEventListener('click', () => {
    if (!bridge) return;
    brand.setAttribute('aria-expanded', 'true');
    bridge.openMenu();
  });
  if (bridge) {
    bridge.onState((s) => {
      if (!s || typeof s !== 'object') return;
      document.body.classList.toggle('blurred', s.focused === false);
      document.body.classList.toggle('maximized', !!s.maximized);
      const c = s.colors;
      const hex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
      if (c && hex(c.bg) && hex(c.fg) && hex(c.fgBlurred)) {
        const root = document.documentElement.style;
        root.setProperty('--bar-bg', c.bg); root.setProperty('--bar-fg', c.fg); root.setProperty('--bar-fg-blurred', c.fgBlurred);
        document.body.classList.toggle('light', !!c.light);
      }
      if (s.menuOpen === false) brand.setAttribute('aria-expanded', 'false');
    });
  }
})();
