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
const { createHash } = require('node:crypto');
const {
  DownloadAdapter,
  parseManifest,
  newerVersion,
  officialFetch,
} = require('../src/main/update-download.cjs');

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
    store: {
      get: (key) => values.get(key),
      set: (key, value) => {
        if (options.historyWriteError && key === 'updates.installHistory')
          throw new Error('private storage fixture');
        values.set(key, value);
      },
    },
    version: options.version || '0.2.0',
    mode: options.mode || 'installed',
    clock: options.clock || (() => Date.parse('2026-10-17T12:00:00Z')),
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

function downloadFixture(t, options = {}) {
  const native = new EventEmitter();
  const calls = { check: 0, install: 0, urls: [] };
  native.setFeedURL = ({ url }) => {
    calls.feed = url;
  };
  native.checkForUpdates = () => {
    calls.check++;
  };
  native.quitAndInstall = () => {
    calls.install++;
  };
  const data = Buffer.from('fixture-package-content');
  const name = 'voxen_desktop-0.3.5-full.nupkg';
  const manifest = `${createHash('sha1').update(data).digest('hex')} ${name} ${data.length}\n`;
  const fetchImpl = async (url, config) => {
    calls.urls.push(url);
    if (url.endsWith('/RELEASES')) return new Response(options.manifest || manifest);
    if (options.packageResponse) return options.packageResponse(config);
    return new Response(data, { headers: { 'content-length': String(data.length) } });
  };
  const adapter = new DownloadAdapter({ native, version: options.version || '0.3.4', fetchImpl });
  const errors = [],
    progress = [],
    releases = [];
  adapter.on('error', (error) => errors.push(error.message));
  adapter.on('download-progress', (value) => progress.push(value));
  adapter.on('release-info', (value) => releases.push(value));
  adapter.setFeedURL({ url: FEED });
  t.after(() => adapter.close());
  return { native, adapter, calls, data, name, errors, progress, releases };
}

test('strict full-package manifest parsing and stable version comparisons reject untrusted packages', () => {
  const valid = `${'a'.repeat(40)} voxen_desktop-0.3.5-full.nupkg 1024`;
  assert.equal(parseManifest(valid).version, '0.3.5');
  for (const bad of [
    valid + '\n' + valid,
    valid.replace('voxen_desktop', '../voxen_desktop'),
    valid.replace('full', 'delta'),
    valid.replace('1024', '0'),
    valid.replace('1024', '9007199254740992'),
    valid.replace('voxen_desktop', 'other'),
  ])
    assert.throws(() => parseManifest(bad));
  assert(newerVersion('0.3.5', '0.3.4'));
  assert(newerVersion('0.10.0', '0.9.9'));
  assert(!newerVersion('0.3.4', '0.3.4'));
  assert(!newerVersion('0.3.3', '0.3.4'));
  assert(!newerVersion('0.3.5-evil', '0.3.4'));
});

test('loopback feed streams one pinned official package and reports actual byte progress', async (t) => {
  const f = downloadFixture(t);
  await f.adapter.checkForUpdates();
  assert.equal(f.calls.check, 1);
  assert.deepEqual(f.releases, [{ version: '0.3.5', totalBytes: f.data.length }]);
  assert.match(f.calls.feed, /^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}$/);
  const manifest = await fetch(f.calls.feed + '/RELEASES?id=voxen&localVersion=0.3.4&arch=amd64');
  assert.equal(manifest.status, 200);
  const downloaded = Buffer.from(await (await fetch(f.calls.feed + '/' + f.name)).arrayBuffer());
  assert.deepEqual(downloaded, f.data);
  assert.equal(f.progress.at(-1).transferredBytes, f.data.length);
  assert.equal(f.progress.at(-1).downloadPercent, 100);
  assert.equal(f.calls.urls.filter((url) => url.endsWith('.nupkg')).length, 1);
  assert(
    f.calls.urls.includes(
      `https://github.com/foulezombie94/VOXEN/releases/download/v0.3.5/${f.name}`,
    ),
  );
  assert.equal(f.calls.install, 0);
});

test('no newer release never starts Squirrel or advertises availability', async (t) => {
  const f = downloadFixture(t, { version: '0.3.5' });
  let notAvailable = 0;
  f.adapter.on('update-not-available', () => {
    notAvailable++;
  });
  await f.adapter.checkForUpdates();
  assert.equal(notAvailable, 1);
  assert.equal(f.calls.check, 0);
  assert.equal(f.releases.length, 0);
  assert.equal(f.adapter.server, undefined);
});

