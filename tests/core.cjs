'use strict';
// Isolated functional checks. No user database, credential access, microphone or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('../src/main/store.cjs');
const {
  deepgramUrl,
  applyReplacements,
  wordCount,
  transcribe,
  rewrite,
} = require('../src/main/providers.cjs');
const { VoiceDetector, Waveform } = require('../src/main/vad.cjs');

const root = path.resolve(__dirname, '..');
const dataDirectory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'voxen-core-'));
const results = [];
const metrics = {};
async function check(name, action) {
  try {
    await action();
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
  }
}
function pcm16Wave(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  let format;
  let data;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert.ok(start + length <= bytes.length, 'Truncated WAV chunk');
    if (id === 'fmt ') format = bytes.subarray(start, start + length);
    if (id === 'data') data = bytes.subarray(start, start + length);
    offset = start + length + (length % 2);
  }
  assert.ok(format && data);
  assert.equal(format.readUInt16LE(0), 1, 'PCM required');
  assert.equal(format.readUInt16LE(2), 1, 'Mono required');
  assert.equal(format.readUInt32LE(4), 16000, '16 kHz required');
  assert.equal(format.readUInt16LE(14), 16, '16-bit PCM required');
  return data;
}

(async () => {
  await check('Deepgram exact options, French and no filler words', () => {
    const url = new URL(deepgramUrl('fr', []));
    assert.equal(url.origin + url.pathname, 'https://api.deepgram.com/v1/listen');
    const expected = {
      model: 'nova-3',
      language: 'fr',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      utterances: 'true',
      punctuate: 'true',
      smart_format: 'true',
      filler_words: 'false',
      mip_opt_out: 'true',
    };
    assert.deepEqual(Object.fromEntries(url.searchParams), expected);
  });
  await check('Dynamic keyterms, deduplication and URL escaping', () => {
    const terms = [' Claude Code ', 'Wispr Flow', 'Été & C++', 'Voxen', 'voxen', '', 'a=b?c#d'];
    const url = new URL(deepgramUrl('fr', terms));
    assert.deepEqual(url.searchParams.getAll('keyterm'), [
      'Claude Code',
      'Wispr Flow',
      'Été & C++',
      'Voxen',
      'a=b?c#d',
    ]);
    assert.equal(url.searchParams.get('c'), null);
    assert.equal(
      new URL(deepgramUrl('fr', ['Nouveau mot'])).searchParams.getAll('keyterm')[0],
      'Nouveau mot',
    );
  });
  await check('UTF-8 keyterms keep the conservative 400-byte budget', () => {
    const terms = ['é'.repeat(81), '漢'.repeat(61), 'z'.repeat(60), 'small'];
    const accepted = new URL(deepgramUrl('fr', terms)).searchParams.getAll('keyterm');
    const bytes = accepted.reduce((sum, term) => sum + Buffer.byteLength(term) + 1, 0);
    assert.ok(bytes <= 400);
    assert.ok(!accepted.includes('z'.repeat(60)));
    assert.ok(accepted.includes('small'), 'A later small term can still fit');
    assert.equal(
      new URL(deepgramUrl('fr', ['x'.repeat(399)])).searchParams.getAll('keyterm').length,
      1,
    );
    assert.equal(
      new URL(deepgramUrl('fr', ['x'.repeat(400)])).searchParams.getAll('keyterm').length,
      0,
    );
    metrics.keytermAcceptedUtf8Bytes = bytes;
  });
  await check('Dictionary replacements do not cascade and prefer longest terms', () => {
    const result = applyReplacements('alpha ski Claude Code Claude.', [
      { Heard: 'alpha', ReplaceWith: 'beta' },
      { Heard: 'beta', ReplaceWith: 'gamma' },
      { Heard: 'ski', ReplaceWith: 'skill' },
      { Heard: 'Claude', ReplaceWith: 'Claudine' },
      { Heard: 'Claude Code', ReplaceWith: 'outil' },
    ]);
    assert.deepEqual(result, { text: 'beta skill outil Claudine.', corrections: 4 });
  });
  await check('Replacement boundaries respect accents, punctuation and regex characters', () => {
    const result = applyReplacements('CAFÉ, caféine; «été»! C++ (a.b) $5 [ok] café.', [
      { Heard: 'café', ReplaceWith: 'pause' },
      { Heard: 'été', ReplaceWith: 'saison' },
      { Heard: 'C++', ReplaceWith: 'langage' },
      { Heard: 'a.b', ReplaceWith: 'point' },
      { Heard: '$5', ReplaceWith: 'cinq' },
      { Heard: '[ok]', ReplaceWith: 'validé' },
    ]);
    assert.deepEqual(result, {
      text: 'pause, caféine; «saison»! langage (point) cinq validé pause.',
      corrections: 7,
    });
    assert.deepEqual(applyReplacements('inchangé', []), { text: 'inchangé', corrections: 0 });
    assert.equal(wordCount("L'été, c’est très-bien : 42 !"), 4);
  });
  await check('SQLite preferences persist, clamp settings and reject invalid language', () => {
    const store = new Store(dataDirectory);
    try {
      assert.equal(store.settings().Language, 'fr');
      const settings = store.saveSettings({
        FirstName: 'Essai isolé',
        SilenceSeconds: 0.25,
        TypingSpeed: 1000,
        CleanupEnabled: false,
        UnknownField: 'excluded',
      });
      assert.equal(settings.SilenceSeconds, 2);
      assert.equal(settings.TypingSpeed, 250);
      assert.equal(settings.CleanupEnabled, false);
      assert.equal(Object.hasOwn(settings, 'UnknownField'), false);
      assert.throws(() => store.saveSettings({ Language: 'unsupported' }));
    } finally {
      store.close();
    }
    const reopened = new Store(dataDirectory);
    try {
      assert.equal(reopened.settings().FirstName, 'Essai isolé');
      assert.equal(reopened.settings().CleanupEnabled, false);
      assert.equal(reopened.settings().SilenceSeconds, 2);
    } finally {
      reopened.close();
    }
  });
  await check('SQLite vocabulary and replacements CRUD are idempotent', () => {
    const store = new Store(dataDirectory);
    try {
      const initial = store.terms().length;
      store.addTerm('Terme de test');
      store.addTerm('terme de test');
      assert.equal(store.terms().length, initial + 1);
      const row = store.terms().find((item) => item.Term === 'Terme de test');
      store.deleteTerm(row.Id);
      assert.equal(store.terms().length, initial);
      assert.throws(() => store.addTerm(' '));
      store.saveReplacement({ heard: 'test isolé', replaceWith: 'version une' });
      store.saveReplacement({ heard: 'test isolé', replaceWith: 'version deux' });
      const replacement = store.replacements().find((item) => item.Heard === 'test isolé');
      assert.equal(replacement.ReplaceWith, 'version deux');
      store.saveReplacement({
        id: replacement.Id,
        heard: 'test modifié',
        replaceWith: 'version trois',
      });
      assert.equal(
        store.replacements().find((item) => item.Id === replacement.Id).Heard,
        'test modifié',
      );
      store.deleteReplacement(replacement.Id);
      assert.equal(
        store.replacements().some((item) => item.Id === replacement.Id),
        false,
      );
    } finally {
      store.close();
    }
  });
  await check('SQLite isolated history round trip and deletion', () => {
    const store = new Store(dataDirectory);
    try {
      store.addDictation({
        CreatedAt: '2026-01-01T00:00:00Z',
        Application: 'Synthetic',
        RawText: 'euh texte',
        FinalText: 'Texte.',
        WordCount: 1,
        DurationSeconds: 2.5,
        Corrections: 1,
      });
      const history = store.history();
      assert.equal(history.length, 1);
      assert.equal(history[0].FinalText, 'Texte.');
      store.deleteDictation(history[0].Id);
      assert.equal(store.history().length, 0);
    } finally {
      store.close();
    }
  });
  await check('Provider functions use supplied PCM and reject incomplete rewrite', async () => {
    const originalFetch = global.fetch;
    let request;
    try {
      global.fetch = async (url, options) => {
        request = { url, options };
        return {
          ok: true,
          json: async () => ({
            results: { channels: [{ alternatives: [{ transcript: ' Texte de test. ' }] }] },
          }),
        };
      };
      const pcm = Buffer.alloc(1024);
      assert.equal(
        await transcribe(pcm, { Language: 'fr' }, ['Terme dynamique'], 'synthetic-placeholder'),
        'Texte de test.',
      );
      assert.equal(request.options.body, pcm);
      assert.equal(request.options.headers['Content-Type'], 'application/octet-stream');
      assert.deepEqual(new URL(request.url).searchParams.getAll('keyterm'), ['Terme dynamique']);
      global.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.provider.data_collection, 'deny');
        assert.equal(body.messages[1].content, 'Texte original');
        return {
          ok: true,
          json: async () => ({
            choices: [{ finish_reason: 'length', message: { content: 'Partiel' } }],
          }),
        };
      };
      await assert.rejects(
        rewrite(
          'Texte original',
          { Language: 'fr', CleanupMode: 1, RewriteModel: 'synthetic/model' },
          'synthetic-placeholder',
        ),
        /incomplète/u,
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
  await check('Waveform follows real PCM energy, silence and reset', () => {
    const waveform = new Waveform();
    assert.deepEqual(waveform.push(Buffer.alloc(1024)), Array(12).fill(0));
    const quiet = Buffer.alloc(1024),
      loud = Buffer.alloc(1024);
    for (let i = 0; i < 512; i++) {
      quiet.writeInt16LE(i % 2 ? 100 : -100, i * 2);
      loud.writeInt16LE(i % 2 ? 12000 : -12000, i * 2);
    }
    const low = waveform.push(quiet).at(-1);
    const high = waveform.push(loud).at(-1);
    assert.ok(low > 0 && high > low);
    for (let i = 0; i < 30; i++) waveform.push(Buffer.alloc(1024));
    assert.ok(waveform.values.at(-1) < 0.001);
    waveform.clear();
    assert.deepEqual(waveform.values, Array(12).fill(0));
    metrics.waveformQuiet = Number(low.toFixed(4));
    metrics.waveformLoud = Number(high.toFixed(4));
  });
  await check('Silero stops at 2.016 seconds of initial silence', async () => {
    const detector = await VoiceDetector.create(
      path.join(__dirname, '../assets/silero/silero_vad.onnx'),
    );
    try {
      let stop = false;
      let frames = 0;
      while (!stop && frames < 80) {
        stop = await detector.feed(Buffer.alloc(1024));
        frames++;
      }
      assert.equal(stop, true);
      assert.equal(frames, 63);
      assert.equal(detector.hasSpeech, false);
      metrics.initialSilenceSeconds = (frames * 512) / 16000;
    } finally {
      await detector.close();
    }
  });
  await check(
    'Silero detects public speech fixture and stops after final two-second silence',
    async () => {
      const fixture = pcm16Wave(path.join(__dirname, 'fixtures/speech-6s.wav'));
      // The bundled public fixture is the six-second passage described in fixtures/README.md.
      const pcm = fixture;
      const detector = await VoiceDetector.create(
        path.join(__dirname, '../assets/silero/silero_vad.onnx'),
      );
      try {
        detector.reset(2);
        let speechFrames = 0;
        let maxProbability = 0;
        let prematureStop = false;
        const realWaveform = new Waveform();
        let realWaveformMin = 1;
        let realWaveformMax = 0;
        for (let offset = 0; offset + 1024 <= pcm.length; offset += 1024) {
          const block = pcm.subarray(offset, offset + 1024);
          const stop = await detector.feed(block);
          const level = realWaveform.push(block).at(-1);
          realWaveformMin = Math.min(realWaveformMin, level);
          realWaveformMax = Math.max(realWaveformMax, level);
          maxProbability = Math.max(maxProbability, detector.probability);
          if (detector.probability >= 0.5) speechFrames++;
          if (stop) {
            prematureStop = true;
            break;
          }
        }
        assert.ok(detector.hasSpeech, 'Real speech must be detected');
        assert.ok(speechFrames > 10);
        assert.ok(maxProbability >= 0.9);
        assert.equal(prematureStop, false, 'Continuous speech must not be stopped');
        assert.ok(realWaveformMax > 0.5 && realWaveformMax - realWaveformMin > 0.3);
        let stopped = prematureStop;
        let tailFrames = 0;
        while (!stopped && tailFrames < 90) {
          stopped = await detector.feed(Buffer.alloc(1024));
          tailFrames++;
        }
        assert.equal(stopped, true);
        const silenceAfterLastVoice = detector.samples / 16000 - detector.lastVoice;
        assert.ok(silenceAfterLastVoice >= 2 && silenceAfterLastVoice < 2.033);
        metrics.speechFixtureSeconds = pcm.length / 32000;
        metrics.sourceFixtureSeconds = fixture.length / 32000;
        metrics.fixtureExcerptStartSeconds = 0;
        metrics.speechFrames = speechFrames;
        metrics.maxSpeechProbability = Number(maxProbability.toFixed(5));
        metrics.finalSilenceSeconds = Number(silenceAfterLastVoice.toFixed(3));
        metrics.fixtureContainsStopBeforeEnd = prematureStop;
        metrics.realSpeechWaveformMin = Number(realWaveformMin.toFixed(4));
        metrics.realSpeechWaveformMax = Number(realWaveformMax.toFixed(4));
        detector.reset(2);
        assert.equal(detector.hasSpeech, false);
        assert.equal(detector.samples, 0);
        assert.equal(
          detector.state.every((value) => value === 0),
          true,
        );
        for (let offset = 0; offset < 50 * 1024; offset += 1024)
          await detector.feed(pcm.subarray(offset, offset + 1024));
        assert.equal(detector.hasSpeech, true, 'A reset session must detect real speech again');
        metrics.voiceRecoveredAfterReset = true;
      } finally {
        await detector.close();
      }
    },
  );
  const report = {
    passed: results.every((item) => item.passed),
    passedCount: results.filter((item) => item.passed).length,
    total: results.length,
    metrics,
    cases: results,
    isolation: {
      database: path.relative(root, dataDirectory),
      userDatabaseOpened: false,
      networkRequests: 0,
      microphoneOpened: false,
      credentialValuesRead: false,
    },
  };
  fs.writeFileSync(path.join(dataDirectory, 'test-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
})().catch((error) => {
  console.error('Core tests failed: ' + error.message);
  process.exitCode = 1;
});
