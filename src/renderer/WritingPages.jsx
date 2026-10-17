import React, { useMemo, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Plus,
  Search,
  X,
  Copy,
  Download,
  Star,
  Trash2,
  WandSparkles,
  Sparkles,
  List,
  AlignLeft,
  FileText,
  Pencil,
  LoaderCircle,
  ChevronDown,
  Clock3,
  ChartNoAxesColumn,
} from 'lucide-react';
import { metrics, dayKey } from './metrics.cjs';
import w from './WritingPages.module.scss';
const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n || 0);
const words = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const date = (value) =>
  new Date(value).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const toneIcon = (id) => (id === 'bullets' ? List : id === 'prompt' ? FileText : Sparkles);
function Heading({ title, description, children }) {
  return (
    <header className={w.heading}>
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </header>
  );
}
function Notice({ children }) {
  return (
    <div className={w.empty}>
      <FileText size={27} strokeWidth={1.3} />
      <p>{children}</p>
    </div>
  );
}

export function TransformsPage({ snapshot, run, guide, seed, onNotice }) {
  const presets = snapshot.transforms || [];
  const [selected, setSelected] = useState('polish');
  const [input, setInput] = useState(() => seed || '');
  const [output, setOutput] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [modal, setModal] = useState(null);
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const current = presets.find((item) => String(item.Id) === String(selected)) || presets[0];
  const edit = (item) => {
    setName(item?.Name || '');
    setInstruction(item?.Instruction || '');
    setModal(item || {});
  };
  const apply = async () => {
    setWaiting(true);
    const result = await run('transform.run', { id: current?.Id, text: input });
    if (result?.text) setOutput(result.text);
    setWaiting(false);
  };
  const count = words(input),
    valid = count > 0 && count <= 1000 && input.length <= 18000;
  return (
    <>
      <Heading
        title="Vos mots, sous un autre angle."
        description="Peaufinez un brouillon, structurez un prompt ou créez votre propre consigne."
      >
        <button className={w.secondary} onClick={() => edit(null)}>
          <Plus size={15} />
          Créer une transformation
        </button>
      </Heading>
      {guide}
      <div className={w.presetGrid}>
        {presets.map((item) => {
          const Icon = toneIcon(item.Id);
          return (
            <div
              key={item.Id}
              className={`${w.preset} ${String(current?.Id) === String(item.Id) ? w.selected : ''}`}
            >
              <button
                onClick={() => {
                  setSelected(item.Id);
                  setOutput('');
                }}
              >
                <Icon size={22} strokeWidth={1.5} />
                <strong>{item.Name}</strong>
                <span>{item.Instruction}</span>
              </button>
              {typeof item.Id === 'number' ? (
                <div>
                  <button title="Modifier la transformation" onClick={() => edit(item)}>
                    <Pencil size={13} />
                  </button>
                  <button
                    title="Supprimer la transformation"
                    onClick={async () => {
                      if (confirm('Supprimer cette transformation ?')) {
                        await run('transform.delete', { id: item.Id });
                        setSelected('polish');
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ) : (
                <small>Inclus dans Voxen</small>
              )}
            </div>
          );
        })}
      </div>
      <section className={w.workbench}>
        <header>
          <div>
            <span className={w.label}>ATELIER D’ÉCRITURE</span>
            <h2>Essayez, comparez, puis choisissez.</h2>
          </div>
          <button
            className={w.textButton}
            disabled={waiting}
            onClick={() => {
              setInput(
                'Bonjour, est-ce que nous pouvons faire un point demain à dix heures sur le projet ? Je voudrais discuter du calendrier et des prochaines étapes.',
              );
              setOutput('');
            }}
          >
            Utiliser un exemple
            <ArrowUpRight size={13} />
          </button>
        </header>
        <div className={w.editors}>
          <label>
            <span>
              Votre texte <small>{fmt(count)} / 1 000 mots</small>
            </span>
            <textarea
              data-transform-input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setOutput('');
              }}
              maxLength={18001}
              placeholder="Collez un brouillon ou retrouvez un texte depuis votre historique…"
            />
          </label>
          <label>
            <span>
              Résultat <small>{output ? 'Aperçu prêt' : 'Votre original reste intact'}</small>
            </span>
            <textarea
              data-transform-output
              readOnly
              value={output}
              placeholder="Le résultat apparaîtra ici après votre demande."
            />
          </label>
        </div>
        <footer>
          <p>
            Le texte est envoyé à votre modèle OpenRouter uniquement quand vous lancez l’aperçu.
          </p>
          {waiting ? (
            <button className={w.secondary} onClick={() => run('transform.cancel')}>
              <X size={14} />
              Annuler
            </button>
          ) : (
            <button
              className={w.primary}
              data-transform-run
              disabled={
                !valid ||
                !snapshot.status?.openrouterConfigured ||
                snapshot.status?.state === 'recording' ||
                snapshot.status?.state === 'processing' ||
                snapshot.status?.transforming
              }
              onClick={apply}
            >
              <WandSparkles size={16} />
              Aperçu · {current?.Name || 'Peaufiner'}
            </button>
          )}
          {waiting && <LoaderCircle size={17} className={w.spinner} />}
        </footer>
        {!snapshot.status?.openrouterConfigured && (
          <p className={w.warning}>
            Connectez OpenRouter dans Paramètres → Connexions pour lancer une transformation.
          </p>
        )}
        {count > 1000 && <p className={w.warning}>Choisissez un extrait de 1 000 mots maximum.</p>}
        {output && (
          <div className={w.resultActions}>
            <button
              className={w.secondary}
              onClick={() => {
                setInput(output);
                setOutput('');
              }}
            >
              Utiliser comme nouveau brouillon
            </button>
            <button
              className={w.primary}
              onClick={() => run('text.copy', { text: output }, 'Résultat copié.')}
            >
              <Copy size={15} />
              Copier le résultat
            </button>
          </div>
        )}
      </section>
      <Dialog.Root
        open={Boolean(modal)}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={w.backdrop} />
          <Dialog.Popup className={w.modal}>
            <div className={w.modalHead}>
              <Dialog.Title>
                {modal?.Id ? 'Modifier la transformation' : 'Une consigne à votre façon'}
              </Dialog.Title>
              <Dialog.Close className={w.icon} aria-label="Fermer l’éditeur de transformation">
                <X size={19} />
              </Dialog.Close>
            </div>
            <Dialog.Description>
              Décrivez le résultat attendu. L’essai se fait ensuite dans l’atelier.
            </Dialog.Description>
            <form
              data-transform-form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await run('transform.save', {
                    id: modal?.Id || 0,
                    name: name.trim(),
                    instruction: instruction.trim(),
                  })
                ) {
                  setModal(null);
                  onNotice?.('Transformation enregistrée.');
                }
              }}
            >
              <label>
                Nom
                <input
                  aria-label="Nom de la transformation"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  required
                  placeholder="Ma reformulation professionnelle"
                />
              </label>
              <label>
                Consigne
                <textarea
                  aria-label="Consigne de transformation"
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  maxLength={3000}
                  required
                  rows={6}
                  placeholder="Rends le texte plus concis et chaleureux, en conservant toutes les informations."
                />
              </label>
              <footer>
                <Dialog.Close className={w.secondary} type="button">
                  Annuler
                </Dialog.Close>
                <button className={w.primary} disabled={!name.trim() || !instruction.trim()}>
                  Enregistrer
                </button>
              </footer>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