test('local updater only serves the exact manifest and package to GET requests', async (t) => {
  const f = downloadFixture(t);
  await f.adapter.checkForUpdates();
  for (const suffix of [
    '/anything',
    '/' + f.name + '?url=https://example.invalid',
    '/RELEASES?url=evil',
    '/%2e%2e/RELEASES',
    '/RELEASES/extra',
  ]) {
    assert.equal((await fetch(f.calls.feed + suffix)).status, 404, suffix);
  }
  assert.equal((await fetch(f.calls.feed + '/RELEASES', { method: 'POST' })).status, 404);
  const address = new URL(f.calls.feed);
  assert.equal((await fetch(address.origin + '/wrong/RELEASES')).status, 404);
  assert.equal(f.calls.urls.length, 1);
  assert.throws(() => f.adapter.setFeedURL({ url: 'http://untrusted' }));
});

test('package truncation, length mismatch and checksum mismatch fail safely without 100 percent', async (t) => {
  for (const mode of ['truncated', 'length', 'hash']) {
    const f = downloadFixture(t, {
      packageResponse: () =>
        new Response(mode === 'hash' ? 'X'.repeat(23) : 'short', {
          headers: mode === 'length' ? { 'content-length': '999' } : {},
        }),
    });
    await f.adapter.checkForUpdates();
    try {
      await (await fetch(f.calls.feed + '/' + f.name)).arrayBuffer();
    } catch {
      /* aborted transport */
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert(f.errors.length, mode);
    assert(!f.progress.some((item) => item.downloadPercent === 100), mode);
    assert(
      f.errors.every((value) => !value.includes('http') && !value.includes('fixture')),
      mode,
    );
  }
});

test('closing aborts an active download and removes only owned native listeners', async (t) => {
  let aborted = false;
  const f = downloadFixture(t, {
    packageResponse: ({ signal }) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from('first'));
            signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                controller.error(new Error('fixture aborted'));
              },
              { once: true },
            );
          },
        }),
      ),
  });
  const external = () => {};
  f.native.on('error', external);
  await f.adapter.checkForUpdates();
  const response = await fetch(f.calls.feed + '/' + f.name);
  const reader = response.body.getReader();
  await reader.read();
  f.adapter.close();
  try {
    await reader.read();
  } catch {
    /* cancelled */
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert(aborted);
  assert.equal(f.errors.length, 0);
  assert.deepEqual(f.native.listeners('error'), [external]);
  assert.equal(f.adapter.server, null);
});

test('client cancellation aborts the upstream transfer and never reports completion', async (t) => {
  let aborted = false;
  const f = downloadFixture(t, {
    packageResponse: ({ signal }) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from('first'));
            signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                controller.error(new Error('fixture aborted'));
              },
              { once: true },
            );
          },
        }),
      ),
  });
  await f.adapter.checkForUpdates();
  const response = await fetch(f.calls.feed + '/' + f.name);
  await response.body.cancel();
  for (let i = 0; i < 20 && !aborted; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert(aborted);
  assert(f.errors.length);
  assert(!f.progress.some((item) => item.downloadPercent === 100));
});

test('official transport refuses unsafe redirect targets before requesting them', async () => {
  const first = FEED + '/RELEASES';
  for (const target of [
    'http://github.com/foulezombie94/VOXEN/releases/x',
    'https://example.invalid/secret',
    'https://github.com/other/repo/releases/x',
    'file:///private',
    'https://user:password@release-assets.githubusercontent.com/file',
  ]) {
    let calls = 0;
    await assert.rejects(
      officialFetch(first, new AbortController().signal, async () => {
        calls++;
        return new Response(null, { status: 302, headers: { location: target } });
      }),
    );
    assert.equal(calls, 1);
  }
});

test('update status carries verified version and measured progress without exposing native metadata', () => {
  const f = fixture();
  assert.equal(f.updates.status().downloadPercent, null);
  f.adapter.emit('release-info', { version: '0.3.0', totalBytes: 100 });
  f.adapter.emit('update-available');
  f.adapter.emit('download-progress', {
    transferredBytes: 42,
    totalBytes: 100,
    bytesPerSecond: 21,
  });
  assert.equal(f.updates.status().availableVersion, '0.3.0');
  assert.equal(f.updates.status().downloadPercent, 42);
  assert.equal(f.updates.status().bytesPerSecond, 21);
  f.adapter.emit('download-progress', { transferredBytes: 101, totalBytes: 100 });
  assert.equal(f.updates.status().downloadPercent, 42);
  f.adapter.emit('update-not-available');
  assert.equal(f.updates.status().availableVersion, null);
  assert.equal(f.updates.status().downloadPercent, null);
  f.close();
});

