import React, { useState } from 'react';
import { ArrowUpRight, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
import CircularProgress from './CircularProgress';
import s from './SidebarUpdate.module.scss';

export default function SidebarUpdate({ updates = {}, collapsed = false, onOpen }) {
  const [pending, setPending] = useState(false);
  const state = updates.state || 'unsupported';
  const version = String(updates.availableVersion || '').slice(0, 80);
  const visible =
    updates.supported && version && ['available', 'downloading', 'ready', 'error'].includes(state);
  if (!visible) return null;
  const ready = state === 'ready';
  const error = state === 'error';
  const percent = typeof updates.downloadPercent === 'number' ? updates.downloadPercent : null;
  const verifying = !ready && percent >= 100;
  const title = ready
    ? 'Tout est prêt.'
    : error
      ? 'Téléchargement interrompu'
      : verifying
        ? 'Dernières vérifications…'
        : 'Voxen s’améliore.';
  const subtitle = ready
    ? 'La nouvelle version vous attend.'
    : error
      ? 'Reprenez depuis les paramètres.'
      : verifying
        ? 'Le téléchargement est terminé.'
        : 'Téléchargement en arrière-plan';
  const open = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onOpen?.();
    } finally {
      setPending(false);
    }
  };
  if (collapsed)
    return (
      <button
        className={s.compact}
        onClick={open}
        disabled={pending}
        data-sidebar-update
        data-sidebar-update-open
        title={`Mise à jour ${version} — ${title}`}
        aria-label={`Mise à jour ${version} — ${title}`}
      >
        {error ? (
          <TriangleAlert size={18} />
        ) : (
          <CircularProgress value={percent} complete={ready} compact />
        )}
      </button>
    );
  return (
    <section
      className={`${s.card} ${ready ? s.ready : ''}`}
      data-sidebar-update
      data-update-state={state}
      aria-label="Mise à jour de Voxen"
    >
      <div className={s.eyebrow}>
        <Sparkles size={11} aria-hidden="true" />
        <span>NOUVELLE VERSION</span>
        <span className={s.version}>v{version.replace(/^v/, '')}</span>
      </div>
      <div className={s.summary}>
        {error ? (
          <span className={s.errorIcon}>
            <TriangleAlert size={21} />
          </span>
        ) : (
          <CircularProgress value={percent} complete={ready} compact />
        )}
        <div className={s.copy}>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
      </div>
      <button className={s.action} onClick={open} disabled={pending} data-sidebar-update-open>
        {ready ? <RotateCcw size={13} aria-hidden="true" /> : null}
        {ready ? 'Mettre à jour' : error ? 'Réessayer' : 'Voir le téléchargement'}
        {!ready && <ArrowUpRight size={13} aria-hidden="true" />}
      </button>
    </section>
  );
}