export function HistoryPage({ snapshot, run, guide, onTransform }) {
  const [query, setQuery] = useState(''),
    [application, setApplication] = useState(''),
    [period, setPeriod] = useState(0),
    [favorites, setFavorites] = useState(false),
    [limit, setLimit] = useState(20),
    [detail, setDetail] = useState(null);
  const history = snapshot.history || [];
  const filtered = useMemo(() => {
    const range = metrics(history, Number(period)).rows;
    return range.filter(
      (item) =>
        (!application || item.Application === application) &&
        (!favorites || item.Favorite) &&
        `${item.FinalText} ${item.RawText} ${item.Application}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    );
  }, [history, query, application, period, favorites]);
  const visible = filtered.slice(0, limit),
    groups = [];
  for (const row of visible) {
    const key = dayKey(row.CreatedAt);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = {
        key,
        label: new Date(row.CreatedAt).toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        }),
        rows: [],
      };
      groups.push(group);
    }
    group.rows.push(row);
  }
  const selected = history.find((row) => row.Id === detail);
  return (
    <>
      <Heading
        title="Retrouvez le fil de vos idées."
        description="Recherchez, comparez et gardez vos textes importants."
      >
        <button
          className={w.secondary}
          disabled={!filtered.length}
          onClick={() =>
            run('data.export', { kind: 'history', ids: filtered.map((row) => row.Id) })
          }
        >
          <Download size={15} />
          Exporter
        </button>
      </Heading>
      {guide}
      <div className={w.toolbar}>
        <div className={w.search}>
          <Search size={16} />
          <input
            aria-label="Rechercher dans l’historique"
            placeholder="Rechercher une dictée…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(20);
            }}
          />
        </div>
        <select
          aria-label="Filtrer par application"
          value={application}
          onChange={(e) => {
            setApplication(e.target.value);
            setLimit(20);
          }}
        >
          <option value="">Toutes les applications</option>
          {[...new Set(history.map((row) => row.Application))].sort().map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Période de l’historique"
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            setLimit(20);
          }}
        >
          <option value={0}>Tout l’historique</option>
          <option value={7}>7 derniers jours</option>
          <option value={30}>30 derniers jours</option>
        </select>
        <button
          className={`${w.filter} ${favorites ? w.filterActive : ''}`}
          aria-pressed={favorites}
          onClick={() => setFavorites(!favorites)}
        >
          <Star size={15} fill={favorites ? 'currentColor' : 'none'} />
          Favoris
        </button>
      </div>
      <div className={w.listMeta}>
        {fmt(filtered.length)} dictées{query && ' trouvées'}
      </div>
      {!filtered.length && (
        <Notice>
          {history.length
            ? 'Aucun résultat. Essayez un autre mot ou élargissez les filtres.'
            : 'Votre première dictée apparaîtra ici.'}
        </Notice>
      )}
      {groups.map((group) => (
        <section className={w.dayGroup} key={group.key}>
          <h2>{group.label}</h2>
          {group.rows.map((item) => (
            <article className={w.historyRow} key={item.Id}>
              <div className={w.rowHead}>
                <span>
                  <span className={w.appMark} />
                  {item.Application}
                  <i>·</i>
                  {new Date(item.CreatedAt).toLocaleTimeString('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <div>
                  <button
                    className={w.icon}
                    title={item.Favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                    aria-pressed={Boolean(item.Favorite)}
                    onClick={() =>
                      run('history.favorite', { id: item.Id, favorite: !item.Favorite })
                    }
                  >
                    <Star size={15} fill={item.Favorite ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    className={w.icon}
                    title="Copier cette dictée"
                    onClick={() => run('history.copy', { id: item.Id }, 'Texte copié.')}
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    className={w.icon}
                    title="Supprimer cette dictée"
                    onClick={() => {
                      if (confirm('Supprimer cette dictée ?'))
                        run('history.delete', { id: item.Id });
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <button className={w.historyText} onClick={() => setDetail(item.Id)}>
                {item.FinalText}
              </button>
              <footer>
                <span>
                  {fmt(item.WordCount)} mots · {Math.round(item.DurationSeconds || 0)} s
                </span>
                <button className={w.textButton} onClick={() => setDetail(item.Id)}>
                  Voir le détail
                  <ArrowUpRight size={12} />
                </button>
              </footer>
            </article>
          ))}
        </section>
      ))}
      {filtered.length > limit && (
        <button className={w.more} onClick={() => setLimit(limit + 20)}>
          Afficher 20 dictées de plus
          <ChevronDown size={14} />
        </button>
      )}
      <Dialog.Root
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={w.backdrop} />
          <Dialog.Popup className={`${w.modal} ${w.comparison}`}>
            <div className={w.modalHead}>
              <Dialog.Title>De la voix au texte final</Dialog.Title>
              <Dialog.Close className={w.icon} aria-label="Fermer le détail de dictée">
                <X size={19} />
              </Dialog.Close>
            </div>
            <Dialog.Description>
              {selected?.Application} · {selected && date(selected.CreatedAt)}
            </Dialog.Description>
            {selected && (
              <>
                <div className={w.compareGrid}>
                  <section>
                    <h3>Transcription originale</h3>
                    <p>{selected.RawText}</p>
                    <button
                      className={w.secondary}
                      onClick={() =>
                        run('history.copy', { id: selected.Id, raw: true }, 'Original copié.')
                      }
                    >
                      <Copy size={13} />
                      Copier l’original
                    </button>
                  </section>
                  <section>
                    <h3>Texte final</h3>
                    <p>{selected.FinalText}</p>
                    <button
                      className={w.secondary}
                      onClick={() => run('history.copy', { id: selected.Id }, 'Texte final copié.')}
                    >
                      <Copy size={13} />
                      Copier le résultat
                    </button>
                  </section>
                </div>
                <footer className={w.compareFoot}>
                  <span>{selected.Corrections || 0} raccourci(s) appliqué(s)</span>
                  <button
                    className={w.primary}
                    onClick={() => {
                      onTransform?.(selected.FinalText);
                      setDetail(null);
                    }}
                  >
                    <WandSparkles size={15} />
                    Ouvrir dans les transformations
                  </button>
                </footer>
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

export function InsightsPage({ snapshot, guide }) {
  const [days, setDays] = useState(7);
  const history = snapshot.history || [],
    result = useMemo(
      () => metrics(history, days, new Date(), snapshot.settings?.TypingSpeed),
      [history, days, snapshot.settings?.TypingSpeed],
    );
  const full = useMemo(() => metrics(history, 0), [history]);
  const chart = Array.from({ length: days || 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days || 30) + 1 + i);
    return { day: d, words: result.byDay[dayKey(d)] || 0 };
  });
  const max = Math.max(1, ...chart.map((d) => d.words));
  const heat = Array.from({ length: 84 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 83 + i);
    return { day: d, words: full.byDay[dayKey(d)] || 0 };
  });
  const heatMax = Math.max(1, ...heat.map((d) => d.words));
  return (
    <>
      <Heading
        title="Voyez ce que votre voix vous apporte."
        description="Votre activité réelle, calculée depuis l’historique local."
      >
        <div className={w.segment} role="group" aria-label="Période des statistiques">
          {[7, 30, 90].map((n) => (
            <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>
              {n} jours
            </button>
          ))}
        </div>
      </Heading>
      {guide}
      <div className={w.stats}>
        <div>
          <span>Mots dictés</span>
          <strong>{fmt(result.words)}</strong>
          <small>{fmt(result.rows.length)} dictées</small>
        </div>
        <div>
          <span>Temps gagné estimé</span>
          <strong>
            {Math.round(result.saved)}
            <small> min</small>
          </strong>
          <small>Comparé à {snapshot.settings?.TypingSpeed || 45} mots/min au clavier</small>
        </div>
        <div>
          <span>Votre rythme</span>
          <strong>
            {result.speed}
            <small> mots/min</small>
          </strong>
          <small>{Math.round(result.seconds / 60)} minutes de parole</small>
        </div>
      </div>
      <section className={w.chartCard}>
        <h2>Votre activité au fil des jours</h2>
        <p>Nombre de mots dictés, sur les {days} derniers jours.</p>
        <div
          className={`${w.bars} ${days > 30 ? w.denseBars : ''}`}
          aria-label="Mots dictés chaque jour"
        >
          {chart.map(({ day, words: total }, i) => (
            <div key={i} title={`${day.toLocaleDateString('fr-FR')} : ${fmt(total)} mots`}>
              <div>
                <span style={{ height: `${total ? Math.max(3, (total / max) * 100) : 1}%` }} />
              </div>
              {(days === 7 || i % Math.ceil(days / 7) === 0) && (
                <small>
                  {day.toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: days > 7 ? 'short' : undefined,
                    weekday: days === 7 ? 'short' : undefined,
                  })}
                </small>
              )}
            </div>
          ))}
        </div>
      </section>
      <div className={w.insightColumns}>
        <section className={w.chartCard}>
          <h2>Les applications qui vous écoutent</h2>
          <p>Répartition des mots sur la période choisie.</p>
          {result.apps.length ? (
            result.apps.slice(0, 6).map((item) => (
              <div className={w.appUsage} key={item.name}>
                <div>
                  <span>{item.name}</span>
                  <small>{fmt(item.words)} mots</small>
                </div>
                <div>
                  <span style={{ width: `${item.percent}%` }} />
                </div>
              </div>
            ))
          ) : (
            <Notice>Vos premières applications apparaîtront après quelques dictées.</Notice>
          )}
        </section>
        <section className={w.chartCard}>
          <h2>Un peu chaque jour</h2>
          <p>Vos 12 dernières semaines de dictée.</p>
          <div className={w.heatmap}>
            {heat.map(({ day, words: total }, i) => (
              <span
                key={i}
                title={`${day.toLocaleDateString('fr-FR')} : ${fmt(total)} mots`}
                style={{
                  background: total
                    ? `rgba(143,119,82,${0.22 + (0.78 * total) / heatMax})`
                    : '#f1eee7',
                }}
              />
            ))}
          </div>
          <div className={w.heatLegend}>
            <span>Moins</span>
            {[0, 0.2, 0.45, 0.7, 1].map((n) => (
              <i key={n} style={{ background: n ? `rgba(143,119,82,${n})` : '#f1eee7' }} />
            ))}
            <span>Plus</span>
          </div>
          <p className={w.footnote}>
            {fmt(result.corrections)} raccourci(s) appliqué(s) sur cette période. Les statistiques
            dépendent des textes conservés dans l’historique.
          </p>
        </section>
      </div>
    </>
  );
}
