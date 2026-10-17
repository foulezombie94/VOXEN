import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { AnimatePresence, motion } from 'motion/react';
import {
  AudioLines,
  Mic,
  Disc2,
  ChartNoAxesColumn,
  BookAudio,
  Scissors,
  CaseSensitive,
  WandSparkles,
  StickyNote,
  Settings,
  CircleHelp,
  PanelLeft,
  UserCircle,
  Bell,
  Minus,
  Square,
  X,
  ChevronDown,
  ChevronRight,
  Check,
  Plus,
  Search,
  Copy,
  Trash2,
  ArrowUpRight,
  ArrowRight,
  LoaderCircle,
  Languages,
  ShieldCheck,
  Keyboard,
  Pause,
  Play,
  CheckCircle2,
} from 'lucide-react';
import s from './App.module.scss';
import { GuideBanner, GuideCard, TutorialDialog, useTutorials } from './Tutorials';
import SettingsDialog from './SettingsDialog';
import AccountMenu from './AccountMenu';
import { DictionaryPage, SnippetsPage, AppStylesSection } from './LibraryPages';
import { TransformsPage, HistoryPage, InsightsPage } from './WritingPages';
import NotesPage from './NotesPage';

const LANGUAGES = [
  { code: 'fr', name: 'Français', native: 'Français' },
  { code: 'en', name: 'Anglais', native: 'English' },
  { code: 'de', name: 'Allemand', native: 'Deutsch' },
  { code: 'es', name: 'Espagnol', native: 'Español' },
  { code: 'it', name: 'Italien', native: 'Italiano' },
];
const NAV = [
  { id: 'dictation', label: 'Dictée', icon: Mic },
  { id: 'notetaker', label: 'Notetaker', icon: Disc2, disabled: true },
  { id: 'insights', label: 'Statistiques', icon: ChartNoAxesColumn },
  { id: 'dictionary', label: 'Dictionnaire', icon: BookAudio },
  { id: 'replacements', label: 'Raccourcis', icon: Scissors },
  { id: 'style', label: 'Style', icon: CaseSensitive },
  { id: 'rewrite', label: 'Transformations', icon: WandSparkles },
  { id: 'scratchpad', label: 'Bloc-notes', icon: StickyNote },
];
const initial = {
  settings: {},
  history: [],
  dictionary: [],
  replacements: [],
  notes: [],
  styleProfiles: [],
  transforms: [],
  status: { state: 'ready', shortcut: 'Ctrl+V', levels: [] },
  versions: {},
};
const dateLabel = (value) =>
  new Date(value).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const count = (value) => new Intl.NumberFormat('fr-FR').format(value || 0);

