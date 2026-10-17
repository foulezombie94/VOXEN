'use strict';

// Win32 bridge, x64 only. Native calls stay in Electron's main process.
// No credential value is read during readiness checks or written to application files.
const koffi = require('koffi');
const path = require('node:path');
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Le pont Windows de Voxen nécessite Windows 64 bits.');
}
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const advapi32 = koffi.load('advapi32.dll');
const crt = koffi.load('msvcrt.dll');
const api = {
  credEnumerate: advapi32.func(
    'int __stdcall CredEnumerateW(const char16_t *filter, uint32_t flags, _Out_ uint32_t *count, _Out_ void **credentials)',
  ),
  credRead: advapi32.func(
    'int __stdcall CredReadW(const char16_t *target, uint32_t type, uint32_t flags, _Out_ void **credential)',
  ),
  credFree: advapi32.func('void __stdcall CredFree(void *buffer)'),
  foreground: user32.func('void * __stdcall GetForegroundWindow()'),
  isWindow: user32.func('int __stdcall IsWindow(void *window)'),
  windowProcess: user32.func(
    'uint32_t __stdcall GetWindowThreadProcessId(void *window, _Out_ uint32_t *processId)',
  ),
  keyState: user32.func('int16_t __stdcall GetAsyncKeyState(int key)'),
  sendInput: user32.func(
    'uint32_t __stdcall SendInput(uint32_t count, const void *inputs, int size)',
  ),
  openProcess: kernel32.func(
    'void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t processId)',
  ),
  imageName: kernel32.func(
    'int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, _Out_ void *name, _Inout_ uint32_t *size)',
  ),
  closeHandle: kernel32.func('int __stdcall CloseHandle(void *handle)'),
  openClipboard: user32.func('int __stdcall OpenClipboard(void *owner)'),
  closeClipboard: user32.func('int __stdcall CloseClipboard()'),
  emptyClipboard: user32.func('int __stdcall EmptyClipboard()'),
  enumFormats: user32.func('uint32_t __stdcall EnumClipboardFormats(uint32_t format)'),
  getClipboard: user32.func('void * __stdcall GetClipboardData(uint32_t format)'),
  setClipboard: user32.func('void * __stdcall SetClipboardData(uint32_t format, void *data)'),
  clipboardSequence: user32.func('uint32_t __stdcall GetClipboardSequenceNumber()'),
  formatName: user32.func(
    'int __stdcall GetClipboardFormatNameW(uint32_t format, _Out_ void *name, int capacity)',
  ),
  registerFormat: user32.func('uint32_t __stdcall RegisterClipboardFormatW(const char16_t *name)'),
  globalSize: kernel32.func('size_t __stdcall GlobalSize(void *handle)'),
  globalAlloc: kernel32.func('void * __stdcall GlobalAlloc(uint32_t flags, size_t size)'),
  globalLock: kernel32.func('void * __stdcall GlobalLock(void *handle)'),
  globalUnlock: kernel32.func('int __stdcall GlobalUnlock(void *handle)'),
  globalFree: kernel32.func('void * __stdcall GlobalFree(void *handle)'),
  createWindow: user32.func(
    'void * __stdcall CreateWindowExW(uint32_t exStyle, const char16_t *className, const char16_t *name, uint32_t style, int x, int y, int width, int height, void *parent, void *menu, void *instance, void *param)',
  ),
  destroyWindow: user32.func('int __stdcall DestroyWindow(void *window)'),
  getLastError: kernel32.func('uint32_t __stdcall GetLastError()'),
  setLastError: kernel32.func('void __stdcall SetLastError(uint32_t error)'),
  copy: crt.func('void *memcpy(_Out_ void *destination, const void *source, size_t size)'),
  zero: crt.func('void *memset(void *destination, int value, size_t size)'),
};

const CREDENTIAL = koffi.struct('VoxenCredential', {
  Flags: 'uint32_t',
  Type: 'uint32_t',
  TargetName: 'const char16_t *',
  Comment: 'void *',
  LastWrittenLow: 'uint32_t',
  LastWrittenHigh: 'uint32_t',
  CredentialBlobSize: 'uint32_t',
  CredentialBlob: 'void *',
  Persist: 'uint32_t',
  AttributeCount: 'uint32_t',
  Attributes: 'void *',
  TargetAlias: 'void *',
  UserName: 'const char16_t *',
});
const writeCredential = advapi32.func(
  'int __stdcall CredWriteW(const VoxenCredential *credential, uint32_t flags)',
);
if (koffi.sizeof(CREDENTIAL) !== 80) throw new Error('Structure Windows non prise en charge.');
const targets = Object.freeze({ deepgram: 'Voxen/Deepgram', openrouter: 'Voxen/OpenRouter' });
function credentialTarget(provider) {
  if (!Object.hasOwn(targets, provider)) throw new Error('Fournisseur de clé inconnu.');
  return targets[provider];
}

