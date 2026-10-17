import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import {
  ArrowRight,
  BookAudio,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  Download,
  FileText,
  FolderInput,
  Monitor,
  Pencil,
  Plus,
  Search,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import s from './LibraryPages.module.scss';

const MODES = ['Minimal', 'Naturel', 'Soigné'];
const TONES = { natural: 'Naturel', professional: 'Professionnel', casual: 'Décontracté' };
const EMPTY = [];
const fold = (value) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('fr');
const order = (items, key, sort) =>
  [...items].sort((a, b) =>
    sort === 'newest'
      ? Number(b.Id) - Number(a.Id)
      : String(a[key]).localeCompare(String(b[key]), 'fr', { sensitivity: 'base' }),
  );

function useActions(run, onNotice) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const act = async (action, payload, message) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setPending(true);
    setError('');
    try {
      const result = await run(action, payload);
      if (result === null) {
        setError('La modification n’a pas été enregistrée. Réessayez.');
        return null;
      }
      if (message) onNotice?.(message);
      return result;
    } catch {
      setError('Cette action n’a pas pu être effectuée. Réessayez.');
      return null;
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  };
  return { act, pending, error, setError };
}

function Modal({ open, onOpenChange, title, description, children, wide = false }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={s.backdrop} />
        <Dialog.Popup className={`${s.modal} ${wide ? s.wide : ''}`}>
          <div className={s.modalHeading}>
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && <Dialog.Description>{description}</Dialog.Description>}
            </div>
            <Dialog.Close className={s.iconButton} aria-label="Fermer">
              <X size={19} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function ErrorMessage({ children }) {
  return children ? (
    <p className={s.error} role="alert">
      {children}
    </p>
  ) : null;
}
function Empty({ icon: Icon = BookAudio, title, children, action }) {
  return (
    <div className={s.empty}>
      <span>
        <Icon size={25} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Header({ icon: Icon, eyebrow, title, description, children }) {
  return (
    <div className={s.heading}>
      <div>
        <span className={s.eyebrow}>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className={s.headingActions}>{children || <Icon size={28} strokeWidth={1.3} />}</div>
    </div>
  );
}
function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className={s.search}>
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          className={s.iconButton}
          aria-label="Effacer la recherche"
          onClick={() => onChange('')}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
function Sort({ value, onChange }) {
  return (
    <label className={s.sort}>
      <SlidersHorizontal size={15} />
      <select aria-label="Trier la liste" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="alphabetical">Ordre alphabétique</option>
        <option value="newest">Plus récents</option>
      </select>
      <ChevronDown size={13} />
    </label>
  );
}
function SelectionBar({ items, selected, setSelected, onDelete, pending }) {
  const all = items.length > 0 && items.every((item) => selected.includes(item.Id));
  return (
    <div className={s.selectionBar}>
      <label>
        <input
          type="checkbox"
          checked={all}
          onChange={(e) =>
            setSelected(
              e.target.checked
                ? [...new Set([...selected, ...items.map((item) => item.Id)])]
                : selected.filter((id) => !items.some((item) => item.Id === id)),
            )
          }
          aria-label="Sélectionner tous les résultats"
        />
        {selected.length
          ? `${selected.length} sélectionné${selected.length > 1 ? 's' : ''}`
          : `${items.length} résultat${items.length > 1 ? 's' : ''}`}
      </label>
      {selected.length > 0 && (
        <div>
          <button className={s.textButton} onClick={() => setSelected([])}>
            Désélectionner
          </button>
          <button className={s.dangerText} disabled={pending} onClick={onDelete}>
            <Trash2 size={14} />
            Supprimer
          </button>
        </div>
      )}
    </div>
  );
}
function DeleteDialog({ state, close, pending, error, onConfirm }) {
  return (
    <Modal
      open={!!state}
      onOpenChange={(open) => !open && !pending && close()}
      title={
        state?.ids.length > 1
          ? `Supprimer ces ${state.ids.length} éléments ?`
          : 'Supprimer cet élément ?'
      }
      description="Cette suppression est définitive. Vos autres éléments sont conservés."
    >
      <ErrorMessage>{error}</ErrorMessage>
      <div className={s.modalActions}>
        <button className={s.secondary} disabled={pending} onClick={close}>
          Annuler
        </button>
        <button className={s.danger} disabled={pending} onClick={onConfirm}>
          {pending ? 'Suppression…' : 'Supprimer'}
        </button>
      </div>
    </Modal>
  );
}

// Parsing local de formats simples ; aucune donnée n’est envoyée avant validation.
function csvRows(raw, delimiter) {
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (quoted || !cell.trim()) quoted = !quoted;
      else throw new Error('Guillemets CSV invalides.');
    } else if (!quoted && char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && raw[index + 1] === '\n') index++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('Un guillemet du fichier CSV n’est pas fermé.');
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}
function parseTerms(raw, format) {
  const clean = raw.replace(/^\uFEFF/, '');
  if (!clean.trim()) return [];
  if (format === 'json' || /^\s*[\[{]/.test(clean)) {
    const data = JSON.parse(clean);
    const list = Array.isArray(data) ? data : data.terms || data.dictionary || data.items;
    if (!Array.isArray(list)) throw new Error('Le JSON doit contenir une liste de mots.');
    return list.map((item) => {
      const value = typeof item === 'string' ? item : (item?.Term ?? item?.term ?? item?.word);
      if (typeof value !== 'string') throw new Error('Chaque élément JSON doit contenir un mot.');
      return value;
    });
  }
  if (format !== 'csv') return clean.split(/\r?\n/).filter((value) => value.trim());
  const firstLine = clean.split(/\r?\n/)[0];
  const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const rows = csvRows(clean, delimiter);
  if (!rows.length) return [];
  const header = rows[0].findIndex((value) =>
    /^(mot|mots|word|words|term|terms|terme|termes)$/i.test(value.trim()),
  );
  if (header >= 0) return rows.slice(1).map((row) => row[header] || '');
  if (rows.some((row) => row.length > 1))
    throw new Error('Utilisez un CSV à une colonne, ou une colonne nommée « mot » ou « term ».');
  return rows.map((row) => row[0]);
}

export function DictionaryPage({ snapshot, run, onNotice, guide }) {
  const dictionary = snapshot.dictionary || EMPTY;
  const { act, pending, error, setError } = useActions(run, onNotice);
  const [query, setQuery] = useState(''),
    [sort, setSort] = useState('alphabetical'),
    [selected, setSelected] = useState([]),
    [editor, setEditor] = useState(null),
    [term, setTerm] = useState(''),
    [deleting, setDeleting] = useState(null),
    [importOpen, setImportOpen] = useState(false),
    [importText, setImportText] = useState(''),
    [format, setFormat] = useState('txt'),
    [fileName, setFileName] = useState(''),
    [fileError, setFileError] = useState('');
  const fileRef = useRef(null);
  useEffect(() => {
    setSelected((ids) => ids.filter((id) => dictionary.some((item) => item.Id === id)));
  }, [dictionary]);
  const filtered = useMemo(
    () =>
      order(
        dictionary.filter((item) => fold(item.Term).includes(fold(query))),
        'Term',
        sort,
      ),
    [dictionary, query, sort],
  );
  const duplicate = dictionary.some(
    (item) => item.Id !== editor?.Id && fold(item.Term) === fold(term),
  );
  const preview = useMemo(() => {
    try {
      const terms = parseTerms(importText, format)
        .map((value) => value.trim())
        .filter(Boolean);
      if (terms.length > 3000)
        return {
          error: 'Importez au maximum 3 000 mots à la fois.',
          terms: [],
          duplicates: 0,
          invalid: [],
        };
      const known = new Set(dictionary.map((item) => fold(item.Term)));
      const unique = [];
      let duplicates = 0;
      const invalid = [];
      for (const value of terms) {
        if (value.length > 80 || /[\r\n\u0000-\u001f]/.test(value)) {
          invalid.push(value);
          continue;
        }
        if (known.has(fold(value))) duplicates++;
        else {
          known.add(fold(value));
          unique.push(value);
        }
      }
      return { terms: unique, duplicates, invalid, total: terms.length };
    } catch (exception) {
      return {
        error:
          exception instanceof SyntaxError
            ? 'Le fichier JSON n’est pas valide.'
            : exception.message,
        terms: [],
        duplicates: 0,
        invalid: [],
      };
    }
  }, [importText, format, dictionary]);
  const openEditor = (item) => {
    setEditor(item || { Id: 0 });
    setTerm(item?.Term || '');
    setError('');
  };
  const save = async (e) => {
    e?.preventDefault();
    if (!term.trim() || term.trim().length > 80 || duplicate) return;
    if (
      (await act(
        editor.Id ? 'dictionary.update' : 'dictionary.add',
        editor.Id ? { id: editor.Id, term: term.trim() } : { term: term.trim() },
        'Mot enregistré.',
      )) !== null
    )
      setEditor(null);
  };
  const readFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFileError('');
    if (file.size > 2 * 1024 * 1024) {
      setFileError('Choisissez un fichier de moins de 2 Mo.');
      return;
    }
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['txt', 'csv', 'json'].includes(extension)) {
      setFileError('Choisissez un fichier TXT, CSV ou JSON.');
      return;
    }
    try {
      setFormat(extension);
      setImportText(await file.text());
      setFileName(file.name);
    } catch {
      setFileError('Impossible de lire ce fichier.');
    }
  };
  const confirmDelete = async () => {
    const ids = deleting.ids;
    if (
      (await act(
        ids.length === 1 ? 'dictionary.delete' : 'dictionary.removeMany',
        ids.length === 1 ? { id: ids[0] } : { ids },
        'Suppression effectuée.',
      )) !== null
    ) {
      setDeleting(null);
      setSelected([]);
    }
  };
  return (
    <>
      <Header
        icon={BookAudio}
        eyebrow="VOTRE VOCABULAIRE"
        title="Vos mots. La bonne orthographe."
        description="Noms propres, marques, termes métier : une place pour les mots qui vous ressemblent."
      >
        <button
          className={s.secondary}
          onClick={async () => {
            const result = await act('data.export', { kind: 'dictionary' });
            if (result?.saved) onNotice?.('Dictionnaire exporté.');
          }}
          disabled={pending || !dictionary.length}
        >
          <Download size={15} />
          Exporter
        </button>
        <button className={s.primary} onClick={() => openEditor()}>
          <Plus size={16} />
          Ajouter un mot
        </button>
      </Header>
      {guide}
      <div className={s.infoCard}>
        <span className={s.infoIcon}>
          <BookAudio size={23} strokeWidth={1.5} />
        </span>
        <div>
          <strong>Votre vocabulaire suit votre voix.</strong>
          <p>
            Ces mots guident Deepgram pendant la transcription. Pour remplacer une expression par un
            texte précis, utilisez les Raccourcis.
          </p>
        </div>
      </div>
      <div className={s.toolbar}>
        <SearchBox value={query} onChange={setQuery} placeholder="Rechercher un mot" />
        <Sort value={sort} onChange={setSort} />
        <button
          className={s.secondary}
          onClick={() => {
            setImportOpen(true);
            setError('');
          }}
        >
          <Upload size={15} />
          Importer
        </button>
      </div>
      <SelectionBar
        items={filtered}
        selected={selected}
        setSelected={setSelected}
        pending={pending}
        onDelete={() => {
          setError('');
          setDeleting({ ids: selected });
        }}
      />
      <ErrorMessage>{!editor && !importOpen && !deleting && error}</ErrorMessage>
      {filtered.length ? (
        <div className={s.wordList}>
          {filtered.map((item) => (
            <div
              className={`${s.wordRow} ${selected.includes(item.Id) ? s.selectedRow : ''}`}
              key={item.Id}
            >
              <label className={s.selectItem}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.Id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked ? [...ids, item.Id] : ids.filter((id) => id !== item.Id),
                    )
                  }
                  aria-label={`Sélectionner ${item.Term}`}
                />
                <span>{item.Term}</span>
              </label>
              <div className={s.rowActions}>
                <button
                  className={s.iconButton}
                  title={`Modifier ${item.Term}`}
                  onClick={() => openEditor(item)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className={s.iconButton}
                  title={`Supprimer ${item.Term}`}
                  onClick={() => {
                    setError('');
                    setDeleting({ ids: [item.Id] });
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty title={query ? 'Aucun mot ne correspond.' : 'Un dictionnaire à votre image.'}>
          {query
            ? 'Essayez une autre orthographe ou effacez la recherche.'
            : 'Ajoutez votre premier nom propre, ou importez une liste de mots.'}
        </Empty>
      )}
      <p className={s.footnote}>
        <ShieldCheck size={13} />
        La liste est enregistrée sur cet ordinateur. Vos mots sont transmis à Deepgram uniquement
        lors d’une dictée.
      </p>
      <Modal
        open={!!editor}
        onOpenChange={(open) => !open && !pending && setEditor(null)}
        title={editor?.Id ? 'Modifier ce mot' : 'Un nouveau mot à vous'}
        description="Une orthographe précise pour votre prochaine dictée."
      >
        <form onSubmit={save}>
          <label className={s.field}>
            Mot ou expression
            <input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              maxLength={80}
              placeholder="Par exemple : Voxen"
            />
          </label>
          <div className={s.fieldMeta}>
            <span>
              {duplicate
                ? 'Ce mot est déjà dans votre dictionnaire.'
                : 'Les accents et les noms composés sont acceptés.'}
            </span>
            <span>{term.length}/80</span>
          </div>
          <ErrorMessage>{error}</ErrorMessage>
          <div className={s.modalActions}>
            <button
              className={s.secondary}
              type="button"
              disabled={pending}
              onClick={() => setEditor(null)}
            >
              Annuler
            </button>
            <button className={s.primary} disabled={pending || !term.trim() || duplicate}>
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={importOpen}
        onOpenChange={(open) => !open && !pending && setImportOpen(false)}
        wide
        title="Retrouvez tous vos mots."
        description="Prévisualisez votre liste avant de l’ajouter au dictionnaire."
      >
        <div className={s.importSource}>
          <input ref={fileRef} type="file" accept=".txt,.csv,.json" hidden onChange={readFile} />
          <button className={s.secondary} onClick={() => fileRef.current?.click()}>
            <FolderInput size={16} />
            Choisir un fichier
          </button>
          <span>{fileName || 'TXT · CSV à une colonne · JSON'}</span>
          <select
            aria-label="Format de la liste"
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
              setFileError('');
            }}
          >
            <option value="txt">Texte</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <label className={s.field}>
          Ou collez votre liste
          <textarea
            rows={6}
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setFileName('');
              setFileError('');
            }}
            placeholder={'Voxen\nClaude Code\nVotre nom de projet'}
            spellCheck={false}
          />
        </label>
        <ErrorMessage>{fileError || preview.error}</ErrorMessage>
        {importText.trim() && !preview.error && (
          <div className={s.importPreview}>
            <div className={s.previewStats}>
              <span>
                <CheckCheck size={16} />
                <strong>{preview.terms.length}</strong> nouveau
                {preview.terms.length > 1 ? 'x mots' : ' mot'}
              </span>
              <span>
                {preview.duplicates} doublon{preview.duplicates > 1 ? 's' : ''} ignoré
                {preview.duplicates > 1 ? 's' : ''}
              </span>
            </div>
            {preview.invalid.length > 0 && (
              <ErrorMessage>
                {preview.invalid.length} mot(s) invalide(s) : 80 caractères maximum et une seule
                ligne par mot. Corrigez la liste avant de continuer.
              </ErrorMessage>
            )}
            <div className={s.previewTerms}>
              {preview.terms.slice(0, 100).map((value) => (
                <span key={value}>{value}</span>
              ))}
            </div>
            {preview.terms.length > 100 && (
              <p className={s.hint}>
                Aperçu des 100 premiers mots, sur {preview.terms.length} à ajouter.
              </p>
            )}
          </div>
        )}
        <ErrorMessage>{error}</ErrorMessage>
        <div className={s.modalActions}>
          <button className={s.secondary} disabled={pending} onClick={() => setImportOpen(false)}>
            Annuler
          </button>
          <button
            className={s.primary}
            disabled={
              pending ||
              !!fileError ||
              !!preview.error ||
              !preview.terms.length ||
              !!preview.invalid.length
            }
            onClick={async () => {
              const result = await act('dictionary.import', { terms: preview.terms });
              if (result !== null) {
                onNotice?.(`${result.added ?? preview.terms.length} mot(s) ajouté(s).`);
                setImportOpen(false);
                setImportText('');
                setFileName('');
              }
            }}
          >
            {pending
              ? 'Importation…'
              : `Ajouter ${preview.terms.length} mot${preview.terms.length > 1 ? 's' : ''}`}
          </button>
        </div>
      </Modal>
      <DeleteDialog
        state={deleting}
        close={() => setDeleting(null)}
        pending={pending}
        error={error}
        onConfirm={confirmDelete}
      />
    </>
  );
}

export function SnippetsPage({ snapshot, run, onNotice, guide }) {
  const items = snapshot.replacements || EMPTY;
  const { act, pending, error, setError } = useActions(run, onNotice);
  const [query, setQuery] = useState(''),
    [sort, setSort] = useState('alphabetical'),
    [selected, setSelected] = useState([]),
    [editor, setEditor] = useState(null),
    [heard, setHeard] = useState(''),
    [expansion, setExpansion] = useState(''),
    [deleting, setDeleting] = useState(null),
    [preview, setPreview] = useState(null);
  useEffect(() => {
    setSelected((ids) => ids.filter((id) => items.some((item) => item.Id === id)));
  }, [items]);
  const filtered = useMemo(
    () =>
      order(
        items.filter((item) => fold(`${item.Heard} ${item.ReplaceWith}`).includes(fold(query))),
        'Heard',
        sort,
      ),
    [items, query, sort],
  );
  const duplicate = items.some(
    (item) => item.Id !== editor?.Id && fold(item.Heard) === fold(heard),
  );
  const edit = (item) => {
    setEditor(item || { Id: 0 });
    setHeard(item?.Heard || '');
    setExpansion(item?.ReplaceWith || '');
    setError('');
  };
  const save = async (event) => {
    event?.preventDefault();
    if (!heard.trim() || !expansion.trim() || duplicate) return;
    if (
      (await act(
        'replacement.save',
        { id: editor.Id || 0, heard: heard.trim(), replaceWith: expansion },
        'Raccourci enregistré.',
      )) !== null
    )
      setEditor(null);
  };
  const confirmDelete = async () => {
    const ids = deleting.ids;
    if (
      (await act(
        ids.length === 1 ? 'replacement.delete' : 'replacement.removeMany',
        ids.length === 1 ? { id: ids[0] } : { ids },
        'Suppression effectuée.',
      )) !== null
    ) {
      setDeleting(null);
      setSelected([]);
    }
  };
  return (
    <>
      <Header
        icon={Scissors}
        eyebrow="VOS EXPRESSIONS, EN UN MOT"
        title="Dites-le à votre façon."
        description="Une adresse, une signature, un message : gardez vos textes récurrents à portée de voix."
      >
        <button
          className={s.secondary}
          disabled={pending || !items.length}
          onClick={async () => {
            const result = await act('data.export', { kind: 'replacements' });
            if (result?.saved) onNotice?.('Raccourcis exportés.');
          }}
        >
          <Download size={15} />
          Exporter
        </button>
        <button className={s.primary} onClick={() => edit()}>
          <Plus size={16} />
          Créer un raccourci
        </button>
      </Header>
      {guide}
      <div className={s.snippetHero}>
        <div>
          <span className={s.pill}>
            <Scissors size={13} />
            UN PETIT RACCOURCI. UN GRAND GAIN DE TEMPS.
          </span>
          <h2>Votre voix connaît déjà la suite.</h2>
          <p>
            Enregistrez un déclencheur et le texte à écrire. Une expression répétée devient un geste
            tout simple.
          </p>
        </div>
        <div className={s.snippetDiagram}>
          <span>Votre déclencheur</span>
          <ArrowRight size={18} />
          <strong>Votre texte enregistré</strong>
        </div>
      </div>
      <div className={s.toolbar}>
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Rechercher un déclencheur ou un texte"
        />
        <Sort value={sort} onChange={setSort} />
      </div>
      <SelectionBar
        items={filtered}
        selected={selected}
        setSelected={setSelected}
        pending={pending}
        onDelete={() => {
          setError('');
          setDeleting({ ids: selected });
        }}
      />
      <ErrorMessage>{!editor && !deleting && error}</ErrorMessage>
      {filtered.length ? (
        <div className={s.snippetList}>
          {filtered.map((item) => (
            <article className={selected.includes(item.Id) ? s.selectedRow : ''} key={item.Id}>
              <div className={s.snippetTop}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.Id)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked ? [...ids, item.Id] : ids.filter((id) => id !== item.Id),
                      )
                    }
                    aria-label={`Sélectionner ${item.Heard}`}
                  />
                  <strong>{item.Heard}</strong>
                </label>
                <div className={s.rowActions}>
                  <button
                    className={s.iconButton}
                    title="Voir le texte complet"
                    onClick={() => {
                      setPreview(item);
                      setError('');
                    }}
                  >
                    <FileText size={15} />
                  </button>
                  <button
                    className={s.iconButton}
                    title="Copier le texte"
                    onClick={() => act('text.copy', { text: item.ReplaceWith }, 'Texte copié.')}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    className={s.iconButton}
                    title="Modifier le raccourci"
                    onClick={() => edit(item)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className={s.iconButton}
                    title="Supprimer le raccourci"
                    onClick={() => {
                      setError('');
                      setDeleting({ ids: [item.Id] });
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <button
                className={s.expansionPreview}
                onClick={() => {
                  setPreview(item);
                  setError('');
                }}
              >
                {item.ReplaceWith}
              </button>
              <div className={s.snippetMeta}>
                <span>{item.ReplaceWith.length} caractères</span>
                <button className={s.textButton} onClick={() => edit(item)}>
                  Modifier
                  <ArrowRight size={12} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={Scissors}
          title={
            query
              ? 'Aucun raccourci ne correspond.'
              : 'Une fois enregistré, plus besoin de le répéter.'
          }
        >
          {query
            ? 'Essayez un autre mot ou effacez votre recherche.'
            : 'Créez un premier raccourci avec une phrase déclencheuse facile à retenir.'}
        </Empty>
      )}
      <Modal
        open={!!editor}
        onOpenChange={(open) => !open && !pending && setEditor(null)}
        title={editor?.Id ? 'Modifier votre raccourci' : 'Quelques mots suffisent.'}
        description="Choisissez ce que vous dites et le texte que Voxen écrit à votre place."
        wide
      >
        <form
          onSubmit={save}
          onKeyDown={(event) => {
            if (event.ctrlKey && event.key === 'Enter') {
              event.preventDefault();
              save();
            }
          }}
        >
          <label className={s.field}>
            Quand je dis
            <input
              autoFocus
              maxLength={200}
              value={heard}
              onChange={(e) => setHeard(e.target.value)}
              placeholder="Par exemple : ma signature"
            />
          </label>
          <div className={s.fieldMeta}>
            <span>
              {duplicate
                ? 'Ce déclencheur est déjà utilisé.'
                : 'Une expression courte et facile à retenir.'}
            </span>
            <span>{heard.length}/200</span>
          </div>
          <label className={s.field}>
            Écrire à la place
            <textarea
              rows={10}
              maxLength={2000}
              value={expansion}
              onChange={(e) => setExpansion(e.target.value)}
              placeholder="Votre texte, avec ses retours à la ligne…"
            />
          </label>
          <div className={s.fieldMeta}>
            <span>Vérifiez le texte avant d’enregistrer.</span>
            <span>{expansion.length}/2 000</span>
          </div>
          <ErrorMessage>{error}</ErrorMessage>
          <div className={s.modalActions}>
            <span className={s.keyboardHint}>
              <kbd>Ctrl</kbd> + <kbd>Entrée</kbd> pour enregistrer
            </span>
            <button
              type="button"
              className={s.secondary}
              disabled={pending}
              onClick={() => setEditor(null)}
            >
              Annuler
            </button>
            <button
              className={s.primary}
              disabled={pending || !heard.trim() || !expansion.trim() || duplicate}
            >
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!preview}
        onOpenChange={(open) => !open && setPreview(null)}
        title={preview?.Heard || 'Votre raccourci'}
        description="Le texte enregistré pour ce déclencheur."
      >
        <div className={s.fullPreview}>{preview?.ReplaceWith}</div>
        <ErrorMessage>{error}</ErrorMessage>
        <div className={s.modalActions}>
          <button
            className={s.secondary}
            onClick={() => {
              const item = preview;
              setPreview(null);
              edit(item);
            }}
          >
            <Pencil size={14} />
            Modifier
          </button>
          <button
            className={s.primary}
            onClick={() => act('text.copy', { text: preview?.ReplaceWith || '' }, 'Texte copié.')}
            disabled={pending}
          >
            <Copy size={14} />
            Copier le texte
          </button>
        </div>
      </Modal>
      <DeleteDialog
        state={deleting}
        close={() => setDeleting(null)}
        pending={pending}
        error={error}
        onConfirm={confirmDelete}
      />
    </>
  );
}

export function AppStylesSection({ snapshot, run, onNotice }) {
  const items = snapshot.styleProfiles || EMPTY;
  const { act, pending, error, setError } = useActions(run, onNotice);
  const [editor, setEditor] = useState(null),
    [application, setApplication] = useState(''),
    [mode, setMode] = useState(1),
    [tone, setTone] = useState('natural'),
    [deleting, setDeleting] = useState(null);
  const suggestions = [
    ...new Set(
      (snapshot.history || [])
        .map((item) => String(item.Application || '').trim())
        .filter((value) => /^[\p{L}\p{N}_. -]{1,76}(?:\.exe)?$/u.test(value))
        .map((value) => (/\.exe$/i.test(value) ? value : `${value}.exe`)),
    ),
  ].sort((a, b) => a.localeCompare(b, 'fr'));
  const validApplication = /^[\p{L}\p{N}_. -]{1,76}\.exe$/iu.test(application.trim());
  const duplicate = items.some(
    (item) => item.Id !== editor?.Id && fold(item.Application) === fold(application),
  );
  const edit = (item) => {
    setEditor(item || { Id: 0 });
    setApplication(item?.Application || '');
    setMode(Number(item?.CleanupMode ?? 1));
    setTone(item?.Tone || 'natural');
    setError('');
  };
  const save = async (event) => {
    event.preventDefault();
    if (!validApplication || duplicate) return;
    if (
      (await act(
        'style.save',
        { id: editor?.Id || 0, application: application.trim(), mode, tone },
        'Style d’application enregistré.',
      )) !== null
    )
      setEditor(null);
  };
  return (
    <section className={s.stylesSection}>
      <div className={s.sectionHeading}>
        <div>
          <span className={s.eyebrow}>LE BON TON, AU BON ENDROIT</span>
          <h2>Un style pour chaque application.</h2>
          <p>Associez une application Windows à un niveau de nettoyage et à un ton.</p>
        </div>
        <button className={s.secondary} onClick={() => edit()}>
          <Plus size={15} />
          Ajouter une règle
        </button>
      </div>
      {items.length ? (
        <div className={s.appRules}>
          {items.map((item) => (
            <div className={s.appRule} key={item.Id}>
              <span className={s.appIcon}>
                <Monitor size={20} strokeWidth={1.5} />
              </span>
              <div>
                <strong>{item.Application}</strong>
                <span>
                  {MODES[Number(item.CleanupMode)] || 'Naturel'}
                  <i>·</i>
                  {TONES[item.Tone] || TONES.natural}
                </span>
              </div>
              <div className={s.rowActions}>
                <button
                  className={s.iconButton}
                  title={`Modifier le style de ${item.Application}`}
                  onClick={() => edit(item)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className={s.iconButton}
                  title={`Supprimer le style de ${item.Application}`}
                  onClick={() => {
                    setDeleting({ ids: [item.Id] });
                    setError('');
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={s.noRules}>
          <Monitor size={24} strokeWidth={1.4} />
          <div>
            <strong>Votre style général s’applique partout.</strong>
            <p>Ajoutez une règle pour adapter vos prochaines dictées à une application.</p>
          </div>
        </div>
      )}
      <p className={s.footnote}>
        <ShieldCheck size={13} />
        Voxen utilise le nom du processus actif. Le texte de vos fenêtres et votre écran ne sont pas
        lus.
      </p>
      {snapshot.settings?.CleanupEnabled === false && (
        <p className={s.hint}>
          Activez la reformulation pour appliquer ces règles au texte transcrit.
        </p>
      )}
      <ErrorMessage>{!editor && !deleting && error}</ErrorMessage>
      <Modal
        open={!!editor}
        onOpenChange={(open) => !open && !pending && setEditor(null)}
        title={
          editor?.Id ? 'Le bon style pour cette application.' : 'À chaque application, son ton.'
        }
        description="Cette règle sera choisie d’après le processus actif au début de la dictée."
      >
        <form onSubmit={save}>
          <label className={s.field}>
            Application Windows
            <input
              autoFocus
              list="voxen-known-processes"
              maxLength={80}
              value={application}
              onChange={(e) => setApplication(e.target.value)}
              placeholder="Par exemple : chrome.exe"
              spellCheck={false}
            />
            <datalist id="voxen-known-processes">
              {suggestions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </label>
          <p className={s.hint}>
            {duplicate
              ? 'Une règle existe déjà pour cette application.'
              : 'Saisissez le nom du processus, par exemple outlook.exe. Une adresse web n’est pas un nom d’application.'}
          </p>
          <div className={s.twoColumns}>
            <label className={s.field}>
              Nettoyage
              <select value={mode} onChange={(e) => setMode(Number(e.target.value))}>
                {MODES.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.field}>
              Ton
              <select value={tone} onChange={(e) => setTone(e.target.value)}>
                {Object.entries(TONES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={s.styleSummary}>
            <Check size={15} />
            <span>
              {MODES[mode]} et {TONES[tone].toLowerCase()} pour{' '}
              <strong>{application.trim() || 'cette application'}</strong>.
            </span>
          </div>
          <ErrorMessage>{error}</ErrorMessage>
          <div className={s.modalActions}>
            <button
              type="button"
              className={s.secondary}
              disabled={pending}
              onClick={() => setEditor(null)}
            >
              Annuler
            </button>
            <button className={s.primary} disabled={pending || !validApplication || duplicate}>
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </Modal>
      <DeleteDialog
        state={deleting}
        close={() => setDeleting(null)}
        pending={pending}
        error={error}
        onConfirm={async () => {
          if ((await act('style.delete', { id: deleting.ids[0] }, 'Règle supprimée.')) !== null)
            setDeleting(null);
        }}
      />
    </section>
  );
}
