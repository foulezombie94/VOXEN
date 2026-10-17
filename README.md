# Voxen

Application Windows de dictée vocale en français. Une pression sur **Ctrl+V** démarre la capture ; après **deux secondes de silence**, Voxen transcrit, reformule et insère le texte dans l’application active.

## Fonctionnalités

- Capture mono PCM 16 bits à 16 kHz et détection de voix locale Silero.
- Transcription Deepgram Nova-3 et reformulation OpenRouter, avec **Qwen3.8 27B** par défaut.
- Capsule flottante animée par le niveau réel du micro, déplaçable, avec menu au clic droit.
- Dictionnaire, remplacements parlés, styles par application et transformations de texte.
- Notes avec sauvegarde automatique, historique des versions et détection des conflits.
- Historique des dictées, favoris, statistiques et exports.
- Compte facultatif Supabase, synchronisation choisie par catégorie et fonctionnement local hors connexion.
- Interface crème, navigation latérale et carte Compte flottante.

## Développement

Prérequis : **Windows x64**, **Node.js 24.19 ou plus récent** et npm. Les tests n’utilisent ni le micro ni les clés personnelles.

```powershell
git clone https://github.com/foulezombie94/VOXEN.git
cd VOXEN
npm ci
npm run build
npm start
```

Dans **Paramètres → Connexions**, configurez les clés Deepgram et OpenRouter. Elles sont stockées dans le Gestionnaire d’identifiants Windows et ne sont jamais réaffichées. Le raccourci Ctrl+V est configurable ; il remplace le collage habituel lorsqu’il est actif dans une autre application. La pause rend le raccourci disponible à nouveau.

## Qualité du code

**Prettier 3.9.10** est fixé dans le lockfile.

```powershell
npm run format
npm run format:check
npm test
npm run build
npm run test:ui
```

`npm run check` exécute le formatage en vérification, les tests et la compilation. Le diagnostic UI est isolé : aucun compte réel, enregistrement, clé API ou email n’est utilisé. Ses résultats restent dans `artifacts/`, exclu de Git. GitHub Actions exécute ces vérifications sur Windows.

## Backend facultatif

L’application démarre et dicte sans compte Supabase. Pour activer le compte et la synchronisation, suivez [backend/README.md](backend/README.md), puis créez votre configuration locale :

```powershell
Copy-Item assets/cloud-config.example.json assets/cloud-config.json
```

Renseignez l’URL du projet et sa clé **publishable**. Ne placez jamais de clé `service_role`, de clé secrète Supabase ni de clé de transcription dans ce fichier. Le fichier de configuration réel n’est pas publié dans le dépôt.

## Créer le paquet Windows

```powershell
npm run package
```

Le paquet est généré dans `release/Voxen-win32-x64/`. Le script utilise les DLL redistribuables Visual C++ déjà présentes dans Windows, ou celles du dossier indiqué par `VOXEN_RUNTIME_DIR`. Si l’une manque, il s’arrête avec la liste des fichiers requis ; il n’installe rien automatiquement. Les DLL sont copiées à côté de l’exécutable pour le fonctionnement portable.

## Données et confidentialité

- Deepgram reçoit l’audio et les termes du dictionnaire pendant une dictée.
- OpenRouter reçoit le texte à reformuler si cette option est activée.
- Le détecteur de silence tourne localement ; Voxen n’enregistre pas l’audio sur disque et ne lit pas l’écran.
- Les textes et notes sont conservés localement dans `%LOCALAPPDATA%\Voxen\voxen.db`, sans chiffrement applicatif du contenu.
- La synchronisation nécessite une activation explicite. Notes et historique sont exclus par défaut. Les jetons de session sont chiffrés avec Windows DPAPI.
- Désactiver une catégorie arrête ses nouveaux envois sans supprimer les copies précédemment envoyées. Le backend conserve vingt versions ; les remplacements locaux gardent cinq sauvegardes.

## Structure

```text
src/main/       Electron, capture, Win32, stockage, fournisseurs et synchronisation
src/renderer/  React, styles Sass, pages et fenêtres flottantes
assets/        Icônes, polices libres et modèle Silero
backend/       Schéma PostgreSQL, politiques RLS et tests SQL
scripts/       Compilation, paquet portable et diagnostic UI
tests/         Tests isolés et extrait audio public
```

Voxen est un projet indépendant. Il ne contient pas le code de Wispr Flow, ses fichiers d’installation, ses comptes ni ses données privées. Voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) pour les composants tiers.
