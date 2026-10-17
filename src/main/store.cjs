const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs'),
  path = require('node:path');
const defaults = {
  FirstName: '',
  HotkeyVirtualKey: 86,
  HotkeyAccelerator: 'Control+V',
  Language: 'fr',
  StartSound: false,
  EndSound: false,
  RestoreClipboard: true,
  StartWithWindows: false,
  CleanupEnabled: true,
  CleanupMode: 1,
  RewriteModel: 'qwen/qwen3.8-27b',
  TypingSpeed: 45,
  HistoryEnabled: true,
  OnboardingCompleted: false,
  SilenceSeconds: 2,
  MicrophoneDeviceId: '',
};
class Store {
  constructor(directory = path.join(process.env.LOCALAPPDATA, 'Voxen')) {
    fs.mkdirSync(directory, { recursive: true });
    this.path = path.join(directory, 'voxen.db');
    this.db = new DatabaseSync(this.path);
    this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=3000;
CREATE TABLE IF NOT EXISTS Migrations(Version INTEGER PRIMARY KEY,AppliedAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS Dictations(Id INTEGER PRIMARY KEY AUTOINCREMENT,CreatedAt TEXT NOT NULL,Application TEXT NOT NULL,RawText TEXT NOT NULL,FinalText TEXT NOT NULL,WordCount INTEGER NOT NULL,DurationSeconds REAL NOT NULL,Corrections INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS Vocabulary(Id INTEGER PRIMARY KEY AUTOINCREMENT,Term TEXT NOT NULL COLLATE NOCASE UNIQUE);
CREATE TABLE IF NOT EXISTS Replacements(Id INTEGER PRIMARY KEY AUTOINCREMENT,Heard TEXT NOT NULL COLLATE NOCASE UNIQUE,ReplaceWith TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS Settings(Key TEXT PRIMARY KEY,Value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS Notes(Id INTEGER PRIMARY KEY AUTOINCREMENT,Title TEXT NOT NULL,Body TEXT NOT NULL,Pinned INTEGER NOT NULL DEFAULT 0,UpdatedAt TEXT NOT NULL,Revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS NoteVersions(Id INTEGER PRIMARY KEY AUTOINCREMENT,NoteId INTEGER NOT NULL,Title TEXT NOT NULL,Body TEXT NOT NULL,CreatedAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS StyleProfiles(Id INTEGER PRIMARY KEY AUTOINCREMENT,Application TEXT NOT NULL COLLATE NOCASE UNIQUE,CleanupMode INTEGER NOT NULL,Tone TEXT NOT NULL DEFAULT 'natural');
CREATE TABLE IF NOT EXISTS TransformPresets(Id INTEGER PRIMARY KEY AUTOINCREMENT,Name TEXT NOT NULL,Instruction TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS DictationFlags(DictationId INTEGER PRIMARY KEY,Favorite INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO Migrations VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));`);
    if (!this.get('initialized')) {
      for (const term of ['Claude Code', 'skill', 'prompt', 'to-do', 'Wispr Flow', 'Voxen'])
        this.addTerm(term);
      this.saveReplacement({ heard: 'ski', replaceWith: 'skill' });
      this.set('initialized', 'true');
    }
  }
  get(key) {
    return this.db.prepare('SELECT Value FROM Settings WHERE Key=?').get(key)?.Value;
  }
  set(key, value) {
    this.db
      .prepare(
        'INSERT INTO Settings(Key,Value) VALUES(?,?) ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value',
      )
      .run(key, value);
  }
  settings() {
    try {
      const saved = JSON.parse(this.get('preferences') || '{}');
      const accelerator = require('./hotkey-policy.cjs');
      return {
        ...defaults,
        ...saved,
        HotkeyAccelerator:
          accelerator.normalizeAccelerator(saved.HotkeyAccelerator) ||
          accelerator.legacyAccelerator(saved.HotkeyVirtualKey) ||
          defaults.HotkeyAccelerator,
      };
    } catch {
      return { ...defaults };
    }
  }
  saveSettings(value) {
    const next = { ...this.settings() };
    for (const key of Object.keys(defaults)) if (Object.hasOwn(value, key)) next[key] = value[key];
    for (const key of Object.keys(defaults)) {
      if (typeof defaults[key] === 'boolean') next[key] = !!next[key];
    }
    next.SilenceSeconds = Math.min(15, Math.max(2, Number(next.SilenceSeconds) || 2));
    next.TypingSpeed = Math.min(250, Math.max(5, Number(next.TypingSpeed) || 45));
    next.CleanupMode = [0, 1, 2].includes(Number(next.CleanupMode)) ? Number(next.CleanupMode) : 1;
    next.FirstName = String(next.FirstName).slice(0, 60);
    next.RewriteModel = String(next.RewriteModel).trim().slice(0, 150);
    next.MicrophoneDeviceId = String(next.MicrophoneDeviceId || '').slice(0, 256);
    if (!next.RewriteModel) throw new Error('Renseignez le modèle de reformulation.');
    if (!['fr', 'en', 'de', 'es', 'it'].includes(next.Language))
      throw new Error('Langue non prise en charge.');
    const hotkeys = require('./hotkey-policy.cjs');
    if (Object.hasOwn(value, 'HotkeyAccelerator')) {
      next.HotkeyAccelerator = hotkeys.normalizeAccelerator(value.HotkeyAccelerator);
      if (!next.HotkeyAccelerator) throw new Error('Raccourci non pris en charge.');
      next.HotkeyVirtualKey = hotkeys.virtualKeyOf(next.HotkeyAccelerator) ?? next.HotkeyVirtualKey;
    } else if (Object.hasOwn(value, 'HotkeyVirtualKey')) {
      const legacy = Number(value.HotkeyVirtualKey);
      next.HotkeyAccelerator = hotkeys.legacyAccelerator(legacy);
      if (!next.HotkeyAccelerator) throw new Error('Raccourci non pris en charge.');
      next.HotkeyVirtualKey = legacy;
    }
    this.set('preferences', JSON.stringify(next));
    return next;
  }
  history() {
    return this.db
      .prepare(
        'SELECT d.*,COALESCE(f.Favorite,0) AS Favorite FROM Dictations d LEFT JOIN DictationFlags f ON f.DictationId=d.Id ORDER BY CreatedAt DESC',
      )
      .all();
  }
  terms() {
    return this.db.prepare('SELECT * FROM Vocabulary ORDER BY Term COLLATE NOCASE').all();
  }
  replacements() {
    return this.db.prepare('SELECT * FROM Replacements ORDER BY Heard COLLATE NOCASE').all();
  }
  addTerm(term) {
    term = String(term || '').trim();
    if (!term || term.length > 80)
      throw new Error('Un terme doit contenir entre 1 et 80 caractères.');
    this.db.prepare('INSERT OR IGNORE INTO Vocabulary(Term) VALUES(?)').run(term);
  }
  deleteTerm(id) {
    this.db.prepare('DELETE FROM Vocabulary WHERE Id=?').run(Number(id));
  }
  updateTerm(id, term) {
    term = String(term || '').trim();
    if (!term || term.length > 80) throw new Error('Renseignez un mot de 1 à 80 caractères.');
    if (
      this.terms().some(
        (row) => row.Id !== Number(id) && row.Term.toLocaleLowerCase() === term.toLocaleLowerCase(),
      )
    )
      throw new Error('Renseignez un mot qui n’existe pas déjà.');
    this.db.prepare('UPDATE Vocabulary SET Term=? WHERE Id=?').run(term, Number(id));
  }
  importTerms(terms) {
    if (!Array.isArray(terms) || terms.length > 3000)
      throw new Error('Renseignez au maximum 3 000 mots.');
    const clean = terms.map((term) => String(term).trim()).filter(Boolean);
    if (clean.some((term) => term.length > 80))
      throw new Error('Renseignez des mots de 80 caractères maximum.');
    const known = new Set(this.terms().map((row) => row.Term.toLocaleLowerCase()));
    let added = 0;
    this.db.exec('BEGIN');
    try {
      for (const term of clean) {
        if (!known.has(term.toLocaleLowerCase())) {
          this.addTerm(term);
          known.add(term.toLocaleLowerCase());
          added++;
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { added, duplicates: clean.length - added };
  }
  saveReplacement({ id = 0, heard, replaceWith }) {
    heard = String(heard || '').trim();
    replaceWith = String(replaceWith || '');
    if (!heard || heard.length > 200 || !replaceWith.trim() || replaceWith.length > 2000)
      throw new Error('Renseignez les deux textes du remplacement.');
    if (id)
      this.db
        .prepare('UPDATE Replacements SET Heard=?,ReplaceWith=? WHERE Id=?')
        .run(heard, replaceWith, Number(id));
    else
      this.db
        .prepare(
          'INSERT INTO Replacements(Heard,ReplaceWith) VALUES(?,?) ON CONFLICT(Heard) DO UPDATE SET ReplaceWith=excluded.ReplaceWith',
        )
        .run(heard, replaceWith);
  }
  deleteReplacement(id) {
    this.db.prepare('DELETE FROM Replacements WHERE Id=?').run(Number(id));
  }
  addDictation(d) {
    this.db
      .prepare(
        'INSERT INTO Dictations(CreatedAt,Application,RawText,FinalText,WordCount,DurationSeconds,Corrections) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        d.CreatedAt,
        d.Application,
        d.RawText,
        d.FinalText,
        d.WordCount,
        d.DurationSeconds,
        d.Corrections,
      );
  }
  deleteDictation(id) {
    this.db.prepare('DELETE FROM Dictations WHERE Id=?').run(Number(id));
    this.db.prepare('DELETE FROM DictationFlags WHERE DictationId=?').run(Number(id));
  }
  clearHistory() {
    this.db.exec('DELETE FROM Dictations;DELETE FROM DictationFlags');
  }
  favoriteDictation(id, value) {
    if (!this.db.prepare('SELECT Id FROM Dictations WHERE Id=?').get(Number(id))) return;
    this.db
      .prepare(
        'INSERT INTO DictationFlags VALUES(?,?) ON CONFLICT(DictationId) DO UPDATE SET Favorite=excluded.Favorite',
      )
      .run(Number(id), value ? 1 : 0);
  }
  notes() {
    return this.db.prepare('SELECT * FROM Notes ORDER BY Pinned DESC,UpdatedAt DESC').all();
  }
  saveNote({ id = 0, title = '', body = '', pinned = false, revision } = {}) {
    title = String(title).trim().slice(0, 120);
    body = String(body);
    if (body.length > 200000)
      throw new Error('Renseignez une note de moins de 200 000 caractères.');
    const now = new Date().toISOString();
    if (!id) {
      const result = this.db
        .prepare('INSERT INTO Notes(Title,Body,Pinned,UpdatedAt) VALUES(?,?,?,?)')
        .run(title || 'Nouvelle note', body, pinned ? 1 : 0, now);
      return {
        note: this.db.prepare('SELECT * FROM Notes WHERE Id=?').get(result.lastInsertRowid),
      };
    }
    const previous = this.db.prepare('SELECT * FROM Notes WHERE Id=?').get(Number(id));
    if (!previous) throw new Error('Impossible de retrouver cette note.');
    if (Number(revision) !== previous.Revision) return { conflict: true, note: previous };
    if (previous.Title === title && previous.Body === body && previous.Pinned === (pinned ? 1 : 0))
      return { note: previous };
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO NoteVersions(NoteId,Title,Body,CreatedAt) VALUES(?,?,?,?)')
        .run(Number(id), previous.Title, previous.Body, now);
      this.db
        .prepare(
          'UPDATE Notes SET Title=?,Body=?,Pinned=?,UpdatedAt=?,Revision=Revision+1 WHERE Id=?',
        )
        .run(title || 'Nouvelle note', body, pinned ? 1 : 0, now, Number(id));
      this.db
        .prepare(
          'DELETE FROM NoteVersions WHERE NoteId=? AND Id NOT IN (SELECT Id FROM NoteVersions WHERE NoteId=? ORDER BY Id DESC LIMIT 30)',
        )
        .run(Number(id), Number(id));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { note: this.db.prepare('SELECT * FROM Notes WHERE Id=?').get(Number(id)) };
  }
  noteVersions(id) {
    return this.db
      .prepare('SELECT * FROM NoteVersions WHERE NoteId=? ORDER BY Id DESC LIMIT 30')
      .all(Number(id));
  }
  deleteNote(id) {
    this.db.prepare('DELETE FROM Notes WHERE Id=?').run(Number(id));
    this.db.prepare('DELETE FROM NoteVersions WHERE NoteId=?').run(Number(id));
  }
  styleProfiles() {
    return this.db.prepare('SELECT * FROM StyleProfiles ORDER BY Application COLLATE NOCASE').all();
  }
  saveStyleProfile({ id = 0, application, mode = 1, tone = 'natural' }) {
    application = String(application || '').trim();
    if (
      !/^[\p{L}\p{N}_. -]{1,80}$/u.test(application) ||
      ![0, 1, 2].includes(Number(mode)) ||
      !['natural', 'professional', 'casual'].includes(tone)
    )
      throw new Error('Renseignez une application, un style et un ton valides.');
    if (id)
      this.db
        .prepare('UPDATE StyleProfiles SET Application=?,CleanupMode=?,Tone=? WHERE Id=?')
        .run(application, Number(mode), tone, Number(id));
    else
      this.db
        .prepare(
          'INSERT INTO StyleProfiles(Application,CleanupMode,Tone) VALUES(?,?,?) ON CONFLICT(Application) DO UPDATE SET CleanupMode=excluded.CleanupMode,Tone=excluded.Tone',
        )
        .run(application, Number(mode), tone);
  }
  deleteStyleProfile(id) {
    this.db.prepare('DELETE FROM StyleProfiles WHERE Id=?').run(Number(id));
  }
  transformPresets() {
    return this.db.prepare('SELECT * FROM TransformPresets ORDER BY Id').all();
  }
  saveTransform({ id = 0, name, instruction }) {
    name = String(name || '').trim();
    instruction = String(instruction || '').trim();
    if (!name || name.length > 60 || !instruction || instruction.length > 3000)
      throw new Error('Renseignez un nom et une consigne de transformation valides.');
    if (id)
      this.db
        .prepare('UPDATE TransformPresets SET Name=?,Instruction=? WHERE Id=?')
        .run(name, instruction, Number(id));
    else
      this.db
        .prepare('INSERT INTO TransformPresets(Name,Instruction) VALUES(?,?)')
        .run(name, instruction);
  }
  deleteTransform(id) {
    this.db.prepare('DELETE FROM TransformPresets WHERE Id=?').run(Number(id));
  }
  close() {
    this.db.close();
  }
}
module.exports = { Store, defaults };
