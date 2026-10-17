'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const repository = 'foulezombie94/VOXEN';

async function collectAssets(root, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Version stable invalide.');
  const directory = path.resolve(root, 'release', 'installer');
  const manifest = path.join(directory, 'RELEASES');
  const lines = fs.readFileSync(manifest, 'utf8').trim().split(/\r?\n/);
  // Full-only channel: one current version, no stale files or delta dependency.
  if (lines.length !== 1) throw new Error('RELEASES doit contenir exactement un paquet complet.');
  const match = /^([a-f0-9]{40}) ([A-Za-z0-9_.-]+-full\.nupkg) ([0-9]+)$/i.exec(lines[0]);
  if (!match || !match[2].endsWith(`-${version}-full.nupkg`))
    throw new Error('Manifeste Squirrel invalide ou version incorrecte.');
  const packagePath = path.join(directory, match[2]);
  if (fs.lstatSync(packagePath).isSymbolicLink()) throw new Error('Paquet symbolique refusé.');
  const stat = fs.statSync(packagePath);
  if (!stat.isFile() || stat.size <= 0 || String(stat.size) !== match[3])
    throw new Error('La taille du paquet ne correspond pas à RELEASES.');
  const hash = createHash('sha1'); // Required by the Squirrel RELEASES protocol.
  for await (const chunk of fs.createReadStream(packagePath)) hash.update(chunk);
  if (hash.digest('hex').toLowerCase() !== match[1].toLowerCase())
    throw new Error('Le paquet ne correspond pas à l’empreinte RELEASES.');
  const setupPath = path.join(directory, `Voxen-Setup-${version}-win32-x64.exe`);
  if (
    fs.lstatSync(setupPath).isSymbolicLink() ||
    !fs.statSync(setupPath).isFile() ||
    !fs.statSync(setupPath).size
  )
    throw new Error('Installateur absent ou invalide.');
  return [manifest, packagePath, setupPath];
}

function gh(args, options = {}) {
  return spawnSync('gh', args, { encoding: 'utf8', windowsHide: true, shell: false, ...options });
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = metadata.version;
  if (metadata.name !== 'voxen-desktop' || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('Le paquet doit être une version stable de Voxen.');
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== repository)
    throw new Error('Publication autorisée uniquement dans le dépôt officiel Voxen.');
  if (
    process.env.GITHUB_ACTIONS === 'true' &&
    (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/main')
  )
    throw new Error('La publication CI est réservée aux push de confiance sur main.');
  const target = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/i.test(target || ''))
    throw new Error('GITHUB_SHA doit identifier le commit validé à publier.');
  const tag = `v${version}`;
  const existing = gh(['release', 'view', tag, '--repo', repository, '--json', 'tagName']);
  if (existing.error) throw new Error('GitHub CLI indisponible.');
  if (existing.status === 0) {
    console.log(`${tag} existe déjà : aucun asset ni tag n’a été modifié.`);
    return;
  }
  if (existing.status !== 1 || !/release not found/i.test(existing.stderr || ''))
    throw new Error('Impossible de confirmer l’absence de la release. Publication arrêtée.');
  const assets = await collectAssets(root, version);
  const notes = path.join(root, 'docs', 'release-notes.md');
  if (!fs.existsSync(notes) || !fs.readFileSync(notes, 'utf8').trim())
    throw new Error('Notes de version manquantes.');
  const result = gh([
    'release',
    'create',
    tag,
    ...assets,
    '--repo',
    repository,
    '--target',
    target,
    '--title',
    `Voxen ${version}`,
    '--notes-file',
    notes,
    '--latest',
  ]);
  if (result.error || result.status !== 0)
    throw new Error('Publication GitHub échouée. Vérifiez la release avant de relancer.');
  console.log(`Release publiée : https://github.com/${repository}/releases/tag/${tag}`);
}

if (require.main === module)
  main().catch((error) => {
    console.error('Publication impossible : ' + error.message);
    process.exitCode = 1;
  });

module.exports = { collectAssets, main };
