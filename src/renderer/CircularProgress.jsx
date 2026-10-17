import React from 'react';
import { Check, Download } from 'lucide-react';
import s from './CircularProgress.module.scss';

export default function CircularProgress({ value = null, complete = false, compact = false }) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const percent = complete ? 100 : known ? Math.min(100, Math.max(0, value)) : null;
  const displayed = percent == null ? null : Math.floor(percent);
  return (
    <span
      className={`${s.root} ${compact ? s.compact : ''} ${complete ? s.complete : ''}`}
      role={complete ? 'img' : 'progressbar'}
      aria-label={complete ? 'Mise à jour prête à installer' : 'Téléchargement de la mise à jour'}
      aria-valuemin={complete ? undefined : 0}
      aria-valuemax={complete ? undefined : 100}
      aria-valuenow={complete ? undefined : (percent ?? undefined)}
      aria-valuetext={
        complete
          ? undefined
          : percent == null
            ? 'Connexion au téléchargement'
            : `${displayed} % téléchargés`
      }
      data-circular-progress
      data-progress-value={percent ?? 'unknown'}
    >
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <circle className={s.track} cx="28" cy="28" r="24" />
        <circle
          className={`${s.fill} ${percent == null ? s.indeterminate : ''}`}
          cx="28"
          cy="28"
          r="24"
          pathLength="100"
          strokeDasharray={percent == null ? '24 76' : '100 100'}
          strokeDashoffset={percent == null ? 0 : 100 - percent}
        />
      </svg>
      <span className={s.center} aria-hidden="true">
        {complete ? (
          <Check size={compact ? 16 : 21} strokeWidth={2.1} />
        ) : percent == null ? (
          <Download size={compact ? 14 : 18} />
        ) : (
          <>
            {displayed}
            <small>%</small>
          </>
        )}
      </span>
    </span>
  );
}
