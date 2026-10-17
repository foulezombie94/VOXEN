const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Menu,
  Tray,
  nativeImage,
  screen,
  shell,
  clipboard,
  dialog,
  safeStorage,
  autoUpdater,
  net,
} = require('electron');
const path = require('node:path'),
  fs = require('node:fs');
const { Store } = require('./store.cjs'),
  { Engine, safe } = require('./engine.cjs'),
  native = require('./windows.cjs'),
  providers = require('./providers.cjs');
const { Workspace, ACTIONS: workspaceActions } = require('./workspace.cjs');
const { Cloud, ACTIONS: cloudActions } = require('./cloud.cjs');
const { Updates, ACTIONS: updateActions, installationMode } = require('./updates.cjs');
const { handleSquirrel, APP_ID } = require('./squirrel.cjs');
const { loadClientConfig } = require('./cloud-config.cjs');
const {
  legacyAccelerator,
  shouldSuspendForFocusedWindow,
  virtualKeyOf,
} = require('./hotkey-policy.cjs');
const args = process.argv;
const diagnosticIndex = args.indexOf('--ui-self-test');
const diagnostic = diagnosticIndex >= 0;
const diagnosticDir = diagnostic ? path.resolve(args[diagnosticIndex + 1]) : null;
app.setName('Voxen');
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
const squirrelHandled = !diagnostic && handleSquirrel({ app });
if (diagnostic) {
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(diagnosticDir, 'profile'));
}
let hub,
  overlay,
  capture,
  notesWindow,
  tray,
  store,
  engine,
  workspace,
  cloud,
  updater,
  localDestination,
  quitting = false,
  inserting = false,
  poll,
  previousDown = false,
  lastToggle = 0,
  anchor = null,
  keyboardWarning = '',
  capturingShortcut = false,
  dataCache = null;
