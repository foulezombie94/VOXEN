const { contextBridge, ipcRenderer } = require('electron');
let last = null;
const subscribe = (channel, callback) => {
  const listener = (_, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
let pendingLocalTexts = [];
const localTextListeners = new Set();
ipcRenderer.on('voxen:local-text', (_event, value) => {
  if (localTextListeners.size) {
    for (const listener of localTextListeners) listener(value);
  } else {
    pendingLocalTexts.push(value);
    if (pendingLocalTexts.length > 8) pendingLocalTexts.shift();
  }
});
contextBridge.exposeInMainWorld('voxen', {
  getSnapshot: async () => (last = await ipcRenderer.invoke('voxen:snapshot')),
  call: (action, payload) => ipcRenderer.invoke('voxen:action', { action, payload }),
  onSnapshot: (callback) => {
    const a = subscribe('voxen:snapshot', (value) => {
      last = value;
      callback(value);
    });
    const b = subscribe('voxen:levels', (levels) => {
      if (last) {
        last = { ...last, status: { ...last.status, levels } };
        callback(last);
      }
    });
    return () => {
      a();
      b();
    };
  },
  onNavigate: (callback) => subscribe('voxen:navigate', callback),
  onLocalText: (callback) => {
    localTextListeners.add(callback);
    const pending = pendingLocalTexts;
    pendingLocalTexts = [];
    queueMicrotask(() => {
      if (localTextListeners.has(callback)) for (const value of pending) callback(value);
      else pendingLocalTexts.unshift(...pending);
    });
    return () => localTextListeners.delete(callback);
  },
  onMicrophoneLevel: (callback) => subscribe('voxen:microphone-level', callback),
  onAudioCommand: (callback) => subscribe('voxen:audio-command', callback),
  audioStarted: (sessionId) => ipcRenderer.send('voxen:audio-started', { sessionId }),
  audioFrame: (sessionId, data) => ipcRenderer.send('voxen:audio-frame', { sessionId, data }),
  audioError: (sessionId) => ipcRenderer.send('voxen:audio-error', { sessionId }),
});
