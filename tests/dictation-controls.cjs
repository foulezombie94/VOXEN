const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TemporaryEscape,
  copyLastDictationItem,
  usesEscape,
} = require('../src/main/dictation-controls.cjs');

function fixture({ conflict = false } = {}) {
  const listeners = new Map();
  const timers = new Map();
  const calls = [];
  let down = false;
  let cancellations = 0;
  const controls = new TemporaryEscape({
    shortcuts: {
      register(key, callback) {
        calls.push(['register', key]);
        if (conflict) return false;
        listeners.set(key, callback);
        return true;
      },
      unregister(key) {
        calls.push(['unregister', key]);
        listeners.delete(key);
      },
    },
    isDown: () => down,
    cancel: () => cancellations++,
    timers: {
      setInterval(callback) {
        timers.set(1, callback);
        return 1;
      },
      clearInterval(id) {
        timers.delete(id);
      },
    },
  });
  return {
    controls,
    calls,
    listeners,
    timers,
    setDown: (value) => (down = value),
    cancellations: () => cancellations,
    sync: (state, options = {}) => controls.sync({ state, shortcut: 'VK:123', ...options }),
  };
}

test('Escape only owns the key during recording/processing and releases on every end state', () => {
  for (const finalState of ['ready', 'error', 'paused']) {
    const f = fixture();
    f.sync('ready');
    assert.equal(f.listeners.size, 0);
    assert.equal(f.calls.length, 0);
    f.sync('recording');
    const callback = f.listeners.get('Escape');
    callback();
    assert.equal(f.cancellations(), 1);
    f.sync('processing');
    assert.equal(f.calls.length, 1, 'state transition does not register twice');
    f.sync(finalState);
    assert.equal(f.listeners.size, 0);
    callback();
    assert.equal(f.cancellations(), 1, 'a stale callback cannot cancel while idle');
    assert.deepEqual(f.calls, [
      ['register', 'Escape'],
      ['unregister', 'Escape'],
    ]);
  }
});

test('shortcut capture and shutdown release Escape and can restore it for the active session', () => {
  const f = fixture();
  f.sync('recording');
  f.sync('recording', { disabled: true });
  assert.equal(f.listeners.size, 0);
  f.sync('recording');
  assert.equal(f.listeners.size, 1);
  f.controls.release();
  assert.equal(f.listeners.size, 0);
});

test('an explicitly configured Escape shortcut retains its own registration without collision', () => {
  for (const shortcut of ['Escape', 'VK:27']) {
    assert.equal(usesEscape(shortcut), true);
    const f = fixture();
    f.sync('recording', { shortcut });
    assert.equal(f.calls.length, 0);
    assert.equal(f.timers.size, 0);
  }
  assert.equal(usesEscape('Control+Escape'), false);
});

test('a conflicting Escape accelerator falls back to edge polling and stops polling at idle', () => {
  const f = fixture({ conflict: true });
  f.setDown(true);
  f.sync('recording');
  const poll = f.timers.get(1);
  poll();
  assert.equal(f.cancellations(), 0, 'a held key does not cancel a new session');
  f.setDown(false);
  poll();
  f.setDown(true);
  poll();
  poll();
  assert.equal(f.cancellations(), 1);
  f.sync('ready');
  assert.equal(f.timers.size, 0);
  poll();
  assert.equal(f.cancellations(), 1);
  assert(!f.calls.some(([action]) => action === 'unregister'), 'never unregister another app');
});

test('copy-last menus never write without explicit click and use the latest completed text', () => {
  const writes = [];
  let text = '';
  const options = { getText: () => text, writeText: (value) => writes.push(value) };
  const empty = copyLastDictationItem(options);
  assert.equal(empty.enabled, false);
  empty.click();
  assert.deepEqual(writes, []);
  text = 'Dernière dictée';
  const menu = copyLastDictationItem(options);
  assert.equal(menu.enabled, true);
  assert.deepEqual(writes, []);
  text = 'Dictée plus récente';
  menu.click();
  assert.deepEqual(writes, ['Dictée plus récente']);
  text = '';
  menu.click();
  assert.equal(writes.length, 1);
  const diagnostic = copyLastDictationItem({ ...options, getText: () => 'test', disabled: true });
  diagnostic.click();
  assert.equal(diagnostic.enabled, false);
  assert.equal(writes.length, 1);
});
