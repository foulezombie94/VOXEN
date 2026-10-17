'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { newerVersion } = require('./update-download.cjs');
const FEED = 'https://github.com/foulezombie94/VOXEN/releases/latest/download';
const RELEASES = 'https://github.com/foulezombie94/VOXEN/releases/latest';
const ACTIONS = new Set([
  'updates.check',
  'updates.install',
  'updates.preferences',
  'updates.openReleases',
]);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const INSTALL_HISTORY = 'updates.installHistory';
const stableVersion = (value) =>
  typeof value === 'string' && /^v?\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(value);
const emptyInstallHistory = () => ({ failures: [], pending: null, autoRetryAt: null });

function readInstallHistory(value, now) {
  try {
    if (typeof value !== 'string' || value.length > 4096) return emptyInstallHistory();
    const data = JSON.parse(value);
    const timestamp = (number) => Number.isSafeInteger(number) && number >= 0;
    if (
      !data ||
      Array.isArray(data) ||
      !Array.isArray(data.failures) ||
      data.failures.length > 3 ||
      !data.failures.every(timestamp) ||
      (data.autoRetryAt !== null && !timestamp(data.autoRetryAt))
    )
      return emptyInstallHistory();
    if (
      data.pending !== null &&
      (!data.pending ||
        typeof data.pending !== 'object' ||
        !stableVersion(data.pending.targetVersion) ||
        !stableVersion(data.pending.fromVersion) ||
        !newerVersion(data.pending.targetVersion, data.pending.fromVersion) ||
        !timestamp(data.pending.attemptedAt))
    )
      return emptyInstallHistory();
    return {
      failures: data.failures
        .map((time) => Math.min(time, now))
        .filter((time) => time > now - DAY)
        .slice(-3),
      pending: data.pending
        ? {
            targetVersion: data.pending.targetVersion,
            fromVersion: data.pending.fromVersion,
            attemptedAt: Math.min(data.pending.attemptedAt, now),
          }
        : null,
      autoRetryAt: data.autoRetryAt > now ? Math.min(data.autoRetryAt, now + DAY) : null,
    };
  } catch {
    return emptyInstallHistory();
  }
}

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
    this.resetProgress();
    // Never infer that the current version is up to date from a previous process.
    this.lastChecked = null;
    this.installing = false;
    this.closed = false;
    this.listeners = [];
    this.installHistory = emptyInstallHistory();
    if (this.supported) {
      const storedHistory = store.get(INSTALL_HISTORY);
      this.installHistory = readInstallHistory(storedHistory, this.clock());
      if (
        typeof storedHistory === 'string' &&
        storedHistory !== JSON.stringify(this.installHistory)
      )
        this.saveInstallHistory();
      if (this.installHistory.pending) {
        if (
          stableVersion(version) &&
          !newerVersion(this.installHistory.pending.targetVersion, version)
        ) {
          this.installHistory = emptyInstallHistory();
          this.saveInstallHistory();
        } else {
          this.failedInstallAttempt(this.installHistory.pending.attemptedAt);
        }
      }
      this.listen('checking-for-update', () => {
        if (this.state === 'downloading') return;
        this.state = 'checking';
        this.changed();
      });
      this.listen('release-info', ({ version, totalBytes } = {}) => {
        if (!newerVersion(version, this.version)) return;
        this.availableVersion = version;
        this.confirmedVersion = version;
        this.totalBytes = Number.isSafeInteger(totalBytes) && totalBytes > 0 ? totalBytes : null;
        this.changed();
      });
      this.listen('download-progress', (progress = {}) => {
        const { transferredBytes, totalBytes, bytesPerSecond } = progress;
        if (
          !Number.isSafeInteger(totalBytes) ||
          totalBytes <= 0 ||
          !Number.isSafeInteger(transferredBytes) ||
          transferredBytes < 0 ||
          transferredBytes > totalBytes
        )
          return;
        this.totalBytes = totalBytes;
        this.transferredBytes = transferredBytes;
        this.bytesPerSecond =
          Number.isFinite(bytesPerSecond) && bytesPerSecond >= 0 ? bytesPerSecond : 0;
        this.downloadPercent = (transferredBytes / totalBytes) * 100;
        this.changed();
      });
      this.listen('update-available', () => {
        this.state = 'downloading';
        this.changed();
      });
      this.listen('update-not-available', () => {
        this.state = 'idle';
        this.availableVersion = null;
        this.confirmedVersion = null;
        this.resetProgress();
        this.completed();
      });
      this.listen('update-downloaded', (_event, _notes, releaseName) => {
        this.state = 'ready';
        this.availableVersion =
          this.confirmedVersion ||
          (/^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(releaseName || '') ? releaseName : null);
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
      downloadPercent: this.downloadPercent,
      transferredBytes: this.transferredBytes,
      totalBytes: this.totalBytes,
      bytesPerSecond: this.bytesPerSecond,
      lastChecked: this.lastChecked,
      enabled: this.enabled,
      autoRetryAt: this.retryTime() ? new Date(this.retryTime()).toISOString() : null,
      canInstall: this.state === 'ready' && !this.installing && !this.isBusy(),
      busy: this.installing,
      message: '',
    };
  }
  changed() {
    if (!this.closed) this.onChange();
  }
  resetProgress() {
    this.downloadPercent = null;
    this.transferredBytes = 0;
    this.totalBytes = null;
    this.bytesPerSecond = 0;
  }
  retryTime() {
    return this.installHistory.autoRetryAt > this.clock() ? this.installHistory.autoRetryAt : null;
  }
  saveInstallHistory() {
    try {
      this.store.set(INSTALL_HISTORY, JSON.stringify(this.installHistory));
      return true;
    } catch {
      return false;
    }
  }
  failedInstallAttempt(at = this.clock()) {
    const now = this.clock();
    this.installHistory.pending = null;
    this.installHistory.failures = [...this.installHistory.failures, Math.min(at, now)]
      .filter((time) => time > now - DAY)
      .slice(-3);
    if (this.installHistory.failures.length >= 3 && !this.retryTime())
      this.installHistory.autoRetryAt = now + DAY;
    this.saveInstallHistory();
  }
  beginInstallAttempt() {
    if (
      !stableVersion(this.availableVersion) ||
      !stableVersion(this.version) ||
      !newerVersion(this.availableVersion, this.version)
    )
      return false;
    this.installHistory.pending = {
      targetVersion: this.availableVersion,
      fromVersion: this.version,
      attemptedAt: this.clock(),
    };
    if (!this.saveInstallHistory()) {
      this.installHistory.pending = null;
      throw new Error('Impossible de préparer le redémarrage.');
    }
    return true;
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
    delay = Math.max(delay, (this.retryTime() || 0) - this.clock());
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
    if (this.installing && this.installHistory.pending) this.failedInstallAttempt();
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
    if (!manual && this.retryTime()) {
      this.arm(MINUTE);
      return { ok: false };
    }
    if ((!manual && !this.enabled) || this.isBusy() || !this.isOnline()) {
      this.arm(MINUTE);
      if (manual)
        throw new Error('Terminez l’opération en cours et vérifiez votre connexion Internet.');
      return { ok: false };
    }
    this.unschedule(this.timer);
    this.resetProgress();
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
    let attempted = false;
    try {
      if (!(await this.beforeInstall()) || this.closed || this.isBusy())
        throw new Error(
          'Les notes doivent être enregistrées et la dictée terminée avant de redémarrer.',
        );
      attempted = this.beginInstallAttempt();
      this.adapter.quitAndInstall();
      return { ok: true };
    } catch {
      if (attempted && this.installHistory.pending) this.failedInstallAttempt();
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
    this.adapter.close?.();
  }
}
module.exports = { Updates, ACTIONS, FEED, RELEASES, installationMode };
