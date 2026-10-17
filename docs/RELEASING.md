# Publier Voxen pour Windows

Le canal stable utilise Squirrel.Windows, via `electron-winstaller`, et l’API `autoUpdater` d’Electron. Le dépôt et le flux sont fixes :

```text
https://github.com/foulezombie94/VOXEN/releases/latest/download
```

## Première installation

Télécharger `Voxen-Setup-0.3.0-win32-x64.exe` depuis la release officielle et l’exécuter. Squirrel installe Voxen par utilisateur et gère les raccourcis. Une ancienne version portable ne dispose pas de l’installation Squirrel : elle doit passer une fois par cet installateur avant de recevoir les mises à jour automatiques. Les données Voxen restent dans leur emplacement utilisateur ; les identifiants cloud et les clés des fournisseurs ne font pas partie du paquet.

L’installateur de cette première version n’est pas signé Authenticode. Windows peut afficher une confirmation SmartScreen. Le flux HTTPS et les empreintes du protocole ne constituent pas une signature éditeur. Aucun certificat ou secret de signature n’est lu par les scripts.

## Construire

Sous Windows x64, avec la version Node de `.node-version` :

```powershell
npm ci
npm run make:installer
```

Le script npm doit d’abord construire le paquet portable (`npm run package`), puis exécuter `node scripts/make-installer.cjs`. Le paquet portable attendu est `release/Voxen-win32-x64`. Les cinq DLL Microsoft préparées par `scripts/package.cjs` doivent déjà se trouver à côté de `Voxen.exe`. Le nom de paquet reste `voxen-desktop` et la version vient exclusivement de `package.json`.

Le constructeur remplace uniquement son répertoire de sortie généré `release/installer`. Il génère et vérifie :

- `RELEASES`, manifeste Squirrel contenant le nom, la taille et le SHA-1 du paquet ;
- `*-VERSION-full.nupkg`, paquet complet de la version ;
- `Voxen-Setup-VERSION-win32-x64.exe`, installateur Windows.

Les MSI et paquets delta sont désactivés. Un seul paquet complet courant figure dans le manifeste : une ancienne installation peut télécharger directement la version stable courante, sans dépendre de paquets intermédiaires. Chaque publication doit conserver ensemble ces trois assets.

## Publier une nouvelle version

1. Augmenter la version stable `x.y.z` de `package.json` et mettre à jour le lockfile.
2. Rédiger `docs/release-notes.md`, puis faire valider le changement sur `main`.
3. La CI Windows exécute formatage, tests, compilation et contrôle UI.
4. Uniquement après réussite, un push de confiance sur `main` construit l’installateur et publie `vVERSION` sur le SHA exact du workflow.

Le job de publication possède seul `contents: write`. Son jeton GitHub éphémère est fourni uniquement à l’étape qui appelle GitHub CLI. Les PR et forks ne publient rien. Les actions checkout/setup-node sont épinglées par SHA ; les identifiants Git ne persistent pas dans le checkout.

`scripts/publish-release.cjs` vérifie d’abord l’existence de `vVERSION`. Si elle existe, il termine sans modifier ses assets ou son tag. Une erreur réseau/authentification interrompt la publication. Pour corriger une release publiée, créer une nouvelle version ; ne pas remplacer silencieusement des fichiers. Une publication partiellement créée peut nécessiter une revue manuelle avant une nouvelle version.

Pour une publication initiale locale explicitement autorisée, après les mêmes validations et avec GitHub CLI déjà authentifié, définir `GITHUB_SHA` sur le SHA complet du commit validé puis lancer :

```powershell
$env:GITHUB_SHA = git rev-parse HEAD
node scripts/publish-release.cjs
```

Le script n’affiche aucun jeton, ne change pas de configuration GitHub et ne remplace jamais une release existante. Le manifeste et le paquet sont vérifiés avant tout envoi.

## Références

- [electron-winstaller 5.4.4 : API et options Squirrel](https://github.com/electron/windows-installer/blob/v5.4.4/README.md)
- [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater)
- [GitHub CLI : créer une release et joindre ses assets](https://cli.github.com/manual/gh_release_create)
