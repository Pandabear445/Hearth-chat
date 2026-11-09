// The title bar strip (titlebar.html). It shows the app's name and opens the app's menu; the window's own
// buttons are the system's. main.js tells it when the window is focused, maximized or full screen.
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
      if (s.menuOpen === false) brand.setAttribute('aria-expanded', 'false');
    });
  }
})();