const preload = path.join(__dirname, 'preload.cjs');
const renderer = path.resolve(__dirname, '../../dist/renderer/index.html');
const allowedActions = new Set([
  'dictation.toggle',
  'dictation.local',
  'notes.open',
  'notes.pin',
  'dictation.copyLast',
  'dictation.finish',
  'dictation.cancel',
  'dictation.pause',
  'overlay.hide',
  'overlay.move',
  'overlay.show',
  'overlay.recenter',
  'overlay.menu',
  'window.minimize',
  'window.close',
  'window.toggleMaximize',
  'hub.open',
  'settings.save',
  'shortcut.capture',
  'credentials.save',
  'credentials.test',
  'history.copy',
  'history.delete',
  'history.clear',
  'dictionary.add',
  'dictionary.delete',
  'replacement.save',
  'replacement.delete',
  'permissions.microphoneSettings',
  'permissions.soundSettings',
  'microphone.test',
]);
function refreshData() {
  dataCache = {
    settings: engine.settings,
    history: store.history(),
    dictionary: store.terms(),
    replacements: store.replacements(),
    ...workspace?.data(),
  };
}
function snapshot() {
  return {
    ...dataCache,
    cloud: cloud?.status(),
    updates: updater?.status(),
    status: { ...engine.status(), keyboardWarning, transforming: workspace?.busy || false },
    versions: {
      app: app.getVersion(),
      electron: process.versions.electron,
      react: '18.3.1',
      node: process.versions.node,
    },
  };
}
function broadcast() {
  if (!engine) return;
  const value = snapshot();
  for (const win of [hub, overlay, notesWindow])
    if (win && !win.isDestroyed()) win.webContents.send('voxen:snapshot', value);
}
function overlayBounds() {
  const display = anchor
    ? screen.getDisplayNearestPoint(anchor)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const width =
    engine.state === 'error' && engine.lastFinalText
      ? 320
      : engine.state === 'recording'
        ? 192
        : engine.state === 'processing' || engine.state === 'error'
          ? 224
          : 72;
  const height = engine.state === 'error' ? (engine.lastFinalText ? 235 : 150) : 60;
  const center = anchor || { x: area.x + area.width / 2, y: area.y + area.height - 10 };
  return {
    x: Math.round(Math.max(area.x, Math.min(center.x - width / 2, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(center.y - height, area.y + area.height - height))),
    width,
    height,
  };
}
function showOverlay() {
  if (diagnostic) return;
  overlay.setBounds(overlayBounds());
  overlay.showInactive();
  if (engine.state === 'error' && !engine.lastFinalText) {
    clearTimeout(showOverlay.timer);
    showOverlay.timer = setTimeout(() => {
      if (engine.state === 'error') {
        engine.set('ready', 'Prêt à réessayer.');
      }
    }, 8000);
  }
}
function toggle() {
  if (workspace?.busy || updater?.installing) return;
  const now = Date.now();
  if (now - lastToggle < 450) return;
  lastToggle = now;
  const targetWindow = hub?.isFocused() ? hub : notesWindow?.isFocused() ? notesWindow : null;
  if (targetWindow && engine.state !== 'recording' && !engine.busy()) {
    localDestination = {
      sender: targetWindow.webContents,
      context: { noteId: 0 },
    };
    if (targetWindow === hub) hub.webContents.send('voxen:navigate', 'scratchpad');
  }
  void engine
    .toggle({ local: Boolean(targetWindow) })
    .catch(() => engine.set('error', 'Impossible de démarrer le microphone.'));
}
function registerShortcut() {
  globalShortcut.unregisterAll();
  clearInterval(poll);
  poll = null;
  const accelerator =
    engine?.settings.HotkeyAccelerator || legacyAccelerator(engine?.settings.HotkeyVirtualKey);
  const appWindowFocused = hub?.isFocused() || notesWindow?.isFocused();
  if (
    diagnostic ||
    !engine ||
    engine.paused ||
    inserting ||
    updater?.installing ||
    workspace?.busy ||
    capturingShortcut ||
    shouldSuspendForFocusedWindow(accelerator, appWindowFocused)
  )
    return true;
  keyboardWarning = '';
  const vk = virtualKeyOf(accelerator);
  if (vk != null) {
    previousDown = native.isShortcutDown(vk);
    poll = setInterval(() => {
      const down = native.isShortcutDown(vk);
      if (down && !previousDown) toggle();
      previousDown = down;
    }, 20);
  } else {
    if (!globalShortcut.register(accelerator, toggle))
      keyboardWarning = 'Le raccourci est utilisé par une autre application.';
  }
  return !keyboardWarning;
}
function openHub() {
  hub.show();
  if (hub.isMinimized()) hub.restore();
  hub.focus();
}
function menu() {
  Menu.buildFromTemplate([
    { label: 'Ouvrir Voxen', click: openHub },
    {
      label: 'Paramètres',
      click: () => {
        openHub();
        hub.webContents.send('voxen:navigate', 'settings');
      },
    },
    { type: 'separator' },
    {
      label: engine.paused ? 'Reprendre la dictée' : 'Mettre la dictée en pause',
      enabled: !engine.busy(),
      click: async () => {
        await engine.togglePause();
        registerShortcut();
        broadcast();
      },
    },
    {
      label: 'Recentrer la capsule',
      click: () => {
        anchor = null;
        overlay.setBounds(overlayBounds());
      },
    },
    { label: 'Masquer le micro', click: () => overlay.hide() },
    { type: 'separator' },
    { label: 'Quitter Voxen', click: () => app.quit() },
  ]).popup({ window: overlay });
}
function ownSender(event) {
  return [hub?.webContents.id, overlay?.webContents.id, notesWindow?.webContents.id].includes(
    event.sender.id,
  );
}
function captureSender(event) {
  return capture && event.sender.id === capture.webContents.id;
}
async function action(event, { action, payload } = {}) {
  if (
    !ownSender(event) ||
    (!allowedActions.has(action) &&
      !workspaceActions.has(action) &&
      !cloudActions.has(action) &&
      !updateActions.has(action))
  )
    throw new Error('Action indisponible.');
  payload ??= {};
  try {
    if (updateActions.has(action)) {
      if (event.sender.id !== hub?.webContents.id)
        throw new Error('Ouvrez les mises à jour dans les paramètres de Voxen.');
      return await updater.handle(action, payload);
    }
    if (updater?.installing && action !== 'notes.save')
      throw new Error('Voxen prépare son redémarrage.');
    if (cloudActions.has(action)) {
      if (event.sender.id !== hub?.webContents.id)
        throw new Error('Connexion : ouvrez les paramètres dans la fenêtre principale.');
      return await cloud.handle(action, payload);
    }
    if (workspaceActions.has(action)) {
      const result = await workspace.handle(action, payload);
      if (
        ![
          'notes.versions',
          'data.export',
          'text.copy',
          'transform.run',
          'transform.cancel',
        ].includes(action)
      )
        cloud?.markDirty();
      refreshData();
      broadcast();
      return result;
    }
    switch (action) {
      case 'dictation.local':
      case 'dictation.toggle': {
        if (workspace.busy) throw new Error('Impossible de dicter pendant une transformation.');
        const local =
          action === 'dictation.local' ||
          event.sender.id !== overlay.webContents.id ||
          hub.isFocused() ||
          notesWindow?.isFocused();
        if (local && engine.state !== 'recording' && !engine.busy())
          localDestination = {
            sender:
              event.sender.id === overlay.webContents.id
                ? notesWindow?.isFocused()
                  ? notesWindow.webContents
                  : hub.webContents
                : event.sender,
            context: { noteId: Number(payload.noteId) || 0 },
          };
        if (local && !engine.busy() && event.sender.id !== notesWindow?.webContents.id)
          hub.webContents.send('voxen:navigate', 'scratchpad');
        await engine.toggle({ local });
        break;
      }
      case 'notes.open':
        await openNotes();
        break;
      case 'notes.pin':
        if (notesWindow) notesWindow.setAlwaysOnTop(!notesWindow.isAlwaysOnTop());
        return { pinned: notesWindow?.isAlwaysOnTop() || false };
      case 'dictation.copyLast':
        if (engine.lastFinalText && !diagnostic) clipboard.writeText(engine.lastFinalText);
        return { ok: true };
      case 'dictation.finish':
        await engine.finish();
        break;
      case 'dictation.cancel':
        await engine.cancel();
        break;
      case 'dictation.pause':
        await engine.togglePause();
        registerShortcut();
        break;
      case 'overlay.hide':
        overlay.hide();
        break;
      case 'overlay.show':
        showOverlay();
        break;
      case 'overlay.move': {
        if (!Number.isFinite(payload.dx) || !Number.isFinite(payload.dy)) break;
        const bounds = overlay.getBounds();
        anchor = {
          x: bounds.x + bounds.width / 2 + Math.max(-200, Math.min(200, payload.dx)),
          y: bounds.y + bounds.height + Math.max(-200, Math.min(200, payload.dy)),
        };
        overlay.setBounds(overlayBounds());
        break;
      }
      case 'overlay.recenter':
        anchor = null;
        overlay.setBounds(overlayBounds());
        break;
      case 'overlay.menu':
        menu();
        break;
      case 'window.minimize':
        (event.sender.id === notesWindow?.webContents.id ? notesWindow : hub).minimize();
        break;
      case 'window.close':
        (event.sender.id === notesWindow?.webContents.id ? notesWindow : hub).hide();
        registerShortcut();
        break;
      case 'window.toggleMaximize': {
        const win = event.sender.id === notesWindow?.webContents.id ? notesWindow : hub;
        win.isMaximized() ? win.unmaximize() : win.maximize();
        break;
      }
      case 'hub.open':
        openHub();
        break;
      case 'settings.save': {
        if (engine.busy()) throw new Error('Attendez la fin de la dictée.');
        const previous = engine.settings;
        const next = store.saveSettings(payload);
        engine.settings = next;
        if (!diagnostic && previous.StartWithWindows !== next.StartWithWindows)
          configureLogin(next.StartWithWindows);
        refreshData();
        registerShortcut();
        break;
      }
      case 'shortcut.capture': {
        if (event.sender.id !== hub?.webContents.id)
          throw new Error('Ouvrez les paramètres de Voxen pour choisir ce raccourci.');
        capturingShortcut = Boolean(payload.active);
        registerShortcut();
        break;
      }
      case 'credentials.save':
        if (diagnostic) throw new Error('Clés désactivées pendant les contrôles.');
        if (engine.busy()) throw new Error('Attendez la fin de la dictée.');
        native.saveCredential(payload.provider, payload.value);
        payload.value = '';
        engine.refreshKeys();
        break;
      case 'credentials.test':
        if (diagnostic) throw new Error('Réseau désactivé pendant les contrôles.');
        return await native.withCredential(payload.provider, (key) =>
          providers.testProvider(payload.provider, key),
        );
      case 'microphone.test':
        return await engine.testMicrophone();
      case 'permissions.microphoneSettings':
        if (!diagnostic) await shell.openExternal('ms-settings:privacy-microphone');
        break;
      case 'permissions.soundSettings':
        if (!diagnostic) await shell.openExternal('ms-settings:sound');
        break;
      case 'history.copy': {
        const item = store.history().find((d) => d.Id === Number(payload.id));
        if (item && !diagnostic) clipboard.writeText(payload.raw ? item.RawText : item.FinalText);
        break;
      }
      case 'history.delete':
        store.deleteDictation(payload.id);
        refreshData();
        break;
      case 'history.clear':
        store.clearHistory();
        refreshData();
        break;
      case 'dictionary.add':
        store.addTerm(payload.term);
        refreshData();
        break;
      case 'dictionary.delete':
        store.deleteTerm(payload.id);
        refreshData();
        break;
      case 'replacement.save':
        store.saveReplacement(payload);
        refreshData();
        break;
      case 'replacement.delete':
        store.deleteReplacement(payload.id);
        refreshData();
        break;
    }
    if (
      [
        'settings.save',
        'history.delete',
        'history.clear',
        'dictionary.add',
        'dictionary.delete',
        'replacement.save',
        'replacement.delete',
      ].includes(action)
    )
      cloud?.markDirty();
    broadcast();
    return { ok: true };
  } catch (error) {
    throw new Error(safe(error));
  }
}
function protectWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}
function configureLogin(enabled) {
  const installed = updater?.mode === 'installed';
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: installed
      ? path.resolve(path.dirname(process.execPath), '..', 'Update.exe')
      : process.execPath,
    args: installed
      ? ['--processStart', 'Voxen.exe', '--process-start-args', '--tray']
      : ['--tray'],
    name: 'Voxen',
  });
}
async function createWindows() {
  const preferences = {
    preload,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    backgroundThrottling: false,
    webSecurity: true,
    spellcheck: false,
    offscreen: diagnostic,
  };
  hub = new BrowserWindow({
    title: 'Voxen',
    width: 1240,
    height: 850,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#f5f4f0',
    webPreferences: preferences,
  });
  overlay = new BrowserWindow({
    title: 'Voxen · Dictée',
    width: 72,
    height: 60,
    frame: false,
    transparent: true,
    show: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    webPreferences: preferences,
  });
  capture = new BrowserWindow({
    title: 'Voxen · Capture interne',
    show: false,
    width: 1,
    height: 1,
    skipTaskbar: true,
    focusable: false,
    webPreferences: preferences,
  });
  for (const win of [hub, overlay, capture]) protectWindow(win);
  capture.webContents.session.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      const local = contents.id === capture.webContents.id && permission === 'media' && !diagnostic;
      callback(local && !(details.mediaTypes || []).includes('video'));
    },
  );
  capture.webContents.session.setPermissionCheckHandler(
    (contents, permission) =>
      contents?.id === capture.webContents.id && permission === 'media' && !diagnostic,
  );
  ipcMain.handle('voxen:snapshot', (event) => {
    if (!ownSender(event)) throw new Error('Vue non autorisée.');
    return snapshot();
  });
  ipcMain.handle('voxen:action', action);
  ipcMain.on('voxen:audio-started', (event, value) => {
    if (captureSender(event) && value.sessionId === engine.sessionId) {
      engine.audioStarted(value.sessionId);
      if (!diagnostic && engine.state === 'recording' && engine.settings.StartSound) shell.beep();
    }
  });
  ipcMain.on('voxen:audio-frame', (event, value) => {
    if (captureSender(event) && value.data instanceof ArrayBuffer && value.data.byteLength === 1024)
      engine.audioFrame(value.sessionId, value.data);
  });
  ipcMain.on('voxen:audio-error', (event, value) => {
    if (captureSender(event))
      engine.captureError(
        value.sessionId,
        'Accès au microphone impossible. Vérifiez les autorisations Windows.',
      );
  });
  engine.on('capture', (value) => {
    if (!capture.isDestroyed()) capture.webContents.send('voxen:audio-command', value);
    if (
      !diagnostic &&
      value.command === 'stop' &&
      engine.state === 'processing' &&
      engine.settings.EndSound
    )
      shell.beep();
  });
  engine.on('change', broadcast);
  engine.on('data', () => {
    cloud?.markDirty();
    refreshData();
    broadcast();
  });
  engine.on('overlay', showOverlay);
  engine.on('levels', (levels) => {
    for (const win of [hub, overlay, notesWindow])
      if (win && !win.isDestroyed()) win.webContents.send('voxen:levels', levels);
  });
  engine.on('local-text', (value) => {
    const destination = localDestination;
    if (destination?.sender && !destination.sender.isDestroyed()) {
      if (destination.sender.id === hub.webContents.id)
        destination.sender.send('voxen:navigate', 'scratchpad');
      destination.sender.send('voxen:local-text', { ...value, ...destination.context });
    }
  });
  engine.on('microphone-level', (value) => {
    for (const win of [hub, notesWindow])
      if (win && !win.isDestroyed()) win.webContents.send('voxen:microphone-level', value);
  });
  engine.on('before-insert', () => {
    inserting = true;
    registerShortcut();
  });
  engine.on('after-insert', () => {
    inserting = false;
    registerShortcut();
  });
  hub.on('focus', registerShortcut);
  hub.on('blur', registerShortcut);
  hub.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      hub.hide();
      registerShortcut();
    }
  });
  overlay.on('moved', () => {
    if (!overlay.isDestroyed() && overlay.isVisible()) {
      const bounds = overlay.getBounds();
      anchor = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height };
    }
  });
  await Promise.all([
    hub.loadFile(renderer),
    overlay.loadFile(renderer, { query: { view: 'overlay' } }),
    capture.loadFile(renderer, { query: { view: 'capture' } }),
  ]);
}
async function openNotes() {
  if (notesWindow && !notesWindow.isDestroyed()) {
    notesWindow.show();
    notesWindow.focus();
    return;
  }
  notesWindow = new BrowserWindow({
    title: 'Voxen · Notes',
    width: 860,
    height: 650,
    minWidth: 640,
    minHeight: 450,
    frame: false,
    show: false,
    alwaysOnTop: true,
    backgroundColor: '#f5f4f0',
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  protectWindow(notesWindow);
  notesWindow.on('focus', registerShortcut);
  notesWindow.on('blur', registerShortcut);
  notesWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      notesWindow.hide();
      registerShortcut();
    }
  });
  notesWindow.on('closed', () => {
    notesWindow = null;
    registerShortcut();
  });
  await notesWindow.loadFile(renderer, { query: { view: 'scratchpad' } });
  notesWindow.show();
  notesWindow.focus();
}
async function uiSelfTest() {
  const executeScript = hub.webContents.executeJavaScript.bind(hub.webContents);
  hub.webContents.executeJavaScript = async (code, ...options) => {
    try {
      return await executeScript(code, ...options);
    } catch (error) {
      throw new Error('Diagnostic renderer [' + code.slice(0, 220) + '] : ' + error.message);
    }
  };
  await hub.webContents.executeJavaScript(
    `new Promise((resolve,reject)=>{const started=Date.now();const check=()=>{if(document.querySelector('aside nav button')&&document.querySelector('button[aria-label="Compte"]'))return resolve(true);if(Date.now()-started>10000)return reject(new Error('Interface initiale indisponible'));setTimeout(check,50)};check()})`,
  );
  const result = {
    electron: process.versions.electron,
    node: process.versions.node,
    react: '18.3.1',
    popupHiddenOnStartup: !overlay.isVisible(),
    microphoneOpened: false,
    networkRequests: 0,
    credentialValuesRead: false,
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await hub.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
  await wait(300);
  result.noTutorialAtStartup = await hub.webContents.executeJavaScript(
    "!document.querySelector('[data-tutorial]')",
  );
  if (!result.noTutorialAtStartup) throw new Error('Un tutoriel apparaît au démarrage');
  async function shot(win, name) {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(diagnosticDir, name + '.png'), image.toPNG());
  }
  hub.setSize(1240, 850);
  await wait(100);
  await shot(hub, 'sidebar-dashboard');
  result.sidebarUpdatePosition = await hub.webContents.executeJavaScript(
    `(()=>{const card=document.querySelector('[aria-label="Découvrir Voxen"]'),button=document.querySelector('[data-sidebar-update]');if(!card||!button)return false;return card.nextElementSibling===button&&button.getBoundingClientRect().top>=card.getBoundingClientRect().bottom&&button.getBoundingClientRect().bottom<innerHeight})()`,
  );
  if (!result.sidebarUpdatePosition) throw new Error('Bouton de mise à jour absent sous le guide');
  await hub.webContents.executeJavaScript(
    "document.querySelector('[data-sidebar-update]').click()",
  );
  await wait(350);
  result.sidebarUpdateOpensSystem = await hub.webContents.executeJavaScript(
    "!!document.querySelector('[data-settings-panel=system]:not([hidden]) [data-updates-panel]')",
  );
  if (!result.sidebarUpdateOpensSystem)
    throw new Error('Bouton de mise à jour ne rejoint pas le suivi');
  await hub.webContents.executeJavaScript(
    'document.querySelector(\'[aria-label="Fermer les paramètres"]\').click()',
  );
  await wait(100);
  result.sidebar = await hub.webContents.executeJavaScript(
    `(()=>{const e=document.querySelector('aside');const item=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Dictée');const s=getComputedStyle(e),i=getComputedStyle(item);return{width:e.getBoundingClientRect().width,background:s.backgroundColor,font:i.fontFamily,fontSize:i.fontSize,fontWeight:i.fontWeight,activeBackground:i.backgroundColor}})()`,
  );
  if (
    result.sidebar.width !== 216 ||
    !result.sidebar.font.includes('Figtree') ||
    result.sidebar.fontSize !== '15px'
  )
    throw new Error('Métriques sidebar différentes des preuves REA');
  const accountClick = () =>
    hub.webContents.executeJavaScript(
      `document.querySelector('button[aria-label="Compte"]')?.click()`,
    );
  await accountClick();
  await wait(250);
  result.accountMenu = await hub.webContents.executeJavaScript(
    `(()=>{const e=document.querySelector('[data-account-menu]');if(!e)return null;const b=e.getBoundingClientRect();return {width:b.width,top:b.top,right:innerWidth-b.right,font:getComputedStyle(e).fontFamily,settingsClosed:!document.querySelector('[data-settings-dialog]'),triggerActive:document.querySelector('button[aria-label="Compte"]')?.getAttribute('aria-expanded')==='true'}})()`,
  );
  if (
    result.accountMenu?.width !== 426 ||
    Math.abs(result.accountMenu.top - 52) > 1 ||
    Math.abs(result.accountMenu.right - 8) > 1 ||
    !result.accountMenu.settingsClosed ||
    !result.accountMenu.triggerActive
  )
    throw new Error('Carte Compte différente du comportement REA');
  await shot(hub, 'account-button');
  await accountClick();
  await wait(200);
  result.accountSecondClickCloses = await hub.webContents.executeJavaScript(
    `!document.querySelector('[data-account-menu]')`,
  );
  if (!result.accountSecondClickCloses) throw new Error('Second clic compte ne ferme pas la carte');
  await accountClick();
  await wait(200);
  await hub.webContents.executeJavaScript(
    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}))`,
  );
  await wait(200);
  result.accountEscapeCloses = await hub.webContents.executeJavaScript(
    `!document.querySelector('[data-account-menu]')`,
  );
  if (!result.accountEscapeCloses) throw new Error('Échap ne ferme pas la carte Compte');
  await accountClick();
  await wait(200);
  await hub.webContents.executeJavaScript(
    `(()=>{const e=document.querySelector('[data-account-backdrop]');for(const type of ['pointerdown','pointerup'])e.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'mouse',button:0,isPrimary:true}));e.click()})()`,
  );
  await wait(200);
  result.accountOutsideCloses = await hub.webContents.executeJavaScript(
    `!document.querySelector('[data-account-menu]')`,
  );
  if (!result.accountOutsideCloses) throw new Error('Clic extérieur ne ferme pas la carte Compte');
  await accountClick();
  await wait(200);
  await hub.webContents.executeJavaScript(
    `document.querySelector('[data-account-manage]')?.click()`,
  );
  await wait(200);
  result.accountManageOpensProfile = await hub.webContents.executeJavaScript(
    `!!document.querySelector('[data-settings-panel="profile"]:not([hidden]) [data-cloud-account]')&&!document.querySelector('[data-account-menu]')`,
  );
  if (!result.accountManageOpensProfile)
    throw new Error('Gérer mon compte ne rejoint pas le compte');
  await shot(hub, 'account-manage');
  await hub.webContents.executeJavaScript(
    `document.querySelector('[aria-label="Fermer les paramètres"]')?.click()`,
  );
  await wait(100);
  await accountClick();
  await wait(200);
  await hub.webContents.executeJavaScript(
    `document.querySelector('[data-account-settings]')?.click()`,
  );
  await wait(200);
  result.accountSettingsOpensGeneral = await hub.webContents.executeJavaScript(
    `!!document.querySelector('[data-settings-panel="general"]:not([hidden])')`,
  );
  if (!result.accountSettingsOpensGeneral)
    throw new Error('Raccourci paramètres du compte incorrect');
  await hub.webContents.executeJavaScript(
    `document.querySelector('[aria-label="Fermer les paramètres"]')?.click()`,
  );
  await wait(100);
  result.pages = [];
  for (const label of [
    'Statistiques',
    'Dictionnaire',
    'Raccourcis',
    'Style',
    'Transformations',
    'Bloc-notes',
    'Paramètres',
  ]) {
    await hub.webContents.executeJavaScript(
      `(()=>{const label=${JSON.stringify(label)};const b=[...document.querySelectorAll('button')].find(e=>e.title===label||e.textContent.trim()===label);if(!b)throw new Error('Navigation absente');b.click()})()`,
    );
    await wait(100);
    const heading = await hub.webContents.executeJavaScript(
      "document.querySelector('h1')?.textContent||''",
    );
    if (!heading) throw new Error('Page vide');
    result.pages.push({ label, heading });
    if (label === 'Dictionnaire') await shot(hub, 'tutorial-dictionary-intro');
    await hub.webContents.executeJavaScript(
      'document.querySelector(\'[aria-label="Fermer le guide"]\')?.click()',
    );
    await wait(80);
    if (label === 'Paramètres') {
      await shot(hub, 'settings');
      await settingsSelfTest();
    }
    if (label === 'Dictionnaire') await shot(hub, 'dictionary');
  }
  await hub.webContents.executeJavaScript(
    `document.querySelector('[data-settings-edit=language]')?.click()`,
  );
  await wait(200);
  result.languageDialog = await hub.webContents.executeJavaScript(
    "!!document.querySelector('[role=dialog]')",
  );
  if (!result.languageDialog) throw new Error('Modal langues non ouverte');
  await shot(hub, 'languages');
  await hub.webContents.executeJavaScript(
    `document.querySelector('[aria-label="Fermer"]')?.click()`,
  );
  await wait(100);
  result.languagePreservesSettings = await hub.webContents.executeJavaScript(
    "!!document.querySelector('[data-settings-dialog]')",
  );
  if (!result.languagePreservesSettings) throw new Error('Langues ferme les paramètres');
  await hub.webContents.executeJavaScript(
    `(()=>{document.querySelector('[aria-label="Fermer les paramètres"]')?.click();const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Dictée');b?.click()})()`,
  );
  await wait(150);

  async function settingsSelfTest() {
    result.settingsModal = await hub.webContents.executeJavaScript(
      `(()=>{const e=document.querySelector('[data-settings-dialog]');if(!e)return null;const a=e.querySelector('aside'),p=e.querySelector('[data-settings-panel=general]'),h=p.querySelector('h2');return {width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,sidebarWidth:a.getBoundingClientRect().width,font:getComputedStyle(h).fontFamily,bodyFont:getComputedStyle(p).fontFamily,background:getComputedStyle(a).backgroundColor}})()`,
    );
    if (
      result.settingsModal?.width !== 960 ||
      result.settingsModal?.height !== 640 ||
      result.settingsModal?.sidebarWidth !== 209 ||
      !result.settingsModal.font.includes('EBGaramond')
    )
      throw new Error('Géométrie des paramètres différente des preuves');
    result.settingsTabs = [];
    for (const tab of ['general', 'system', 'advanced', 'profile', 'connections', 'privacy']) {
      await hub.webContents.executeJavaScript(
        `document.querySelector('[data-settings-tab="${tab}"]')?.click()`,
      );
      await wait(80);
      const active = await hub.webContents.executeJavaScript(
        `!!document.querySelector('[data-settings-panel="${tab}"]:not([hidden])')`,
      );
      if (!active) throw new Error('Onglet paramètres absent ' + tab);
      result.settingsTabs.push(tab);
      if (tab === 'system') {
        result.updatesPortableExplained = await hub.webContents.executeJavaScript(
          "document.querySelector('[data-updates-panel]')?.textContent.includes('Version de développement')",
        );
        if (!result.updatesPortableExplained)
          throw new Error('Mode développement présenté comme installable');
        const originalAdapter = updater.adapter;
        updater.mode = 'installed';
        updater.state = 'ready';
        updater.availableVersion = '0.3.1';
        let attemptedRestart = false;
        updater.adapter = {
          quitAndInstall: () => {
            attemptedRestart = true;
          },
        };
        broadcast();
        await wait(80);
        await hub.webContents.executeJavaScript(
          "document.querySelector('[data-updates-panel]').scrollIntoView({block:'end'}); [...document.querySelectorAll('[data-updates-panel] button')].find(e=>e.textContent.includes('Redémarrer et installer'))?.click()",
        );
        await wait(80);
        result.updatesRequiresConfirmation = await hub.webContents.executeJavaScript(
          '!!document.querySelector(\'[aria-label="Confirmer le redémarrage de Voxen"]\')',
        );
        if (!result.updatesRequiresConfirmation || attemptedRestart)
          throw new Error('Confirmation de mise à jour absente');
        await shot(hub, 'updates-confirmation');
        engine.state = 'recording';
        broadcast();
        await wait(80);
        result.updatesBlockedDuringDictation = await hub.webContents.executeJavaScript(
          "![...document.querySelectorAll('[data-updates-panel] button')].some(e=>e.textContent.includes('Redémarrer et installer')&&!e.disabled)&&!document.querySelector('[aria-label=\"Confirmer le redémarrage de Voxen\"]')",
        );
        if (!result.updatesBlockedDuringDictation)
          throw new Error('Redémarrage disponible pendant dictée');
        engine.state = 'ready';
        broadcast();
        await wait(80);
        await hub.webContents.executeJavaScript(
          `(()=>{const previous=window.voxenFlushNotes;window.voxenFlushNotes=async()=>{try{return !!(await window.voxen.call('notes.save',{title:'Diagnostic sauvegarde avant mise à jour',body:'Brouillon de contrôle isolé.'})).note}finally{window.voxenFlushNotes=previous}}})()`,
        );
        await updater.install();
        result.updatesFlushBeforeRestart =
          attemptedRestart &&
          store.notes().some((note) => note.Title === 'Diagnostic sauvegarde avant mise à jour') &&
          hub.isEnabled();
        if (!result.updatesFlushBeforeRestart)
          throw new Error('Sauvegarde avant redémarrage indisponible');
        updater.installing = false;
        updater.mode = 'development';
        updater.state = 'unsupported';
        updater.availableVersion = null;
        updater.adapter = originalAdapter;
        broadcast();
        await wait(80);
      }
      await shot(hub, 'settings-' + tab);
      if (tab === 'profile') {
        result.cloudAccount = await hub.webContents.executeJavaScript(
          `(()=>({present:!!document.querySelector('[data-cloud-account]'),email:!!document.querySelector('#cloud-email'),configured:!document.querySelector('#cloud-email')?.disabled,connected:!!document.querySelector('#cloud-profile-name')}))()`,
        );
        if (
          !result.cloudAccount.present ||
          !result.cloudAccount.email ||
          !result.cloudAccount.configured ||
          result.cloudAccount.connected
        )
          throw new Error('Panneau compte indisponible ou connexion automatique en diagnostic');
        const sample = 'voxen-diagnostic-only';
        result.cloudSessionEncryption =
          safeStorage.isEncryptionAvailable() &&
          safeStorage.decryptString(safeStorage.encryptString(sample)) === sample;
        if (!result.cloudSessionEncryption)
          throw new Error('Chiffrement de session Windows indisponible');
        result.cloudNoSessionInDiagnostic = !cloud.session;
      }
    }
    const original = store.settings().HistoryEnabled;
    await hub.webContents.executeJavaScript(
      "document.querySelector('[data-settings-tab=profile]')?.click()",
    );
    await wait(80);
    cloud.session = {
      user: { id: 'diagnostic-ui-only', email: 'demo@example.invalid' },
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
    cloud.meta = {
      scope: { libraries: true, preferences: true, notes: false, history: false },
      enabled: false,
    };
    cloud.state = 'ready';
    broadcast();
    await wait(80);
    result.cloudOptInDefaults = await hub.webContents.executeJavaScript(
      `(()=>{const root=document.querySelector('[data-cloud-account]'),boxes=[...root.querySelectorAll('input[type=checkbox]')];return {connected:!!root.querySelector('#cloud-profile-name'),disabled:root.querySelector('[role=switch]')?.getAttribute('aria-checked')==='false',notesExcluded:boxes[2]?.checked===false,historyExcluded:boxes[3]?.checked===false}})()`,
    );
    if (!Object.values(result.cloudOptInDefaults).every(Boolean))
      throw new Error('Opt-in cloud incorrect');
    await shot(hub, 'cloud-connected-example');
    cloud.meta.enabled = true;
    cloud.state = 'conflict';
    broadcast();
    await wait(80);
    result.cloudConflictChoice = await hub.webContents.executeJavaScript(
      `(()=>{const root=document.querySelector('[data-cloud-account]');return !!root&&root.textContent.includes('Version de ce PC')&&root.textContent.includes('Version du compte')})()`,
    );
    if (!result.cloudConflictChoice) throw new Error('Choix de conflit absent');
    cloud.session = null;
    cloud.meta = {};
    cloud.state = 'offline';
    broadcast();
    await hub.webContents.executeJavaScript(
      "document.querySelector('[data-settings-tab=privacy]')?.click()",
    );
    await wait(80);
    await hub.webContents.executeJavaScript(
      `document.querySelector('[role=switch][aria-label="Conserver l’historique local"]')?.click()`,
    );
    await wait(150);
    if (store.settings().HistoryEnabled === original) throw new Error('Préférence non enregistrée');
    await hub.webContents.executeJavaScript(
      `document.querySelector('[role=switch][aria-label="Conserver l’historique local"]')?.click()`,
    );
    await wait(150);
    if (store.settings().HistoryEnabled !== original) throw new Error('Préférence non restaurée');
    result.settingsAutosave = true;
    await hub.webContents.executeJavaScript(
      "document.querySelector('[data-settings-tab=general]')?.click()",
    );
    await wait(80);
    await hub.webContents.executeJavaScript(
      "document.querySelector('[data-settings-edit=shortcut]')?.click()",
    );
    await wait(100);
    await shot(hub, 'settings-shortcut');
    await hub.webContents.executeJavaScript(
      "(()=>{const b=document.querySelector('[data-shortcut-record]');b?.click();return !!b})()",
    );
    await wait(100);
    await hub.webContents.executeJavaScript(
      "(()=>{const b=document.querySelector('[data-shortcut-record]');b?.dispatchEvent(new KeyboardEvent('keydown',{key:'F12',code:'F12',keyCode:123,bubbles:true,cancelable:true}))})()",
    );
    await wait(80);
    await hub.webContents.executeJavaScript(
      "document.querySelector('[data-settings-save-shortcut]')?.click()",
    );
    await wait(150);
    if (store.settings().HotkeyAccelerator !== 'VK:123')
      throw new Error('La touche F12 enregistrée depuis le clavier est incorrecte');
    await hub.webContents.executeJavaScript(
      "document.querySelector('[data-settings-edit=shortcut]')?.click()",
    );
    await wait(80);
    await hub.webContents.executeJavaScript(
      "(()=>{const b=document.querySelector('[data-shortcut-record]');b?.click();return !!b})()",
    );
    await wait(100);
    await hub.webContents.executeJavaScript(
      "(()=>{const b=document.querySelector('[data-shortcut-record]');b?.dispatchEvent(new KeyboardEvent('keydown',{key:'e',code:'KeyE',keyCode:69,ctrlKey:true,bubbles:true,cancelable:true}))})()",
    );
    await wait(80);
    await hub.webContents.executeJavaScript(
      "document.querySelector('[data-settings-save-shortcut]')?.click()",
    );
    await wait(150);
    if (store.settings().HotkeyAccelerator !== 'Control+E')
      throw new Error('La combinaison Ctrl+E enregistrée depuis le clavier est incorrecte');
    result.shortcutDialogSaves = true;
    await hub.webContents.executeJavaScript(
      "document.querySelector('[data-settings-edit=shortcut]')?.click()",
    );
    await wait(80);
    await hub.webContents.executeJavaScript(
      "(()=>{const b=document.querySelector('[data-shortcut-record]');b?.click();return !!b})()",
    );
    await wait(100);
    await hub.webContents.executeJavaScript(
      "(()=>{const b=document.querySelector('[data-shortcut-record]');b?.dispatchEvent(new KeyboardEvent('keydown',{key:'v',code:'KeyV',keyCode:86,ctrlKey:true,bubbles:true,cancelable:true}))})()",
    );
    await wait(80);
    await hub.webContents.executeJavaScript(
      "document.querySelector('[data-settings-save-shortcut]')?.click()",
    );
    await wait(150);
    await hub.webContents.executeJavaScript(
      "document.querySelector('[data-settings-edit=microphone]')?.click()",
    );
    await wait(100);
    await shot(hub, 'settings-microphone');
    if (
      !(await hub.webContents.executeJavaScript(
        "!!document.querySelector('[data-settings-detail=microphone]')",
      ))
    )
      throw new Error('Microphone non ouvert');
    await hub.webContents.executeJavaScript(
      'document.querySelector(\'[aria-label="Fermer ce réglage"]\')?.click()',
    );
    await wait(80);
  }
  result.guides = [];
  for (const id of [
    'dictation',
    'dictionary',
    'replacements',
    'style',
    'rewrite',
    'scratchpad',
    'insights',
    'settings',
    'history',
  ]) {
    if (id === 'history') {
      hub.webContents.send('voxen:navigate', 'history');
      await wait(100);
    }
    await hub.webContents.executeJavaScript(
      `(()=>{const label=${JSON.stringify({ dictation: 'Dictée', dictionary: 'Dictionnaire', replacements: 'Raccourcis', style: 'Style', rewrite: 'Transformations', scratchpad: 'Bloc-notes', insights: 'Statistiques', settings: 'Paramètres', history: 'Tout voir (0)' }[id])};const b=[...document.querySelectorAll('button')].find(e=>e.title===label||e.textContent.trim()===label);b?.click()})()`,
    );
    await wait(80);
    await hub.webContents.executeJavaScript(
      `document.querySelector('[data-guide-open="${id}"]')?.click()`,
    );
    await wait(100);
    const exists = await hub.webContents.executeJavaScript(
      `!!document.querySelector('[data-tutorial="${id}"]')`,
    );
    if (!exists) throw new Error('Guide absent ' + id);
    if (id === 'dictionary') {
      const termsBefore = JSON.stringify(store.terms());
      await hub.webContents.executeJavaScript(
        'document.querySelector(\'[aria-label="Ajouter le mot de démonstration"]\')?.click()',
      );
      await wait(80);
      const isolated = await hub.webContents.executeJavaScript(
        "document.body.textContent.includes('Exemple ajouté à cet aperçu uniquement.')",
      );
      if (!isolated || JSON.stringify(store.terms()) !== termsBefore)
        throw new Error('Démonstration dictionnaire non isolée');
    }
    for (let step = 1; step <= 3; step++) {
      await hub.webContents.executeJavaScript(
        `(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent.includes(${JSON.stringify(step === 1 ? 'Me laisser guider' : 'Continuer')}));b?.click()})()`,
      );
      await wait(80);
      const actual = await hub.webContents.executeJavaScript(
        "Number(document.querySelector('[data-tutorial]')?.dataset.tutorialStep)",
      );
      if (actual !== step) throw new Error('Étape guide incorrecte ' + id);
      if (step === 2 && id === 'dictionary') await shot(hub, 'tutorial-dictionary-step');
    }
    if (id === 'style') await shot(hub, 'tutorial-style');
    await hub.webContents.executeJavaScript(
      "(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent.includes('À moi de jouer'));b?.click()})()",
    );
    await wait(80);
    const closed = await hub.webContents.executeJavaScript(
      "!document.querySelector('[data-tutorial]')",
    );
    if (!closed) throw new Error('Guide non fermé ' + id);
    result.guides.push({ id, steps: 3, completed: true });
  }
  result.tutorialProgress = await hub.webContents.executeJavaScript(
    "JSON.parse(localStorage.getItem('voxen.guides.v1'))",
  );
  if (result.tutorialProgress.completed.length !== 9) throw new Error('Progression non conservée');
  await hub.webContents.reload();
  await wait(350);
  result.progressAfterReload = await hub.webContents.executeJavaScript(
    "JSON.parse(localStorage.getItem('voxen.guides.v1')).completed.length===9&&!document.querySelector('[data-tutorial]')",
  );
  if (!result.progressAfterReload) throw new Error('Progression perdue au rechargement');
  await hub.webContents.executeJavaScript(
    "(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Dictionnaire');b?.click()})()",
  );
  await wait(100);
  result.completedGuideNotReopened = await hub.webContents.executeJavaScript(
    "!document.querySelector('[data-tutorial]')",
  );
  if (!result.completedGuideNotReopened) throw new Error('Guide revu automatiquement');
  await hub.webContents.executeJavaScript(
    "document.querySelector('[data-guide-open=dictionary]')?.click()",
  );
  await wait(100);
  result.guideCanReplay = await hub.webContents.executeJavaScript(
    "!!document.querySelector('[data-tutorial=dictionary]')",
  );
  if (!result.guideCanReplay) throw new Error('Guide impossible à revoir');
  await hub.webContents.executeJavaScript(
    'document.querySelector(\'[aria-label="Fermer le guide"]\')?.click()',
  );
  await wait(80);
  hub.setSize(1000, 740);
  await wait(100);
  await shot(hub, 'sidebar-compact');
  for (const [state, message, name] of [
    ['ready', 'Prêt', 'popup-idle'],
    ['recording', 'À l’écoute', 'popup-listening'],
    ['processing', 'Transcription en cours', 'popup-processing'],
    ['ready', 'Texte inséré', 'popup-after-dictation'],
  ]) {
    engine.state = state;
    engine.message = message;
    if (state === 'recording')
      engine.waveform.values = [0.05, 0.2, 0.45, 0.7, 0.5, 0.9, 0.6, 0.8, 0.3, 0.5, 0.2, 0.05];
    overlay.setBounds(overlayBounds());
    broadcast();
    await wait(250);
    await shot(overlay, name);
    if (name === 'popup-after-dictation') {
      result.returnsToMicrophone = await overlay.webContents.executeJavaScript(
        '!!document.querySelector(\'[aria-label="Commencer une dictée"]\')',
      );
    }
  }
  if (!result.returnsToMicrophone) throw new Error('Le micro ne revient pas après la dictée');
  result.popupNeverShown = !overlay.isVisible();
  result.captureWindowNeverShown = !capture.isVisible();
  result.credentialsRemainInWindows = true;
  fs.writeFileSync(
    path.join(diagnosticDir, 'electron-ui-validation.json'),
    JSON.stringify(result, null, 2),
  );
}
if (squirrelHandled) {
  // Squirrel's shortcut lifecycle completes without opening windows or user data.
} else if (!diagnostic && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    try {
      if (diagnostic) fs.mkdirSync(diagnosticDir, { recursive: true });
      store = new Store(diagnostic ? path.join(diagnosticDir, 'isolated-data') : undefined);
      engine = new Engine(store, path.resolve(__dirname, '../../assets/silero/silero_vad.onnx'), {
        diagnostic,
      });
      if (diagnostic) {
        engine.deepgramConfigured = false;
        engine.openrouterConfigured = false;
      }
      workspace = new Workspace(store, engine, {
        diagnostic,
        getWindow: () => (notesWindow?.isFocused() ? notesWindow : hub),
        onChange: () => {
          registerShortcut();
          broadcast();
        },
      });
      cloud = new Cloud(store, {
        config: diagnostic
          ? { url: 'https://example.supabase.co', publishableKey: 'diagnostic-public-placeholder' }
          : loadClientConfig(
              path.dirname(store.path),
              path.resolve(__dirname, '../../assets/cloud-config.json'),
            ),
        safeStorage,
        diagnostic,
        onChange: () => {
          engine.settings = store.settings();
          refreshData();
          broadcast();
        },
        beforeApply: async () => {
          if (engine.busy() || engine.testMode || workspace.busy || updater?.installing)
            return false;
          for (const win of [hub, notesWindow])
            if (win && !win.isDestroyed()) {
              if (
                !(await win.webContents.executeJavaScript(
                  'Promise.resolve(window.voxenFlushNotes ? window.voxenFlushNotes() : true)',
                ))
              )
                return false;
            }
          return !engine.busy() && !workspace.busy;
        },
      });
      updater = new Updates({
        adapter: autoUpdater,
        store,
        version: app.getVersion(),
        mode: diagnostic ? 'development' : installationMode({ packaged: app.isPackaged }),
        isOnline: () => net.isOnline(),
        isBusy: () =>
          engine.busy() || engine.testMode || workspace.busy || inserting || cloud.active,
        onChange: () => {
          registerShortcut();
          if (dataCache) broadcast();
        },
        openReleases: async (url) => {
          if (!diagnostic) await shell.openExternal(url);
        },
        beforeInstall: async () => {
          const windows = [hub, notesWindow].filter((win) => win && !win.isDestroyed());
          try {
            for (const win of windows) win.setEnabled(false);
            for (const win of windows) {
              if (
                !(await win.webContents.executeJavaScript(
                  'Promise.resolve(window.voxenFlushNotes ? window.voxenFlushNotes() : true)',
                ))
              )
                return false;
            }
            return true;
          } finally {
            for (const win of windows) if (!win.isDestroyed()) win.setEnabled(true);
          }
        },
      });
      refreshData();
      await createWindows();
      void cloud.init();
      if (diagnostic) {
        await uiSelfTest();
        quitting = true;
        await engine.close();
        store.close();
        app.exit(0);
        return;
      }
      updater.start();
      if (updater.mode === 'installed' && engine.settings.StartWithWindows) configureLogin(true);
      const icon = nativeImage.createFromPath(path.resolve(__dirname, '../../assets/icon.png'));
      tray = new Tray(icon);
      tray.setToolTip('Voxen · Dictée');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Ouvrir Voxen', click: openHub },
          {
            label: 'Paramètres',
            click: () => {
              openHub();
              hub.webContents.send('voxen:navigate', 'settings');
            },
          },
          {
            label: 'Mises à jour',
            click: () => {
              openHub();
              hub.webContents.send('voxen:navigate', 'updates');
            },
          },
          { label: 'Quitter', click: () => app.quit() },
        ]),
      );
      tray.on('double-click', openHub);
      registerShortcut();
      if (!args.includes('--tray')) hub.show();
      if (args.includes('--settings')) {
        openHub();
        hub.webContents.send('voxen:navigate', 'settings');
      }
    } catch (error) {
      if (diagnostic) {
        fs.writeFileSync(
          path.join(diagnosticDir, 'electron-ui-error.json'),
          JSON.stringify({ error: error.name, detail: error.message, stack: error.stack }),
        );
        app.exit(1);
      } else {
        dialog.showErrorBox(
          'Voxen',
          'Le démarrage de Voxen a échoué. Les données et les clés Windows sont conservées.',
        );
        app.exit(1);
      }
    }
  });
  app.on('second-instance', (_event, argv) => {
    if (hub) {
      openHub();
      if (argv.includes('--settings')) hub.webContents.send('voxen:navigate', 'settings');
    }
  });
  app.on('before-quit', () => {
    quitting = true;
    cloud?.close();
    updater?.close();
    workspace?.close();
    globalShortcut.unregisterAll();
    clearInterval(poll);
    void engine?.close();
  });
  autoUpdater.on('before-quit-for-update', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });
}