test('intermediate percentage advances from streamed bytes and stops before verification', async (t) => {
  let stream;
  const f = downloadFixture(t, {
    packageResponse: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            stream = controller;
          },
        }),
      ),
  });
  await f.adapter.checkForUpdates();
  const firstProgress = new Promise((resolve) =>
    f.adapter.on('download-progress', (value) => {
      if (value.transferredBytes === 5) resolve(value);
    }),
  );
  const request = fetch(f.calls.feed + '/' + f.name);
  while (!stream) await new Promise((resolve) => setImmediate(resolve));
  stream.enqueue(f.data.subarray(0, 5));
  const measured = await firstProgress;
  assert.equal(measured.downloadPercent, (5 / f.data.length) * 100);
  assert(!f.progress.some((value) => value.downloadPercent === 100));
  stream.enqueue(f.data.subarray(5));
  stream.close();
  await (await request).arrayBuffer();
  assert.equal(f.progress.at(-1).downloadPercent, 100);
  f.native.emit('update-downloaded', {}, '', 'Non-version release title');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.adapter.server, null);
  assert.equal(f.adapter.running, false);
});

test('verified manifest version survives an arbitrary native release title while staging completes', () => {
  const f = fixture();
  f.adapter.emit('release-info', { version: '0.3.0', totalBytes: 100 });
  f.adapter.emit('update-available');
  f.adapter.emit('checking-for-update');
  assert.equal(f.updates.status().state, 'downloading');
  f.ready('An arbitrary title');
  assert.equal(f.updates.status().availableVersion, '0.3.0');
  assert.equal(f.updates.status().state, 'ready');
  f.close();
});

const INSTALL_KEY = 'updates.installHistory';
const DAY = 24 * 60 * MINUTE;
const attemptNow = Date.parse('2026-10-17T12:00:00Z');
const historyValue = (changes = {}) =>
  JSON.stringify({ failures: [], pending: null, autoRetryAt: null, ...changes });

test('explicit install records one bounded target only after draft saving and verifies success next startup', async () => {
  const f = fixture();
  f.ready('0.3.0');
  await f.updates.install();
  const history = JSON.parse(f.values.get(INSTALL_KEY));
  assert.deepEqual(history.pending, {
    targetVersion: '0.3.0',
    fromVersion: '0.2.0',
    attemptedAt: attemptNow,
  });
  f.close();
  for (const version of ['0.3.0', '0.4.0']) {
    const reopened = fixture({ saved: [...f.values], version });
    assert.deepEqual(JSON.parse(reopened.values.get(INSTALL_KEY)), JSON.parse(historyValue()));
    assert.equal(reopened.updates.status().autoRetryAt, null);
    reopened.close();
  }
  const blocked = fixture({ beforeInstall: async () => false });
  blocked.ready();
  await assert.rejects(blocked.updates.install());
  assert.equal(blocked.values.get(INSTALL_KEY), undefined);
  blocked.close();
});

test('returning to old version records one failed attempt once and three recent failures pause only automatic checks', async () => {
  let saved = [];
  for (let count = 1; count <= 3; count++) {
    const f = fixture({ saved });
    f.ready();
    await f.updates.install();
    saved = [...f.values];
    f.close();
    const reopened = fixture({ saved });
    const history = JSON.parse(reopened.values.get(INSTALL_KEY));
    assert.equal(history.failures.length, count);
    assert.equal(history.pending, null);
    saved = [...reopened.values];
    if (count === 3) {
      assert.equal(reopened.updates.status().autoRetryAt, new Date(attemptNow + DAY).toISOString());
      assert.equal(reopened.updates.status().enabled, true);
      reopened.updates.start();
      assert.equal(reopened.delay(), DAY);
      assert.deepEqual(await reopened.updates.check(false), { ok: false });
      assert.equal(reopened.calls.check, 0);
      assert.deepEqual(await reopened.updates.check(true), { ok: true });
      assert.equal(reopened.calls.check, 1);
    }
    reopened.close();
    const noExtraAttempt = fixture({ saved });
    assert.equal(noExtraAttempt.updates.installHistory.failures.length, count);
    noExtraAttempt.close();
  }
});

test('expired retry pause resumes automatic checks and failure timestamps outside24h do not trigger a pause', async () => {
  let now = attemptNow;
  const f = fixture({
    clock: () => now,
    saved: [[INSTALL_KEY, historyValue({ failures: [now, now, now], autoRetryAt: now + DAY })]],
  });
  f.updates.start();
  assert.equal(f.delay(), DAY);
  now += DAY + 1;
  assert.equal(f.updates.status().autoRetryAt, null);
  assert.deepEqual(await f.updates.check(false), { ok: true });
  assert.equal(f.calls.check, 1);
  f.close();
  const stale = fixture({
    saved: [
      [
        INSTALL_KEY,
        historyValue({
          failures: [attemptNow - DAY - 1, attemptNow - DAY - 1],
          pending: {
            fromVersion: '0.2.0',
            targetVersion: '0.3.0',
            attemptedAt: attemptNow - DAY - 1,
          },
        }),
      ],
    ],
  });
  assert.equal(stale.updates.installHistory.failures.length, 0);
  assert.equal(stale.updates.status().autoRetryAt, null);
  stale.close();
});

