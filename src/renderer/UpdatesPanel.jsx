import React, { useEffect, useRef, useState } from 'react';
import { Switch } from '@base-ui/react/switch';
import {
  ArrowUpRight,
  CheckCircle2,
  Download,
  LoaderCircle,
  MonitorDown,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import s from './UpdatesPanel.module.scss';

function checkedDate(value) {
  if (!value) return 'Pas encore de vérification';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date de vérification indisponible';
  return `Dernière vérification : ${date.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

export default function UpdatesPanel({ updates = {}, run, dictationBusy = false }) {
  const [action, setAction] = useState('');
  const [feedback, setFeedback] = useState('');
  const [confirmInstall, setConfirmInstall] = useState(false);
  const pending = useRef(false);
  const supported = Boolean(updates.supported);
  const state = updates.state || 'unsupported';
  const ready = state === 'ready';
  const portable = updates.mode === 'portable';
  const development = updates.mode === 'development';
  const transferring = state === 'checking' || state === 'downloading';
  const busy = Boolean(action || updates.busy || transferring);
  const installable = supported && ready && Boolean(updates.canInstall) && !busy && !dictationBusy;
  const version = String(updates.currentVersion || '').slice(0, 80);
  const available = String(updates.availableVersion || '').slice(0, 80);

  useEffect(() => {
    if (!ready || dictationBusy || !updates.canInstall) setConfirmInstall(false);
  }, [ready, dictationBusy, updates.canInstall]);
  useEffect(() => {
    setFeedback('');
  }, [state, updates.enabled]);

  const invoke = async (name, payload = {}) => {
    if (pending.current || typeof run !== 'function') return false;
    pending.current = true;
    setAction(name);
    setFeedback('');
    try {
      const result = await run(name, payload);
      if (result === null || result === false) {
        setFeedback('Cette action n’a pas abouti. Vous pouvez réessayer.');
        return false;
      }
      return true;
    } catch {
      // Raw updater errors can include local paths or download URLs.
      setFeedback('Cette action n’a pas abouti. Vous pouvez réessayer.');
      return false;
    } finally {
      pending.current = false;
      setAction('');
    }
  };

  const title = !supported
    ? portable
      ? 'Installez Voxen pour les mises à jour'
      : development
        ? 'Version de développement'
        : 'Mises à jour indisponibles'
    : state === 'checking'
      ? 'Recherche d’une nouvelle version…'
      : state === 'downloading'
        ? 'Téléchargement en cours…'
        : ready
          ? 'Une mise à jour est prête'
          : state === 'error'
            ? 'La vérification n’a pas abouti'
            : updates.lastChecked
              ? 'Aucune nouvelle version trouvée'
              : 'Gardez Voxen à jour';
  const StatusIcon = transferring
    ? LoaderCircle
    : ready
      ? Download
      : state === 'error'
        ? TriangleAlert
        : !supported
          ? MonitorDown
          : updates.lastChecked
            ? CheckCircle2
            : RefreshCw;

  return (
    <section className={s.root} aria-labelledby="voxen-updates-heading" data-updates-panel>
      <h3 id="voxen-updates-heading">Mises à jour</h3>
      <div className={s.card}>
        <div className={s.summary}>
          <span className={`${s.icon} ${ready ? s.readyIcon : ''}`}>
            <StatusIcon size={20} strokeWidth={1.7} className={transferring ? s.spinner : ''} />
          </span>
          <div className={s.summaryText} role="status" aria-live="polite">
            <h4>{title}</h4>
            <p>
              {version ? `Version installée : ${version}` : 'Version en cours de chargement'}
              {supported && ready && available ? ` · Nouvelle version : ${available}` : ''}
            </p>
          </div>
        </div>

        {!supported ? (
          <>
            <p className={s.description}>
              {portable
                ? 'Cette copie fonctionne sans installation. L’installeur Windows permet ensuite de recevoir les nouvelles versions directement dans Voxen.'
                : development
                  ? 'Les mises à jour sont réservées à l’application Windows installée. Elles sont désactivées pendant le développement.'
                  : 'Cette installation ne peut pas recevoir de mises à jour automatiques. Retrouvez la version Windows sur la page officielle de Voxen.'}
            </p>
            <div className={s.actions}>
              <button
                type="button"
                className={s.secondary}
                disabled={busy}
                onClick={() => invoke('updates.openReleases')}
              >
                <ArrowUpRight size={14} />
                {portable ? 'Télécharger l’installeur Windows' : 'Voir les versions de Voxen'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={s.description}>
              {state === 'downloading'
                ? 'Voxen prépare la nouvelle version. Vous pouvez continuer à utiliser l’application.'
                : ready
                  ? 'Le téléchargement est terminé. Choisissez le moment du redémarrage pour appliquer la mise à jour.'
                  : state === 'error'
                    ? 'La connexion ou le service de mise à jour est momentanément indisponible. Votre version actuelle reste utilisable.'
                    : 'Les nouvelles versions sont téléchargées en arrière-plan. Vous choisissez quand redémarrer pour les installer.'}
            </p>
            <div className={s.actions}>
              <span className={s.checked}>{checkedDate(updates.lastChecked)}</span>
              {ready ? (
                <button
                  type="button"
                  className={s.primary}
                  disabled={!installable}
                  onClick={() => setConfirmInstall(true)}
                >
                  <RotateCcw size={14} />
                  Redémarrer et installer
                </button>
              ) : (
                <button
                  type="button"
                  className={s.secondary}
                  disabled={busy}
                  onClick={() => invoke('updates.check')}
                >
                  <RefreshCw
                    size={14}
                    className={state === 'checking' || action === 'updates.check' ? s.spinner : ''}
                  />
                  {state === 'checking' || action === 'updates.check'
                    ? 'Vérification…'
                    : state === 'downloading'
                      ? 'Téléchargement…'
                      : 'Vérifier maintenant'}
                </button>
              )}
            </div>
            {ready && dictationBusy && (
              <p className={s.waiting}>
                Terminez votre dictée ou son traitement avant de redémarrer Voxen.
              </p>
            )}
            {ready && !dictationBusy && !updates.canInstall && (
              <p className={s.waiting}>
                L’installation sera disponible quand Voxen aura terminé l’opération en cours.
              </p>
            )}
            {confirmInstall && installable && (
              <div
                className={s.confirmation}
                role="group"
                aria-label="Confirmer le redémarrage de Voxen"
              >
                <strong>Installer la mise à jour maintenant ?</strong>
                <p>Voxen va se fermer, installer la nouvelle version puis redémarrer.</p>
                <div className={s.confirmActions}>
                  <button
                    type="button"
                    className={s.secondary}
                    onClick={() => setConfirmInstall(false)}
                  >
                    Plus tard
                  </button>
                  <button
                    type="button"
                    className={s.primary}
                    onClick={async () => {
                      setConfirmInstall(false);
                      await invoke('updates.install');
                    }}
                  >
                    <RotateCcw size={14} />
                    Confirmer le redémarrage
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <div className={s.automatic}>
          <div>
            <strong>Rechercher automatiquement</strong>
            <p>Vérifier périodiquement les nouvelles versions de Voxen.</p>
          </div>
          <Switch.Root
            className={s.switch}
            aria-label="Rechercher automatiquement les mises à jour"
            checked={updates.enabled !== false}
            disabled={!supported || busy}
            onCheckedChange={(enabled) => invoke('updates.preferences', { enabled })}
          >
            <Switch.Thumb className={s.thumb} />
          </Switch.Root>
        </div>
        <div className={s.note}>
          <ShieldCheck size={14} />
          <p>Une dictée en cours empêche le redémarrage pour installer une mise à jour.</p>
        </div>
        {feedback && (
          <p className={s.feedback} role="alert">
            {feedback}
          </p>
        )}
      </div>
    </section>
  );
}
