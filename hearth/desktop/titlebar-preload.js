// The bridge for titlebar.html only (the strip at the top of the window). It can ask for the app's menu and
// hear whether the window is focused or maximized; nothing else. The server's page never gets this: it has
// its own preload.js, and no way to move, minimize or close the window. main.js checks that the menu
// request comes from this strip's own page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hearthTitlebar', {
  // cb({ focused, maximized, fullscreen, menuOpen? })
  onState: (cb) => ipcRenderer.on('titlebar:state', (e, s) => cb(s)),
  openMenu: () => ipcRenderer.send('titlebar:menu'),
});
