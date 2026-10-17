'use strict';
// Synthetic PCM and service stubs only: no microphone, vault, user DB or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { captureConstraints } = require('../src/renderer/audio-config.cjs');
const results = [];
async function check(name, action) {
  try {
    await action();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
  }
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function harness() {
  const timers = new Set(),
    calls = { foreground: 0, insert: 0, transcribe: 0 },
    saved = [];
  const native = {
    credentialExists: (provider) => provider === 'deepgram',
    foregroundTarget: () => {
      calls.foreground++;
      return { processName: 'Synthetic editor' };
    },
    withCredential: async (_, callback) => callback('synthetic-placeholder'),
    insertText: async () => {
      calls.insert++;
      return { inserted: true, message: 'Inséré.' };
    },
  };
  const providers = {
    transcribe: async () => {
      calls.transcribe++;
      return 'Texte brut';
    },
    applyReplacements: (text) => ({ text, corrections: 0 }),
    rewrite: async () => {
      throw new Error('Clé manquante');
    },
    wordCount: (text) => text.split(' ').length,
  };
  const vad = {
    reset() {
      this.hasSpeech = false;
    },
    hasSpeech: false,
    feed: async function () {
      this.hasSpeech = true;
      return false;
    },
    close: async () => {},
  };
  class Waveform {
    constructor() {
      this.clear();
    }
    clear() {
      this.values = Array(12).fill(0);
    }
    push() {
      return this.values;
    }
  }
  const sandbox = {
    module: { exports: {} },
    require: (name) =>
      name === 'node:events'
        ? { EventEmitter }
        : name === './vad.cjs'
          ? { VoiceDetector: { create: async () => vad }, Waveform }
          : name === './providers.cjs'
            ? providers
            : name === './writing.cjs'
              ? require('../src/main/writing.cjs')
              : name === './windows.cjs'
                ? native
                : assert.fail(name),
    Buffer,
    AbortController,
    AbortSignal,
    setTimeout: (callback, delay) => {
      const timer = { callback, delay };
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer) => timers.delete(timer),
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../src/main/engine.cjs'), 'utf8'),
    sandbox,
  );
  const store = {
    settings: () => ({
      SilenceSeconds: 2,
      MicrophoneDeviceId: 'selected-mic',
      CleanupEnabled: false,
      HistoryEnabled: true,
    }),
    terms: () => [],
    replacements: () => [],
    addDictation: (entry) => saved.push(entry),
  };
  const engine = new sandbox.module.exports.Engine(store, 'synthetic-model');
  return {
    engine,
    calls,
    saved,
    timers,
    timeout: () => {
      const timer = [...timers].find((item) => item.delay === 1500);
      assert.ok(timer);
      timer.callback();
    },
  };
}
function captureHarness() {
  const requests = [],
    events = [],
    contexts = [];
  let callback;
  class AudioContext {
    constructor() {
      this.closed = false;
      this.audioWorklet = { addModule: async () => {} };
      this.destination = {};
      contexts.push(this);
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    createGain() {
      return { gain: { value: 1 }, connect() {} };
    }
    async resume() {}
    async close() {
      this.closed = true;
    }
  }
  class AudioWorkletNode {
    constructor() {
      this.port = { onmessage: null };
    }
    connect() {}
    disconnect() {}
  }
  const sandbox = {
    captureConstraints,
    AudioContext,
    AudioWorkletNode,
    navigator: {
      mediaDevices: {
        getUserMedia: (constraints) => {
          const pending = deferred();
          requests.push({ constraints, ...pending });
          return pending.promise;
        },
      },
    },
    window: {
      voxen: {
        onAudioCommand: (fn) => (callback = fn),
        audioFrame: (...args) => events.push(['frame', ...args]),
        audioStarted: (id) => events.push(['started', id]),
        audioError: (id) => events.push(['error', id]),
      },
    },
  };
  const source = fs
    .readFileSync(path.join(__dirname, '../src/renderer/capture.js'), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/u, '');
  vm.runInNewContext(source, sandbox);
  return { send: (command) => callback(command), requests, events, contexts };
}
function stream() {
  const track = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  return { track, getTracks: () => [track] };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
(async () => {
  await check(
    'Default microphone omits device constraint; selected microphone is exact and mono',
    () => {
      assert.equal(Object.hasOwn(captureConstraints().audio, 'deviceId'), false);
      assert.equal(Object.hasOwn(captureConstraints('  ').audio, 'deviceId'), false);
      const c = captureConstraints(' chosen-device ');
      assert.deepEqual(c.audio.deviceId, { exact: 'chosen-device' });
      assert.equal(c.audio.channelCount, 1);
      assert.equal(c.audio.sampleRate, 16000);
      assert.equal(c.video, false);
    },
  );
  await check(
    'Microphone check distinguishes received silent PCM from audible energy',
    async () => {
      const h = harness();
      const starts = [];
      h.engine.on('capture', (value) => starts.push(value));
      let p = h.engine.testMicrophone();
      for (let i = 0; i < 10; i++) h.engine.audioFrame(h.engine.sessionId, Buffer.alloc(1024));
      h.timeout();
      const silent = await p;
      assert.equal(silent.received, true);
      assert.equal(silent.detected, false);
      assert.equal(silent.level, 0);
      assert.match(silent.message, /aucun son détecté/u);
      assert.equal(starts[0].deviceId, 'selected-mic');
      p = h.engine.testMicrophone();
      const pcm = Buffer.alloc(1024);
      for (let i = 0; i < 512; i++) pcm.writeInt16LE(i % 2 ? 8192 : -8192, i * 2);
      h.engine.audioFrame(h.engine.sessionId, pcm);
      h.timeout();
      const audible = await p;
      assert.equal(audible.detected, true);
      assert.equal(audible.level, 0.25);
      assert.equal(audible.peak, 0.25);
      assert.equal(audible.durationSeconds, 0.032);
      assert.equal(pcm.readInt16LE(0), -8192);
      assert.equal(h.calls.transcribe, 0);
      await h.engine.close();
    },
  );
  await check(
    'Microphone check reports zero data and capture errors without stale timers',
    async () => {
      const h = harness();
      let p = h.engine.testMicrophone();
      h.timeout();
      assert.equal((await p).received, false);
      p = h.engine.testMicrophone();
      h.engine.captureError(h.engine.sessionId, 'Autorisation refusée.');
      const result = await p;
      assert.equal(result.message, 'Autorisation refusée.');
      assert.equal(result.detected, false);
      assert.equal(h.timers.size, 0);
      assert.equal(h.engine.testMode, false);
      await h.engine.close();
    },
  );
  await check(
    'Local dictation emits final text once, persists Voxen target, avoids native paste',
    async () => {
      const h = harness();
      const delivered = [],
        captures = [];
      h.engine.on('local-text', (value) => delivered.push(value));
      h.engine.on('capture', (value) => captures.push(value));
      await h.engine.toggle({ local: true });
      assert.equal(captures[0].deviceId, 'selected-mic');
      h.engine.audioStarted(h.engine.sessionId);
      h.engine.audioFrame(h.engine.sessionId, Buffer.alloc(1024, 20));
      for (let i = 0; i < 6; i++) h.engine.audioFrame(h.engine.sessionId, Buffer.alloc(1024, 20));
      await h.engine.vadQueue;
      await h.engine.finish();
      assert.equal(h.engine.state, 'ready');
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0].text, 'Texte brut');
      assert.equal(h.calls.foreground, 0);
      assert.equal(h.calls.insert, 0);
      assert.equal(h.saved[0].Application, 'Voxen');
      await h.engine.close();
    },
  );
  await check(
    'External target preserves Win32 insertion and missing rewriter falls back',
    async () => {
      const h = harness();
      h.engine.settings.CleanupEnabled = true;
      assert.equal(h.engine.canDictate, true);
      await h.engine.toggle();
      h.engine.audioStarted(h.engine.sessionId);
      for (let i = 0; i < 7; i++) h.engine.audioFrame(h.engine.sessionId, Buffer.alloc(1024, 20));
      await h.engine.vadQueue;
      await h.engine.finish();
      assert.equal(h.calls.foreground, 1);
      assert.equal(h.calls.insert, 1);
      assert.equal(h.engine.state, 'ready');
      assert.match(h.engine.message, /transcription conservée/u);
      await h.engine.close();
    },
  );
  await check('AudioContext start without PCM still triggers the no-audio watchdog', async () => {
    const h = harness();
    await h.engine.toggle();
    h.engine.audioStarted(h.engine.sessionId);
    h.engine.audioFrame(h.engine.sessionId, Buffer.alloc(20));
    const timeout = [...h.timers].find((item) => item.delay === 8000);
    assert.ok(timeout);
    timeout.callback();
    assert.equal(h.engine.state, 'error');
    assert.match(h.engine.message, /aucun son/u);
    assert.equal(h.calls.transcribe, 0);
    await h.engine.close();
  });
  await check(
    'Stopping while permission is pending closes late stream without starting audio',
    async () => {
      const h = captureHarness();
      const pending = h.send({ command: 'start', sessionId: 1, deviceId: 'chosen' });
      await flush();
      assert.equal(h.requests[0].constraints.audio.deviceId.exact, 'chosen');
      await h.send({ command: 'stop', sessionId: 1 });
      const audio = stream();
      h.requests[0].resolve(audio);
      await pending;
      assert.equal(audio.track.stopped, true);
      assert.equal(h.events.length, 0);
      assert.equal(h.contexts.length, 0);
    },
  );
  await check('Late old microphone rejection cannot stop a newer successful session', async () => {
    const h = captureHarness();
    const old = h.send({ command: 'start', sessionId: 1 });
    await flush();
    const current = h.send({ command: 'start', sessionId: 2 });
    await flush();
    const audio = stream();
    h.requests[1].resolve(audio);
    await current;
    h.requests[0].reject(new Error('Old request'));
    await old;
    assert.equal(audio.track.stopped, false);
    assert.equal(h.events.length, 1);
    assert.equal(h.events[0][0], 'started');
    assert.equal(h.events[0][1], 2);
    await h.send({ command: 'cancel', sessionId: 1 });
    assert.equal(audio.track.stopped, false);
    await h.send({ command: 'stop', sessionId: 2 });
    assert.equal(audio.track.stopped, true);
    assert.equal(h.contexts[0].closed, true);
  });
  const report = {
    passed: results.every((result) => result.passed),
    cases: results,
    isolation: {
      microphoneOpened: false,
      credentialValuesRead: false,
      userDatabaseOpened: false,
      networkRequests: 0,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
