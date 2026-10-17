'use strict';
const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const { createHash, randomBytes } = require('node:crypto');
const FEED = 'https://github.com/foulezombie94/VOXEN/releases/latest/download';
const SAFE_ERROR = 'Téléchargement de la mise à jour interrompu.';

function newerVersion(candidate, current) {
  const parse = (value) =>
    /^v?(\d+)\.(\d+)\.(\d+)$/
      .exec(value || '')
      ?.slice(1)
      .map(Number);
  const a = parse(candidate),
    b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function parseManifest(text) {
  if (Buffer.byteLength(text) > 262144) throw new Error(SAFE_ERROR);
  const lines = text.trim().split(/\r?\n/);
  if (lines.length !== 1) throw new Error(SAFE_ERROR);
  const match =
    /^([a-f0-9]{40}) (voxen[-_]desktop-(\d+\.\d+\.\d+)-full\.nupkg) ([1-9][0-9]*)$/i.exec(lines[0]);
  const size = Number(match?.[4]);
  if (!match || !Number.isSafeInteger(size) || size > 4 * 1024 ** 3) throw new Error(SAFE_ERROR);
  return {
    hash: match[1].toLowerCase(),
    filename: match[2],
    version: match[3],
    size,
    text: lines[0] + '\n',
  };
}

async function officialFetch(url, signal, fetchImpl) {
  for (let redirects = 0; redirects <= 6; redirects++) {
    const target = new URL(url);
    const allowed =
      target.hostname === 'github.com'
        ? target.pathname.startsWith('/foulezombie94/VOXEN/releases/')
        : ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(
            target.hostname,
          );
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      !allowed ||
      (target.port && target.port !== '443')
    )
      throw new Error(SAFE_ERROR);
    const response = await fetchImpl(target.href, {
      redirect: 'manual',
      signal,
      headers: { 'Accept-Encoding': 'identity' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error(SAFE_ERROR);
      url = new URL(location, target).href;
      continue;
    }
    if (!response.ok || response.status !== 200 || !response.body) throw new Error(SAFE_ERROR);
    return response;
  }
  throw new Error(SAFE_ERROR);
}

// Squirrel owns installation and package validation. This loopback transport only
// counts the bytes it really downloads; no second remote download or fake timer.
class DownloadAdapter extends EventEmitter {
  constructor({ native, version, fetchImpl = globalThis.fetch, now = Date.now }) {
    super();
    Object.assign(this, { native, version, fetchImpl, now });
    this.closed = false;
    this.listeners = [];
    for (const event of [
      'checking-for-update',
      'update-available',
      'update-not-available',
      'update-downloaded',
      'error',
    ]) {
      const handler = (...args) => {
        if (this.closed) return;
        if (['error', 'update-downloaded', 'update-not-available'].includes(event))
          this.stopTransfer();
        this.emit(event, ...args);
      };
      native.on(event, handler);
      this.listeners.push([event, handler]);
    }
  }
  setFeedURL({ url }) {
    if (url !== FEED) throw new Error(SAFE_ERROR);
  }
  async checkForUpdates() {
    if (this.closed || this.running) return;
    this.running = true;
    this.controller = new AbortController();
    try {
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(20_000)]);
      const response = await officialFetch(FEED + '/RELEASES', signal, this.fetchImpl);
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 262144) throw new Error(SAFE_ERROR);
        chunks.push(Buffer.from(chunk));
      }
      if (this.closed || this.controller.signal.aborted) return;
      this.release = parseManifest(Buffer.concat(chunks).toString('utf8'));
      if (!newerVersion(this.release.version, this.version)) {
        this.running = false;
        this.emit('update-not-available');
        return;
      }
      this.emit('release-info', { version: this.release.version, totalBytes: this.release.size });
      this.emit('update-available');
      await this.startServer();
      if (this.closed) return;
      this.native.setFeedURL({ url: this.localFeed });
      this.native.checkForUpdates();
    } catch {
      if (!this.closed) {
        this.stopTransfer();
        this.emit('error', new Error(SAFE_ERROR));
      }
    }
  }
  async startServer() {
    await this.closeServer();
    if (this.closed) return;
    this.token = randomBytes(24).toString('hex');
    this.server = http.createServer((req, res) => {
      void this.serve(req, res);
    });
    this.server.requestTimeout = 10 * 60_000;
    this.server.headersTimeout = 10_000;
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    this.server.unref();
    this.localFeed = `http://127.0.0.1:${this.server.address().port}/${this.token}`;
  }
  async serve(req, res) {
    const manifest = `/${this.token}/RELEASES`;
    const file = `/${this.token}/${this.release.filename}`;
    const rawPath = req.url.split('?')[0];
    const validQuery =
      !req.url.includes('?') ||
      (rawPath === manifest &&
        [...new URL(req.url, 'http://127.0.0.1').searchParams.keys()].every((key) =>
          ['id', 'localVersion', 'arch'].includes(key),
        ));
    if (req.method !== 'GET' || !validQuery || ![manifest, file].includes(rawPath) || this.closed) {
      res.writeHead(404).end();
      return;
    }
    if (rawPath === manifest) {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(this.release.text),
        'Cache-Control': 'no-store',
      });
      res.end(this.release.text);
      return;
    }
    if (this.transferring) {
      res.writeHead(409).end();
      return;
    }
    this.transferring = true;
    const transfer = new AbortController();
    const cancel = () => {
      if (!res.writableFinished) transfer.abort();
    };
    res.on('close', cancel);
    try {
      const signal = AbortSignal.any([
        this.controller.signal,
        transfer.signal,
        AbortSignal.timeout(10 * 60_000),
      ]);
      const response = await officialFetch(
        `https://github.com/foulezombie94/VOXEN/releases/download/v${this.release.version}/${this.release.filename}`,
        signal,
        this.fetchImpl,
      );
      const advertised = response.headers.get('content-length');
      if (advertised && Number(advertised) !== this.release.size) throw new Error(SAFE_ERROR);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': this.release.size,
        'Cache-Control': 'no-store',
      });
      const hash = createHash('sha1');
      const started = this.now();
      let transferred = 0,
        lastNotification = -Infinity;
      this.emit('download-progress', {
        transferredBytes: 0,
        totalBytes: this.release.size,
        bytesPerSecond: 0,
        downloadPercent: 0,
      });
      for await (const chunk of response.body) {
        transferred += chunk.length;
        if (transferred > this.release.size || signal.aborted) throw new Error(SAFE_ERROR);
        hash.update(chunk);
        if (!res.write(chunk)) await once(res, 'drain', { signal });
        const now = this.now();
        if (now - lastNotification >= 100 && transferred < this.release.size) {
          lastNotification = now;
          this.emit('download-progress', {
            transferredBytes: transferred,
            totalBytes: this.release.size,
            bytesPerSecond: Math.round((transferred * 1000) / Math.max(1, now - started)),
            downloadPercent: (transferred / this.release.size) * 100,
          });
        }
      }
      if (
        signal.aborted ||
        transferred !== this.release.size ||
        hash.digest('hex') !== this.release.hash
      )
        throw new Error(SAFE_ERROR);
      res.end();
      if (!this.closed)
        this.emit('download-progress', {
          transferredBytes: transferred,
          totalBytes: this.release.size,
          bytesPerSecond: Math.round((transferred * 1000) / Math.max(1, this.now() - started)),
          downloadPercent: 100,
        });
    } catch {
      res.destroy();
      transfer.abort();
      if (!this.closed) {
        this.stopTransfer();
        this.emit('error', new Error(SAFE_ERROR));
      }
    } finally {
      this.transferring = false;
      res.removeListener('close', cancel);
    }
  }
  quitAndInstall() {
    this.native.quitAndInstall();
  }
  stopTransfer() {
    this.controller?.abort();
    this.running = false;
    void this.closeServer();
  }
  async closeServer() {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  close() {
    this.closed = true;
    this.stopTransfer();
    for (const [event, handler] of this.listeners) this.native.removeListener(event, handler);
    this.listeners = [];
  }
}
module.exports = { DownloadAdapter, newerVersion, parseManifest, officialFetch };
