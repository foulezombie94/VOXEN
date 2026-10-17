import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  History,
  LoaderCircle,
  Mic,
  Pin,
  Plus,
  Search,
  StickyNote,
  Trash2,
  X,
  SquareArrowOutUpRight,
  ShieldCheck,
} from 'lucide-react';
import s from './NotesPage.module.scss';

const BACKUP = 'voxen.notes.pending.v1';
const OWNER = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const MIGRATED = 'voxen.scratchpad.migrated.v1';
const IMPORT_LOCK = 'voxen.scratchpad.import-lock.v1';
const date = (value) =>
  value
    ? new Date(value).toLocaleString('fr-FR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
const normalize = (note) => ({
  Id: note.Id,
  Title: note.Title || '',
  Body: note.Body || '',
  Pinned: Boolean(note.Pinned),
  UpdatedAt: note.UpdatedAt,
  Revision: Number(note.Revision || 0),
  dirty: false,
  saving: false,
  edit: 0,
  error: '',
  conflict: null,
});
const wordCount = (text) => (text.trim().match(/\S+/g) || []).length;
function pendingNotes() {
  const notes = {};
  try {
    const candidates = [];
    const legacy = JSON.parse(localStorage.getItem(BACKUP) || '{}');
    for (const [id, note] of Object.entries(legacy))
      candidates.push({ id, note, source: { key: BACKUP, id } });
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${BACKUP}.`)) {
        const note = JSON.parse(localStorage.getItem(key) || 'null');
        if (note) candidates.push({ id: note.Id, note, source: { key } });
      }
    }
    candidates.sort((a, b) => Number(a.note?.BackupAt || 0) - Number(b.note?.BackupAt || 0));
    for (const { id, note, source } of candidates)
      if (Number(id) > 0 && note && typeof note.Body === 'string') {
        const current = notes[id];
        const same = current?.Body === note.Body && current?.Title === (note.Title || '');
        notes[id] = {
          ...normalize(note),
          Id: Number(id),
          dirty: true,
          backupSources: [...(same ? current.backupSources || [] : []), source],
        };
      }
  } catch {}
  return notes;
}

export default function NotesPage({
  snapshot = {},
  run,
  status = {},
  onNotice = () => {},
  floating = false,
  guide = null,
}) {
  const drafts = useRef(null);
  if (!drafts.current) drafts.current = pendingNotes();
  const [selectedId, setSelectedId] = useState(
    () => Number(Object.keys(drafts.current)[0]) || null,
  );
  const selected = useRef(selectedId);
  selected.current = selectedId;
  const [query, setQuery] = useState('');
  const [, render] = useState(0);
  const [creating, setCreating] = useState(false);
  const [versions, setVersions] = useState(null);
  const [versionsBusy, setVersionsBusy] = useState(false);
  const [windowPinned, setWindowPinned] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const editor = useRef(null);
  const titleInput = useRef(null);
  const timers = useRef(new Map());
  const inflight = useRef(new Map());
  const contexts = useRef(new Map());
  const writtenBackups = useRef(new Set());
  const sessions = useRef(new Set());
  const knownIds = useRef(new Set());
  const mounted = useRef(true);
  const importing = useRef(false);
  const live = useRef({ run, onNotice, snapshot });
  live.current = { run, onNotice, snapshot };
  const flushRef = useRef(null);
  const publish = () => {
    if (mounted.current) render((value) => value + 1);
  };
  const notice = (message) => live.current.onNotice(message);
  const call = (action, payload) => live.current.run(action, payload);
  const backup = () => {
    try {
      const active = new Set();
      for (const [id, note] of Object.entries(drafts.current)) {
        const key = `${BACKUP}.${OWNER}.${id}`;
        if (note.dirty || note.conflict) {
          localStorage.setItem(
            key,
            JSON.stringify({
              Id: note.Id,
              Title: note.Title,
              Body: note.Body,
              Pinned: note.Pinned,
              Revision: note.Revision,
              UpdatedAt: note.UpdatedAt,
              BackupAt: Date.now(),
            }),
          );
          active.add(key);
          writtenBackups.current.add(key);
        } else if (!note.saving && note.backupSources) {
          for (const source of note.backupSources) {
            const value = JSON.parse(localStorage.getItem(source.key) || 'null');
            const candidate = source.id ? value?.[source.id] : value;
            if (candidate?.Body === note.Body && (candidate.Title || '') === note.Title) {
              if (source.id) {
                delete value[source.id];
                localStorage.setItem(source.key, JSON.stringify(value));
              } else localStorage.removeItem(source.key);
            }
          }
          note.backupSources = [];
        }
      }
      for (const key of writtenBackups.current)
        if (!active.has(key)) {
          localStorage.removeItem(key);
          writtenBackups.current.delete(key);
        }
      if (mounted.current) setStorageError(false);
    } catch {
      if (mounted.current) setStorageError(true);
    }
  };
  const hydrate = (id) => {
    if (!drafts.current[id]) {
      const note = (live.current.snapshot.notes || []).find(
        (item) => Number(item.Id) === Number(id),
      );
      if (note) drafts.current[id] = normalize(note);
    }
    return drafts.current[id];
  };
  const save = (id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    if (inflight.current.has(id)) return inflight.current.get(id);
    const operation = (async () => {
      let note = hydrate(id);
      if (!note || note.conflict) return !note?.dirty;
      while (note.dirty && !note.conflict) {
        const edit = note.edit;
        note.saving = true;
        note.error = '';
        publish();
        let result;
        try {
          result = await call('notes.save', {
            id: note.Id,
            title: note.Title,
            body: note.Body,
            pinned: note.Pinned,
            revision: note.Revision,
          });
        } catch {
          result = null;
        }
        note = drafts.current[id];
        if (!note) return false;
        note.saving = false;
        if (result?.conflict) {
          note.conflict = { note: result.note || null };
          note.error = 'Une autre fenêtre a modifié cette note.';
          backup();
          publish();
          return false;
        }
        if (!result?.note) {
          note.error = 'Sauvegarde impossible. Votre brouillon reste dans cette fenêtre.';
          backup();
          publish();
          return false;
        }
        note.Revision = Number(result.note.Revision || note.Revision);
        note.UpdatedAt = result.note.UpdatedAt;
        if (note.edit === edit) {
          note.Title = result.note.Title || '';
          note.dirty = false;
        }
        backup();
        publish();
      }
      return !note.dirty;
    })();
    inflight.current.set(id, operation);
    operation.finally(() => {
      if (inflight.current.get(id) === operation) inflight.current.delete(id);
    });
    return operation;
  };
  const flush = async () => {
    const results = await Promise.all(
      Object.values(drafts.current)
        .filter((note) => note.dirty || note.saving)
        .map((note) => save(note.Id)),
    );
    return results.every(Boolean);
  };
  flushRef.current = flush;
  const editNote = (id, changes) => {
    const note = hydrate(id);
    if (!note) return;
    Object.assign(note, changes, { dirty: true, edit: note.edit + 1, error: '' });
    backup();
    publish();
    clearTimeout(timers.current.get(id));
    if (!note.conflict)
      timers.current.set(
        id,
        setTimeout(() => {
          void save(id);
        }, 500),
      );
  };
  const select = async (id) => {
    if (Number(id) === selected.current) return;
    if (selected.current && !(await save(selected.current))) {
      notice('Conservez votre brouillon ou résolvez le conflit avant de changer de note.');
      return;
    }
    hydrate(id);
    setSelectedId(Number(id));
    setVersions(null);
  };
  const create = async ({ title = '', body = '', skipFlush = false } = {}) => {
    if (creating) return null;
    if (!skipFlush && !(await flushRef.current())) return null;
    setCreating(true);
    try {
      const result = await call('notes.save', { title, body, pinned: false });
      if (!result?.note) return null;
      drafts.current[result.note.Id] = normalize(result.note);
      setSelectedId(result.note.Id);
      setVersions(null);
      publish();
      return result.note;
    } finally {
      if (mounted.current) setCreating(false);
    }
  };

  useEffect(() => {
    const notes = snapshot.notes || [];
    const present = new Set(notes.map((item) => String(item.Id)));
    for (const id of knownIds.current)
      if (!present.has(id)) {
        const current = drafts.current[id];
        if (current?.dirty || current?.saving) {
          if (!current.saving) current.conflict = { note: null };
        } else delete drafts.current[id];
      }
    knownIds.current = present;
    for (const note of notes) {
      const current = drafts.current[note.Id];
      if (
        !current ||
        (!current.dirty && !current.saving && Number(note.Revision || 0) >= current.Revision)
      )
        drafts.current[note.Id] = normalize(note);
      else if (current.dirty && !current.saving && Number(note.Revision || 0) > current.Revision)
        current.conflict = { note };
    }
    if ((!selected.current || !drafts.current[selected.current]) && notes.length) {
      const id = notes[0].Id;
      setSelectedId(id);
      selected.current = id;
    } else if (selected.current && !drafts.current[selected.current]) {
      setSelectedId(null);
      selected.current = null;
    }
    publish();
  }, [snapshot.notes]);

  useEffect(() => {
    if (importing.current) return;
    let old, lock;
    try {
      old = localStorage.getItem('voxen.scratchpad');
      if (!old?.trim() || localStorage.getItem(MIGRATED)) return;
      lock = JSON.parse(localStorage.getItem(IMPORT_LOCK) || 'null');
      if (lock && Date.now() - Number(lock.time) < 30000) return;
      localStorage.setItem(IMPORT_LOCK, JSON.stringify({ time: Date.now() }));
    } catch {
      return;
    }
    importing.current = true;
    (async () => {
      try {
        const result = await call('notes.save', {
          title: 'Ancien brouillon',
          body: old,
          pinned: false,
        });
        if (result?.note) {
          drafts.current[result.note.Id] = normalize(result.note);
          localStorage.setItem(MIGRATED, String(result.note.Id));
          // Keep the original until and after the confirmed database write.
          if (!selected.current && mounted.current) setSelectedId(result.note.Id);
          publish();
          notice('Votre ancien brouillon a été conservé dans vos notes.');
        }
      } finally {
        try {
          localStorage.removeItem(IMPORT_LOCK);
        } catch {}
      }
    })().catch(() => notice('L’ancien brouillon est conservé. Son import pourra être réessayé.'));
  }, []);

  useEffect(() => {
    mounted.current = true;
    const handler = () => flushRef.current();
    window.voxenFlushNotes = handler;
    const beforeUnload = () => {
      backup();
      void flushRef.current();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      backup();
      void flushRef.current();
      mounted.current = false;
      for (const timer of timers.current.values()) clearTimeout(timer);
      if (window.voxenFlushNotes === handler) delete window.voxenFlushNotes;
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  useEffect(
    () =>
      window.voxen.onLocalText?.((payload) => {
        if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) return;
        if (payload.sessionId != null && sessions.current.has(payload.sessionId)) return;
        if (payload.sessionId != null) sessions.current.add(payload.sessionId);
        const id = Number(payload.noteId || 0);
        if (!id) {
          void create({ title: 'Nouvelle dictée', body: payload.text, skipFlush: true });
          return;
        }
        const note = hydrate(id),
          context = contexts.current.get(id);
        contexts.current.delete(id);
        if (!note) {
          void create({ title: 'Dictée récupérée', body: payload.text, skipFlush: true });
          return;
        }
        let body, cursor;
        if (context && note.Body === context.body) {
          const before = note.Body.slice(0, context.start),
            after = note.Body.slice(context.end);
          const prefix = before && !/\s$/.test(before) ? ' ' : '';
          const suffix = after && !/^\s|^[,.;:!?)]/.test(after) ? ' ' : '';
          body = before + prefix + payload.text + suffix + after;
          cursor = before.length + prefix.length + payload.text.length;
        } else {
          body = note.Body + (note.Body && !/\n$/.test(note.Body) ? '\n\n' : '') + payload.text;
          cursor = body.length;
          if (context)
            notice(
              'Votre note avait changé : la dictée a été ajoutée à la fin pour préserver vos modifications.',
            );
        }
        editNote(id, { Body: body });
        if (selected.current === id)
          requestAnimationFrame(() => {
            editor.current?.focus();
            editor.current?.setSelectionRange(cursor, cursor);
          });
        else notice('La dictée a été ajoutée à sa note d’origine.');
      }),
    [],
  );

  const allNotes = Object.values(drafts.current);
  const notes = useMemo(
    () =>
      allNotes
        .filter((note) =>
          `${note.Title}\n${note.Body}`
            .toLocaleLowerCase('fr')
            .includes(query.toLocaleLowerCase('fr')),
        )
        .sort(
          (a, b) =>
            Number(b.Pinned) - Number(a.Pinned) ||
            new Date(b.UpdatedAt || 0) - new Date(a.UpdatedAt || 0),
        ),
    [query, allNotes],
  );
  const note = selectedId ? drafts.current[selectedId] : null;
  const recording = status.state === 'recording';
  const dictationBusy = recording || status.state === 'processing';
  const saveLabel = note?.conflict
    ? 'Conflit à résoudre'
    : note?.saving
      ? 'Enregistrement…'
      : note?.error
        ? 'À enregistrer'
        : note?.dirty
          ? 'Modifications en cours…'
          : 'Enregistré sur cet ordinateur';

  const remove = async () => {
    const id = selected.current;
    if (!id || !(await save(id))) return;
    const item = drafts.current[id];
    if (!confirm(`Supprimer « ${item.Title || 'Sans titre'} » et ses versions ?`)) return;
    const result = await call('notes.delete', { id });
    if (result === null) return;
    clearTimeout(timers.current.get(id));
    delete drafts.current[id];
    backup();
    setSelectedId(
      Object.values(drafts.current).sort(
        (a, b) => new Date(b.UpdatedAt || 0) - new Date(a.UpdatedAt || 0),
      )[0]?.Id || null,
    );
    setVersions(null);
    publish();
    notice('Note supprimée.');
  };
  const viewVersions = async () => {
    const id = selected.current;
    if (!id || !(await save(id))) return;
    setVersionsBusy(true);
    try {
      const result = await call('notes.versions', { id });
      if (result !== null)
        setVersions({ noteId: id, items: Array.isArray(result) ? result : result.versions || [] });
    } finally {
      setVersionsBusy(false);
    }
  };
  const restore = async (version) => {
    const id = versions.noteId;
    if (
      !confirm(
        'Restaurer cette version ? Le contenu actuel sera conservé dans les versions précédentes.',
      )
    )
      return;
    if (!(await save(id))) return;
    editNote(id, { Title: version.Title || '', Body: version.Body || '' });
    if (await save(id)) {
      setVersions(null);
      notice('Version restaurée.');
    }
  };
  const copyDraft = async () => {
    const item = drafts.current[selected.current];
    if (!item) return;
    if ((await call('text.copy', { text: item.Body })) !== null) notice('Texte copié.');
  };
  const saveCopy = async () => {
    const oldId = selected.current,
      old = drafts.current[oldId];
    if (!old) return;
    const result = await call('notes.save', {
      title: `${old.Title || 'Sans titre'} — copie`,
      body: old.Body,
      pinned: old.Pinned,
    });
    if (!result?.note) return;
    const remote = old.conflict?.note;
    old.dirty = false;
    old.conflict = null;
    backup();
    if (remote) drafts.current[oldId] = normalize(remote);
    else delete drafts.current[oldId];
    drafts.current[result.note.Id] = normalize(result.note);
    backup();
    setSelectedId(result.note.Id);
    publish();
    notice('Votre brouillon est conservé dans une nouvelle note.');
  };
  const loadRemote = () => {
    const item = drafts.current[selected.current];
    if (
      !item?.conflict ||
      !confirm(
        'Charger la version de l’autre fenêtre ? Copiez ou enregistrez votre brouillon avant de continuer.',
      )
    )
      return;
    const remote = item.conflict.note;
    item.dirty = false;
    item.conflict = null;
    backup();
    if (remote) drafts.current[item.Id] = normalize(remote);
    else {
      delete drafts.current[item.Id];
      setSelectedId(null);
    }
    backup();
    publish();
  };
  const dictate = async () => {
    if (recording) {
      await call('dictation.local', { noteId: selected.current || 0 });
      return;
    }
    if (dictationBusy) return;
    let id = selected.current;
    if (!id) {
      const created = await create({ title: 'Nouvelle dictée' });
      if (!created) return;
      id = created.Id;
    }
    if (!(await save(id))) return;
    const item = drafts.current[id],
      target = editor.current;
    contexts.current.set(id, {
      body: item.Body,
      start: target?.selectionStart ?? item.Body.length,
      end: target?.selectionEnd ?? item.Body.length,
    });
    await call('dictation.local', { noteId: id });
  };

  return (
    <section className={`${s.page} ${floating ? s.floating : ''}`} aria-label="Bloc-notes">
      <header className={s.heading}>
        <div>
          <span className={s.eyebrow}>VOTRE CARNET PERSONNEL</span>
          <h1>Une place pour vos idées.</h1>
          <p>Dictez, retrouvez et gardez les mots qui comptent.</p>
        </div>
        <div className={s.headerActions}>
          {floating ? (
            <>
              <button
                className={s.iconButton}
                title="Toujours devant"
                aria-label="Toujours devant"
                aria-pressed={windowPinned}
                onClick={async () => {
                  const result = await call('notes.pin', {});
                  if (result) setWindowPinned(Boolean(result.pinned));
                }}
              >
                <Pin size={17} />
              </button>
              <button
                className={s.iconButton}
                aria-label="Fermer le bloc-notes"
                onClick={async () => {
                  if (await flushRef.current()) await call('window.close');
                }}
              >
                <X size={18} />
              </button>
            </>
          ) : (
            <button
              className={s.secondary}
              onClick={async () => {
                if (await flushRef.current()) await call('notes.open', { id: selectedId });
              }}
            >
              <SquareArrowOutUpRight size={15} />
              Ouvrir à part
            </button>
          )}
        </div>
      </header>
      {!floating && guide}
      {storageError && (
        <div className={s.warning} role="alert">
          La copie de secours locale est indisponible. Gardez cette fenêtre ouverte jusqu’à la
          confirmation de l’enregistrement.
        </div>
      )}
      <div className={s.workspace}>
        <aside className={s.sidebar} aria-label="Vos notes">
          <div className={s.listTop}>
            <strong>
              Vos notes <span>{allNotes.length}</span>
            </strong>
            <button
              className={s.newButton}
              title="Nouvelle note"
              aria-label="Nouvelle note"
              disabled={creating}
              onClick={() =>
                create().then((value) => {
                  if (value) requestAnimationFrame(() => titleInput.current?.focus());
                })
              }
            >
              {creating ? <LoaderCircle size={16} className={s.spinner} /> : <Plus size={18} />}
            </button>
          </div>
          <label className={s.search}>
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher une note"
              aria-label="Rechercher une note"
            />
            {query && (
              <button aria-label="Effacer la recherche" onClick={() => setQuery('')}>
                <X size={13} />
              </button>
            )}
          </label>
          <div className={s.noteList}>
            {notes.map((item) => (
              <button
                key={item.Id}
                className={`${s.noteItem} ${item.Id === selectedId ? s.active : ''}`}
                aria-current={item.Id === selectedId ? 'true' : undefined}
                onClick={() => select(item.Id)}
              >
                <span className={s.noteTitle}>
                  {item.Pinned && <Pin size={12} />}
                  <strong>{item.Title || 'Sans titre'}</strong>
                  {item.dirty && (
                    <span className={s.dirtyDot} title="Modifications non enregistrées" />
                  )}
                </span>
                <span className={s.excerpt}>
                  {item.Body.trim().replace(/\s+/g, ' ').slice(0, 100) ||
                    'Votre prochaine idée commence ici…'}
                </span>
                <small>{date(item.UpdatedAt) || 'Nouvelle note'}</small>
              </button>
            ))}
            {!notes.length && (
              <div className={s.listEmpty}>
                <StickyNote size={22} />
                <p>
                  {query
                    ? 'Aucune note ne correspond à cette recherche.'
                    : 'Un carnet encore tout neuf.'}
                </p>
                {query && <button onClick={() => setQuery('')}>Afficher toutes les notes</button>}
              </div>
            )}
          </div>
          <span className={s.localHint}>
            <ShieldCheck size={13} />
            Notes enregistrées localement
          </span>
        </aside>
        {note ? (
          <div className={s.editorPanel}>
            <div className={s.toolbar}>
              <span
                className={`${s.saveState} ${note.error || note.conflict ? s.saveError : ''}`}
                role="status"
              >
                {note.saving ? (
                  <LoaderCircle size={13} className={s.spinner} />
                ) : note.dirty || note.conflict ? (
                  <span className={s.dirtyDot} />
                ) : (
                  <Check size={13} />
                )}
                {saveLabel}
              </span>
              <div>
                <button
                  className={s.iconButton}
                  title={note.Pinned ? 'Désépingler la note' : 'Épingler la note'}
                  aria-label={note.Pinned ? 'Désépingler la note' : 'Épingler la note'}
                  aria-pressed={note.Pinned}
                  onClick={() => editNote(note.Id, { Pinned: !note.Pinned })}
                >
                  <Pin size={16} />
                </button>
                <button
                  className={s.iconButton}
                  title="Versions précédentes"
                  aria-label="Versions précédentes"
                  disabled={versionsBusy}
                  onClick={viewVersions}
                >
                  {versionsBusy ? (
                    <LoaderCircle className={s.spinner} size={16} />
                  ) : (
                    <History size={16} />
                  )}
                </button>
                <button
                  className={s.iconButton}
                  title="Exporter en texte"
                  aria-label="Exporter en texte"
                  onClick={async () => {
                    if (await save(note.Id))
                      await call('data.export', { kind: 'notes', ids: [note.Id] });
                  }}
                >
                  <Download size={16} />
                </button>
                <button
                  className={`${s.iconButton} ${s.deleteButton}`}
                  title="Supprimer la note"
                  aria-label="Supprimer la note"
                  onClick={remove}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {note.conflict && (
              <div className={s.conflict} role="alert">
                <strong>Cette note a changé dans une autre fenêtre.</strong>
                <p>Votre brouillon est préservé ici. Choisissez comment le conserver.</p>
                <div>
                  <button onClick={copyDraft}>
                    <Copy size={13} />
                    Copier mon brouillon
                  </button>
                  <button onClick={saveCopy}>
                    Enregistrer une copie
                    <ArrowUpRight size={13} />
                  </button>
                  <button onClick={loadRemote}>Charger l’autre version</button>
                </div>
              </div>
            )}
            {note.error && !note.conflict && (
              <div className={s.warning} role="alert">
                <span>{note.error}</span>
                <button onClick={() => save(note.Id)}>Réessayer</button>
              </div>
            )}
            <input
              ref={titleInput}
              className={s.titleInput}
              value={note.Title}
              maxLength={120}
              onChange={(event) => editNote(note.Id, { Title: event.target.value })}
              placeholder="Sans titre"
              aria-label="Titre de la note"
            />
            <textarea
              ref={editor}
              className={s.editor}
              value={note.Body}
              onChange={(event) => editNote(note.Id, { Body: event.target.value })}
              placeholder="Une idée, un message, une pensée à garder…\n\nÉcrivez ici ou cliquez sur « Dicter ici »."
              aria-label="Contenu de la note"
              spellCheck
            />
            <footer className={s.footer}>
              <span>
                {wordCount(note.Body)} mots <i>·</i> {note.Body.length.toLocaleString('fr-FR')}{' '}
                caractères
              </span>
              <div>
                <button className={s.secondary} disabled={!note.Body} onClick={copyDraft}>
                  <Copy size={15} />
                  Copier
                </button>
                <button
                  className={`${s.primary} ${recording ? s.recording : ''}`}
                  disabled={status.state === 'processing' || Boolean(status.paused)}
                  onClick={dictate}
                >
                  {status.state === 'processing' ? (
                    <LoaderCircle size={16} className={s.spinner} />
                  ) : (
                    <Mic size={16} />
                  )}
                  {recording
                    ? 'Terminer la dictée'
                    : status.state === 'processing'
                      ? 'Traitement…'
                      : 'Dicter ici'}
                </button>
              </div>
            </footer>
          </div>
        ) : (
          <div className={s.emptyEditor}>
            <div className={s.emptyIllustration}>
              <StickyNote size={45} strokeWidth={1.1} />
              <span>
                <Mic size={19} />
              </span>
            </div>
            <span className={s.eyebrow}>DE LA VOIX À LA PAGE</span>
            <h2>Votre prochaine idée mérite une place.</h2>
            <p>
              Une note pour préparer un message, garder une pensée ou simplement trouver les bons
              mots.
            </p>
            <button className={s.primary} disabled={creating} onClick={() => create()}>
              <Plus size={16} />
              Créer ma première note
            </button>
            <small>Votre ancien brouillon, s’il existe, est importé automatiquement.</small>
          </div>
        )}
      </div>
      <Dialog.Root
        open={Boolean(versions)}
        onOpenChange={(open) => {
          if (!open) setVersions(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={s.backdrop} />
          <Dialog.Popup className={s.versionsDialog}>
            <div className={s.dialogHeader}>
              <div>
                <Dialog.Title>Versions précédentes</Dialog.Title>
                <Dialog.Description>
                  Retrouvez les états enregistrés de votre note. La restauration conserve une
                  version du texte actuel.
                </Dialog.Description>
              </div>
              <Dialog.Close className={s.iconButton} aria-label="Fermer les versions">
                <X size={18} />
              </Dialog.Close>
            </div>
            <div className={s.versionsList}>
              {versions?.items.length ? (
                versions.items.map((version) => (
                  <article key={version.Id}>
                    <div>
                      <span>{date(version.CreatedAt)}</span>
                      <button className={s.secondary} onClick={() => restore(version)}>
                        Restaurer
                      </button>
                    </div>
                    <h3>{version.Title || 'Sans titre'}</h3>
                    <p>{version.Body || 'Note vide'}</p>
                  </article>
                ))
              ) : (
                <div className={s.listEmpty}>
                  <History size={27} />
                  <p>Les versions apparaîtront au fil des modifications enregistrées.</p>
                </div>
              )}
            </div>
            <p className={s.versionsHint}>Les versions sont conservées sur cet ordinateur.</p>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
