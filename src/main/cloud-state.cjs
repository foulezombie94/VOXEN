'use strict';
const { createHash } = require('node:crypto');
const PREFS = [
  'FirstName',
  'Language',
  'CleanupEnabled',
  'CleanupMode',
  'RewriteModel',
  'TypingSpeed',
  'HistoryEnabled',
];
const DEFAULT_SCOPE = { libraries: true, preferences: true, notes: false, history: false };
const COLUMNS = {
  dictionary: ['Id', 'Term'],
  replacements: ['Id', 'Heard', 'ReplaceWith'],
  styleProfiles: ['Id', 'Application', 'CleanupMode', 'Tone'],
  transforms: ['Id', 'Name', 'Instruction'],
  notes: ['Id', 'Title', 'Body', 'Pinned', 'UpdatedAt', 'Revision'],
  history: [
    'Id',
    'CreatedAt',
    'Application',
    'RawText',
    'FinalText',
    'WordCount',
    'DurationSeconds',
    'Corrections',
    'Favorite',
  ],
};
const TABLES = {
  dictionary: 'Vocabulary',
  replacements: 'Replacements',
  styleProfiles: 'StyleProfiles',
  transforms: 'TransformPresets',
  notes: 'Notes',
};
function scopeOf(value = {}) {
  return Object.fromEntries(
    Object.keys(DEFAULT_SCOPE).map((k) => [
      k,
      typeof value[k] === 'boolean' ? value[k] : DEFAULT_SCOPE[k],
    ]),
  );
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
function exportState(store, scope = DEFAULT_SCOPE) {
  scope = scopeOf(scope);
  const settings = store.settings();
  const s = {
    schema: 1,
    scope,
    preferences: scope.preferences ? Object.fromEntries(PREFS.map((k) => [k, settings[k]])) : {},
  };
  const data = {
    dictionary: () => store.terms(),
    replacements: () => store.replacements(),
    styleProfiles: () => store.styleProfiles(),
    transforms: () => store.transformPresets(),
    notes: () => store.notes(),
    history: () => store.history(),
  };
  for (const [k, read] of Object.entries(data)) {
    const enabled = scope[k === 'notes' || k === 'history' ? k : 'libraries'];
    s[k] = enabled
      ? read()
          .map((row) => Object.fromEntries(COLUMNS[k].map((c) => [c, row[c]])))
          .sort((a, b) => a.Id - b.Id)
      : [];
  }
  return s;
}
function validateState(s) {
  if (
    !s ||
    s.schema !== 1 ||
    !s.scope ||
    !s.preferences ||
    Array.isArray(s.preferences) ||
    Buffer.byteLength(JSON.stringify(s)) > 8388608
  )
    throw new Error('Connexion : données de synchronisation invalides.');
  if (
    Object.keys(s).some(
      (k) => !['schema', 'scope', 'preferences', ...Object.keys(COLUMNS)].includes(k),
    )
  )
    throw new Error('Connexion : champs de synchronisation invalides.');
  if (Object.keys(s.preferences).some((k) => !PREFS.includes(k)))
    throw new Error('Connexion : préférence non autorisée.');
  for (const [k, cols] of Object.entries(COLUMNS)) {
    if (
      !Array.isArray(s[k]) ||
      s[k].length >
        {
          dictionary: 3000,
          replacements: 1000,
          styleProfiles: 200,
          transforms: 200,
          notes: 500,
          history: 2000,
        }[k]
    )
      throw new Error('Connexion : bibliothèque trop volumineuse.');
    const ids = new Set();
    for (const row of s[k]) {
      if (
        !row ||
        !Number.isSafeInteger(row.Id) ||
        row.Id < 1 ||
        ids.has(row.Id) ||
        Object.keys(row).some((c) => !cols.includes(c)) ||
        cols.some((c) => !Object.hasOwn(row, c))
      )
        throw new Error('Connexion : ligne distante invalide.');
      ids.add(row.Id);
    }
  }
  return s;
}
function mergeSelected(local, remote) {
  if (!remote) return local;
  validateState(remote);
  const out = structuredClone(remote);
  for (const key of Object.keys(DEFAULT_SCOPE)) {
    if (!local.scope[key]) continue;
    out.scope[key] = true;
    if (key === 'preferences') out.preferences = local.preferences;
    else
      for (const k of key === 'libraries'
        ? ['dictionary', 'replacements', 'styleProfiles', 'transforms']
        : [key])
        out[k] = local[k];
  }
  return out;
}
function applyState(store, remote, selected) {
  validateState(remote);
  const scope = scopeOf(selected),
    db = store.db;
  const previous = exportState(store, {
    libraries: true,
    preferences: true,
    notes: true,
    history: true,
  });
  db.exec(
    'CREATE TABLE IF NOT EXISTS CloudBackups(Id INTEGER PRIMARY KEY AUTOINCREMENT,CreatedAt TEXT NOT NULL,State TEXT NOT NULL);BEGIN IMMEDIATE',
  );
  try {
    db.prepare('INSERT INTO CloudBackups(CreatedAt,State) VALUES(?,?)').run(
      new Date().toISOString(),
      JSON.stringify(previous),
    );
    db.exec(
      'DELETE FROM CloudBackups WHERE Id NOT IN(SELECT Id FROM CloudBackups ORDER BY Id DESC LIMIT 5)',
    );
    if (scope.preferences && remote.scope.preferences) store.saveSettings(remote.preferences);
    for (const [key, table] of Object.entries(TABLES)) {
      if (
        !scope[key === 'notes' ? 'notes' : 'libraries'] ||
        !remote.scope[key === 'notes' ? 'notes' : 'libraries']
      )
        continue;
      const oldNotes = key === 'notes' ? store.notes() : [];
      if (key === 'notes') db.exec('DELETE FROM NoteVersions');
      db.exec(`DELETE FROM ${table}`);
      const cols = COLUMNS[key],
        insert = db.prepare(
          `INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`,
        );
      for (const row of remote[key]) {
        const next = { ...row };
        if (key === 'notes')
          next.Revision =
            Math.max(row.Revision, oldNotes.find((n) => n.Id === row.Id)?.Revision || 0) + 1;
        insert.run(...cols.map((c) => next[c]));
      }
    }
    if (scope.history && remote.scope.history) {
      db.exec('DELETE FROM DictationFlags;DELETE FROM Dictations');
      const cols = COLUMNS.history.filter((k) => k !== 'Favorite'),
        insert = db.prepare(
          `INSERT INTO Dictations(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`,
        ),
        flag = db.prepare('INSERT INTO DictationFlags VALUES(?,?)');
      for (const row of remote.history) {
        insert.run(...cols.map((c) => row[c]));
        flag.run(row.Id, row.Favorite);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
// Revisions protect local editors; changing one during a pull must not cause a new cloud upload.
function contentHash(state) {
  const copy = structuredClone(state);
  for (const n of copy.notes) delete n.Revision;
  return digest(copy);
}
module.exports = {
  DEFAULT_SCOPE,
  PREFS,
  scopeOf,
  exportState,
  validateState,
  mergeSelected,
  applyState,
  contentHash,
};
