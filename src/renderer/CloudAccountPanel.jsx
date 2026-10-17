import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  CloudOff,
  Database,
  Laptop,
  LoaderCircle,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from 'lucide-react';
import s from './CloudAccountPanel.module.scss';

const DEFAULT_SCOPE = { libraries: true, preferences: true, notes: false, history: false };
const STATUS = {
  offline: 'Hors connexion',
  ready: 'Prêt à synchroniser',
  syncing: 'Synchronisation en cours',
  synced: 'À jour',
  conflict: 'Deux versions à départager',
  error: 'Synchronisation interrompue',
};

function syncDate(value) {
  if (!value) return 'Aucune synchronisation pour le moment';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date indisponible';
  return `Dernière synchronisation : ${date.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

function ScopeRow({ label, detail, checked, disabled, onChange, optional = false }) {
  return (
    <label className={s.scopeRow}>
      <span>
        <strong>
          {label}
          {optional && <em>Au choix</em>}
        </strong>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export default function CloudAccountPanel({ cloud = {}, run, onNotice }) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState(cloud.displayName || '');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resolve, setResolve] = useState('');
  const [showScope, setShowScope] = useState(true);
  const busyRef = useRef(false);
  const scope = { ...DEFAULT_SCOPE, ...cloud.scope };
  const connected = Boolean(cloud.connected);
  const locked = Boolean(busy) || cloud.status === 'syncing';
  const conflicted = cloud.status === 'conflict';
  const statusIcon =
    cloud.status === 'syncing'
      ? LoaderCircle
      : conflicted || cloud.status === 'error'
        ? TriangleAlert
        : cloud.status === 'synced'
          ? CheckCircle2
          : cloud.status === 'offline'
            ? CloudOff
            : Cloud;
  const StatusIcon = statusIcon;

  useEffect(() => {
    setName(cloud.displayName || '');
  }, [cloud.displayName, connected]);
  useEffect(() => {
    if (connected) {
      setSentTo('');
      setCode('');
      setMessage('');
      setError(false);
    }
  }, [connected]);
  useEffect(() => {
    if (!conflicted) setResolve('');
  }, [conflicted]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const invoke = async (action, payload, success) => {
    if (busyRef.current || typeof run !== 'function') return false;
    busyRef.current = true;
    setBusy(action);
    setMessage('');
    setError(false);
    try {
      const result = await run(action, payload);
      if (result === null || result === false) {
        setMessage('Cette opération n’a pas abouti. Vérifiez la connexion et réessayez.');
        setError(true);
        return false;
      }
      if (success) {
        setMessage(success);
        onNotice?.(success);
      }
      return true;
    } catch {
      // Never render provider errors: an authentication URL may contain a token.
      setMessage('Cette opération n’a pas abouti. Vérifiez la connexion et réessayez.');
      setError(true);
      return false;
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  };
  const requestLink = async (event) => {
    event.preventDefault();
    const address = email.trim();
    if (
      await invoke(
        'cloud.requestLink',
        { email: address },
        'Consultez votre boîte mail, y compris les courriers indésirables.',
      )
    ) {
      setSentTo(address);
      setCooldown(60);
      setCode('');
    }
  };
  const verify = async (event) => {
    event.preventDefault();
    const value = code.trim();
    if (!value || !sentTo) return;
    setCode('');
    await invoke(
      'cloud.verify',
      { email: sentTo, codeOrLink: value },
      'Connexion au compte effectuée.',
    );
  };
  const saveScope = (key, value) =>
    invoke(
      'cloud.preferences',
      { enabled: Boolean(cloud.enabled), scope: { ...scope, [key]: value } },
      'Choix de synchronisation enregistré.',
    );

  return (
    <div className={s.root} data-cloud-account>
      <div className={s.intro}>
        <span className={s.introIcon}>
          <Cloud size={22} strokeWidth={1.5} />
        </span>
        <div>
          <h3>Vos repères, sur vos ordinateurs.</h3>
          <p>
            Un compte pour retrouver votre bibliothèque et les préférences choisies, avec Supabase.
          </p>
        </div>
      </div>
      {!cloud.configured && (
        <div className={s.warning} role="status">
          <TriangleAlert size={17} />
          <p>
            Le service de compte n’est pas encore configuré dans cette version. Votre bibliothèque
            locale reste disponible.
          </p>
        </div>
      )}

      {!connected ? (
        <section className={s.card} aria-labelledby="cloud-login-title">
          <div className={s.sectionHeading}>
            <Mail size={18} />
            <h4 id="cloud-login-title">Se connecter sans mot de passe</h4>
          </div>
          <p className={s.description}>
            Recevez un email de connexion. Aucune donnée du PC n’est synchronisée à cette étape.
          </p>
          <form className={s.form} onSubmit={requestLink}>
            <label htmlFor="cloud-email">Adresse email</label>
            <div className={s.inputAction}>
              <input
                id="cloud-email"
                type="email"
                value={email}
                autoComplete="email"
                placeholder="vous@exemple.fr"
                required
                maxLength={254}
                disabled={locked || !cloud.configured || Boolean(sentTo)}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button
                type="submit"
                className={s.primary}
                disabled={locked || !cloud.configured || !email.trim() || Boolean(cooldown)}
              >
                {busy === 'cloud.requestLink' ? (
                  <LoaderCircle size={15} className={s.spin} />
                ) : (
                  <ArrowRight size={15} />
                )}
                {cooldown ? `Renvoyer (${cooldown} s)` : sentTo ? 'Renvoyer' : 'Recevoir le lien'}
              </button>
            </div>
          </form>
          {sentTo && (
            <div className={s.verification}>
              <p>
                <CheckCircle2 size={15} />
                Email demandé pour <strong>{sentTo}</strong>
              </p>
              <form className={s.form} onSubmit={verify}>
                <label htmlFor="cloud-code">Code ou lien reçu par email</label>
                <input
                  id="cloud-code"
                  type="password"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  maxLength={8192}
                  placeholder="Collez le code ou le lien de connexion"
                  required
                  disabled={locked}
                />
                <small>
                  Selon l’email reçu, collez le code à 6 chiffres ou copiez l’adresse du bouton de
                  connexion. Le contenu reste masqué.
                </small>
                <div className={s.actions}>
                  <button
                    type="button"
                    className={s.textButton}
                    disabled={locked}
                    onClick={() => {
                      setSentTo('');
                      setCode('');
                      setCooldown(0);
                      setMessage('');
                    }}
                  >
                    Changer d’adresse
                  </button>
                  <button type="submit" className={s.primary} disabled={locked || !code.trim()}>
                    {busy === 'cloud.verify' && <LoaderCircle size={15} className={s.spin} />}Se
                    connecter
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className={s.card} aria-labelledby="cloud-profile-title">
            <div className={s.profile}>
              <div className={s.avatar}>
                <UserRound size={23} strokeWidth={1.6} />
              </div>
              <div>
                <h4 id="cloud-profile-title">{cloud.displayName || 'Votre compte Voxen'}</h4>
                <span>{cloud.email || 'Compte connecté'}</span>
              </div>
              <span className={s.connected}>
                <Check size={12} />
                Connecté
              </span>
            </div>
            <form
              className={s.form}
              onSubmit={async (event) => {
                event.preventDefault();
                await invoke('cloud.profile', { displayName: name.trim() }, 'Profil enregistré.');
              }}
            >
              <label htmlFor="cloud-profile-name">Nom d’affichage</label>
              <div className={s.inputAction}>
                <input
                  id="cloud-profile-name"
                  value={name}
                  maxLength={80}
                  placeholder="Votre prénom"
                  disabled={locked}
                  onChange={(event) => setName(event.target.value)}
                />
                <button
                  type="submit"
                  className={s.secondary}
                  disabled={locked || name.trim() === (cloud.displayName || '')}
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </section>

          <section className={s.card} aria-labelledby="cloud-sync-title">
            <div className={s.syncToggle}>
              <div>
                <h4 id="cloud-sync-title">Synchronisation</h4>
                <p>Activez-la quand vous souhaitez partager ces données entre vos PC.</p>
              </div>
              <button
                type="button"
                className={s.switch}
                role="switch"
                aria-label="Activer la synchronisation du compte"
                aria-checked={Boolean(cloud.enabled)}
                data-checked={cloud.enabled || undefined}
                disabled={locked || !cloud.configured}
                onClick={() =>
                  invoke(
                    'cloud.preferences',
                    { enabled: !cloud.enabled, scope },
                    cloud.enabled
                      ? 'Synchronisation désactivée sur ce PC.'
                      : 'Synchronisation activée sur ce PC.',
                  )
                }
              >
                <span />
              </button>
            </div>
            <div
              className={`${s.status} ${conflicted || cloud.status === 'error' ? s.statusWarning : ''}`}
              role="status"
            >
              <StatusIcon size={17} className={cloud.status === 'syncing' ? s.spin : ''} />
              <div>
                <strong>
                  {!cloud.enabled
                    ? 'Synchronisation désactivée'
                    : STATUS[cloud.status] || 'Prêt à synchroniser'}
                </strong>
                <small>{syncDate(cloud.lastSync)}</small>
              </div>
              {cloud.enabled && (
                <button
                  type="button"
                  className={s.iconButton}
                  aria-label="Synchroniser maintenant"
                  title="Synchroniser maintenant"
                  disabled={locked || conflicted || !cloud.configured}
                  onClick={() => invoke('cloud.sync', {}, 'Synchronisation effectuée.')}
                >
                  <RefreshCw size={17} className={locked ? s.spin : ''} />
                </button>
              )}
            </div>
            {cloud.pending && !conflicted && (
              <p className={s.pending}>
                Des modifications locales attendent la prochaine synchronisation.
              </p>
            )}
            <button
              type="button"
              className={s.scopeHeading}
              aria-expanded={showScope}
              onClick={() => setShowScope((value) => !value)}
            >
              Choisir les données synchronisées
              <ChevronDown size={16} className={!showScope ? s.collapsed : ''} />
            </button>
            {showScope && (
              <div className={s.scopes}>
                <ScopeRow
                  label="Bibliothèque"
                  detail="Dictionnaire, raccourcis, styles par application et transformations."
                  checked={scope.libraries}
                  disabled={locked}
                  onChange={(value) => saveScope('libraries', value)}
                />
                <ScopeRow
                  label="Préférences de dictée"
                  detail="Langue, reformulation et préférences compatibles entre vos PC."
                  checked={scope.preferences}
                  disabled={locked}
                  onChange={(value) => saveScope('preferences', value)}
                />
                <ScopeRow
                  label="Envoyer aussi mes notes"
                  detail="Le contenu de vos notes sera enregistré dans votre compte."
                  checked={scope.notes}
                  disabled={locked}
                  optional
                  onChange={(value) => saveScope('notes', value)}
                />
                <ScopeRow
                  label="Envoyer aussi mon historique"
                  detail="Les textes dictés et leurs statistiques seront enregistrés dans votre compte."
                  checked={scope.history}
                  disabled={locked}
                  optional
                  onChange={(value) => saveScope('history', value)}
                />
              </div>
            )}
            {!cloud.enabled && (
              <p className={s.helper}>
                Ces choix seront utilisés à l’activation. Aucun envoi automatique pendant que la
                synchronisation est désactivée.
              </p>
            )}
            <p className={s.helper}>
              Les 20 dernières versions envoyées sont conservées dans le compte. Désactiver une
              catégorie arrête ses nouveaux envois, sans effacer ses copies précédentes. Une copie
              locale des cinq derniers remplacements est conservée sur ce PC.
            </p>
          </section>

          {conflicted && (
            <section className={s.conflict} aria-labelledby="cloud-conflict-title">
              <div className={s.sectionHeading}>
                <TriangleAlert size={18} />
                <h4 id="cloud-conflict-title">Choisir la version à conserver</h4>
              </div>
              <p>
                Le PC et le compte contiennent des versions différentes. Aucun remplacement
                automatique : choisissez la version qui doit devenir commune aux appareils.
              </p>
              {!resolve ? (
                <div className={s.resolutionChoices}>
                  <button
                    type="button"
                    className={s.resolution}
                    disabled={locked}
                    onClick={() => setResolve('local')}
                  >
                    <Laptop size={19} />
                    <span>
                      <strong>Version de ce PC</strong>
                      <small>Remplacer la version du compte</small>
                    </span>
                    <ArrowRight size={15} />
                  </button>
                  <button
                    type="button"
                    className={s.resolution}
                    disabled={locked}
                    onClick={() => setResolve('remote')}
                  >
                    <Database size={19} />
                    <span>
                      <strong>Version du compte</strong>
                      <small>Remplacer la version de ce PC</small>
                    </span>
                    <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                <div
                  className={s.confirmation}
                  role="group"
                  aria-label="Confirmer la résolution du conflit"
                >
                  <strong>
                    {resolve === 'local'
                      ? 'Utiliser la version de ce PC ?'
                      : 'Utiliser la version du compte ?'}
                  </strong>
                  <p>
                    {resolve === 'local'
                      ? 'Les catégories sélectionnées dans le compte seront remplacées par celles de ce PC. Ce choix pourra ensuite s’appliquer à vos autres appareils.'
                      : 'Les catégories sélectionnées sur ce PC seront remplacées par celles du compte. Une sauvegarde locale sera créée avant le remplacement.'}
                  </p>
                  <div className={s.actions}>
                    <button
                      type="button"
                      className={s.secondary}
                      disabled={locked}
                      onClick={() => setResolve('')}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      className={s.primary}
                      disabled={locked}
                      onClick={async () => {
                        if (await invoke('cloud.resolve', { strategy: resolve }, 'Conflit résolu.'))
                          setResolve('');
                      }}
                    >
                      {busy === 'cloud.resolve' && <LoaderCircle size={15} className={s.spin} />}
                      Confirmer ce choix
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <button
            type="button"
            className={s.logout}
            disabled={locked}
            onClick={() => invoke('cloud.logout', {}, 'Compte déconnecté sur ce PC.')}
          >
            <LogOut size={15} />
            Se déconnecter de ce PC
          </button>
        </>
      )}

      <div className={s.privacy}>
        <ShieldCheck size={18} />
        <p>
          Vos clés Deepgram et OpenRouter restent dans Windows. L’audio, les sons, le choix du micro
          et les raccourcis système ne sont pas synchronisés.
        </p>
      </div>
      {message && (
        <div
          role={error ? 'alert' : 'status'}
          className={`${s.feedback} ${error ? s.feedbackError : ''}`}
        >
          {error ? <TriangleAlert size={15} /> : <CheckCircle2 size={15} />}
          <p>{message}</p>
        </div>
      )}
    </div>
  );
}
