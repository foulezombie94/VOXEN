import React, { useMemo, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import {
  ArrowRight,
  Check,
  Cloud,
  CloudOff,
  Settings,
  ShieldCheck,
  UserCircle,
} from 'lucide-react';
import s from './AccountMenu.module.scss';

export default function AccountMenu({
  cloud = {},
  firstName = '',
  navigate,
  className,
  iconClassName,
}) {
  const [open, setOpen] = useState(false);
  const navigating = useRef(false);
  const connected = Boolean(cloud.connected);
  const name = connected
    ? cloud.displayName || firstName || 'Votre compte Voxen'
    : firstName || 'Votre espace Voxen';
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => [...word][0])
    .join('')
    .toLocaleUpperCase('fr-FR');
  // The shipped Windows card is attached to the top right of the hub viewport.
  const anchor = useMemo(
    () => ({
      contextElement: document.documentElement,
      getBoundingClientRect: () => ({
        x: innerWidth - 8,
        y: 44,
        top: 44,
        bottom: 44,
        left: innerWidth - 8,
        right: innerWidth - 8,
        width: 0,
        height: 0,
      }),
    }),
    [],
  );
  const go = (page) => {
    navigating.current = true;
    setOpen(false);
    void navigate(page);
  };
  const syncText = !cloud.enabled
    ? 'Synchronisation désactivée'
    : cloud.status === 'conflict'
      ? 'Deux versions à départager'
      : cloud.status === 'syncing'
        ? 'Synchronisation en cours'
        : cloud.status === 'error' || cloud.status === 'offline'
          ? 'Connexion à vérifier'
          : cloud.status === 'synced'
            ? 'Vos données sont à jour'
            : 'Synchronisation activée';
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) navigating.current = false;
        setOpen(next);
      }}
    >
      <Popover.Trigger
        className={`${className || ''} ${s.trigger}`}
        aria-label="Compte"
        title="Compte"
      >
        <UserCircle size={18} strokeWidth={1.7} className={iconClassName} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Backdrop className={s.backdrop} data-account-backdrop />
        <Popover.Positioner
          className={s.positioner}
          anchor={anchor}
          positionMethod="fixed"
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={8}
        >
          <Popover.Popup
            className={s.popup}
            data-account-menu
            finalFocus={() => !navigating.current}
          >
            <div className={s.identity}>
              <div className={s.avatar} aria-hidden="true">
                {connected ? initials : <UserCircle size={27} strokeWidth={1.35} />}
              </div>
              <div className={s.identityText}>
                <Popover.Title className={s.name}>{name}</Popover.Title>
                <Popover.Description
                  className={s.email}
                  title={connected ? cloud.email : undefined}
                >
                  {connected ? cloud.email : 'Sur cet ordinateur'}
                </Popover.Description>
              </div>
              <span className={s.badge}>
                {connected && <Check size={11} />}
                {connected ? 'Connecté' : 'Local'}
              </span>
            </div>
            <div className={s.divider} />
            <div className={s.summary}>
              <div>
                <h3>{connected ? 'Votre espace synchronisé' : 'Retrouvez vos repères'}</h3>
                <p>{connected ? syncText : 'Vos mots, raccourcis et préférences sur vos PC.'}</p>
              </div>
              <button type="button" className={s.primary} onClick={() => go('account')}>
                {connected ? 'Configurer' : 'Se connecter'}
              </button>
            </div>
            <div className={s.local}>
              <ShieldCheck size={15} />
              <span>
                La dictée reste disponible sans compte. Vos clés API restent dans Windows.
              </span>
            </div>
            <div className={s.divider} />
            <div className={s.actions}>
              <button type="button" data-account-manage onClick={() => go('account')}>
                <UserCircle size={17} />
                <span>Gérer mon compte</span>
                <ArrowRight size={16} />
              </button>
              <button type="button" data-account-sync onClick={() => go('account')}>
                {cloud.enabled ? <Cloud size={17} /> : <CloudOff size={17} />}
                <span>Préférences de synchronisation</span>
                <ArrowRight size={16} />
              </button>
              <button type="button" data-account-settings onClick={() => go('settings')}>
                <Settings size={17} />
                <span>Paramètres de Voxen</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
