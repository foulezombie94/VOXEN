import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, LoaderCircle, RefreshCw } from 'lucide-react';
import s from './SidebarUpdate.module.scss';

export default function SidebarUpdate({ updates = {}, collapsed = false, onOpen, run }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const state = updates.state || 'unsupported';
  const ready = Boolean(updates.supported && state === 'ready');
  const checking = state === 'checking';
  const downloading = state === 'downloading';
  const disabled = Boolean(pending || checking || downloading || updates.busy);
  const version = String(updates.currentVersion || '').slice(0, 80);
  const available = String(updates.availableVersion || '').slice(0, 80);

  useEffect(() => setFailed(false), [state]);

  const label = checking
    ? 'Vérification en cours'
    : downloading
      ? 'Téléchargement en cours'
      : ready
        ? 'Installer la mise à jour'
        : 'Mettre à jour';
  const caption = failed
    ? 'Réessayez dans les paramètres'
    : ready
      ? available
        ? `Version ${available} disponible`
        : 'Prête à redémarrer'
      : checking
        ? 'Recherche d’une nouvelle version'
        : downloading
          ? 'Préparation en arrière-plan'
          : state === 'error'
            ? 'Réessayer la vérification'
            : version
              ? `Canal stable · v${version.replace(/^v/, '')}`
              : 'Canal stable';
  const Icon = checking || downloading || pending ? LoaderCircle : ready ? Download : RefreshCw;

  const open = async () => {
    if (disabled || lock.current) return;
    lock.current = true;
    setPending(true);
    setFailed(false);
    try {
      if ((await onOpen?.()) === false) return;
      if (updates.supported && ['idle', 'error'].includes(state)) {
        await run?.('updates.check', {});
      }
    } catch {
      setFailed(true);
    } finally {
      lock.current = false;
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      className={`${s.card} ${collapsed ? s.compact : ''} ${ready ? s.ready : ''}`}
      data-sidebar-update
      data-update-state={state}
      disabled={disabled}
      onClick={open}
      aria-label={`${label}. ${caption}`}
      aria-busy={disabled || undefined}
      title={`${label} — ${caption}`}
    >
      <span className={`${s.icon} ${checking || downloading || pending ? s.spinning : ''}`}>
        <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
      </span>
      {!collapsed && (
        <>
          <span className={s.copy}>
            <span className={s.label}>{label}</span>
            <span className={s.caption}>{caption}</span>
          </span>
          <ArrowUpRight className={s.arrow} size={13} strokeWidth={1.8} aria-hidden="true" />
        </>
      )}
    </button>
  );
}
