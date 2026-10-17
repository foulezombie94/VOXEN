'use strict';
const assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs');
const { Store } = require('../src/main/store.cjs'),
  writing = require('../src/main/writing.cjs');
const { metrics } = require('../src/renderer/metrics.cjs');
const folder = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'voxen-writing-'));
fs.mkdirSync(folder, { recursive: true });
const cases = [];
async function check(name, fn) {
  try {
    await fn();
    cases.push({ name, passed: true });
  } catch (error) {
    cases.push({ name, passed: false, error: error.message });
  }
}
(async () => {
  await check(
    'Spoken snippets retain exact whitespace, newlines, punctuation and dollar sequences through rewriting',
    () => {
      const expansion = '  Bonjour\nÉquipe $& <test>  ';
      const p = writing.prepareSnippets('Merci, ma signature.', [
        { Heard: 'ma signature', ReplaceWith: expansion },
      ]);
      assert.equal(p.corrections, 1);
      assert.equal(p.text, 'Merci, ' + expansion + '.');
      assert.equal(
        p.restore(p.protectedText.replace('Merci', 'Bien reçu')),
        'Bien reçu, ' + expansion + '.',
      );
      assert.throws(() => p.restore('Réponse sans marqueur'));
      assert.throws(() => p.restore(p.protectedText + p.protectedText));
    },
  );
  await check(
    'A trigger spoken alone ignores surrounding punctuation and returns only its expansion',
    () => {
      const p = writing.prepareSnippets('« MA SIGNATURE ! »', [
        { Heard: 'ma signature', ReplaceWith: 'Jean\nVoxen' },
      ]);
      assert.equal(p.text, 'Jean\nVoxen');
      assert.equal(
        writing.prepareSnippets('signaturelle', [{ Heard: 'signature', ReplaceWith: 'X' }])
          .corrections,
        0,
      );
    },
  );
  await check(
    'Application profiles match executable names case-insensitively without changing global preferences',
    () => {
      const settings = { CleanupMode: 0, Language: 'fr' };
      const profiles = [{ Application: 'OUTLOOK.exe', CleanupMode: 2, Tone: 'professional' }];
      assert.equal(writing.applicationSettings(settings, profiles, 'outlook').Tone, 'professional');
      assert.equal(writing.applicationSettings(settings, profiles, 'chrome.exe').CleanupMode, 0);
      assert.equal(settings.CleanupMode, 0);
    },
  );
  await check(
    'Dictionary imports deduplicate Unicode and validate the complete batch before mutation',
    () => {
      const store = new Store(path.join(folder, 'dictionary'));
      const old = store.terms().length;
      const result = store.importTerms(['Éclair', 'éclair', 'Voxen']);
      assert.equal(result.added, 1);
      assert.equal(result.duplicates, 2);
      assert.throws(() => store.importTerms(['ValidBeforeInvalid', 'x'.repeat(81)]));
      assert.equal(store.terms().length, old + 1);
      const row = store.terms().find((row) => row.Term === 'Éclair');
      store.updateTerm(row.Id, 'Orion');
      assert.equal(store.terms().find((row) => row.Id === row.Id)?.Term !== undefined, true);
      assert.ok(store.terms().some((row) => row.Term === 'Orion'));
      store.close();
    },
  );
  await check('Notes persist with optimistic concurrency and bounded version history', () => {
    const directory = path.join(folder, 'notes');
    let store = new Store(directory);
    let first = store.saveNote({ title: 'Idées', body: 'Version A' }).note;
    const stale = { ...first };
    first = store.saveNote({
      id: first.Id,
      title: 'Idées',
      body: 'Version B',
      revision: first.Revision,
    }).note;
    assert.equal(
      store.saveNote({ id: stale.Id, title: 'Stale', body: 'Écrasement', revision: stale.Revision })
        .conflict,
      true,
    );
    assert.equal(store.notes()[0].Body, 'Version B');
    for (let i = 0; i < 35; i++)
      first = store.saveNote({
        id: first.Id,
        title: 'Idées',
        body: 'Texte ' + i,
        pinned: true,
        revision: first.Revision,
      }).note;
    assert.equal(store.noteVersions(first.Id).length, 30);
    store.close();
    store = new Store(directory);
    assert.equal(store.notes()[0].Body, 'Texte 34');
    assert.equal(store.notes()[0].Pinned, 1);
    store.deleteNote(first.Id);
    assert.equal(store.noteVersions(first.Id).length, 0);
    store.close();
  });
  await check(
    'Snippet storage preserves its exact expansion; profiles, presets and favorites persist',
    () => {
      const store = new Store(path.join(folder, 'libraries'));
      store.saveReplacement({ heard: 'ma signature', replaceWith: '  Jean\nÉquipe  ' });
      assert.equal(
        store.replacements().find((row) => row.Heard === 'ma signature').ReplaceWith,
        '  Jean\nÉquipe  ',
      );
      store.saveStyleProfile({ application: 'chrome.exe', mode: 2, tone: 'professional' });
      store.saveTransform({ name: 'Texte clair', instruction: 'Clarifie sans ajouter de faits.' });
      assert.equal(store.styleProfiles()[0].Tone, 'professional');
      assert.equal(store.transformPresets()[0].Name, 'Texte clair');
      store.addDictation({
        CreatedAt: new Date().toISOString(),
        Application: 'Test',
        RawText: 'a',
        FinalText: 'a',
        WordCount: 1,
        DurationSeconds: 1,
        Corrections: 0,
      });
      const row = store.history()[0];
      store.favoriteDictation(row.Id, true);
      assert.equal(store.history()[0].Favorite, 1);
      store.deleteDictation(row.Id);
      assert.equal(store.db.prepare('SELECT COUNT(*) n FROM DictationFlags').get().n, 0);
      store.close();
    },
  );
  await check(
    'Metrics respect calendar boundaries, exclude future and invalid entries, and compute weighted speed',
    () => {
      const now = new Date(2026, 9, 16, 12);
      const rows = [
        {
          CreatedAt: new Date(2026, 9, 16, 10).toISOString(),
          WordCount: 60,
          DurationSeconds: 30,
          Application: 'A',
        },
        {
          CreatedAt: new Date(2026, 9, 15, 23, 59).toISOString(),
          WordCount: 40,
          DurationSeconds: 30,
          Application: 'B',
        },
        { CreatedAt: 'bad', WordCount: 9999 },
        { CreatedAt: new Date(2026, 9, 17).toISOString(), WordCount: 9999 },
      ];
      const today = metrics(rows, 1, now, 40);
      assert.equal(today.words, 60);
      assert.equal(today.speed, 120);
      assert.equal(metrics(rows, 7, now).words, 100);
      assert.equal(metrics(rows, 7, now).apps.length, 2);
    },
  );
  await check('Exports are plain user content with no settings or credential fields', () => {
    assert.equal(writing.exportData('dictionary', [{ Term: 'Voxen' }]).text, 'Voxen');
    const output = writing.exportData('replacements', [{ Heard: 'salut', ReplaceWith: 'Bonjour' }]);
    assert.deepEqual(JSON.parse(output.text), [{ trigger: 'salut', text: 'Bonjour' }]);
    assert.match(writing.exportData('notes', [{ Title: 'A', Body: 'B' }]).text, /# A\n\nB/);
    assert.throws(() => writing.exportData('settings', []));
  });
  await check(
    'Transforms send only explicit text and selected instruction; incomplete results keep originals outside the provider',
    async () => {
      const realFetch = global.fetch;
      let count = 0,
        request;
      global.fetch = async (url, options) => {
        count++;
        request = { url, options };
        return {
          ok: true,
          json: async () => ({
            choices: [{ finish_reason: 'stop', message: { content: 'Résultat' } }],
          }),
        };
      };
      try {
        const signal = new AbortController().signal;
        assert.equal(
          await writing.transform(
            'Texte utilisateur',
            'Clarifie',
            { RewriteModel: 'mock' },
            'synthetic-placeholder',
            signal,
          ),
          'Résultat',
        );
        const body = JSON.parse(request.options.body);
        assert.equal(body.messages[1].content, 'Texte utilisateur');
        assert.equal(body.provider.data_collection, 'deny');
        assert.equal(request.options.signal, signal);
        await assert.rejects(() =>
          writing.transform(
            'a '.repeat(1001),
            'Clarifie',
            { RewriteModel: 'mock' },
            'placeholder',
            signal,
          ),
        );
        assert.equal(count, 1);
        global.fetch = async () => ({
          ok: true,
          json: async () => ({
            choices: [{ finish_reason: 'length', message: { content: 'Tronqué' } }],
          }),
        });
        await assert.rejects(() =>
          writing.transform('Texte', 'Clarifie', { RewriteModel: 'mock' }, 'placeholder', signal),
        );
      } finally {
        global.fetch = realFetch;
      }
    },
  );
  const report = {
    passed: cases.every((row) => row.passed),
    passedCount: cases.filter((row) => row.passed).length,
    total: cases.length,
    cases,
    isolation: {
      userDatabaseOpened: false,
      networkRequests: 0,
      microphoneOpened: false,
      credentialValuesRead: false,
    },
  };
  fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
})();