test('native synchronous and asynchronous install failures count once without leaving a pending retry', async () => {
  for (const asynchronous of [false, true]) {
    let saved = [];
    for (let count = 1; count <= 3; count++) {
      const f = fixture({
        saved,
        ...(!asynchronous && { installError: new Error('private fixture') }),
      });
      f.ready();
      if (asynchronous) {
        await f.updates.install();
        f.adapter.emit('error', new Error('private fixture'));
      } else await assert.rejects(f.updates.install());
      const history = JSON.parse(f.values.get(INSTALL_KEY));
      assert.equal(history.failures.length, count);
      assert.equal(history.pending, null);
      assert.equal(f.updates.status().autoRetryAt !== null, count === 3);
      saved = [...f.values];
      f.close();
    }
  }
});

test('install history rejects malformed or oversized JSON and caps valid future timestamps to24h', () => {
  const invalid = [
    'not json',
    'null',
    '[]',
    'x'.repeat(4097),
    historyValue({ failures: [1, 2, 3, 4] }),
    historyValue({ failures: ['secret'] }),
    historyValue({
      pending: { fromVersion: '0.2.0', targetVersion: 'https://secret', attemptedAt: attemptNow },
    }),
    historyValue({
      pending: { fromVersion: '0.3.0', targetVersion: '0.2.0', attemptedAt: attemptNow },
    }),
    historyValue({ autoRetryAt: 'forever' }),
  ];
  for (const value of invalid) {
    const f = fixture({ saved: [[INSTALL_KEY, value]] });
    assert.deepEqual(f.updates.installHistory, JSON.parse(historyValue()));
    assert.equal(f.updates.status().autoRetryAt, null);
    f.close();
  }
  const f = fixture({
    saved: [
      [
        INSTALL_KEY,
        historyValue({
          failures: [Number.MAX_SAFE_INTEGER],
          autoRetryAt: Number.MAX_SAFE_INTEGER,
          pending: {
            fromVersion: '0.2.0',
            targetVersion: '0.3.0',
            attemptedAt: Number.MAX_SAFE_INTEGER,
          },
        }),
      ],
    ],
  });
  assert.deepEqual(f.updates.installHistory.failures, [attemptNow, attemptNow]);
  assert.equal(f.updates.status().autoRetryAt, new Date(attemptNow + DAY).toISOString());
  assert.equal(f.updates.installHistory.pending, null);
  assert(!JSON.stringify(f.updates.status()).includes('secret'));
  f.close();
});

test('development and portable modes do not reconcile or persist installation tracking', () => {
  const value = historyValue({
    pending: { fromVersion: '0.2.0', targetVersion: '0.3.0', attemptedAt: attemptNow },
  });
  for (const mode of ['development', 'portable']) {
    const f = fixture({ mode, saved: [[INSTALL_KEY, value]] });
    assert.equal(f.values.get(INSTALL_KEY), value);
    assert.equal(f.updates.status().autoRetryAt, null);
    f.close();
  }
});

test('future retry timestamp is persisted once so restarting cannot prolong the24h cap', () => {
  const f = fixture({
    saved: [[INSTALL_KEY, historyValue({ autoRetryAt: Number.MAX_SAFE_INTEGER })]],
  });
  const expected = new Date(attemptNow + DAY).toISOString();
  assert.equal(f.updates.status().autoRetryAt, expected);
  const reopened = fixture({ saved: [...f.values], clock: () => attemptNow + MINUTE });
  assert.equal(reopened.updates.status().autoRetryAt, expected);
  f.close();
  reopened.close();
});

test('failure to persist an explicit attempt prevents the native restart without exposing storage errors', async () => {
  const f = fixture({ historyWriteError: true });
  f.ready();
  await assert.rejects(
    f.updates.install(),
    (error) => /Redémarrage reporté/.test(error.message) && !error.message.includes('private'),
  );
  assert.equal(f.calls.install, 0);
  assert.equal(f.updates.installHistory.pending, null);
  assert.equal(f.updates.installHistory.failures.length, 0);
  assert.equal(f.updates.status().busy, false);
  f.close();
  const pending = historyValue({
    pending: { fromVersion: '0.2.0', targetVersion: '0.3.0', attemptedAt: attemptNow },
  });
  const reopened = fixture({ historyWriteError: true, saved: [[INSTALL_KEY, pending]] });
  assert.equal(reopened.updates.installHistory.failures.length, 1);
  reopened.close();
});
