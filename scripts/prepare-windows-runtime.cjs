'use strict';
const fs = require('node:fs');
const path = require('node:path');
const runtimeNames = [
  'msvcp140.dll',
  'msvcp140_1.dll',
  'msvcp140_atomic_wait.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
];
function prepareRuntime() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('La création du paquet nécessite Windows x64.');
  const destination = path.resolve(__dirname, '../assets/windows-runtime');
  const candidates = [
    process.env.VOXEN_RUNTIME_DIR,
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
  ].filter(Boolean);
  const missing = runtimeNames.filter(
    (name) =>
      !fs.existsSync(path.join(destination, name)) &&
      !candidates.some((dir) => fs.existsSync(path.join(dir, name))),
  );
  if (missing.length)
    throw new Error(
      'DLL Microsoft requises : ' +
        missing.join(', ') +
        '. Indiquez leur dossier avec VOXEN_RUNTIME_DIR.',
    );
  fs.mkdirSync(destination, { recursive: true });
  for (const name of runtimeNames) {
    if (fs.existsSync(path.join(destination, name))) continue;
    const source = candidates
      .map((dir) => path.join(dir, name))
      .find((file) => fs.existsSync(file));
    fs.copyFileSync(source, path.join(destination, name));
  }
  return destination;
}
if (require.main === module) {
  try {
    console.log('Runtime prêt : ' + prepareRuntime());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { prepareRuntime, runtimeNames };
