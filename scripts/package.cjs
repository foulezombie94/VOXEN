'use strict';
const { packager } = require('@electron/packager');
const fs = require('node:fs');
const path = require('node:path');
const { prepareRuntime, runtimeNames } = require('./prepare-windows-runtime.cjs');
const root = path.resolve(__dirname, '..');
async function main() {
  const runtime = prepareRuntime();
  const paths = await packager({
    dir: root,
    out: path.join(root, 'release'),
    name: 'Voxen',
    platform: 'win32',
    arch: 'x64',
    icon: path.join(root, 'assets/icon.ico'),
    overwrite: true,
    asar: false,
    prune: true,
    ignore: [
      /^\/release(?:\/|$)/,
      /^\/artifacts(?:\/|$)/,
      /^\/tests(?:\/|$)/,
      /^\/backend(?:\/|$)/,
      /^\/\.github(?:\/|$)/,
      /webpack\.config\.cjs$/,
      /package-lock\.json$/,
    ],
  });
  for (const directory of paths)
    for (const name of runtimeNames)
      fs.copyFileSync(path.join(runtime, name), path.join(directory, name));
  console.log(paths.join('\n'));
}
main().catch((error) => {
  console.error('Création du paquet impossible : ' + error.message);
  process.exitCode = 1;
});
