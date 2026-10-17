'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  { randomUUID } = require('node:crypto');
const {
  DEFAULT_SCOPE,
  scopeOf,
  exportState,
  validateState,
  mergeSelected,
  applyState,
  contentHash,
} = require('./cloud-state.cjs');
const ACTIONS = new Set([
  'cloud.requestLink',
  'cloud.verify',
  'cloud.logout',
  'cloud.preferences',
  'cloud.sync',
  'cloud.resolve',
  'cloud.profile',
]);
const ERROR =
  'Connexion : opération impossible. Vérifiez votre connexion ou renvoyez un email de connexion.';
class Cloud {
  constructor(
    store,
    {
      config,
      safeStorage,
      fetchImpl = global.fetch,
      diagnostic = false,
      onChange = () => {},
      beforeApply = async () => true,
    } = {},
  ) {
    this.store = store;
    this.config = config || {};
    this.vault = safeStorage;
    this.fetch = fetchImpl;
    this.diagnostic = diagnostic;
    this.onChange = onChange;
    this.beforeApply = beforeApply;
    this.session = null;
    this.state = 'offline';
    this.message = '';
    this.closed = false;
    this.queue = Promise.resolve();
    this.active = false;
    this.file = path.join(path.dirname(store.path), 'cloud-session.bin');
    this.meta = {};
    this.pending = false;
    this.device = store.get('cloud.device');
    if (!this.device && !diagnostic) {
      this.device = randomUUID();
      store.set('cloud.device', this.device);
    }
    this.device ||= randomUUID();
  }
  get configured() {
    return Boolean(this.config.url?.startsWith('https://') && this.config.publishableKey);
  }
  readMeta(uid) {
    try {
      return JSON.parse(this.store.get('cloud.user.' + uid) || '{}');
    } catch {
      return {};
    }
  }
  saveMeta() {
    if (this.session)
      this.store.set('cloud.user.' + this.session.user.id, JSON.stringify(this.meta));
  }
  status() {
    return {
      configured: this.configured,
      connected: Boolean(this.session),
      email: this.session?.user.email || '',
      displayName: this.meta.displayName || '',
      enabled: !!this.meta.enabled,
      status: this.state,
      message: this.message,
      lastSync: this.meta.lastSync || null,
      revision: this.meta.revision || 0,
      scope: scopeOf(this.meta.scope),
      pending: this.pending,
      projectName: this.config.projectName || 'Voxen',
    };
  }
  changed() {
    if (!this.closed) this.onChange();
  }
  async request(
    endpoint,
    { method = 'POST', body, auth = false, retry = true, headers = {} } = {},
  ) {
    if (this.diagnostic || this.closed || !this.configured) throw new Error(ERROR);
    if (auth) await this.ensureSession();
    let response;
    try {
      response = await this.fetch(this.config.url + endpoint, {
        method,
        headers: {
          apikey: this.config.publishableKey,
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: 'Bearer ' + this.session.access_token } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new Error(ERROR);
    }
    if (response.status === 401 && auth && retry) {
      await this.refresh();
      return this.request(endpoint, { method, body, auth, retry: false, headers });
    }
    if (!response.ok) {
      if (response.status === 401 && auth) {
        this.expire();
      }
      throw new Error(ERROR);
    }
    // Provider response bodies/errors are never logged or sent to a renderer.
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  persist(session) {
    if (!this.vault?.isEncryptionAvailable())
      throw new Error('Connexion : le chiffrement Windows est indisponible.');
    const encrypted = this.vault.encryptString(JSON.stringify(session));
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, encrypted);
    fs.renameSync(temp, this.file);
  }
  async accept(value) {
    if (
      !value?.access_token ||
      !value?.refresh_token ||
      !value.user?.id ||
      !value.user.email ||
      value.user.is_anonymous
    )
      throw new Error(ERROR);
    const session = {
      access_token: value.access_token,
      refresh_token: value.refresh_token,
      expires_at: value.expires_at || Math.floor(Date.now() / 1000) + (value.expires_in || 3600),
      user: { id: value.user.id, email: value.user.email },
    };
    this.persist(session);
    this.authGeneration = (this.authGeneration || 0) + 1;
    const previous = this.session?.user.id;
    this.session = session;
    if (previous !== session.user.id) {
      this.meta = this.readMeta(session.user.id);
      if (previous) {
        this.meta.enabled = false;
        this.meta.hash = null;
      }
      this.saveMeta();
    }
    this.state = 'ready';
    this.changed();
  }
  async ensureSession() {
    if (!this.session) throw new Error('Connexion : connectez votre compte.');
    if (this.session.expires_at * 1000 < Date.now() + 60000) await this.refresh();
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    const token = this.session?.refresh_token,
      generation = this.authGeneration || 0;
    if (!token) throw new Error(ERROR);
    this.refreshing = (async () => {
      try {
        const r = await this.request('/auth/v1/token?grant_type=refresh_token', {
          body: { refresh_token: token },
        });
        if (this.closed || generation !== (this.authGeneration || 0)) return;
        await this.accept(r);
      } catch (error) {
        if (generation === (this.authGeneration || 0)) {
          this.state = 'offline';
          this.changed();
          throw error;
        }
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }
  expire() {
    this.authGeneration = (this.authGeneration || 0) + 1;
    this.session = null;
    this.meta = {};
    this.pending = false;
    try {
      fs.rmSync(this.file, { force: true });
    } catch {}
    this.state = 'offline';
    this.changed();
  }
  async init() {
    if (this.diagnostic || !this.configured) return;
    try {
      if (fs.existsSync(this.file) && this.vault?.isEncryptionAvailable()) {
        const parsed = JSON.parse(this.vault.decryptString(fs.readFileSync(this.file)));
        if (parsed.user?.id && parsed.access_token && parsed.refresh_token) {
          this.session = parsed;
          this.meta = this.readMeta(parsed.user.id);
          await this.ensureSession();
          this.state = 'ready';
        }
      }
    } catch {
      this.state = 'offline';
    }
    this.changed();
    this.timer = setInterval(() => {
      if (this.session && this.meta.enabled && !this.active && this.state !== 'conflict')
        void this.handle('cloud.sync').catch(() => {});
    }, 30000);
    this.timer.unref?.();
    if (this.session && this.meta.enabled) void this.handle('cloud.sync').catch(() => {});
  }
  markDirty() {
    if (this.closed || !this.session || !this.meta.enabled) return;
    this.pending = true;
    this.changed();
    clearTimeout(this.debounce);
    if (this.state === 'conflict') return;
    this.debounce = setTimeout(() => {
      if (!this.active) void this.handle('cloud.sync').catch(() => {});
    }, 2200);
    this.debounce.unref?.();
  }
  handle(action, p = {}) {
    const work = this.queue.then(async () => {
      if (this.closed) throw new Error(ERROR);
      this.active = true;
      try {
        return await this.perform(action, p);
      } catch (error) {
        this.state = this.session ? 'error' : 'offline';
        this.message = ERROR;
        this.changed();
        throw new Error(ERROR);
      } finally {
        this.active = false;
      }
    });
    this.queue = work.catch(() => {});
    return work;
  }
  async perform(action, p) {
    if (!ACTIONS.has(action)) throw new Error(ERROR);
    if (action === 'cloud.requestLink') {
      const email = String(p.email || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error(ERROR);
      if (this.lastMail && Date.now() - this.lastMail < 60000) throw new Error(ERROR);
      await this.request('/auth/v1/otp', { body: { email, create_user: true } });
      this.lastMail = Date.now();
      return { ok: true };
    }
    if (action === 'cloud.verify') {
      const value = String(p.codeOrLink || '').trim(),
        email = String(p.email || '').trim();
      p.codeOrLink = '';
      let body;
      if (/^\d{6,10}$/.test(value)) body = { email, token: value, type: 'email' };
      else {
        let u;
        try {
          u = new URL(value);
        } catch {
          throw new Error(ERROR);
        }
        if (u.origin !== this.config.url || u.pathname !== '/auth/v1/verify')
          throw new Error(ERROR);
        const hash = u.searchParams.get('token_hash') || u.searchParams.get('token');
        if (!hash || !['magiclink', 'email', 'signup'].includes(u.searchParams.get('type')))
          throw new Error(ERROR);
        body = { token_hash: hash, type: 'email' };
      }
      await this.accept(await this.request('/auth/v1/verify', { body }));
      await this.loadProfile();
      return { ok: true };
    }
    if (action === 'cloud.logout') {
      if (this.session) {
        try {
          await this.request('/auth/v1/logout?scope=local', { auth: true });
        } catch {}
        this.meta.enabled = false;
        this.saveMeta();
      }
      this.expire();
      return { ok: true };
    }
    await this.ensureSession();
    if (action === 'cloud.profile') {
      const name = String(p.displayName || '')
        .trim()
        .slice(0, 60);
      await this.request('/rest/v1/voxen_profiles?on_conflict=user_id', {
        auth: true,
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: {
          user_id: this.session.user.id,
          display_name: name,
          updated_at: new Date().toISOString(),
        },
      });
      this.meta.displayName = name;
      this.saveMeta();
      this.changed();
      return { ok: true };
    }
    if (action === 'cloud.preferences') {
      const next = scopeOf(p.scope || this.meta.scope);
      if (JSON.stringify(next) !== JSON.stringify(scopeOf(this.meta.scope))) this.meta.hash = null;
      this.meta.scope = next;
      this.meta.enabled = p.enabled === true;
      this.saveMeta();
      this.state = 'ready';
      this.changed();
      if (this.meta.enabled) return this.sync();
      return { ok: true };
    }
    if (action === 'cloud.resolve') {
      if (this.state !== 'conflict' || !['local', 'remote'].includes(p.strategy))
        throw new Error(ERROR);
      return this.sync(p.strategy);
    }
    return this.sync();
  }
  async loadProfile() {
    try {
      const rows = await this.request(
        '/rest/v1/voxen_profiles?select=display_name&user_id=eq.' +
          encodeURIComponent(this.session.user.id),
        { auth: true, method: 'GET' },
      );
      this.meta.displayName = rows?.[0]?.display_name || '';
      this.saveMeta();
      this.changed();
    } catch {
      /* Login remains usable without a profile row. */
    }
  }
  async sync(strategy) {
    if (!this.meta.enabled) return { ok: true, disabled: true };
    this.state = 'syncing';
    this.message = '';
    this.changed();
    // Flush both local editors before taking a snapshot. Busy audio/transform postpones sync.
    if (!(await this.beforeApply())) {
      this.state = 'ready';
      this.pending = true;
      this.changed();
      return { ok: true, deferred: true };
    }
    const scope = scopeOf(this.meta.scope),
      local = exportState(this.store, scope),
      hash = contentHash(local);
    const remote = await this.request('/rest/v1/rpc/voxen_get_workspace', { auth: true, body: {} });
    if (!remote || !Number.isSafeInteger(remote.revision) || remote.revision < 0)
      throw new Error(ERROR);
    if (remote.state) validateState(remote.state);
    if (!this.meta.enabled) return { ok: true };
    const current = () => contentHash(exportState(this.store, scope));
    const reviewedRevision = this.conflictRevision;
    const conflict = () => {
      this.conflictRevision = remote.revision;
      this.state = 'conflict';
      this.pending = true;
      this.changed();
      return { ok: true, conflict: true };
    };
    if (current() !== hash) return conflict();
    const known = this.meta.hash && Number.isSafeInteger(this.meta.revision);
    const localChanged = !known || hash !== this.meta.hash,
      remoteChanged = !known || remote.revision !== this.meta.revision;
    if (!strategy && remote.state && localChanged && remoteChanged) return conflict();
    if (strategy === 'remote' || (!localChanged && remoteChanged && remote.state)) {
      if (!remote.state) return conflict();
      if (strategy && reviewedRevision !== remote.revision) return conflict();
      if (!(await this.beforeApply()) || current() !== hash) return conflict();
      applyState(this.store, remote.state, scope);
      this.meta.revision = remote.revision;
    } else if (strategy === 'local' || localChanged || !remote.state) {
      const combined = mergeSelected(local, remote.state);
      validateState(combined);
      // A deliberate choice replaces the revision that was reviewed. A newer write still conflicts.
      if (strategy && reviewedRevision !== remote.revision) return conflict();
      const result = await this.request('/rest/v1/rpc/voxen_put_workspace', {
        auth: true,
        body: { p_state: combined, p_expected_revision: remote.revision, p_device_id: this.device },
      });
      if (result?.conflict) {
        this.conflictRevision = result.revision;
        return conflict();
      }
      if (!Number.isSafeInteger(result?.revision)) throw new Error(ERROR);
      this.meta.revision = result.revision;
    }
    // The fetch may overlap a local edit; retain that edit as pending for the next pass.
    this.meta.hash =
      strategy === 'remote' || (!localChanged && remoteChanged && remote.state) ? current() : hash;
    this.meta.lastSync = new Date().toISOString();
    this.saveMeta();
    this.pending = current() !== this.meta.hash;
    this.state = 'synced';
    this.conflictRevision = undefined;
    this.changed();
    return { ok: true };
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    clearTimeout(this.debounce);
  }
}
module.exports = { Cloud, ACTIONS };
