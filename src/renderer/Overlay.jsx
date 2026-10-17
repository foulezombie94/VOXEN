import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Mic, X, Check, LoaderCircle, Pause, Copy } from 'lucide-react';
import s from './App.module.scss';
export default function Overlay() {
  const [snapshot, setSnapshot] = useState({ status: { state: 'ready', levels: [] } });
  useEffect(() => {
    window.voxen
      .getSnapshot()
      .then(setSnapshot)
      .catch(() => {});
    return window.voxen.onSnapshot(setSnapshot);
  }, []);
  const status = snapshot.status || {},
    recording = status.state === 'recording',
    processing = status.state === 'processing',
    error = status.state === 'error';
  const drag = useRef(null);
  const call = (action, payload) => window.voxen.call(action, payload).catch(() => {});
  const down = (e) => {
    if (e.button !== 0 || e.target.closest('[data-recovery]')) return;
    drag.current = {
      x: e.screenX,
      y: e.screenY,
      startX: e.screenX,
      startY: e.screenY,
      moved: false,
    };
    e.target.closest('button')?.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d || !e.buttons) return;
    if (!d.moved && Math.hypot(e.screenX - d.startX, e.screenY - d.startY) < 6) return;
    d.moved = true;
    call('overlay.move', { dx: e.screenX - d.x, dy: e.screenY - d.y });
    d.x = e.screenX;
    d.y = e.screenY;
  };
  const click = (e) => {
    if (drag.current?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
    drag.current = null;
  };
  return (
    <main
      className={s.overlayRoot}
      onPointerDownCapture={down}
      onPointerMove={move}
      onClickCapture={click}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        call('overlay.menu');
      }}
    >
      {error && (
        <div className={s.overlayMessage} data-recovery>
          <span>{status.message}</span>
          {status.lastFinalText && (
            <>
              <p className={s.recoveredText}>{status.lastFinalText}</p>
              <button className={s.recoveryCopy} onClick={() => call('dictation.copyLast')}>
                <Copy size={13} />
                Copier le dernier texte
              </button>
            </>
          )}
        </div>
      )}
      <motion.div
        layout
        className={s.capsule}
        style={{ width: recording ? 168 : processing || error ? 200 : 48 }}
        transition={{ type: 'spring', stiffness: 460, damping: 34 }}
      >
        {recording ? (
          <div className={s.recordingContent}>
            <button
              title="Annuler la dictée"
              aria-label="Annuler la dictée"
              onClick={() => call('dictation.cancel')}
            >
              <X size={14} />
            </button>
            <div className={s.waveform} aria-label="Niveau réel du microphone">
              {Array.from({ length: 12 }, (_, i) => (
                <span
                  key={i}
                  style={{
                    height: `${3 + 19 * Math.max(0, Math.min(1, Number(status.levels?.[i] || 0)))}px`,
                  }}
                />
              ))}
            </div>
            <button
              title="Transcrire maintenant"
              aria-label="Terminer la dictée"
              onClick={() => call('dictation.finish')}
            >
              <Check size={16} />
            </button>
          </div>
        ) : processing ? (
          <div className={s.processingContent}>
            <button
              title="Annuler le traitement"
              aria-label="Annuler le traitement"
              onClick={() => call('dictation.cancel')}
            >
              <X size={13} />
            </button>
            <LoaderCircle className={s.spinner} size={14} />
            <span>
              {status.message?.includes('Reformulation')
                ? 'Reformulation…'
                : status.message?.includes('Insertion')
                  ? 'Insertion…'
                  : 'Transcription…'}
            </span>
          </div>
        ) : error ? (
          <button
            className={s.overlayError}
            title={status.message}
            onClick={() => call('dictation.toggle')}
          >
            <Mic size={16} />
            <span>Réessayer</span>
          </button>
        ) : (
          <button
            title="Cliquer pour parler · clic droit : paramètres"
            aria-label="Commencer une dictée"
            onClick={() => call(status.paused ? 'dictation.pause' : 'dictation.toggle')}
          >
            {status.paused ? <Pause size={18} /> : <Mic size={18} />}
          </button>
        )}
      </motion.div>
    </main>
  );
}
