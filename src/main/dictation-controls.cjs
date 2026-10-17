'use strict';

function usesEscape(shortcut) {
  return shortcut === 'Escape' || shortcut === 'VK:27';
}

// Escape belongs to the foreground application again as soon as dictation ends.
class TemporaryEscape {
  constructor({ shortcuts, isDown, cancel, timers = globalThis }) {
    Object.assign(this, { shortcuts, isDown, cancel, timers });
    this.registered = false;
    this.poll = null;
    this.active = false;
  }
  sync({ state, shortcut, disabled = false }) {
    const active = !disabled && ['recording', 'processing'].includes(state);
    if (!active || usesEscape(shortcut)) {
      this.release();
      return;
    }
    this.active = true;
    if (this.registered || this.poll != null) return;
    this.registered = this.shortcuts.register('Escape', () => {
      if (this.active) this.cancel();
    });
    if (this.registered) return;
    // An app may already own this accelerator. Observe Escape without stealing it.
    let previous = this.isDown(27);
    this.poll = this.timers.setInterval(() => {
      const down = this.isDown(27);
      if (this.active && down && !previous) this.cancel();
      previous = down;
    }, 20);
  }
  release() {
    this.active = false;
    if (this.registered) this.shortcuts.unregister('Escape');
    if (this.poll != null) this.timers.clearInterval(this.poll);
    this.registered = false;
    this.poll = null;
  }
}

function copyLastDictationItem({ getText, writeText, disabled = false }) {
  return {
    label: 'Copier la dernière dictée',
    enabled: !disabled && Boolean(getText()),
    click: () => {
      const text = getText();
      if (!disabled && text) writeText(text);
    },
  };
}

module.exports = { TemporaryEscape, copyLastDictationItem, usesEscape };
