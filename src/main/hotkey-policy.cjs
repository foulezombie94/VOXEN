'use strict';

const MODIFIERS = ['Control', 'Alt', 'Shift', 'Super'];
const ELECTRON_KEYS = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
  'Space',
  'Tab',
  'Capslock',
  'Numlock',
  'Scrolllock',
  'Backspace',
  'Delete',
  'Insert',
  'Return',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
  'PrintScreen',
  'Pause',
  'Plus',
  'Minus',
  'Comma',
  'Period',
  'Slash',
  'Backslash',
  'OpenBracket',
  'CloseBracket',
  'Semicolon',
  'Quote',
  'Backquote',
  'num0',
  'num1',
  'num2',
  'num3',
  'num4',
  'num5',
  'num6',
  'num7',
  'num8',
  'num9',
  'numadd',
  'numsub',
  'numdec',
  'nummult',
  'numdiv',
  'numsep',
]);
const CODE_KEYS = {
  Space: 'Space',
  Tab: 'Tab',
  CapsLock: 'Capslock',
  NumLock: 'Numlock',
  ScrollLock: 'Scrolllock',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Enter: 'Enter',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  PrintScreen: 'PrintScreen',
  Pause: 'Pause',
  NumpadEnter: 'Enter',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadDecimal: 'numdec',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadComma: 'numsep',
  Minus: 'Minus',
  Equal: 'Plus',
  BracketLeft: 'OpenBracket',
  BracketRight: 'CloseBracket',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Backquote: 'Backquote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
};
const MODIFIER_VKS = {
  ControlLeft: 162,
  ControlRight: 163,
  AltLeft: 164,
  AltRight: 165,
  ShiftLeft: 160,
  ShiftRight: 161,
  MetaLeft: 91,
  MetaRight: 92,
};
const LEGACY_ACCELERATORS = {
  86: 'Control+V',
  123: 'VK:123',
  163: 'VK:163',
  165: 'VK:165',
};

function normalizeAccelerator(value) {
  const input = String(value || '').trim();
  if (/^VK:(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4])$/.test(input)) return input;
  const parts = input.split('+');
  if (parts.length < 1 || parts.some((part) => !part)) return null;
  let key = parts.pop();
  if (/^[a-z]$/.test(key)) key = key.toUpperCase();
  const modifiers = parts.map(
    (part) =>
      ({ Ctrl: 'Control', CommandOrControl: 'Control', Cmd: 'Super', Meta: 'Super' })[part] || part,
  );
  if (
    !ELECTRON_KEYS.has(key) ||
    modifiers.some((modifier) => !MODIFIERS.includes(modifier)) ||
    new Set(modifiers).size !== modifiers.length
  )
    return null;
  return [...MODIFIERS.filter((modifier) => modifiers.includes(modifier)), key].join('+');
}

function acceleratorFromKeyboardEvent(event, { modifierReleased = false } = {}) {
  const keyCode = Number(event.keyCode);
  const code = String(event.code || '');
  if (!Number.isInteger(keyCode) || keyCode <= 0 || keyCode > 254) return null;
  // Wait for keyup before accepting a modifier alone, so Ctrl+E is not captured as Ctrl.
  if (MODIFIER_VKS[code]) return modifierReleased ? `VK:${MODIFIER_VKS[code]}` : null;
  const modifiers = [
    event.ctrlKey && 'Control',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Super',
  ].filter(Boolean);
  if (!modifiers.length) return `VK:${keyCode}`;
  let key = CODE_KEYS[code];
  if (!key && /^Key[A-Z]$/.test(code)) key = code.slice(3);
  if (!key && /^Digit[0-9]$/.test(code)) key = code.slice(5);
  if (!key && /^Numpad[0-9]$/.test(code)) key = `num${code.slice(6)}`;
  if (!key && /^F(?:[1-9]|1\d|2[0-4])$/.test(code)) key = code;
  if (!key && event.key === '+') key = 'Plus';
  if (!key && event.key === ' ') key = 'Space';
  const eventKey = String(event.key || '');
  if (!key && eventKey.length === 1 && /^[A-Za-z0-9]$/.test(eventKey)) key = eventKey.toUpperCase();
  return key ? normalizeAccelerator([...modifiers, key].join('+')) : null;
}

function legacyAccelerator(virtualKey) {
  return LEGACY_ACCELERATORS[Number(virtualKey)] || null;
}

function virtualKeyOf(accelerator) {
  const match = /^VK:(\d+)$/.exec(String(accelerator || ''));
  return match ? Number(match[1]) : null;
}

function displayAccelerator(value) {
  const accelerator = normalizeAccelerator(value);
  if (!accelerator) return 'Ctrl+V';
  const virtualKey = virtualKeyOf(accelerator);
  if (virtualKey != null) {
    const labels = {
      8: 'Retour arrière',
      9: 'Tab',
      13: 'Entrée',
      16: 'Maj',
      17: 'Ctrl',
      18: 'Alt',
      20: 'Verr. Maj',
      27: 'Échap',
      32: 'Espace',
      33: 'Page préc.',
      34: 'Page suiv.',
      35: 'Fin',
      36: 'Début',
      37: '←',
      38: '↑',
      39: '→',
      40: '↓',
      45: 'Inser',
      46: 'Suppr',
      91: 'Windows gauche',
      92: 'Windows droite',
      160: 'Maj gauche',
      161: 'Maj droite',
      162: 'Ctrl gauche',
      163: 'Ctrl droite',
      164: 'Alt gauche',
      165: 'Alt droite',
    };
    return (
      labels[virtualKey] ||
      (virtualKey >= 48 && virtualKey <= 57
        ? String.fromCharCode(virtualKey)
        : virtualKey >= 65 && virtualKey <= 90
          ? String.fromCharCode(virtualKey)
          : virtualKey >= 112 && virtualKey <= 135
            ? `F${virtualKey - 111}`
            : `Touche ${virtualKey}`)
    );
  }
  const labels = { Control: 'Ctrl', Shift: 'Maj', Super: 'Win', Space: 'Espace', Escape: 'Échap' };
  return accelerator
    .split('+')
    .map((part) => labels[part] || part)
    .join('+');
}

function shouldSuspendForFocusedWindow(accelerator, windowFocused) {
  return windowFocused && normalizeAccelerator(accelerator) === 'Control+V';
}

module.exports = {
  acceleratorFromKeyboardEvent,
  displayAccelerator,
  legacyAccelerator,
  normalizeAccelerator,
  shouldSuspendForFocusedWindow,
  virtualKeyOf,
};
