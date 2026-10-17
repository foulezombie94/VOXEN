const { EventEmitter } = require('node:events');
const { VoiceDetector, Waveform } = require('./vad.cjs');
const providers = require('./providers.cjs');
const writing = require('./writing.cjs');
const native = require('./windows.cjs');
const { displayAccelerator } = require('./hotkey-policy.cjs');
class Engine extends EventEmitter {
  constructor(store, model, { diagnostic = false } = {}) {
    super();
    this.store = store;
    this.settings = store.settings();
    this.state = 'ready';
    this.message = 'Voxen est prêt';
    this.paused = false;
    this.waveform = new Waveform();
    this.sessionId = 0;
    this.chunks = [];
    this.lastFinalText = '';
    this.vadReady = VoiceDetector.create(model)
      .then((value) => (this.vad = value))
      .catch(() => {
        this.modelFailed = true;
      });
    this.diagnostic = diagnostic;
    this.refreshKeys();
  }
  refreshKeys() {
    this.deepgramConfigured = native.credentialExists('deepgram');
    this.openrouterConfigured = native.credentialExists('openrouter');
  }
  get canDictate() {
    return this.deepgramConfigured;
  }
  get shortcut() {
    return displayAccelerator(this.settings.HotkeyAccelerator);
  }
  status() {
    return {
      state: this.state,
      message: this.message,
      shortcut: this.shortcut,
      paused: this.paused,
      canDictate: this.canDictate,
      deepgramConfigured: this.deepgramConfigured,
      openrouterConfigured: this.openrouterConfigured,
      levels: this.waveform.values.slice(),
      lastFinalText: this.lastFinalText,
    };
  }
  set(state, message, { popup = true } = {}) {
    this.state = state;
    this.message = message;
    this.emit('change');
    if (popup) this.emit('overlay');
  }
  busy() {
    return this.state === 'recording' || this.state === 'processing';
  }
  async toggle({ local = false } = {}) {
    if (this.state === 'recording') return this.finish();
    if (this.busy() || this.paused || this.testMode) return;
    if (this.diagnostic) throw new Error('Capture désactivée pendant la validation locale.');
    if (!this.canDictate) {
      this.set('error', 'Configurez vos clés dans Paramètres.');
      return;
    }
    const id = ++this.sessionId;
    this.target = local ? { local: true, processName: 'Voxen' } : native.foregroundTarget();
    this.chunks = [];
    this.audioBytes = 0;
    this.waveform.clear();
    this.vadQueue = Promise.resolve();
    this.set('recording', 'À l’écoute');
    await this.vadReady;
    if (this.state !== 'recording' || id !== this.sessionId) return;
    if (!this.vad) {
      this.set('error', 'Le détecteur vocal local est indisponible.');
      return;
    }
    this.vad.reset(this.settings.SilenceSeconds);
    this.emit('capture', {
      command: 'start',
      sessionId: id,
      deviceId: this.settings.MicrophoneDeviceId || '',
    });
    this.startTimeout = setTimeout(() => {
      if (this.state === 'recording' && !this.audioBytes)
        this.captureError(
          id,
          'Le microphone ne fournit aucun son. Vérifiez son accès dans Windows.',
        );
    }, 8000);
  }
  audioStarted(id) {
    if (id !== this.sessionId) return;
    this.captureStarted = true;
  }
  audioFrame(id, data) {
    if (id !== this.sessionId || (!this.testMode && this.state !== 'recording')) return;
    const pcm = Buffer.from(data);
    if (pcm.length !== 1024) return;
    if (!this.testMode && !this.audioBytes) clearTimeout(this.startTimeout);
    if (this.testMode) {
      this.testBytes += pcm.length;
      for (let offset = 0; offset < pcm.length; offset += 2) {
        const sample = pcm.readInt16LE(offset) / 32768;
        this.testEnergy += sample * sample;
        this.testPeak = Math.max(this.testPeak, Math.abs(sample));
      }
      this.emit('microphone-level', this.microphoneResult());
      pcm.fill(0);
      return;
    }
    this.chunks.push(pcm);
    this.audioBytes += pcm.length;
    if (this.audioBytes > 256 * 1024 * 1024) {
      this.captureError(id, 'La capacité audio en mémoire est atteinte. Relancez une dictée.');
      return;
    }
    const levels = this.waveform.push(pcm);
    this.emit('levels', levels);
    this.vadQueue = this.vadQueue
      .then(async () => {
        if (this.state !== 'recording' || id !== this.sessionId) return;
        const shouldStop = await this.vad.feed(pcm);
        if (shouldStop && this.state === 'recording') void this.finish();
      })
      .catch(() => this.captureError(id, 'Le détecteur vocal local a rencontré une erreur.'));
  }
  captureError(id, message) {
    if (id !== this.sessionId) return;
    this.emit('capture', { command: 'cancel', sessionId: id });
    clearTimeout(this.startTimeout);
    this.erase();
    if (this.testMode) {
      this.testResolve?.(message);
      this.testMode = false;
      this.testResolve = null;
      return;
    }
    this.set('error', message);
  }
  erase() {
    for (const chunk of this.chunks) chunk.fill(0);
    this.chunks = [];
    this.audioBytes = 0;
    this.waveform.clear();
  }
  async finish() {
    if (this.state !== 'recording') return;
    const id = this.sessionId;
    clearTimeout(this.startTimeout);
    this.set('processing', 'Transcription en cours');
    this.emit('capture', { command: 'stop', sessionId: id });
    await this.vadQueue;
    if (this.cancelled) {
      this.cancelled = false;
      this.erase();
      this.set('ready', 'Dictée annulée.');
      return;
    }
    const hasSpeech = this.vad?.hasSpeech;
    const pcm = Buffer.concat(this.chunks);
    const duration = pcm.length / 32000;
    this.erase();
    if (!hasSpeech || duration < 0.15) {
      pcm.fill(0);
      this.set('ready', 'Aucune parole détectée.');
      return;
    }
    this.abort = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(120000)]);
    try {
      let raw = await native.withCredential('deepgram', (key) =>
        providers.transcribe(
          pcm,
          this.settings,
          this.store.terms().map((t) => t.Term),
          key,
          signal,
        ),
      );
      if (!raw) {
        this.set('ready', 'Aucune parole reconnue.');
        return;
      }
      const corrected = writing.prepareSnippets(raw, this.store.replacements());
      const rewriteSettings = writing.applicationSettings(
        this.settings,
        this.store.styleProfiles?.() || [],
        this.target?.processName,
      );
      let final = corrected.text;
      let warning = '';
      if (this.settings.CleanupEnabled) {
        this.set('processing', 'Reformulation en cours');
        try {
          final = await native.withCredential('openrouter', (key) =>
            providers
              .rewrite(corrected.protectedText, rewriteSettings, key, signal)
              .then(corrected.restore),
          );
        } catch (e) {
          if (signal.aborted) throw e;
          warning = 'Reformulation indisponible : transcription conservée. ';
        }
      }
      signal.throwIfAborted();
      this.lastFinalText = final;
      if (this.settings.HistoryEnabled)
        this.store.addDictation({
          CreatedAt: new Date().toISOString(),
          Application: this.target?.processName || 'Application',
          RawText: raw,
          FinalText: final,
          WordCount: providers.wordCount(final),
          DurationSeconds: duration,
          Corrections: corrected.corrections,
        });
      this.emit('data');
      this.set('processing', 'Insertion du texte');
      let result;
      if (this.target?.local) {
        this.emit('local-text', { text: final, sessionId: id });
        result = { inserted: true, message: 'Votre texte est prêt dans Voxen.' };
      } else {
        this.emit('before-insert');
        try {
          result = await native.insertText(final, this.target, this.settings.RestoreClipboard);
        } finally {
          this.emit('after-insert');
        }
      }
      if (id !== this.sessionId) return;
      this.set(result.inserted ? 'ready' : 'error', warning + result.message);
    } catch (error) {
      if (this.cancelled) {
        this.set('ready', 'Dictée annulée.');
      } else
        this.set(
          'error',
          signal.aborted
            ? 'Délai dépassé. Votre texte peut rester disponible dans l’historique.'
            : safe(error),
        );
    } finally {
      pcm.fill(0);
      this.abort = null;
      this.cancelled = false;
    }
  }
  async cancel() {
    if (this.state === 'processing') {
      this.cancelled = true;
      this.abort?.abort();
      return;
    }
    if (this.state === 'recording') {
      const id = this.sessionId;
      this.sessionId++;
      this.emit('capture', { command: 'cancel', sessionId: id });
      clearTimeout(this.startTimeout);
      await this.vadQueue;
      this.erase();
    }
    this.set('ready', 'Dictée annulée.');
  }
  async togglePause() {
    if (this.busy()) throw new Error('Attendez la fin de la dictée.');
    this.paused = !this.paused;
    this.set('ready', this.paused ? 'Dictée en pause' : 'Voxen est prêt', { popup: false });
  }
  microphoneResult() {
    const samples = this.testBytes / 2;
    const level = samples ? Math.sqrt(this.testEnergy / samples) : 0;
    return {
      received: samples > 0,
      detected: level >= 0.001 && this.testPeak >= 0.005,
      level,
      peak: this.testPeak || 0,
      durationSeconds: samples / 16000,
    };
  }
  async testMicrophone() {
    if (this.busy() || this.testMode) throw new Error('Une capture est déjà en cours.');
    if (this.diagnostic) throw new Error('Test micro désactivé pendant la validation.');
    this.testMode = true;
    this.testBytes = 0;
    this.testEnergy = 0;
    this.testPeak = 0;
    const id = ++this.sessionId;
    return new Promise((resolve) => {
      let finished = false;
      const finish = (message) => {
        if (finished) return;
        finished = true;
        clearTimeout(this.testTimeout);
        this.emit('capture', { command: 'stop', sessionId: id });
        const result = this.microphoneResult();
        this.testMode = false;
        this.testResolve = null;
        resolve({
          ...result,
          message:
            message ||
            (result.detected
              ? 'Son détecté · PCM16 mono 16 kHz. Aucun envoi.'
              : result.received
                ? 'Microphone connecté, mais aucun son détecté. Parlez ou vérifiez le niveau Windows.'
                : 'Aucun échantillon reçu du microphone.'),
        });
      };
      this.testResolve = finish;
      this.testTimeout = setTimeout(() => finish(), 1500);
      this.emit('capture', {
        command: 'start',
        sessionId: id,
        deviceId: this.settings.MicrophoneDeviceId || '',
      });
    });
  }
  async close() {
    this.abort?.abort();
    clearTimeout(this.startTimeout);
    this.testResolve?.('Test micro interrompu.');
    await this.vadQueue;
    this.erase();
    await this.vadReady;
    await this.vad?.close();
  }
}
function safe(error) {
  const message = String(error?.message || '');
  return /^(Deepgram|OpenRouter|Clé manquante|Renseignez|Windows|La fenêtre|Le presse-papiers|Impossible de|Connexion|Reformulation)/.test(
    message,
  )
    ? message
    : 'L’opération a échoué. Vérifiez le microphone, les clés et la connexion dans Paramètres.';
}
module.exports = { Engine, safe };
