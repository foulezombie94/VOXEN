'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { Store } = require('../src/main/store.cjs');
const { Cloud } = require('../src/main/cloud.cjs');
const {
  exportState,
  applyState,
  contentHash,
  mergeSelected,
} = require('../src/main/cloud-state.cjs');
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voxen-cloud-test-')),
    store = new Store(dir);
  const config = { url: 'https://example.supabase.co', publishableKey: 'public-test-only' };
  let remote = { revision: 0, state: null },
    calls = [];
  const vault = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('cipher:' + Buffer.from(s).toString('base64')),
    decryptString: (b) => Buffer.from(b.toString().slice(7), 'base64').toString(),
  };
  const fetchImpl = async (url, opt) => {
    const body = opt.body ? JSON.parse(opt.body) : null;
    calls.push({ url, body });
    let value = {};
    if (url.endsWith('voxen_get_workspace')) value = structuredClone(remote);
    else if (url.endsWith('voxen_put_workspace')) {
      if (body.p_expected_revision !== remote.revision)
        value = { conflict: true, revision: remote.revision };
      else {
        remote = { revision: remote.revision + 1, state: body.p_state };
        value = { conflict: false, revision: remote.revision };
      }
    } else if (url.includes('/verify') || url.includes('/token?'))
      value = {
        access_token: 'fixture-access-do-not-log',
        refresh_token: 'fixture-refresh-do-not-log',
        expires_in: 3600,
        user: { id: 'test-user', email: 'test@example.invalid' },
      };
    return { ok: true, status: 200, json: async () => value };
  };
  const cloud = new Cloud(store, { config, safeStorage: vault, fetchImpl });
  const login = () =>
    cloud.handle('cloud.verify', { email: 'test@example.invalid', codeOrLink: '123456' });
  return {
    store,
    cloud,
    dir,
    calls,
    login,
    get remote() {
      return remote;
    },
    set remote(r) {
      remote = r;
    },
    close() {
      cloud.close();
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('snapshot allowlist excludes machine preferences, credentials, notes and history by default', () => {
  const f = fixture();
  try {
    f.store.set('DeepgramKey', 'never-export');
    f.store.saveNote({ body: 'private note' });
    const s = exportState(f.store);
    assert.deepEqual(s.notes, []);
    assert.deepEqual(s.history, []);
    assert.equal(s.preferences.HotkeyVirtualKey, undefined);
    assert(!JSON.stringify(s).includes('never-export'));
    assert(!JSON.stringify(s).includes('private note'));
  } finally {
    f.close();
  }
});
test('email login saves encrypted session and sends no workspace until explicit opt-in', async () => {
  const f = fixture();
  try {
    await f.login();
    assert.equal(f.cloud.status().connected, true);
    assert.equal(f.cloud.status().enabled, false);
    assert.equal(f.calls.filter((x) => x.url.includes('workspace')).length, 0);
    assert(!fs.readFileSync(f.cloud.file, 'utf8').includes('fixture-access'));
    assert(!JSON.stringify(f.cloud.status()).includes('fixture-refresh'));
    await f.cloud.handle('cloud.preferences', { enabled: true });
    assert.equal(f.remote.revision, 1);
  } finally {
    f.close();
  }
});
test('first existing cloud data requires explicit choice; newer revision needs another review', async () => {
  const f = fixture();
  try {
    await f.login();
    const initial = exportState(f.store);
    initial.dictionary = [{ Id: 1, Term: 'Remote' }];
    f.remote = { revision: 5, state: initial };
    await f.cloud.handle('cloud.preferences', { enabled: true });
    assert.equal(f.cloud.status().status, 'conflict');
    assert.equal(
      f.store.terms().some((t) => t.Term === 'Remote'),
      false,
    );
    f.remote = { revision: 6, state: initial };
    await f.cloud.handle('cloud.resolve', { strategy: 'local' });
    assert.equal(f.cloud.status().status, 'conflict');
    assert.equal(f.remote.revision, 6);
    await f.cloud.handle('cloud.resolve', { strategy: 'remote' });
    assert.equal(f.cloud.status().status, 'synced');
    assert.equal(f.store.terms()[0].Term, 'Remote');
    assert.equal(f.store.db.prepare('SELECT count(*) n FROM CloudBackups').get().n, 1);
  } finally {
    f.close();
  }
});
test('local-only edits push; remote-only changes pull; concurrent edits remain local until resolved', async () => {
  const f = fixture();
  try {
    await f.login();
    await f.cloud.handle('cloud.preferences', { enabled: true });
    f.store.addTerm('Local');
    await f.cloud.handle('cloud.sync');
    assert.equal(f.remote.revision, 2);
    let s = structuredClone(f.remote.state);
    s.dictionary.push({ Id: 99, Term: 'Remote' });
    f.remote = { revision: 3, state: s };
    await f.cloud.handle('cloud.sync');
    assert(f.store.terms().some((t) => t.Term === 'Remote'));
    f.store.addTerm('Unsent');
    s = structuredClone(f.remote.state);
    s.dictionary.push({ Id: 100, Term: 'Other' });
    f.remote = { revision: 4, state: s };
    await f.cloud.handle('cloud.sync');
    assert.equal(f.cloud.status().status, 'conflict');
    assert(f.store.terms().some((t) => t.Term === 'Unsent'));
    assert(!f.store.terms().some((t) => t.Term === 'Other'));
  } finally {
    f.close();
  }
});
test('unselected remote categories survive an upload; applying remote preserves local machine settings', () => {
  const f = fixture();
  try {
    f.store.saveSettings({ HotkeyVirtualKey: 123 });
    f.store.saveNote({ body: 'remote note' });
    const remote = exportState(f.store, { notes: true });
    const local = exportState(f.store);
    local.dictionary = [{ Id: 1, Term: 'Chosen' }];
    const merged = mergeSelected(local, remote);
    assert.equal(merged.notes[0].Body, 'remote note');
    applyState(f.store, merged, {
      libraries: true,
      preferences: true,
      notes: false,
      history: false,
    });
    assert.equal(f.store.settings().HotkeyVirtualKey, 123);
    assert.equal(f.store.notes()[0].Body, 'remote note');
  } finally {
    f.close();
  }
});
test('a failed remote transaction rolls back and local note revisions reject stale writers', () => {
  const f = fixture();
  try {
    f.store.saveNote({ body: 'local' });
    const before = exportState(f.store, { notes: true });
    let bad = structuredClone(before);
    bad.dictionary = [{ Id: 1, Term: null }];
    assert.throws(() => applyState(f.store, bad, { libraries: true, notes: true }));
    assert.equal(contentHash(exportState(f.store, { notes: true })), contentHash(before));
    const remote = structuredClone(before);
    remote.notes[0].Body = 'new remote';
    applyState(f.store, remote, {
      notes: true,
      libraries: false,
      preferences: false,
      history: false,
    });
    const r = f.store.saveNote({
      id: before.notes[0].Id,
      revision: before.notes[0].Revision,
      body: 'stale',
    });
    assert.equal(r.conflict, true);
    assert.equal(f.store.notes()[0].Body, 'new remote');
  } finally {
    f.close();
  }
});
test('auth refuses foreign links and unavailable encryption; diagnostic never contacts network', async () => {
  const f = fixture();
  try {
    await assert.rejects(
      f.cloud.handle('cloud.verify', {
        codeOrLink: 'https://evil.invalid/auth/v1/verify?token=hidden&type=email',
      }),
    );
    assert.equal(f.calls.length, 0);
    f.cloud.vault.isEncryptionAvailable = () => false;
    await assert.rejects(f.login());
    assert.equal(fs.existsSync(f.cloud.file), false);
    const diag = new Cloud(f.store, {
      config: f.cloud.config,
      diagnostic: true,
      fetchImpl: () => {
        throw Error('network forbidden');
      },
    });
    await diag.init();
    assert.equal(diag.session, null);
    await assert.rejects(diag.handle('cloud.requestLink', { email: 'test@example.invalid' }));
    diag.close();
  } finally {
    f.close();
  }
});
test('logout deletes vault, disables auto-sync and leaves local data available', async () => {
  const f = fixture();
  try {
    await f.login();
    await f.cloud.handle('cloud.preferences', { enabled: true });
    const terms = f.store.terms();
    await f.cloud.handle('cloud.logout');
    assert.equal(fs.existsSync(f.cloud.file), false);
    assert.equal(f.cloud.status().connected, false);
    assert.deepEqual(f.store.terms(), terms);
  } finally {
    f.close();
  }
});
test('a late refresh cannot replace a newer account session', async () => {
  const f = fixture();
  try {
    await f.login();
    let release;
    f.cloud.fetch = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const refreshing = f.cloud.refresh();
    await f.cloud.accept({
      access_token: 'synthetic-B',
      refresh_token: 'synthetic-B-refresh',
      expires_in: 3600,
      user: { id: 'user-B', email: 'b@example.invalid' },
    });
    release({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'synthetic-A-old',
        refresh_token: 'synthetic-A-refresh',
        expires_in: 3600,
        user: { id: 'test-user', email: 'test@example.invalid' },
      }),
    });
    await refreshing;
    assert.equal(f.cloud.session.user.id, 'user-B');
    assert.equal(f.cloud.status().enabled, false);
  } finally {
    f.close();
  }
});
