# Mise à jour Windows : enquête et réalisation

L’analyse statique REA de Wispr Flow Windows 1.6.1167 a trouvé l’API native `autoUpdater` d’Electron, le format Squirrel `RELEASES`/`*-full.nupkg` et les hooks d’installation qui gèrent les raccourcis via `Update.exe`.

Le gestionnaire est dans `.webpack/main/index.js`, octets 6800483–6822906 ; le contrôle des paramètres est dans `.webpack/renderer/hub/index.js`, octets 1339309–1343770. Le SHA-256 de la source principale est `90543b8ced6b40a2e48117df72d235b9bacc8d73dfa7ef3df04011b150f110ba`. Cinq unités ont été analysées par REA, sans erreur de parsing ; le graphe reste partiel. Aucun binaire Wispr n’a été exécuté.

## Observé chez Wispr

- Vérifications grand public réparties entre trente minutes et cinq heures, conditionnées par l’activité système et la connexion réseau.
- États de recherche, téléchargement, version prête et erreur ; aucun pourcentage natif trouvé dans ce contrôle.
- Téléchargement délégué à Electron/Squirrel, puis installation différée pour respecter dictée et réunion. Plusieurs temporisations, politiques administrateur et feature flags existent.
- Application via `quitAndInstall`, et confirmation spécifique lors d’une demande manuelle pendant un enregistrement.
- Contrôle de version dans les paramètres et les menus. Aucune preuve d’une fenêtre flottante de progression indépendante dans les extraits étudiés.

## Réalisation originale Voxen

Voxen utilise le même mécanisme Electron/Squirrel et ses propres releases GitHub. Il ajoute un installateur par utilisateur, un flux stable fixe, une carte sous « Prenez vos marques » et un panneau dans Système. Les vérifications sont sérialisées et reportées hors connexion ou pendant une opération. La première attend une minute, notamment pour laisser passer le verrou Squirrel de première installation.

Le téléchargement reste en arrière-plan. L’application n’impose pas de redémarrage : la demande d’installation exige une confirmation, une dictée et un traitement terminés, et l’enregistrement des notes des deux fenêtres. Les raccourcis utilisent le lanceur stable Squirrel ; les données restent dans le dossier utilisateur Voxen.

Les réglages MDM, les canaux internes/bêta et la stratégie de report automatique de Wispr ne sont pas reproduits. Une copie portable affiche explicitement qu’une installation est nécessaire. La première version de l’installateur est non signée Authenticode ; HTTPS et les empreintes du protocole ne remplacent pas une signature éditeur.

## Ce qui n’est pas établi

Cette analyse ne prouve ni la configuration active des serveurs Wispr, ni leurs politiques de signature, ni un rollback automatique après régression. Les tests Voxen avec adaptateur isolé vérifient les états et les protections ; ils ne remplacent pas une mise à jour réelle entre deux versions publiées.

Références : [API Electron](https://www.electronjs.org/docs/latest/api/auto-updater), [protocole Squirrel](https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/update-process.md), [liens de release GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases).