function credentialExists(provider) {
  const target = credentialTarget(provider);
  const count = [0];
  const list = [null];
  if (!api.credEnumerate(target, 0, count, list)) return false;
  try {
    // Deliberately decode only each CREDENTIAL.TargetName pointer (offset 8), never Blob.
    for (let i = 0; i < count[0]; i++) {
      const item = koffi.decode(list[0], i * 8, 'void *');
      const namePointer = koffi.decode(item, 8, 'void *');
      if (namePointer && koffi.decode.string16(namePointer) === target) return true;
    }
    return false;
  } finally {
    api.credFree(list[0]);
  }
}

async function withCredential(provider, callback) {
  const target = credentialTarget(provider);
  if (typeof callback !== 'function') throw new Error('Action de connexion invalide.');
  const result = [null];
  if (!api.credRead(target, 1, 0, result)) {
    throw new Error('Clé absente : renseignez-la dans Paramètres → Clés API.');
  }
  let bytes;
  let key;
  try {
    const size = koffi.decode(result[0], 32, 'uint32_t');
    const blob = koffi.decode(result[0], 40, 'void *');
    if (!blob || size < 2 || size > 2560 || size % 2)
      throw new Error('Format de clé Windows invalide.');
    bytes = Buffer.alloc(size);
    api.copy(bytes, blob, size);
    api.zero(blob, 0, size);
    key = bytes.toString('utf16le').replace(/\0+$/u, '');
  } catch (error) {
    bytes?.fill(0);
    throw error;
  } finally {
    api.credFree(result[0]);
  }
  // HTTPS authentication needs a JS string temporarily. JS strings cannot be reliably erased.
  // Caller must never retain/log the key or pass it to renderer code.
  try {
    return await callback(key);
  } finally {
    bytes?.fill(0);
    key = undefined;
  }
}

function saveCredential(provider, value) {
  const target = credentialTarget(provider);
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 1200 ||
    value.includes('\0')
  ) {
    throw new Error('Clé vide ou taille non prise en charge.');
  }
  const bytes = Buffer.from(value, 'utf16le');
  try {
    const credential = {
      Flags: 0,
      Type: 1,
      TargetName: target,
      Comment: null,
      LastWrittenLow: 0,
      LastWrittenHigh: 0,
      CredentialBlobSize: bytes.length,
      CredentialBlob: bytes,
      Persist: 2,
      AttributeCount: 0,
      Attributes: null,
      TargetAlias: null,
      UserName: 'Voxen',
    };
    if (!writeCredential(credential, 0))
      throw new Error(
        "Windows n'a pas pu sauvegarder la clé dans le Gestionnaire d'identification.",
      );
  } finally {
    bytes.fill(0);
  }
}