function Empty({ icon: Icon = Mic, title, children }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>
        <Icon size={23} strokeWidth={1.5} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Toggle({ checked, onChange, label, detail }) {
  return (
    <label className={s.settingRow}>
      <span>
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <input
        className={s.toggle}
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function Section({ title, description, children }) {
  return (
    <section className={s.section}>
      <div className={s.sectionHeading}>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState(initial);
  const floating = new URLSearchParams(location.search).get('view') === 'scratchpad';
  const [page, setPage] = useState(floating ? 'scratchpad' : 'dictation');
  const [transformSeed, setTransformSeed] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general');
  const preferencesRef = useRef({});
  const guides = useTutorials(page);
  const [collapsed, setCollapsed] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [languageOpen, setLanguageOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState('');
  const [languageChoice, setLanguageChoice] = useState('fr');
  const [helpOpen, setHelpOpen] = useState(false);
  const [settings, setSettings] = useState({});
  const [term, setTerm] = useState('');
  const [heard, setHeard] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [scratchpad, setScratchpad] = useState(
    () => localStorage.getItem('voxen.scratchpad') || '',
  );
  preferencesRef.current = settings;
  const settingsDirty = useRef(false);
  const initialSettings = useRef(false);
  const status = snapshot.status || initial.status;
  const history = snapshot.history || [];
  const dictionary = snapshot.dictionary || [];
  const replacements = snapshot.replacements || [];
  useEffect(() => {
    const update = (next) => {
      setSnapshot({ ...initial, ...next });
      if (!settingsDirty.current || !initialSettings.current) {
        setSettings(next.settings || {});
        initialSettings.current = true;
      }
    };
    window.voxen
      .getSnapshot()
      .then(update)
      .catch(() => setNotice('Impossible de joindre le moteur Voxen.'));
    return window.voxen.onSnapshot(update);
  }, []);
  useEffect(
    () =>
      window.voxen.onNavigate?.((id) => {
        void navigate(id);
      }),
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const run = async (action, payload, success = '') => {
    if (action === 'window.close' && window.voxenFlushNotes && !(await window.voxenFlushNotes()))
      return null;
    setBusy(action);
    try {
      const result = await window.voxen.call(action, payload);
      if (success) setNotice(success);
      return result;
    } catch {
      setNotice('L’opération n’a pas abouti. Réessayez ou vérifiez les paramètres.');
      return null;
    } finally {
      setBusy('');
    }
  };
  const change = (key, value) => {
    settingsDirty.current = true;
    setSettings((previous) => ({ ...previous, [key]: value }));
  };
  const saveSettings = async (values) => {
    const result = await run('settings.save', values || settings, 'Paramètres enregistrés.');
    if (result !== null) settingsDirty.current = false;
    return result;
  };
  const navigate = async (id) => {
    if (window.voxenFlushNotes && !(await window.voxenFlushNotes())) return;
    guides.close();
    if (id === 'settings' || id === 'account') {
      setSettingsTab(id === 'account' ? 'profile' : 'general');
      setSettingsOpen(true);
      return;
    }
    setSettingsOpen(false);
    setPage(id);
    setQuery('');
  };
  const savePreference = async (key, value) => {
    const next = { ...preferencesRef.current, [key]: value };
    preferencesRef.current = next;
    settingsDirty.current = true;
    setSettings(next);
    return saveSettings(next);
  };
  const stats = useMemo(() => {
    const words = history.reduce((total, item) => total + Number(item.WordCount || 0), 0);
    const seconds = history.reduce((total, item) => total + Number(item.DurationSeconds || 0), 0);
    const saved = Math.max(0, words / Number(settings.TypingSpeed || 45) - seconds / 60);
    return { words, seconds, saved, speed: seconds ? Math.round((words / seconds) * 60) : 0 };
  }, [history, settings.TypingSpeed]);
  const selectedLanguage =
    LANGUAGES.find((item) => item.code === settings.Language) || LANGUAGES[0];
  const stateLabel = status.paused
    ? 'En pause'
    : {
        ready: 'Prêt à vous écouter',
        recording: 'À votre écoute',
        processing: 'Reformulation en cours',
        error: 'Vérification nécessaire',
      }[status.state] || 'Prêt à vous écouter';
  const saveButton = (
    <div className={s.saveBar}>
      <span>Vos préférences s’appliquent aux prochaines dictées.</span>
      <button
        className={s.primary}
        onClick={() => saveSettings()}
        disabled={busy === 'settings.save'}
      >
        {busy === 'settings.save' && <LoaderCircle size={15} className={s.spinner} />}Enregistrer
      </button>
    </div>
  );
  function historyCard(item) {
    return (
      <article className={s.historyCard} key={item.Id}>
        <div className={s.historyMeta}>
          <span>
            <span className={s.appDot} />
            {item.Application || 'Dictée'}
            <i>·</i>
            {dateLabel(item.CreatedAt)}
          </span>
          <div>
            <button
              className={s.iconButton}
              title="Copier le texte"
              onClick={() => run('history.copy', { id: item.Id }, 'Texte copié.')}
            >
              <Copy size={16} />
            </button>
            <button
              className={s.iconButton}
              title="Supprimer cette dictée"
              onClick={() => {
                if (confirm('Supprimer cette dictée ?')) run('history.delete', { id: item.Id });
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        <p>{item.FinalText}</p>
        <div className={s.historyFoot}>
          <span>{count(item.WordCount)} mots</span>
          <span>{Math.round(item.DurationSeconds || 0)} s</span>
          {item.RawText !== item.FinalText && (
            <details>
              <summary>Transcription originale</summary>
              <p>{item.RawText}</p>
            </details>
          )}
        </div>
      </article>
    );
  }
  function content() {
    if (page === 'dictation')
      return (
        <>
          <div className={s.pageHeading}>
            <div>
              <span className={s.eyebrow}>VOTRE ESPACE VOCAL</span>
              <h1>
                {settings.FirstName
                  ? `Bonjour ${settings.FirstName}.`
                  : 'Les idées viennent en parlant.'}
              </h1>
              <p>Vous parlez. Vos mots prennent leur place.</p>
            </div>
            <button className={s.secondary} onClick={() => navigate('settings')}>
              <Languages size={17} />
              {selectedLanguage.name}
              <ChevronDown size={14} />
            </button>
          </div>
          <div className={s.dictationHero}>
            <div className={s.heroCopy}>
              <span
                className={`${s.liveStatus} ${status.state === 'recording' ? s.recording : ''}`}
              >
                <span />
                {stateLabel}
              </span>
              <h2>
                Moins de clavier.
                <br />
                Plus de vous.
              </h2>
              <p>
                Cliquez dans votre application, appuyez sur <kbd>{status.shortcut || 'Ctrl+V'}</kbd>{' '}
                et parlez naturellement. {settings.SilenceSeconds || 2} secondes de silence
                suffisent pour terminer.
              </p>
              <button
                className={s.primary}
                disabled={status.state === 'processing'}
                onClick={() => run('dictation.toggle')}
              >
                <Mic size={17} />
                {status.state === 'recording' ? 'Terminer la dictée' : 'Commencer une dictée'}
                <span className={s.buttonShortcut}>{status.shortcut || 'Ctrl+V'}</span>
              </button>
            </div>
            <div className={s.heroVisual} aria-hidden="true">
              <div className={s.voiceOrb}>
                <AudioLines size={48} strokeWidth={1.2} />
              </div>
              <div className={s.visualCapsule}>
                <X size={13} />
                <div>
                  {[5, 10, 16, 22, 12, 18, 9, 15, 22, 14, 8, 4].map((height, i) => (
                    <span
                      key={i}
                      style={{
                        height:
                          status.state === 'recording'
                            ? `${4 + Math.min(1, Number(status.levels?.[i] || 0)) * 20}px`
                            : `${height}px`,
                      }}
                    />
                  ))}
                </div>
                <Check size={14} />
              </div>
              <span>Votre voix, votre rythme.</span>
            </div>
          </div>
          {!status.deepgramConfigured && (
            <div className={s.setupBanner}>
              <ShieldCheck size={22} />
              <div>
                <strong>Une dernière étape avant votre première dictée</strong>
                <p>Ajoutez votre clé Deepgram pour activer la transcription.</p>
              </div>
              <button className={s.secondary} onClick={() => navigate('settings')}>
                Configurer
                <ArrowRight size={16} />
              </button>
            </div>
          )}
          <div className={s.statsGrid}>
            <div>
              <span>Mots dictés</span>
              <strong>{count(stats.words)}</strong>
            </div>
            <div>
              <span>Temps gagné estimé</span>
              <strong>
                {Math.round(stats.saved)}
                <small> min</small>
              </strong>
            </div>
            <div>
              <span>Votre rythme</span>
              <strong>
                {stats.speed}
                <small> mots/min</small>
              </strong>
            </div>
          </div>
          <div className={s.listHeading}>
            <h2>Vos dernières dictées</h2>
            <button className={s.textButton} onClick={() => navigate('history')}>
              Tout voir ({count(history.length)})<ArrowRight size={14} />
            </button>
          </div>
          {history.length ? (
            history.slice(0, 8).map(historyCard)
          ) : (
            <Empty title="Votre première idée vous attend">
              Vos dictées apparaîtront ici. L’historique est conservé sur cet ordinateur.
            </Empty>
          )}
        </>
      );

    if (page === 'style')
      return (
        <>
          <div className={s.pageHeading}>
            <div>
              <h1>Votre voix, votre style.</h1>
              <p>Choisissez la façon dont Voxen peaufine vos mots.</p>
            </div>
            <CaseSensitive size={28} strokeWidth={1.3} />
          </div>
          <div className={s.styleGrid}>
            {[
              {
                title: 'Minimal',
                text: 'Ponctuation et hésitations. Au plus près de vos mots.',
                icon: Mic,
              },
              {
                title: 'Naturel',
                text: 'Une reformulation légère, fluide et fidèle à vos idées.',
                icon: AudioLines,
              },
              {
                title: 'Soigné',
                text: 'Une structure plus soignée, sans résumé ni ajout de faits.',
                icon: WandSparkles,
              },
            ].map((mode, index) => (
              <button
                key={mode.title}
                className={`${s.styleCard} ${Number(settings.CleanupMode ?? 1) === index ? s.selectedStyle : ''}`}
                onClick={() => change('CleanupMode', index)}
              >
                <div>
                  <mode.icon size={24} strokeWidth={1.4} />
                  {Number(settings.CleanupMode ?? 1) === index && <CheckCircle2 size={18} />}
                </div>
                <h3>{mode.title}</h3>
                <p>{mode.text}</p>
              </button>
            ))}
          </div>
          <Section title="Reformulation">
            <Toggle
              label="Peaufiner le texte après transcription"
              detail="Le texte transcrit est envoyé au modèle OpenRouter configuré."
              checked={settings.CleanupEnabled}
              onChange={(value) => change('CleanupEnabled', value)}
            />
          </Section>
          {saveButton}
          <AppStylesSection snapshot={snapshot} run={run} onNotice={setNotice} />
        </>
      );

    return null;
  }
  const languageDialog = (
    <Dialog.Root open={languageOpen} onOpenChange={setLanguageOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={s.modalBackdrop} />
        <Dialog.Popup className={s.languageModal}>
          <div className={s.modalHeading}>
            <div>
              <Dialog.Title>Langues</Dialog.Title>
              <Dialog.Description>
                Sélectionnez la langue que vous utilisez avec Voxen.
              </Dialog.Description>
            </div>
            <Dialog.Close className={s.iconButton} aria-label="Fermer">
              <X size={20} />
            </Dialog.Close>
          </div>
          <div className={s.languageBody}>
            <div>
              <div className={s.searchBox}>
                <Search size={17} />
                <input
                  placeholder="Rechercher une langue"
                  value={languageSearch}
                  onChange={(e) => setLanguageSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className={s.languageGrid}>
                {LANGUAGES.filter((item) =>
                  `${item.name} ${item.native}`
                    .toLowerCase()
                    .includes(languageSearch.toLowerCase()),
                ).map((item) => (
                  <button
                    key={item.code}
                    className={languageChoice === item.code ? s.selectedLanguage : ''}
                    onClick={() => setLanguageChoice(item.code)}
                  >
                    <strong>{item.name}</strong>
                    <span>{item.native}</span>
                    {languageChoice === item.code && <Check size={14} />}
                  </button>
                ))}
              </div>
            </div>
            <aside>
              <h3>Sélectionnée</h3>
              <p>
                {LANGUAGES.find((item) => item.code === languageChoice)?.name}
                <Check size={14} />
              </p>
              <small>
                Une langue à la fois.
                <br />
                La détection automatique n’est pas activée.
              </small>
            </aside>
          </div>
          <div className={s.modalActions}>
            <button
              className={s.primary}
              onClick={async () => {
                const next = { ...settings, Language: languageChoice };
                setSettings(next);
                if ((await saveSettings(next)) !== null) setLanguageOpen(false);
              }}
            >
              Enregistrer et fermer
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
  const guide = floating ? null : <GuideBanner page={page} guides={guides} />;
  const common = { snapshot, run, guide, onNotice: setNotice };
  const enhanced =
    page === 'dictionary' ? (
      <DictionaryPage {...common} />
    ) : page === 'replacements' ? (
      <SnippetsPage {...common} />
    ) : page === 'rewrite' ? (
      <TransformsPage {...common} seed={transformSeed} key={transformSeed} />
    ) : page === 'history' ? (
      <HistoryPage
        {...common}
        onTransform={(text) => {
          setTransformSeed(text);
          void navigate('rewrite');
        }}
      />
    ) : page === 'insights' ? (
      <InsightsPage {...common} />
    ) : page === 'scratchpad' ? (
      <NotesPage {...common} status={status} floating={floating} />
    ) : null;
  const pageParts = React.Children.toArray(enhanced ? null : content()?.props.children);
  return (
    <div className={`${s.app} ${collapsed ? s.collapsed : ''} ${floating ? s.floatingApp : ''}`}>
      <aside className={s.sidebar}>
        <div className={s.sidebarTools}>
          <button
            className={s.iconButton}
            title={collapsed ? 'Développer la navigation' : 'Réduire la navigation'}
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeft size={18} />
          </button>
          {!collapsed && (
            <AccountMenu
              cloud={snapshot.cloud}
              firstName={settings.FirstName}
              navigate={navigate}
              className={s.iconButton}
              iconClassName={s.profileIcon}
            />
          )}
        </div>
        <button className={s.brand} onClick={() => navigate('dictation')} title="Voxen">
          <AudioLines size={26} strokeWidth={2.3} />
          {!collapsed && <span>Voxen</span>}
        </button>
        <nav className={s.navigation} aria-label="Navigation principale">
          {NAV.map((item) => (
            <button
              key={item.id}
              title={
                item.disabled
                  ? 'Prise de notes de réunion : non disponible'
                  : collapsed
                    ? item.label
                    : undefined
              }
              disabled={item.disabled}
              aria-current={
                page === item.id || (item.id === 'dictation' && page === 'history')
                  ? 'page'
                  : undefined
              }
              onClick={() => navigate(item.id)}
            >
              <item.icon size={20} strokeWidth={1.8} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        {!collapsed && <GuideCard guides={guides} />}
        <div className={s.sidebarBottom}>
          <button
            title={status.paused ? 'Reprendre la dictée' : 'Mettre en pause'}
            onClick={() => run('dictation.pause')}
          >
            {status.paused ? <Play size={19} /> : <Pause size={19} />}
            {!collapsed && <span>{status.paused ? 'Reprendre la dictée' : 'Mettre en pause'}</span>}
          </button>
          <button
            aria-current={settingsOpen ? 'page' : undefined}
            title="Paramètres"
            onClick={() => navigate('settings')}
          >
            <Settings size={20} strokeWidth={1.8} />
            {!collapsed && (
              <>
                <span>Paramètres</span>
                {!status.deepgramConfigured && <span className={s.alertDot}>1</span>}
              </>
            )}
          </button>
          <button title="Aide" onClick={() => setHelpOpen(true)}>
            <CircleHelp size={20} strokeWidth={1.8} />
            {!collapsed && <span>Aide</span>}
          </button>
        </div>
      </aside>
      <div className={s.mainArea}>
        <header className={s.titlebar}>
          <div className={s.breadcrumb}>
            {page === 'settings'
              ? 'Paramètres'
              : page === 'history'
                ? 'Dictée · Historique'
                : NAV.find((item) => item.id === page)?.label}
          </div>
          <div className={s.windowButtons}>
            <button title="Réduire" onClick={() => run('window.minimize')}>
              <Minus size={15} />
            </button>
            <button title="Agrandir" onClick={() => run('window.toggleMaximize')}>
              <Square size={12} />
            </button>
            <button
              title="Fermer la fenêtre"
              className={s.closeWindow}
              onClick={() => run('window.close')}
            >
              <X size={17} />
            </button>
          </div>
        </header>
        <main className={s.content}>
          <div className={s.contentInner} key={page}>
            {status.state === 'error' && status.lastFinalText && (
              <div className={s.setupBanner}>
                <div>
                  <strong>Votre texte est prêt à récupérer.</strong>
                  <p>{status.message}</p>
                </div>
                <button
                  className={s.secondary}
                  onClick={() => run('dictation.copyLast', {}, 'Texte copié.')}
                >
                  <Copy size={14} />
                  Copier le texte
                </button>
              </div>
            )}
            {enhanced || (
              <>
                {pageParts[0]}
                {guide}
                {pageParts.slice(1)}
              </>
            )}
          </div>
        </main>
      </div>
      <AnimatePresence>
        {notice && (
          <motion.div
            className={s.toast}
            role="status"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <CheckCircle2 size={17} />
            <span>{notice}</span>
            <button
              className={s.iconButton}
              onClick={() => setNotice('')}
              aria-label="Fermer le message"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <SettingsDialog
        open={settingsOpen}
        initialTab={settingsTab}
        onOpenChange={setSettingsOpen}
        settings={settings}
        status={status}
        cloud={snapshot.cloud}
        versions={snapshot.versions}
        busy={busy}
        savePreference={savePreference}
        saveSettings={saveSettings}
        run={run}
        languageDialog={languageDialog}
        guides={guides}
        onLanguage={() => {
          setLanguageChoice(settings.Language || 'fr');
          setLanguageSearch('');
          setLanguageOpen(true);
        }}
        credentials={
          <>
            <Credential
              provider="deepgram"
              title="Deepgram"
              subtitle="Transcription · Nova-3"
              configured={status.deepgramConfigured}
              run={run}
              busy={busy}
            />
            <Credential
              provider="openrouter"
              title="OpenRouter"
              subtitle="Reformulation du texte"
              configured={status.openrouterConfigured}
              run={run}
              busy={busy}
            />
          </>
        }
      />
      <TutorialDialog guides={guides} status={status} settings={settings} navigate={navigate} />

      <Dialog.Root open={helpOpen} onOpenChange={setHelpOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className={s.modalBackdrop} />
          <Dialog.Popup className={s.helpModal}>
            <div className={s.modalHeading}>
              <Dialog.Title>Parler, simplement.</Dialog.Title>
              <Dialog.Close className={s.iconButton} aria-label="Fermer">
                <X size={20} />
              </Dialog.Close>
            </div>
            <div className={s.helpSteps}>
              <div>
                <span>1</span>
                <p>Cliquez dans le champ où vous voulez écrire.</p>
              </div>
              <div>
                <span>2</span>
                <p>
                  Appuyez une fois sur <kbd>{status.shortcut || 'Ctrl+V'}</kbd>, puis parlez sans
                  maintenir les touches.
                </p>
              </div>
              <div>
                <span>3</span>
                <p>
                  Après {settings.SilenceSeconds || 2} secondes de silence, Voxen transcrit et
                  insère votre texte.
                </p>
              </div>
            </div>
            <p className={s.subtle}>
              Le clic droit sur le micro flottant ouvre ses réglages. Vous pouvez aussi appuyer à
              nouveau sur le raccourci pour terminer.
            </p>
            <Dialog.Close className={s.primary}>C’est compris</Dialog.Close>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function Credential({ provider, title, subtitle, configured, run, busy }) {
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  return (
    <div className={s.credential}>
      <div className={s.credentialHeading}>
        <div>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </div>
        <span className={configured ? s.connected : s.notConnected}>
          {configured ? <Check size={13} /> : null}
          {configured ? 'Clé enregistrée' : 'À connecter'}
        </span>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value.trim()) return;
          const secret = value.trim();
          setValue('');
          await run(
            'credentials.save',
            { provider, value: secret },
            'Clé enregistrée dans Windows.',
          );
        }}
      >
        <input
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          aria-label={`Clé API ${title}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            configured ? 'Remplacer la clé enregistrée' : `Collez votre clé API ${title}`
          }
          maxLength={1200}
        />
        <button className={s.secondary} disabled={!value.trim() || busy === 'credentials.save'}>
          Enregistrer
        </button>
        <button
          type="button"
          className={s.textButton}
          disabled={!configured || busy === 'credentials.test'}
          onClick={async () => {
            setMessage('Test de connexion…');
            const result = await run('credentials.test', { provider });
            setMessage(
              result
                ? result.message ||
                    (result.connected
                      ? 'Connexion réussie.'
                      : 'Vérifiez la connexion et votre clé.')
                : 'Le test a échoué.',
            );
          }}
        >
          {busy === 'credentials.test' ? <LoaderCircle size={15} className={s.spinner} /> : null}
          Tester
        </button>
      </form>
      {message && (
        <p className={s.subtle} role="status">
          {message}
        </p>
      )}
    </div>
  );
}
