import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Tabs } from '@base-ui/react/tabs';
import { Switch } from '@base-ui/react/switch';
import {
  SlidersHorizontal,
  Monitor,
  FlaskConical,
  UserCircle,
  Plug,
  ShieldCheck,
  X,
  ChevronDown,
  ArrowUpRight,
  Mic,
  Check,
  LoaderCircle,
  CircleHelp,
  AudioLines,
  RefreshCw,
} from 'lucide-react';
import s from './SettingsDialog.module.scss';
import CloudAccountPanel from './CloudAccountPanel';

const ITEMS = [
  { id: 'general', label: 'Général', icon: SlidersHorizontal },
  { id: 'system', label: 'Système', icon: Monitor },
  { id: 'advanced', label: 'Expérimental', icon: FlaskConical },
  { id: 'profile', label: 'Compte et synchro', icon: UserCircle, group: true },
  { id: 'connections', label: 'Connexions', icon: Plug },
  {
    id: 'privacy',
    label: 'Données et confidentialité',
    navLabel: 'Confidentialité',
    icon: ShieldCheck,
  },
];
const shortcutFor = (key) =>
  ({ 86: 'Ctrl+V', 165: 'Alt droite', 163: 'Ctrl droite', 123: 'F12' })[key] || 'Ctrl+V';
const languageFor = (code) =>
  ({ fr: 'Français', en: 'Anglais', de: 'Allemand', es: 'Espagnol', it: 'Italien' })[code] ||
  'Français';

function Group({ title, children }) {
  return (
    <section className={s.group}>
      {title && <h3>{title}</h3>}
      <div className={s.card}>{children}</div>
    </section>
  );
}
function Row({ title, description, children }) {
  return (
    <div className={s.row}>
      <div>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      <div className={s.control}>{children}</div>
    </div>
  );
}
function ToggleRow({ title, description, checked, disabled, onChange }) {
  return (
    <Row title={title} description={description}>
      <Switch.Root
        className={s.switch}
        aria-label={title}
        checked={Boolean(checked)}
        disabled={disabled}
        onCheckedChange={onChange}
      >
        <Switch.Thumb className={s.thumb} />
      </Switch.Root>
    </Row>
  );
}