function foregroundTarget() {
  const handle = api.foreground();
  const pid = [0];
  let processName = 'Inconnue';
  if (handle) {
    api.windowProcess(handle, pid);
    const processHandle = api.openProcess(0x1000, 0, pid[0]);
    if (processHandle) {
      try {
        const buffer = Buffer.alloc(32768 * 2);
        const size = [32768];
        if (api.imageName(processHandle, 0, buffer, size)) {
          processName = path.win32.basename(buffer.toString('utf16le', 0, size[0] * 2), '.exe');
        }
        buffer.fill(0);
      } finally {
        api.closeHandle(processHandle);
      }
    }
  }
  return { handle: handle ? handle.toString() : '0', processName };
}
function modifiersReleased() {
  return [0x10, 0x11, 0x12, 0x5b, 0x5c].every((key) => !(api.keyState(key) & 0x8000));
}
function targetHandle(target) {
  try {
    return BigInt(typeof target === 'object' && target !== null ? target.handle : target);
  } catch {
    return 0n;
  }
}
function targetActive(handle) {
  return handle !== 0n && !!api.isWindow(handle) && api.foreground() === handle;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Windows x64 INPUT is 40 bytes; KEYBDINPUT starts at byte 8.
function input(vk, scan, flags) {
  const buffer = Buffer.alloc(40);
  buffer.writeUInt32LE(1, 0);
  buffer.writeUInt16LE(vk, 8);
  buffer.writeUInt16LE(scan, 10);
  buffer.writeUInt32LE(flags, 12);
  return buffer;
}
function sendInputs(events) {
  return api.sendInput(events.length, Buffer.concat(events), 40);
}
function sendPaste() {
  const sent = sendInputs([
    input(0x11, 0, 0),
    input(0x56, 0, 0),
    input(0x56, 0, 2),
    input(0x11, 0, 2),
  ]);
  if (sent !== 4) sendInputs([input(0x56, 0, 2), input(0x11, 0, 2)]);
  return sent === 4;
}
async function sendUnicode(text, handle) {
  for (let offset = 0; offset < text.length;) {
    if (!targetActive(handle) || !modifiersReleased()) return false;
    let count = Math.min(64, text.length - offset);
    const end = text.charCodeAt(offset + count - 1);
    if (offset + count < text.length && end >= 0xd800 && end <= 0xdbff) count--;
    const events = [];
    for (let i = 0; i < count; i++) {
      const unit = text.charCodeAt(offset + i);
      events.push(input(0, unit, 4), input(0, unit, 6));
    }
    if (sendInputs(events) !== events.length) return false;
    offset += count;
    await delay(5);
  }
  return true;
}

let clipboardOwner = null;
function owner() {
  if (!clipboardOwner) {
    clipboardOwner = api.createWindow(
      0,
      'STATIC',
      'VoxenClipboardOwner',
      0,
      0,
      0,
      0,
      0,
      BigInt.asUintN(64, -3n),
      null,
      null,
      null,
    );
    if (!clipboardOwner) throw new Error('Le presse-papiers Windows est indisponible.');
  }
  return clipboardOwner;
}
process.once('exit', () => {
  if (clipboardOwner) api.destroyWindow(clipboardOwner);
});
async function withClipboard(action) {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (api.openClipboard(owner())) {
      try {
        return action();
      } finally {
        api.closeClipboard();
      }
    }
    await delay(15);
  }
  throw new Error('Le presse-papiers est occupé. Réessayez.');
}
const MAX_CLIPBOARD = 64 * 1024 * 1024;
class UnsupportedClipboard extends Error {}
function captureClipboard() {
  const items = [];
  let total = 0;
  let format = 0;
  try {
    for (;;) {
      api.setLastError(0);
      format = api.enumFormats(format);
      if (!format) {
        if (api.getLastError()) throw new UnsupportedClipboard();
        break;
      }
      // These formats are GDI/metafile/private object handles, not movable HGLOBAL.
      if (
        [2, 3, 9, 14, 0x80, 0x81, 0x82, 0x83, 0x8e].includes(format) ||
        (format >= 0x200 && format <= 0x3ff)
      ) {
        throw new UnsupportedClipboard();
      }
      const nameBuffer = Buffer.alloc(512);
      const nameLength = api.formatName(format, nameBuffer, 256);
      const name = nameBuffer.toString('utf16le', 0, Math.max(0, nameLength) * 2);
      if (/^(DataObject|Ole Private Data|ObjectLink|OwnerLink|Link Source)$/iu.test(name))
        throw new UnsupportedClipboard();
      const memory = api.getClipboard(format);
      if (!memory) throw new UnsupportedClipboard();
      const size = Number(api.globalSize(memory));
      total += size;
      if (!Number.isSafeInteger(size) || size <= 0 || total > MAX_CLIPBOARD)
        throw new UnsupportedClipboard();
      const pointer = api.globalLock(memory);
      if (!pointer) throw new UnsupportedClipboard();
      const bytes = Buffer.alloc(size);
      try {
        api.copy(bytes, pointer, size);
      } finally {
        api.globalUnlock(memory);
      }
      items.push({ format, bytes });
    }
    return { items, sequence: api.clipboardSequence() };
  } catch (error) {
    items.forEach((item) => item.bytes.fill(0));
    throw error;
  }
}
function bytesHandle(bytes) {
  const memory = api.globalAlloc(2, bytes.length);
  if (!memory) throw new Error('Mémoire insuffisante pour le presse-papiers.');
  const pointer = api.globalLock(memory);
  if (!pointer) {
    api.globalFree(memory);
    throw new Error('Mémoire du presse-papiers inaccessible.');
  }
  try {
    api.copy(pointer, bytes, bytes.length);
  } catch (error) {
    api.globalUnlock(memory);
    api.globalFree(memory);
    throw error;
  }
  api.globalUnlock(memory);
  return memory;
}
function replaceClipboard(items, onEmptied = () => {}) {
  // Prepare every allocation before emptying the original clipboard.
  const handles = [];
  try {
    for (const item of items)
      handles.push({ format: item.format, memory: bytesHandle(item.bytes) });
    if (!api.emptyClipboard()) throw new Error('Écriture du presse-papiers refusée.');
    onEmptied();
    for (const item of handles) {
      if (!api.setClipboard(item.format, item.memory))
        throw new Error('Windows a refusé un format du presse-papiers.');
      item.memory = null; // Windows owns it now.
    }
  } finally {
    handles.forEach((item) => {
      if (item.memory) api.globalFree(item.memory);
    });
  }
}
let insertionRunning = false;
async function insertText(text, target, restoreClipboard = true) {
  if (insertionRunning)
    return { inserted: false, restored: false, message: 'Un collage est déjà en cours.' };
  if (typeof text !== 'string' || !text.trim())
    return { inserted: false, restored: false, message: 'Aucun texte à insérer.' };
  const handle = targetHandle(target);
  if (!targetActive(handle))
    return {
      inserted: false,
      restored: false,
      message: "L'application active a changé : texte conservé dans Historique.",
    };
  insertionRunning = true;
  let snapshot;
  let ownedSequence;
  let clipboardChanged = false;
  let inserted = false;
  let restored = false;
  let failure = false;
  try {
    for (let i = 0; i < 30 && !modifiersReleased(); i++) await delay(20);
    if (!modifiersReleased())
      return {
        inserted: false,
        restored: false,
        message: 'Relâchez les touches de modification. Texte conservé dans Historique.',
      };
    if (!targetActive(handle))
      return {
        inserted: false,
        restored: false,
        message: 'La fenêtre active a changé : collage annulé.',
      };
    if (restoreClipboard) {
      try {
        snapshot = await withClipboard(captureClipboard);
      } catch (error) {
        if (!(error instanceof UnsupportedClipboard)) throw error;
        const typed = await sendUnicode(text, handle);
        return {
          inserted: typed,
          restored: false,
          message: typed
            ? 'Texte saisi directement · presse-papiers intact.'
            : 'Saisie interrompue ou refusée. Le texte peut être partiel ; version complète dans Historique. Presse-papiers intact.',
        };
      }
    }
    const bytes = Buffer.from(text + '\0', 'utf16le');
    try {
      await withClipboard(() => {
        if (!targetActive(handle) || (snapshot && api.clipboardSequence() !== snapshot.sequence))
          throw new Error('Collage annulé.');
        const items = [{ format: 13, bytes }];
        for (const name of ['CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard']) {
          const format = api.registerFormat(name);
          if (format) items.push({ format, bytes: Buffer.alloc(4) });
        }
        try {
          replaceClipboard(items, () => {
            clipboardChanged = true;
          });
        } finally {
          ownedSequence = api.clipboardSequence();
        }
      });
    } finally {
      bytes.fill(0);
    }
    if (targetActive(handle) && modifiersReleased()) inserted = sendPaste();
    await delay(300);
  } catch {
    failure = true;
  } finally {
    if (snapshot && clipboardChanged) {
      try {
        restored = await withClipboard(() => {
          if (api.clipboardSequence() !== ownedSequence) return false;
          replaceClipboard(snapshot.items);
          return true;
        });
      } catch {
        restored = false;
      }
    }
    snapshot?.items.forEach((item) => item.bytes.fill(0));
    insertionRunning = false;
  }
  if (failure || !inserted)
    return {
      inserted: false,
      restored,
      message:
        'Collage refusé ou fenêtre modifiée. Texte conservé dans Historique. Une application administrateur peut bloquer la saisie.',
    };
  return {
    inserted: true,
    restored,
    message: restoreClipboard
      ? restored
        ? 'Texte inséré · presse-papiers restauré.'
        : 'Ctrl+V envoyé. Presse-papiers modifié ou occupé : aucun nouveau contenu copié écrasé.'
      : 'Texte inséré · restauration désactivée.',
  };
}

function isShortcutDown(vk) {
  return Number.isInteger(vk) && vk >= 1 && vk <= 254 && !!(api.keyState(vk) & 0x8000);
}
module.exports = {
  isShortcutDown,
  credentialExists,
  withCredential,
  saveCredential,
  foregroundTarget,
  insertText,
  modifiersReleased,
};
