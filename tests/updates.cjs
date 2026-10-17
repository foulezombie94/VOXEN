'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Updates, installationMode, FEED, RELEASES } = require('../src/main/updates.cjs');
const { handleSquirrel } = require('../src/main/squirrel.cjs');
const { readClientConfig, loadClientConfig } = require('../src/main/cloud-config.cjs');
const MINUTE = 60_000;

function fixture(options = {}) {
  const values = new Map(options.saved || []);
  const timers = new Map();
  const adapter = new EventEmitter();
  const calls = { feed: [], check: 0, install: 0, changed: 0, releases: [] };
  adapter.setFeedURL = (value) => {
    calls.feed.push(value);
    if (options.feedError) throw options.feedError;
  };
  adapter.checkForUpdates = () => {
    calls.check++;
    return options.check?.();
  };
  adapter.quitAndInstall = () => {
    calls.install++;
    if (options.installError) throw options.installError;
  };
  let busy = false,
    online = true;
  const updates = new Updates({
    adapter,
    store: { get: (key) => values.get(key), set: (key, value) => values.set(key, value) },
    version: '0.2.0',
    mode: options.mode || 'installed',
    clock: () => Date.parse('2026-10-17T12:00:00Z'),
    random: options.random || (() => 0.5),
    isBusy: () => busy,
    isOnline: () => online,
    beforeInstall: options.beforeInstall || (async () => true),
    onChange: () => {
      calls.changed++;
    },
    openReleases: async (url) => {
      calls.releases.push(url);
    },
    schedule: (fn, delay) => {
      const id = { unref() {} };
      timers.set(id, { fn, delay });
      return id;
    },
    unschedule: (id) => timers.delete(id),
  });
  return {
    updates,
    adapter,
    calls,
    timers,
    values,
    busy(value) {
      busy = value;
    },
    online(value) {
      online = value;
    },
    ready(version = '0.3.0') {
      adapter.emit('update-downloaded', {}, 'notes are never exposed', version);
    },
    fire() {
      const entry = timers.entries().next().value;
      assert(entry, 'a timer is scheduled');
      timers.delete(entry[0]);
      entry[1].fn();
    },
    delay() {
      assert.equal(timers.size, 1);
      return timers.values().next().value.delay;
    },
    close() {
      updates.close();
    },
  };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('development and portable builds neither configure a feed nor check or schedule updates', async () => {
  for (const mode of ['development', 'portable']) {
    const f = fixture({ mode });
    f.updates.start();
    assert.deepEqual(await f.updates.check(), { ok: false });
    assert.equal(f.calls.feed.length, 0);
    assert.equal(f.calls.check, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.updates.status().supported, false);
    assert.equal(f.updates.status().state, 'unsupported');
    await assert.rejects(f.updates.handle('updates.preferences', { enabled: true }));
    f.close();
  }
});

test('installed detection requires Windows, packaging, an exact app semver folder and sibling Update.exe', () => {
  const root = path.join(os.tmpdir(), 'Voxen installed fixture');
  const execPath = path.join(root, 'app-1.2.3', 'Voxen.exe');
  const expectedUpdater = path.join(root, 'Update.exe');
  const config = {
    packaged: true,
    platform: 'win32',
    execPath,
    exists: (file) => file === expectedUpdater,
  };
  assert.equal(installationMode(config), 'installed');
  assert.equal(installationMode({ ...config, packaged: false }), 'development');
  assert.equal(installationMode({ ...config, platform: 'linux' }), 'portable');
  assert.equal(installationMode({ ...config, exists: () => false }), 'portable');
  for (const name of ['app-1.evil', 'app-1.2', 'app-1.2.3-junk', 'app-1.2.3.exe', 'Release']) {
    assert.equal(
      installationMode({
        ...config,
        execPath: path.join(root, name, 'Voxen.exe'),
        exists: () => true,
      }),
      'portable',
      name,
    );
  }
});

test('installed startup waits 60 seconds and subsequent randomized checks remain between 30 minutes and 5 hours', () => {
  const f = fixture();
  assert.deepEqual(f.calls.feed, [{ url: FEED }]);
  assert.equal(f.updates.status().lastChecked, null);
  f.updates.start();
  assert.equal(f.delay(), MINUTE);
  assert.equal(f.calls.check, 0);
  f.fire();
  assert.equal(f.calls.check, 1);
  f.adapter.emit('update-not-available');
  assert.equal(f.delay(), 165 * MINUTE);
  assert.equal(f.updates.status().lastChecked, '2026-10-17T12:00:00.000Z');
  f.updates.random = () => 0;
  assert.equal(f.updates.delay(), 30 * MINUTE);
  f.updates.random = () => 0.999999;
  assert(f.updates.delay() <= 300 * MINUTE);
  assert(f.updates.delay() >= 30 * MINUTE);
  f.close();
});

test('busy and offline automatic checks defer quietly while manual checks return an actionable safe error', async () => {
  for (const condition of ['busy', 'online']) {
    const f = fixture();
    f[condition](condition === 'busy');
    assert.deepEqual(await f.updates.check(false), { ok: false });
    assert.equal(f.calls.check, 0);
    assert.equal(f.delay(), MINUTE);
    await assert.rejects(f.updates.check(true), /Terminez.*connexion Internet/);
    assert.equal(f.calls.check, 0);
    f[condition](condition !== 'busy');
    assert.deepEqual(await f.updates.check(false), { ok: true });
    assert.equal(f.calls.check, 1);
    f.close();
  }
});

test('checking, downloading and ready states serialize checks and never install automatically', async () => {
  const f = fixture();
  assert.deepEqual(await f.updates.check(), { ok: true });
  assert.deepEqual(await f.updates.check(), { ok: false });
  f.adapter.emit('checking-for-update');
  assert.equal(f.updates.status().state, 'checking');
  f.adapter.emit('update-available');
  assert.equal(f.updates.status().state, 'downloading');
  assert.deepEqual(await f.updates.check(), { ok: false });
  f.ready('v1.2.3');
  assert.equal(f.updates.status().state, 'ready');
  assert.equal(f.updates.status().availableVersion, 'v1.2.3');
  assert.equal(f.updates.status().canInstall, true);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(await f.updates.check(), { ok: false });
  assert.equal(f.calls.check, 1);
  assert.equal(f.calls.install, 0);
  f.close();
});

test('release titles and native errors cannot expose untrusted paths, URLs, headers or notes', () => {
  const f = fixture();
  for (const value of [
    'https://example.invalid/token=synthetic-secret',
    'C:\\private\\update.exe',
    '<b>1.2.3</b>',
    '1.2.3\nextra',
  ]) {
    f.ready(value);
    assert.equal(f.updates.status().availableVersion, null);
    assert(!JSON.stringify(f.updates.status()).includes(value));
  }
  for (const value of ['1.2.3', 'v1.2.3-beta.2', '1.2.3+build.4']) {
    f.ready(value);
    assert.equal(f.updates.status().availableVersion, value);
  }
  f.adapter.emit('error', new Error('synthetic-private-header: fixture-value C:\\private\\file'));
  assert.equal(f.updates.status().state, 'error');
  assert.equal(f.updates.status().message, '');
  assert(!JSON.stringify(f.updates.status()).includes('synthetic-private'));
  assert.equal(f.delay(), 30 * MINUTE);
  f.close();
});

test('feed setup and synchronous or rejected asynchronous checks fail without leaking their errors', async () => {
  const secretError = new Error('synthetic-private-native-error');
  for (const options of [
    { feedError: secretError },
    {
      check: () => {
        throw secretError;
      },
    },
    { check: () => Promise.reject(secretError) },
  ]) {
    const f = fixture(options);
    if (!options.feedError) await f.updates.check();
    await Promise.resolve();
    assert.equal(f.updates.status().state, 'error');
    assert(!JSON.stringify(f.updates.status()).includes(secretError.message));
    assert.equal(f.delay(), 30 * MINUTE);
    f.close();
  }
});

test('automatic preference is local, validates booleans, cancels timers, and preserves manual checking', async () => {
  const f = fixture({ saved: [['updates.enabled', 'false']] });
  f.updates.start();
  assert.equal(f.updates.status().enabled, false);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(await f.updates.check(false), { ok: false });
  await assert.rejects(f.updates.handle('updates.preferences', { enabled: 'true' }));
  assert.equal(f.values.get('updates.enabled'), 'false');
  assert.deepEqual(await f.updates.handle('updates.preferences', { enabled: true }), { ok: true });
  assert.equal(f.values.get('updates.enabled'), 'true');
  assert.equal(f.delay(), MINUTE);
  await f.updates.handle('updates.preferences', { enabled: false });
  assert.equal(f.timers.size, 0);
  assert.deepEqual(await f.updates.check(true), { ok: true });
  assert.equal(f.calls.check, 1);
  f.close();
});

test('installation requires a ready release, no dictation, and successful draft flushing', async () => {
  const notReady = fixture();
  await assert.rejects(notReady.updates.install());
  assert.equal(notReady.calls.install, 0);
  notReady.close();
  for (const beforeInstall of [
    async () => false,
    async () => {
      throw new Error('synthetic-draft-error');
    },
  ]) {
    const f = fixture({ beforeInstall });
    f.ready();
    await assert.rejects(f.updates.install(), /Redémarrage reporté/);
    assert.equal(f.calls.install, 0);
    assert.equal(f.updates.status().busy, false);
    assert.equal(f.updates.status().state, 'ready');
    f.close();
  }
  const f = fixture();
  f.ready();
  f.busy(true);
  assert.equal(f.updates.status().canInstall, false);
  await assert.rejects(f.updates.install());
  assert.equal(f.calls.install, 0);
  f.busy(false);
  assert.deepEqual(await f.updates.install(), { ok: true });
  assert.equal(f.calls.install, 1);
  f.close();
});

test('installation rechecks activity after asynchronous draft saving and rejects concurrent installs', async () => {
  const gate = deferred();
  const f = fixture({ beforeInstall: () => gate.promise });
  f.ready();
  const installation = f.updates.install();
  assert.equal(f.updates.status().busy, true);
  assert.equal(f.updates.status().canInstall, false);
  await assert.rejects(f.updates.install());
  f.busy(true);
  const rejected = assert.rejects(installation, /Redémarrage reporté/);
  gate.resolve(true);
  await rejected;
  assert.equal(f.calls.install, 0);
  assert.equal(f.updates.status().busy, false);
  f.close();
});

test('closing during asynchronous draft saving prevents a late updater restart', async () => {
  const gate = deferred();
  const f = fixture({ beforeInstall: () => gate.promise });
  f.ready();
  const installation = f.updates.install();
  f.close();
  const rejected = assert.rejects(installation, /Redémarrage reporté/);
  gate.resolve(true);
  await rejected;
  assert.equal(f.calls.install, 0);
});

test('failed native installation remains ready for retry and hides its internal error', async () => {
  const f = fixture({ installError: new Error('synthetic-private-native-install-url') });
  f.ready();
  await assert.rejects(
    f.updates.install(),
    (error) =>
      !error.message.includes('synthetic-private') && /Redémarrage reporté/.test(error.message),
  );
  assert.equal(f.updates.status().state, 'ready');
  assert.equal(f.updates.status().busy, false);
  f.close();
});

test('close removes only updater listeners and timers, prevents checks, and keeps external listeners', async () => {
  const f = fixture();
  const external = () => {};
  f.adapter.on('error', external);
  f.updates.start();
  f.close();
  assert.equal(f.timers.size, 0);
  assert.equal(f.adapter.listenerCount('update-downloaded'), 0);
  assert.deepEqual(f.adapter.listeners('error'), [external]);
  const count = f.calls.changed;
  f.adapter.emit('update-downloaded', {}, '', '1.2.3');
  f.adapter.emit('error', new Error('synthetic-error'));
  assert.equal(f.calls.changed, count);
  assert.deepEqual(await f.updates.check(), { ok: false });
  await assert.rejects(f.updates.install());
  assert.equal(f.calls.check, 0);
});

test('opening releases uses the fixed trusted URL even with hostile payload fields', async () => {
  const f = fixture({ mode: 'portable' });
  await f.updates.handle('updates.openReleases', { url: 'file:///private', command: 'unsafe' });
  assert.deepEqual(f.calls.releases, [RELEASES]);
  await assert.rejects(f.updates.handle('updates.unknown'));
  f.close();
});

test('Squirrel install/update/uninstall use a fixed executable and separate non-shell arguments', () => {
  for (const [event, command] of [
    ['--squirrel-install', '--createShortcut'],
    ['--squirrel-updated', '--createShortcut'],
    ['--squirrel-uninstall', '--removeShortcut'],
  ]) {
    const child = new EventEmitter();
    const calls = [];
    let quits = 0;
    const execPath = path.join(os.tmpdir(), 'Voxen space & literal', 'app-1.2.3', 'Voxen.exe');
    assert.equal(
      handleSquirrel({
        app: {
          quit: () => {
            quits++;
          },
        },
        platform: 'win32',
        execPath,
        argv: ['Voxen.exe', event, '--unsafe-extra'],
        spawnImpl: (...args) => {
          calls.push(args);
          return child;
        },
      }),
      true,
    );
    assert.deepEqual(calls, [
      [
        path.resolve(path.dirname(execPath), '..', 'Update.exe'),
        [command, 'Voxen.exe'],
        { windowsHide: true, shell: false },
      ],
    ]);
    assert.equal(quits, 0);
    child.emit('exit', 0);
    child.emit('error', new Error('synthetic-event-after-exit'));
    assert.equal(quits, 1);
  }
});

test('Squirrel ignores first-run, arbitrary flags and other platforms; obsolete quits without spawning', () => {
  let quits = 0,
    spawns = 0;
  const base = {
    app: {
      quit: () => {
        quits++;
      },
    },
    platform: 'win32',
    spawnImpl: () => {
      spawns++;
      throw new Error('must not spawn');
    },
  };
  for (const flag of ['--squirrel-firstrun', '--unsafe', undefined])
    assert.equal(handleSquirrel({ ...base, argv: ['Voxen.exe', flag] }), false);
  assert.equal(
    handleSquirrel({ ...base, platform: 'linux', argv: ['Voxen.exe', '--squirrel-install'] }),
    false,
  );
  assert.equal(quits, 0);
  assert.equal(spawns, 0);
  assert.equal(handleSquirrel({ ...base, argv: ['Voxen.exe', '--squirrel-obsolete'] }), true);
  assert.equal(quits, 1);
  assert.equal(spawns, 0);
});

test('Squirrel spawn errors quit safely and do not escape into application startup', () => {
  let quits = 0;
  const base = {
    app: {
      quit: () => {
        quits++;
      },
    },
    platform: 'win32',
    argv: ['Voxen.exe', '--squirrel-install'],
  };
  assert.equal(
    handleSquirrel({
      ...base,
      spawnImpl: () => {
        throw new Error('synthetic spawn failure');
      },
    }),
    true,
  );
  const child = new EventEmitter();
  assert.equal(handleSquirrel({ ...base, spawnImpl: () => child }), true);
  child.emit('error', new Error('synthetic asynchronous spawn failure'));
  child.emit('exit', 1);
  assert.equal(quits, 2);
});

function configFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voxen-update-config-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bundled = path.join(dir, 'bundled.json');
  const external = path.join(dir, 'cloud-config.json');
  const config = {
    url: 'https://fixture.supabase.co',
    publishableKey: 'sb_publishable_fixture-only',
    projectName: 'Fixture project',
  };
  const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
  return { dir, bundled, external, config, write };
}