export default function SettingsDialog({
  open,
  initialTab = 'general',
  onOpenChange,
  settings,
  status,
  versions,
  busy,
  savePreference,
  saveSettings,
  run,
  languageDialog,
  onLanguage,
  credentials,
  guides,
  cloud,
}) {
  const [tab, setTab] = useState('general');
  const [detail, setDetail] = useState(null);
  const [choice, setChoice] = useState('');
  const [message, setMessage] = useState('');
  const [firstName, setFirstName] = useState('');
  const [model, setModel] = useState('');
  const [speed, setSpeed] = useState(45);
  const [microphones, setMicrophones] = useState([]);
  const [microphonesLoading, setMicrophonesLoading] = useState(false);
  const [microphonesError, setMicrophonesError] = useState('');
  const [microphoneTesting, setMicrophoneTesting] = useState(false);
  const [microphoneLevel, setMicrophoneLevel] = useState(null);
  const [microphoneMessage, setMicrophoneMessage] = useState('');
  const microphoneBusy =
    Boolean(busy) ||
    microphoneTesting ||
    status?.state === 'recording' ||
    status?.state === 'processing';
  const selectedMicrophone = microphones.find(
    (device) => device.deviceId === settings.MicrophoneDeviceId,
  );
  const microphoneLabel = settings.MicrophoneDeviceId
    ? selectedMicrophone?.label || 'Microphone sélectionné'
    : 'Microphone par défaut de Windows';
  const microphoneMounted = useRef(true);
  const microphoneEnumeration = useRef(0);
  const latest = useRef(settings);
  latest.current = settings;
  const saving = busy === 'settings.save';
  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setDetail(null);
      setMessage('');
      setFirstName(settings.FirstName || '');
      setModel(settings.RewriteModel || 'qwen/qwen3.8-27b');
      setSpeed(settings.TypingSpeed || 45);
    }
  }, [open, initialTab]);
  useEffect(() => {
    if (!open) setDetail(null);
  }, [open]);
  useEffect(() => {
    microphoneMounted.current = true;
    return () => {
      microphoneMounted.current = false;
      microphoneEnumeration.current++;
    };
  }, []);
  const refreshMicrophones = async () => {
    const request = ++microphoneEnumeration.current;
    setMicrophonesLoading(true);
    setMicrophonesError('');
    try {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error('unavailable');
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!microphoneMounted.current || request !== microphoneEnumeration.current) return;
      const inputs = devices.filter(
        (device) =>
          device.kind === 'audioinput' &&
          device.deviceId &&
          device.deviceId !== 'default' &&
          device.deviceId !== 'communications',
      );
      setMicrophones(
        inputs
          .filter(
            (device, index) =>
              inputs.findIndex((other) => other.deviceId === device.deviceId) === index,
          )
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${index + 1}`,
          })),
      );
    } catch {
      if (microphoneMounted.current && request === microphoneEnumeration.current)
        setMicrophonesError(
          'La liste des micros est indisponible. Le microphone par défaut reste utilisable.',
        );
    } finally {
      if (microphoneMounted.current && request === microphoneEnumeration.current)
        setMicrophonesLoading(false);
    }
  };
  useEffect(() => {
    if (!open || detail !== 'microphone') return;
    setMicrophoneMessage('');
    setMicrophoneLevel(null);
    void refreshMicrophones();
    return window.voxen.onMicrophoneLevel?.((value) => setMicrophoneLevel(value));
  }, [open, detail]);
  const testMicrophone = async () => {
    if (microphoneBusy) return;
    setMicrophoneTesting(true);
    setMicrophoneLevel(null);
    setMicrophoneMessage('Parlez pendant le test…');
    try {
      const result = await run('microphone.test');
      if (!microphoneMounted.current) return;
      setMicrophoneLevel(result && typeof result.level === 'number' ? result : null);
      setMicrophoneMessage(result?.message || 'Le test du microphone n’a pas abouti.');
      // The explicit test may reveal device labels after the microphone permission
      // was granted. Enumeration itself never asks for microphone access.
      void refreshMicrophones();
    } finally {
      if (microphoneMounted.current) setMicrophoneTesting(false);
    }
  };
  const measuredRms = Math.min(1, Math.max(0, Number(microphoneLevel?.level) || 0));
  const measuredPeak = Math.min(1, Math.max(0, Number(microphoneLevel?.peak) || 0));
  const meterWidth =
    measuredRms > 0
      ? Math.min(100, Math.max(0, ((20 * Math.log10(measuredRms) + 60) / 60) * 100))
      : 0;
  const peakPosition =
    measuredPeak > 0
      ? Math.min(100, Math.max(0, ((20 * Math.log10(measuredPeak) + 60) / 60) * 100))
      : 0;
  const update = async (key, value) => {
    setMessage('Enregistrement…');
    const result = await savePreference(key, value);
    setMessage(result ? 'Modifications enregistrées' : 'Modification non enregistrée. Réessayez.');
    return result;
  };
  const edit = (type, value) => {
    setChoice(String(value));
    setMessage('');
    setDetail(type);
  };
  const general = (
    <>
      <Group>
        <Row title="Raccourcis" description={shortcutFor(settings.HotkeyVirtualKey)}>
          <button
            className={s.changeButton}
            data-settings-edit="shortcut"
            onClick={() => edit('shortcut', settings.HotkeyVirtualKey || 86)}
          >
            Changer
          </button>
        </Row>
        <Row title="Microphone" description={microphoneLabel}>
          <button
            className={s.changeButton}
            data-settings-edit="microphone"
            onClick={() => setDetail('microphone')}
          >
            Changer
          </button>
        </Row>
        <Row title="Langues de dictée" description={languageFor(settings.Language)}>
          <button className={s.changeButton} data-settings-edit="language" onClick={onLanguage}>
            Changer
          </button>
        </Row>
        <div className={s.separator} />
        <Row title="Langue de l’application">
          <button
            className={s.selectButton}
            disabled
            title="L’interface Voxen est actuellement disponible en français."
          >
            Français
            <ChevronDown size={15} />
          </button>
        </Row>
        <Row title="Thème">
          <button className={s.selectButton} disabled title="Le thème crème de Voxen.">
            Crème
            <ChevronDown size={15} />
          </button>
        </Row>
      </Group>
      <button
        className={s.guideLink}
        data-guide-open="settings"
        onClick={() => {
          onOpenChange(false);
          guides.open('settings');
        }}
      >
        <CircleHelp size={15} />
        Découvrir les paramètres
        <ArrowUpRight size={13} />
      </button>
    </>
  );
  const system = (
    <>
      <Group title="Application">
        <ToggleRow
          title="Lancer Voxen au démarrage"
          description="Retrouvez votre raccourci quand Windows démarre."
          checked={settings.StartWithWindows}
          disabled={saving}
          onChange={(value) => update('StartWithWindows', value)}
        />
        <Row title="Capsule flottante" description="Elle reste masquée au lancement de Voxen.">
          <button className={s.changeButton} onClick={() => run('overlay.show')}>
            Afficher
          </button>
        </Row>
      </Group>
      <Group title="Son">
        <ToggleRow
          title="Son au début de la dictée"
          checked={settings.StartSound}
          disabled={saving}
          onChange={(value) => update('StartSound', value)}
        />
        <ToggleRow
          title="Son à la fin de la dictée"
          checked={settings.EndSound}
          disabled={saving}
          onChange={(value) => update('EndSound', value)}
        />
      </Group>
      <Group title="Dictée">
        <Row title="Arrêt automatique" description="La capture continue tant que vous parlez.">
          <button
            className={s.changeButton}
            data-settings-edit="silence"
            onClick={() => edit('silence', settings.SilenceSeconds || 2)}
          >
            <span>{settings.SilenceSeconds || 2} secondes</span>Changer
          </button>
        </Row>
        <ToggleRow
          title="Reformuler mes dictées"
          description="Peaufiner le texte avec le modèle OpenRouter configuré."
          checked={settings.CleanupEnabled}
          disabled={saving}
          onChange={(value) => update('CleanupEnabled', value)}
        />
      </Group>
      <Group title="Insertion du texte">
        <ToggleRow
          title="Restaurer le presse-papiers"
          description="Rétablir son contenu après l’insertion, si aucune autre copie n’a eu lieu."
          checked={settings.RestoreClipboard}
          disabled={saving}
          onChange={(value) => update('RestoreClipboard', value)}
        />
      </Group>
    </>
  );
  const advanced = (
    <>
      <p className={s.intro}>Ajustez la reformulation et les estimations de Voxen.</p>
      <Group title="Reformulation">
        <Row title="Modèle OpenRouter" description="Le modèle utilisé après la transcription.">
          <input
            aria-label="Modèle OpenRouter"
            className={s.textInput}
            value={model}
            maxLength={150}
            disabled={saving}
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => {
              if (model.trim() && model.trim() !== latest.current.RewriteModel)
                update('RewriteModel', model.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </Row>
        <Row title="Style de reformulation">
          <select
            aria-label="Style de reformulation"
            disabled={saving}
            value={settings.CleanupMode ?? 1}
            onChange={(e) => update('CleanupMode', Number(e.target.value))}
          >
            <option value={0}>Minimal</option>
            <option value={1}>Naturel</option>
            <option value={2}>Soigné</option>
          </select>
        </Row>
      </Group>
      <Group title="Statistiques">
        <Row title="Vitesse de frappe estimée" description="Pour calculer votre temps gagné.">
          <label className={s.numberInput}>
            <input
              type="number"
              aria-label="Vitesse de frappe estimée"
              min={5}
              max={250}
              disabled={saving}
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              onBlur={() => {
                const value = Math.min(250, Math.max(5, Number(speed) || 45));
                setSpeed(value);
                if (value !== latest.current.TypingSpeed) update('TypingSpeed', value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            mots/min
          </label>
        </Row>
      </Group>
      <div className={s.note}>
        <FlaskConical size={17} />
        <p>
          Ces réglages s’appliquent à vos prochaines dictées. La transcription utilise Nova-3 et le
          détecteur de silence fonctionne sur votre ordinateur.
        </p>
      </div>
    </>
  );
  const profile = (
    <>
      <CloudAccountPanel cloud={cloud} run={run} />
      <Group title="Votre profil local">
        <Row title="Prénom" description="Pour personnaliser votre accueil dans Voxen.">
          <input
            className={s.textInput}
            aria-label="Prénom"
            value={firstName}
            maxLength={60}
            placeholder="Votre prénom"
            disabled={saving}
            onChange={(e) => setFirstName(e.target.value)}
            onBlur={() => {
              if (firstName !== latest.current.FirstName) update('FirstName', firstName);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </Row>
      </Group>
      <div className={s.note}>
        <UserCircle size={19} />
        <p>
          La dictée reste disponible sans compte. Le prénom fait partie des préférences si leur
          synchronisation est activée.
        </p>
      </div>
    </>
  );
  const connections = (
    <>
      <p className={s.intro}>
        Connectez vos services de dictée. Les clés enregistrées ne sont jamais réaffichées.
      </p>
      <div className={`${s.card} ${s.credentials}`}>{credentials}</div>
      <div className={s.note}>
        <ShieldCheck size={18} />
        <p>
          Vos clés sont conservées dans le Gestionnaire d’identifiants Windows. Le bouton Tester
          contacte le service concerné uniquement à votre demande.
        </p>
      </div>
    </>
  );
  const privacy = (
    <>
      <Group title="Vos données">
        <ToggleRow
          title="Conserver l’historique local"
          description="Les textes restent sur ce PC, sans chiffrement applicatif."
          checked={settings.HistoryEnabled}
          disabled={saving}
          onChange={(value) => update('HistoryEnabled', value)}
        />
      </Group>
      <div className={s.dataCard}>
        <h3>Ce qui est envoyé</h3>
        <p>
          <strong>Deepgram</strong> reçoit votre audio et les mots de votre dictionnaire pour la
          transcription.
        </p>
        <p>
          <strong>OpenRouter</strong> reçoit le texte transcrit si la reformulation est activée.
        </p>
        <p>
          <strong>Supabase</strong> reçoit les catégories choisies dans Compte et synchro,
          uniquement après activation. Les notes et l’historique sont exclus par défaut. Les 20
          dernières versions cloud sont conservées ; désactiver une catégorie ne supprime pas les
          copies déjà envoyées.
        </p>
        <p>
          L’audio n’est pas enregistré sur disque par Voxen. L’application ne lit pas le contenu de
          votre écran.
        </p>
      </div>
      <Group title="Historique">
        <Row
          title="Effacer les dictées enregistrées"
          description="Cette action supprime les textes et les statistiques associées."
        >
          <button
            className={s.dangerButton}
            onClick={async () => {
              if (
                confirm('Effacer définitivement toutes les dictées locales et leurs statistiques ?')
              )
                await run('history.clear', {}, 'Historique local effacé.');
            }}
          >
            Tout effacer
          </button>
        </Row>
      </Group>
    </>
  );
  const panels = { general, system, advanced, profile, connections, privacy };
  const openChange = (value) => {
    if (!value && saving) return;
    onOpenChange(value);
  };
  return (
    <Dialog.Root open={open} onOpenChange={openChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={s.backdrop} />
        <Dialog.Popup className={s.popup} data-settings-dialog>
          <Dialog.Title className={s.srOnly}>Paramètres Voxen</Dialog.Title>
          <Dialog.Description className={s.srOnly}>
            Réglez la dictée, les préférences système et vos connexions.
          </Dialog.Description>
          <Tabs.Root
            orientation="vertical"
            value={tab}
            onValueChange={(value) => {
              setTab(value);
              setMessage('');
            }}
            className={s.layout}
          >
            <aside className={s.sidebar}>
              <Tabs.List
                className={s.navigation}
                activateOnFocus
                aria-label="Sections des paramètres"
              >
                <span className={s.groupLabel}>PARAMÈTRES</span>
                {ITEMS.map((item) => (
                  <React.Fragment key={item.id}>
                    {item.group && (
                      <>
                        <div className={s.navSeparator} />
                        <span className={s.groupLabel}>COMPTE</span>
                      </>
                    )}
                    <Tabs.Tab value={item.id} data-settings-tab={item.id} className={s.tab}>
                      <item.icon size={20} strokeWidth={1.8} />
                      <span>{item.navLabel || item.label}</span>
                    </Tabs.Tab>
                  </React.Fragment>
                ))}
              </Tabs.List>
              <div className={s.version}>
                <span>Voxen v0.2.0</span>
                <button
                  aria-label="À propos de cette version"
                  title={`Electron ${versions?.electron || ''} · React ${versions?.react || ''}`}
                  onClick={() =>
                    setMessage(
                      `Voxen · Electron ${versions?.electron || ''} · React ${versions?.react || ''}`,
                    )
                  }
                >
                  <CircleHelp size={15} />
                </button>
              </div>
            </aside>
            <div className={s.panelArea}>
              <Dialog.Close className={s.close} aria-label="Fermer les paramètres">
                <X size={18} />
              </Dialog.Close>
              {ITEMS.map((item) => (
                <Tabs.Panel
                  className={s.panel}
                  key={item.id}
                  value={item.id}
                  data-settings-panel={item.id}
                >
                  <header className={s.heading}>
                    <h2>{item.label}</h2>
                  </header>
                  <div className={s.scroll}>{panels[item.id]}</div>
                </Tabs.Panel>
              ))}
              <div className={s.saveStatus} role="status">
                {saving ? (
                  <>
                    <LoaderCircle size={12} className={s.spinner} />
                    Enregistrement…
                  </>
                ) : message ? (
                  <>
                    {message.startsWith('Modifications') && <Check size={13} />}
                    {message}
                    {message.startsWith('Modification non') && (
                      <button
                        onClick={async () => {
                          const result = await saveSettings();
                          setMessage(
                            result
                              ? 'Modifications enregistrées'
                              : 'Modification non enregistrée. Réessayez.',
                          );
                        }}
                      >
                        Réessayer
                      </button>
                    )}
                  </>
                ) : (
                  'Les modifications sont enregistrées automatiquement.'
                )}
              </div>
            </div>
          </Tabs.Root>
        </Dialog.Popup>
      </Dialog.Portal>
      {languageDialog}
      <Dialog.Root
        open={Boolean(detail)}
        onOpenChange={(value) => {
          if (!value && !saving) setDetail(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={s.detailBackdrop} />
          <Dialog.Popup className={s.detailPopup} data-settings-detail={detail}>
            <div className={s.detailHeader}>
              <Dialog.Title>
                {detail === 'shortcut'
                  ? 'Raccourci de dictée'
                  : detail === 'silence'
                    ? 'Arrêt après un silence'
                    : 'Microphone'}
              </Dialog.Title>
              <Dialog.Close className={s.closeDetail} aria-label="Fermer ce réglage">
                <X size={18} />
              </Dialog.Close>
            </div>
            {detail === 'microphone' ? (
              <>
                <Dialog.Description>
                  Choisissez le micro utilisé pour vos prochaines dictées, puis vérifiez son niveau.
                </Dialog.Description>
                <div className={s.microphoneCard}>
                  <div className={s.micIcon}>
                    <Mic size={24} strokeWidth={1.5} />
                  </div>
                  <div className={s.microphoneSummary}>
                    <strong>{microphoneLabel}</strong>
                    <span>Mono · PCM 16 bits · 16 kHz</span>
                  </div>
                  {!settings.MicrophoneDeviceId && <span className={s.defaultBadge}>Windows</span>}
                </div>
                <div className={s.microphoneSelection}>
                  <label htmlFor="voxen-microphone">Microphone de dictée</label>
                  <div>
                    <select
                      id="voxen-microphone"
                      aria-label="Microphone de dictée"
                      disabled={microphoneBusy || microphonesLoading}
                      value={settings.MicrophoneDeviceId || ''}
                      onChange={async (event) => {
                        setMicrophoneLevel(null);
                        setMicrophoneMessage('');
                        await update('MicrophoneDeviceId', event.target.value);
                      }}
                    >
                      <option value="">Microphone par défaut de Windows</option>
                      {settings.MicrophoneDeviceId && !selectedMicrophone && (
                        <option value={settings.MicrophoneDeviceId}>
                          Microphone sélectionné · indisponible
                        </option>
                      )}
                      {microphones.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className={s.refreshMicrophones}
                      aria-label="Actualiser les microphones"
                      title="Actualiser les microphones"
                      disabled={microphoneBusy || microphonesLoading}
                      onClick={refreshMicrophones}
                    >
                      <RefreshCw size={16} className={microphonesLoading ? s.spinner : ''} />
                    </button>
                  </div>
                  {microphonesError && <p role="status">{microphonesError}</p>}
                </div>
                <div className={s.microphoneMeterCard} data-microphone-meter>
                  <div className={s.microphoneMeterLabel}>
                    <span>Niveau du micro</span>
                    <span>
                      {microphoneLevel
                        ? measuredPeak >= 0.98
                          ? 'Niveau élevé'
                          : microphoneLevel.detected
                            ? 'Son détecté'
                            : 'Aucun son détecté'
                        : 'Prêt pour le test'}
                    </span>
                  </div>
                  <div
                    className={`${s.microphoneMeter} ${measuredPeak >= 0.98 ? s.microphoneMeterHigh : ''}`}
                    role="meter"
                    aria-label="Niveau sonore du microphone"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Number((measuredRms * 100).toFixed(2))}
                    aria-valuetext={`Niveau moyen ${Math.round(measuredRms * 100)} %, pic ${Math.round(measuredPeak * 100)} %`}
                  >
                    <span style={{ width: `${meterWidth}%` }} />
                    <i style={{ left: `${peakPosition}%`, opacity: measuredPeak ? 1 : 0 }} />
                  </div>
                  <div className={s.microphoneMeterScale}>
                    <span>Faible</span>
                    <span>
                      {microphoneLevel
                        ? `Pic ${Math.round(measuredPeak * 100)} %`
                        : 'Le micro reste fermé avant le test'}
                    </span>
                  </div>
                </div>
                <button
                  className={s.secondaryButton}
                  disabled={microphoneBusy}
                  onClick={testMicrophone}
                >
                  {microphoneTesting ? (
                    <LoaderCircle size={15} className={s.spinner} />
                  ) : (
                    <AudioLines size={15} />
                  )}
                  {microphoneTesting ? 'Écoute pendant 1,5 seconde…' : 'Tester le microphone'}
                </button>
                <p className={s.testResult} role="status">
                  {microphoneMessage}
                </p>
                <p className={s.detailNote}>
                  Le test écoute pendant 1,5 seconde et mesure uniquement le son sur ce PC. Aucun
                  audio n’est envoyé.
                </p>
                <button className={s.link} onClick={() => run('permissions.microphoneSettings')}>
                  Autorisations microphone Windows
                  <ArrowUpRight size={14} />
                </button>
                <button className={s.link} onClick={() => run('permissions.soundSettings')}>
                  Réglages du son Windows
                  <ArrowUpRight size={14} />
                </button>
                <div className={s.detailActions}>
                  <Dialog.Close className={s.primaryButton}>Fermer</Dialog.Close>
                </div>
              </>
            ) : (
              <>
                <Dialog.Description>
                  {detail === 'shortcut'
                    ? 'Une pression pour commencer, sans maintenir les touches.'
                    : 'La capture continue pendant la parole, puis se termine au bout du délai choisi.'}
                </Dialog.Description>
                <div className={s.choiceList}>
                  {(detail === 'shortcut' ? [86, 165, 163, 123] : [2, 3, 5, 8]).map((value) => (
                    <label className={choice === String(value) ? s.selectedChoice : ''} key={value}>
                      <input
                        type="radio"
                        name="settings-choice"
                        value={value}
                        checked={choice === String(value)}
                        disabled={saving}
                        onChange={() => setChoice(String(value))}
                      />
                      <span>
                        {detail === 'shortcut' ? shortcutFor(value) : `${value} secondes`}
                      </span>
                      {choice === String(value) && <Check size={16} />}
                    </label>
                  ))}
                </div>
                {detail === 'shortcut' && (
                  <p className={s.detailNote}>
                    Dans la fenêtre principale de Voxen, Ctrl+V conserve sa fonction habituelle de
                    collage. Mettez la dictée en pause pour le libérer partout.
                  </p>
                )}
                <div className={s.detailActions}>
                  <Dialog.Close className={s.secondaryButton}>Annuler</Dialog.Close>
                  <button
                    className={s.primaryButton}
                    disabled={saving}
                    onClick={async () => {
                      if (
                        await update(
                          detail === 'shortcut' ? 'HotkeyVirtualKey' : 'SilenceSeconds',
                          Number(choice),
                        )
                      )
                        setDetail(null);
                    }}
                  >
                    {saving && <LoaderCircle size={14} className={s.spinner} />}Enregistrer
                  </button>
                </div>
              </>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </Dialog.Root>
  );
}
