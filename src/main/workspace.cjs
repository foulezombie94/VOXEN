'use strict';
const { dialog } = require('electron');
const fs = require('node:fs');
const native = require('./windows.cjs');
const writing = require('./writing.cjs');
const ACTIONS = new Set([
  'dictionary.update',
  'dictionary.import',
  'dictionary.removeMany',
  'replacement.removeMany',
  'style.save',
  'style.delete',
  'transform.save',
  'transform.delete',
  'transform.run',
  'transform.cancel',
  'notes.save',
  'notes.delete',
  'notes.versions',
  'history.favorite',
  'data.export',
  'text.copy',
]);
class Workspace {
  constructor(store, engine, { diagnostic = false, getWindow, onChange } = {}) {
    this.store = store;
    this.engine = engine;
    this.diagnostic = diagnostic;
    this.getWindow = getWindow;
    this.onChange = onChange;
    this.abort = null;
  }
  get busy() {
    return Boolean(this.abort);
  }
  data() {
    return {
      notes: this.store.notes(),
      styleProfiles: this.store.styleProfiles(),
      transforms: [...writing.BUILTINS, ...this.store.transformPresets()],
    };
  }
  async handle(action, p = {}) {
    switch (action) {
      case 'dictionary.update':
        this.store.updateTerm(p.id, p.term);
        break;
      case 'dictionary.import':
        return this.store.importTerms(p.terms);
      case 'dictionary.removeMany':
        if (!Array.isArray(p.ids) || p.ids.length > 3000)
          throw new Error('Renseignez une sélection valide.');
        for (const id of p.ids) this.store.deleteTerm(id);
        break;
      case 'replacement.removeMany':
        if (!Array.isArray(p.ids) || p.ids.length > 3000)
          throw new Error('Renseignez une sélection valide.');
        for (const id of p.ids) this.store.deleteReplacement(id);
        break;
      case 'style.save':
        this.store.saveStyleProfile(p);
        break;
      case 'style.delete':
        this.store.deleteStyleProfile(p.id);
        break;
      case 'transform.save':
        this.store.saveTransform(p);
        break;
      case 'transform.delete':
        this.store.deleteTransform(p.id);
        break;
      case 'notes.save':
        return this.store.saveNote(p);
      case 'notes.delete':
        this.store.deleteNote(p.id);
        break;
      case 'notes.versions':
        return this.store.noteVersions(p.id);
      case 'history.favorite':
        this.store.favoriteDictation(p.id, p.favorite);
        break;
      case 'transform.cancel':
        this.abort?.abort();
        break;
      case 'transform.run': {
        if (this.diagnostic)
          throw new Error('OpenRouter : réseau désactivé pendant la validation.');
        if (this.busy || this.engine.busy() || this.engine.testMode)
          throw new Error('Impossible de transformer pendant une autre opération.');
        const preset = [...writing.BUILTINS, ...this.store.transformPresets()].find(
          (row) => String(row.Id) === String(p.id),
        );
        if (!preset) throw new Error('Renseignez une transformation existante.');
        this.abort = new AbortController();
        this.onChange?.();
        try {
          return {
            text: await native.withCredential('openrouter', (key) =>
              writing.transform(
                p.text,
                preset.Instruction,
                { ...this.engine.settings },
                key,
                AbortSignal.any([this.abort.signal, AbortSignal.timeout(120000)]),
              ),
            ),
          };
        } catch (error) {
          if (this.abort.signal.aborted)
            throw new Error('Reformulation annulée. Votre texte original est conservé.');
          throw error;
        } finally {
          this.abort = null;
          this.onChange?.();
        }
      }
      case 'text.copy': {
        if (typeof p.text !== 'string' || p.text.length > 200000)
          throw new Error('Renseignez un texte valide.');
        if (!this.diagnostic) require('electron').clipboard.writeText(p.text);
        return { ok: true };
      }
      case 'data.export': {
        const rows =
          p.kind === 'dictionary'
            ? this.store.terms()
            : p.kind === 'replacements'
              ? this.store.replacements()
              : p.kind === 'notes'
                ? this.store.notes()
                : p.kind === 'history'
                  ? this.store.history()
                  : null;
        if (!rows) throw new Error('Impossible de préparer cet export.');
        const selected = Array.isArray(p.ids) ? rows.filter((row) => p.ids.includes(row.Id)) : rows;
        const data = writing.exportData(p.kind, selected);
        if (this.diagnostic) return data;
        const result = await dialog.showSaveDialog(this.getWindow(), {
          title: 'Exporter depuis Voxen',
          defaultPath: data.filename,
          filters: [{ name: 'Fichier ' + data.extension, extensions: [data.extension] }],
        });
        if (result.canceled || !result.filePath) return { cancelled: true };
        await fs.promises.writeFile(result.filePath, data.text, 'utf8');
        return { saved: true };
      }
    }
    return { ok: true };
  }
  close() {
    this.abort?.abort();
  }
}
module.exports = { Workspace, ACTIONS };
