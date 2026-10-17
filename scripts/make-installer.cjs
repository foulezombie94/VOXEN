'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { runtimeNames } = require('./prepare-windows-runtime.cjs');
const { collectAssets } = require('./publish-release.cjs');

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('La création de l’installateur nécessite Windows x64.');
  const root = path.resolve(__dirname, '..');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (metadata.name !== 'voxen-desktop' || !/^\d+\.\d+\.\d+$/.test(metadata.version))
    throw new Error('Le nom ou la version stable du paquet est invalide.');
  const appDirectory = path.join(root, 'release', 'Voxen-win32-x64');
  const outputDirectory = path.join(root, 'release', 'installer');
  for (const file of ['Voxen.exe', ...runtimeNames]) {
    if (!fs.existsSync(path.join(appDirectory, file)))
      throw new Error(`Paquet incomplet : ${file}. Exécutez npm run package.`);
  }
  const packagedMetadata = JSON.parse(
    fs.readFileSync(path.join(appDirectory, 'resources', 'app', 'package.json'), 'utf8'),
  );
  if (packagedMetadata.name !== metadata.name || packagedMetadata.version !== metadata.version)
    throw new Error('Le paquet portable ne correspond pas à la version source.');
  // Only this generated directory is cleared. Never resolve an input/environment path for deletion.
  if (path.relative(root, outputDirectory) !== path.join('release', 'installer'))
    throw new Error('Dossier de sortie inattendu.');
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  const installer = await import('electron-winstaller');
  const createWindowsInstaller =
    installer.createWindowsInstaller || installer.default?.createWindowsInstaller;
  if (typeof createWindowsInstaller !== 'function')
    throw new Error('API electron-winstaller indisponible.');
  await createWindowsInstaller({
    appDirectory,
    outputDirectory,
    authors: 'foulezombie94',
    owners: 'foulezombie94',
    name: metadata.name,
    title: 'Voxen',
    description: metadata.description,
    version: metadata.version,
    exe: 'Voxen.exe',
    setupExe: `Voxen-Setup-${metadata.version}-win32-x64.exe`,
    setupIcon: path.join(root, 'assets', 'icon.ico'),
    iconUrl: 'https://raw.githubusercontent.com/foulezombie94/VOXEN/main/assets/icon.ico',
    noMsi: true,
    noDelta: true,
  });
  const assets = await collectAssets(root, metadata.version);
  console.log('Installateur et flux Squirrel vérifiés :');
  for (const asset of assets) console.log(path.relative(root, asset));
}

if (require.main === module)
  main().catch((error) => {
    console.error('Création de l’installateur impossible : ' + error.message);
    process.exitCode = 1;
  });

module.exports = { main };