test('external publishable configuration takes priority over bundled defaults and strips extra fields', (t) => {
  const f = configFixture(t);
  f.write(f.bundled, f.config);
  f.write(f.external, {
    ...f.config,
    url: 'https://external.supabase.co/',
    projectName: 'X'.repeat(100),
    ignoredField: 'fixture-ignored',
  });
  const result = loadClientConfig(f.dir, f.bundled);
  assert.equal(result.url, 'https://external.supabase.co');
  assert.equal(result.projectName.length, 80);
  assert.deepEqual(Object.keys(result).sort(), ['projectName', 'publishableKey', 'url']);
});

test('invalid external URLs or non-publishable keys fall back safely without accepting secrets', (t) => {
  const f = configFixture(t);
  f.write(f.bundled, f.config);
  const invalid = [
    { url: 'http://fixture.supabase.co' },
    { url: 'https://user:password@fixture.supabase.co' },
    { url: 'https://fixture.supabase.co/private' },
    { url: 'https://fixture.supabase.co/?token=fixture' },
    { url: 'https://fixture.supabase.co/#fixture' },
    { url: 'not a URL' },
    { publishableKey: 'sb_secret_fixture-only' },
    { publishableKey: 'eyJfixture-legacy-jwt' },
    { publishableKey: '' },
    { publishableKey: 'sb_publishable_fixture with spaces' },
  ];
  for (const value of invalid) {
    f.write(f.external, { ...f.config, ...value });
    assert.equal(readClientConfig(f.external), null);
    assert.deepEqual(loadClientConfig(f.dir, f.bundled), f.config);
  }
  fs.writeFileSync(f.external, '{invalid JSON');
  assert.deepEqual(loadClientConfig(f.dir, f.bundled), f.config);
  fs.unlinkSync(f.bundled);
  assert.deepEqual(loadClientConfig(f.dir, f.bundled), {});
  assert.equal(readClientConfig(path.join(f.dir, 'missing.json')), null);
});
