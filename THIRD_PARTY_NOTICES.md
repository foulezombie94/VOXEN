# Composants tiers

Voxen utilise les dépendances listées avec leurs versions exactes dans `package.json` et `package-lock.json`. Leurs licences restent celles de leurs auteurs et sont incluses dans les paquets npm correspondants.

## Actifs distribués dans ce dépôt

- **Figtree** : auteurs du projet Figtree, SIL Open Font License 1.1. Licence : `assets/fonts/OFL.txt`. Projet : <https://github.com/erikdkennedy/figtree>.
- **EB Garamond** : auteurs du projet EB Garamond, SIL Open Font License 1.1. Licence : `assets/fonts/EB-Garamond-OFL.txt`. Projet : <https://github.com/octaviopardo/EBGaramond12>.
- **Silero VAD** : licence MIT, conservée dans `assets/silero/SILERO-LICENSE.txt`. Modèle issu de <https://github.com/snakers4/silero-vad>, révision `1e261b036686cd0017d500ee96acd1c4ba572a9d`.
- **Extrait de test audio** : passage public de six secondes du fichier `examples/c++/aepyx.wav` du dépôt Silero VAD à la même révision. Voir `tests/fixtures/README.md`.

Les DLL Visual C++ ne sont pas stockées dans Git. La préparation d’un paquet les copie depuis une installation existante ou un dossier fourni explicitement. Leur redistribution reste soumise aux conditions de Microsoft.
