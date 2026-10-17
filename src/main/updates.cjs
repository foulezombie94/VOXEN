'use strict';
const fs = require('node:fs');
const path = require('node:path');
const FEED = 'https://github.com/foulezombie94/VOXEN/releases/latest/download';
const RELEASES = 'https://github.com/foulezombie94/VOXEN/releases/latest';
const ACTIONS = new Set([
  'updates.check',
  'updates.install',
  'updates.preferences',
  'updates.openReleases',
]);
const MINUTE = 60_000;

function installationMode({
  packaged,
  platform = process.platform,
  execPath = process.execPath,
  exists = fs.existsSync,
}) {
  if (!packaged) return 'development';
  if (
    platform === 'win32' &&
    /^app-\d+\.\d+\.\d+$/i.test(path.basename(path.dirname(execPath))) &&
    exists(path.resolve(path.dirname(execPath), '..', 'Update.exe'))
  )
    return 'installed';
  return 'portable';
}

class Updates {
  constructor({
    adapter,
    store,
    version,
    mode,
    isBusy = () => false,
    isOnline = () => true,
    beforeInstall = async () => true,
    onChange = () => {},
    openReleases = async () => {},
    clock = () => Date.now(),
    random = Math.random,
    schedule = setTimeout,
    unschedule = clearTimeout,
  }) {
    Object.assign(this, {
      adapter,
      store,
      version,
      mode,
      isBusy,
      isOnline,
      beforeInstall,
      onChange,
      openReleases,
      clock,
      random,
      schedule,
      unschedule,
    });
    this.enabled = store.get('updates.enabled') !== 'false';
    this.state = mode === 'installed' ? 'idle' : 'unsupported';
    this.availableVersion = null;
    // Never infer that the current version is up to date from a previous process.
    this.lastChecked = null;
    this.installing = false;
    this.closed = false;
    this.listeners = [];
    if (this.supported) {
      this.listen('checking-for-update', () => {
        this.state = 'checking';
        this.changed();
      });
      this.listen('update-available', () => {
        this.state = 'downloading';
        this.changed();
      });
      this.listen('update-not-available', () => {
        this.state = 'idle';
        this.completed();
      });
      this.listen('update-downloaded', (_event, _notes, releaseName) => {
        this.state = 'ready';
        this.availableVersion = /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(releaseName || '')
          ? releaseName
          : null;
        this.completed();
      });
      this.listen('error', () => this.failed());
      try {
        adapter.setFeedURL({ url: FEED });
      } catch {
        this.failed();
      }
    }
  }
  get supported() {
    return this.mode === 'installed';
  }
  listen(event, handler) {
    this.adapter.on(event, handler);
    this.listeners.push([event, handler]);
  }
  status() {
    return {
      supported: this.supported,
      mode: this.mode,
      state: this.state,
      currentVersion: this.version,
      availableVersion: this.availableVersion,
      lastChecked: this.lastChecked,
      enabled: this.enabled,
      canInstall: this.state === 'ready' && !this.installing && !this.isBusy(),
      busy: this.installing,
      message: '',
    };
  }
  changed() {
    if (!this.closed) this.onChange();
  }
  delay() {
    return Math.round((30 + this.random() * 270) * MINUTE);
  }
  arm(delay = this.delay()) {
    this.unschedule(this.timer);
    if (
      this.closed ||
      !this.supported ||
      !this.enabled ||
      this.state === 'ready' ||
      this.installing
    )
      return;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.check(false);
    }, delay);
    this.timer?.unref?.();
  }
  start() {
    this.arm(MINUTE);
  } // Includes the Squirrel first-run lock delay (>10s).
  completed() {
    this.lastChecked = new Date(this.clock()).toISOString();
    this.arm();
    this.changed();
  }
  failed() {
    if (this.closed) return;
    this.state = 'error';
    this.installing = false;
    this.arm(30 * MINUTE);
    this.changed(); // Never forward native error strings, paths, URLs or headers.
  }
  async check(manual = true) {
    if (
      this.closed ||
      !this.supported ||
      this.installing ||
      ['checking', 'downloading', 'ready'].includes(this.state)
    )
      return { ok: false };
    if ((!manual && !this.enabled) || this.isBusy() || !this.isOnline()) {
      this.arm(MINUTE);
      if (manual)
        throw new Error('Terminez l’opération en cours et vérifiez votre connexion Internet.');
      return { ok: false };
    }
    this.unschedule(this.timer);
    this.state = 'checking';
    this.changed();
    try {
      const pending = this.adapter.checkForUpdates();
      pending?.catch?.(() => this.failed());
    } catch {
      this.failed();
    }
    return { ok: this.state !== 'error' };
  }
  async install() {
    if (
      this.closed ||
      !this.supported ||
      this.state !== 'ready' ||
      this.installing ||
      this.isBusy()
    )
      throw new Error('Terminez l’opération en cours avant de redémarrer.');
    this.installing = true;
    this.changed();
    try {
      if (!(await this.beforeInstall()) || this.closed || this.isBusy())
        throw new Error(
          'Les notes doivent être enregistrées et la dictée terminée avant de redémarrer.',
        );
      this.adapter.quitAndInstall();
      return { ok: true };
    } catch {
      this.installing = false;
      this.changed();
      throw new Error(
        'Redémarrage reporté. Terminez la dictée et enregistrez vos notes, puis réessayez.',
      );
    }
  }
  async handle(action, payload = {}) {
    if (action === 'updates.openReleases') {
      await this.openReleases(RELEASES);
      return { ok: true };
    }
    if (action === 'updates.check') return this.check();
    if (action === 'updates.install') return this.install();
    if (
      action === 'updates.preferences' &&
      this.supported &&
      typeof payload.enabled === 'boolean'
    ) {
      this.enabled = payload.enabled;
      this.store.set('updates.enabled', String(this.enabled));
      this.arm(this.enabled ? MINUTE : undefined);
      this.changed();
      return { ok: true };
    }
    throw new Error('Action de mise à jour indisponible.');
  }
  close() {
    this.closed = true;
    this.unschedule(this.timer);
    for (const [event, handler] of this.listeners) this.adapter.removeListener(event, handler);
  }
}
module.exports = { Updates, ACTIONS, FEED, RELEASES, installationMode };
