# Vérification finale ciblée — Wispr Flow Windows et Voxen

Analyse statique du 17 octobre 2026. Wispr Flow n’a été ni lancé ni modifié. Aucun profil utilisateur, identifiant ou secret n’a été consulté. Cette passe porte sur les mises à jour, l’annulation au clavier et la récupération du dernier texte ; elle ne prétend pas inventorier toutes les fonctions de Wispr.

## Identité et preuves

L’installation actuelle est **Wispr Flow 1.6.1174**, à `C:\Users\azer1\AppData\Local\WisprFlow\app-1.6.1174\resources\app.asar`.

- SHA-256 ASAR : `464035ab8823cf641037636d5318924a184513b6b455bffe662e3af601fb48c0`.
- Source principale : `.webpack/main/index.js`, SHA-256 `215d03b9ca2e345e256aad65ae8518b2b09b20ef849372aca96930f6998a2e0b` ; début absolu dans l’ASAR : `3982258`.
- REA, identité et manifeste de l’ASAR : `ev_3472996a4619667efe9c2c138efe408861343c1bcb02daa77ea9639d6207e01c` ; résumé `ev_72b9236b6fe47f57da280f64dfb5bb040eed380215e8990b60b3158d72fff1a9`.
- REA, gestionnaire de mises à jour : `ev_388f6387c49158099fd5884263a6a6fc686f49e50e0a89e94279783f13c818f8` ; résumé `ev_ca808787896ab28c4ab6f57fc06fb123688bb99f8be8de29c02bc2995a3740d8`. Deux segments analysés, zéro erreur de parsing.
- REA, raccourcis et récupération : `ev_c811db83b348bc3eaeb6131587a8a092fbfceee96e26a50baa15b4c11d2cd1de` ; résumé `ev_c2320c48427f004549fe6f1733771428677476c6f5f35e01a047fc99cc21d2d0`. Trois nouveaux segments analysés, zéro erreur de parsing.

Les segments sont des copies inertes des octets actuels avec seulement `const modules={` et `};` ajoutés pour les parser. Leur provenance et leurs empreintes se trouvent dans `work/wispr-stack/final-audit-focus/provenance.json` du dossier d’enquête. Les positions ci-dessous sont des offsets **UTF-8 base zéro relatifs au membre principal**, borne de fin exclue ; ajouter `3982258` pour obtenir une position absolue dans l’ASAR. Les identifiants numériques sont propres à cette compilation.

REA a relevé trois contradictions entre l’intégrité déclarée de l’ASAR et ses compagnons natifs dépaquetés (`node_sqlite3.node`, `crypt32-ia32.node`, `crypt32-x64.node`). L’inspection du manifeste a été poursuivie explicitement avec `record-and-continue` ; ces compagnons ne servent à aucune conclusion ci-dessous. Leur divergence n’établit pas une compromission. Les segments JavaScript proviennent directement du membre empaqueté dont l’empreinte est donnée ci-dessus.

## Mises à jour : observé et adaptations Voxen

Dans le module **63364**, `6822271–6844694`, le gestionnaire écoute `checking-for-update`, `update-available`, `update-not-available`, `update-downloaded` et `error`, puis transmet son état à l’interface. Le module **66772**, `2935200–2936136`, définit les états utilisés par ce gestionnaire.

| Question                                     | Observation dans les octets livrés                                                                                                                                                                                  | Conséquence pour Voxen                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quand proposer le redémarrage ?              | `isMenuButtonClickable` et `handleMenuButtonClick`, vers `6843560–6843877`, distinguent une version téléchargée d’une simple recherche. `quitAndInstall` appartient au chemin d’application d’une version préparée. | Afficher l’action d’installation seulement après détection d’une vraie version plus récente ; la rendre active seulement une fois le téléchargement terminé. Une recherche ou une erreur n’est pas une preuve qu’une version existe.         |
| Que faire pendant la dictée ?                | `updateIfCooldownPast` diffère l’application lorsque la dictée ou une réunion est active ; la voie manuelle `applyUpdateWithActiveCaptureConfirm`, vers `6843877`, possède sa confirmation.                         | Conserver le blocage du redémarrage pendant une dictée ou un traitement et l’enregistrement des notes avant de quitter.                                                                                                                      |
| Et les erreurs répétées ?                    | `checkForFailedUpdate`, vers `6828049`, compare la version après redémarrage et compte les échecs. Trois échecs conduisent à une pause de 24 heures pour les tentatives automatiques.                               | Implémenté dans Voxen : suivi persistant de la version visée, remise à zéro après réussite et pause automatique de 24 heures après trois échecs. Les vérifications manuelles restent disponibles. Ce mécanisme ne constitue pas un rollback. |
| Le cercle de pourcentage vient-il de Wispr ? | Les extraits de ce gestionnaire donnent des états ; aucune progression numérique de téléchargement n’y est établie.                                                                                                 | Le cercle et le pourcentage sont un choix original Voxen demandé par l’utilisateur. Ils doivent suivre les octets réellement reçus et annoncer une phase indéterminée si le total est inconnu. Aucun pourcentage simulé.                     |

Les anciens rapports décrivaient **1.6.1167**. Cette passe a relu le gestionnaire actuel : son empreinte a changé ; les anciennes positions ne sont donc pas réutilisées comme preuve actuelle. Le segment d’énumération 66772 possède, lui, les mêmes octets que l’extraction antérieure.

## Deux manques pratiques relevés dans Voxen au début de cette passe

**1. Annulation par Échap pendant une dictée.** Dans le module **28889**, `2727761–2743781`, la table Windows associe `esc` à l’action `Dismiss`. Le module **94189**, `5178582–5190127`, traite `Dismiss` au premier appui et appelle le chemin d’annulation avec `UserActionEscape` ; le corps commence vers `5181226`, l’appel apparaît vers `5181913`. Cette preuve dépasse la présence d’un simple libellé : la table et le gestionnaire concordent, sous réserve des dépendances et de l’activation effective à l’exécution.

Voxen possède déjà `engine.cancel()` et les boutons d’annulation de sa capsule, mais aucun raccourci Échap global de dictée n’était présent dans le code inspecté. Adaptation bornée recommandée : activer Échap seulement pendant l’enregistrement ou le traitement, appeler la même annulation et libérer Échap à la fin. Ne pas intercepter Échap en permanence. Vérifier aussi le cas où la touche de dictée choisie est elle-même Échap.

**2. Accès au dernier texte depuis la capsule ou l’icône système.** La table du module **28889** associe sous Windows `Alt+Shift+X` à `CopyLastText` et `Alt+Shift+Z` à `PasteLastText`. Le gestionnaire du module **94189** appelle l’action de copie au premier appui. Dans le module **45961**, `4351705–4362326`, le chemin de copie teste `lastTranscription`, appelle `clipboard.writeText` avec le dernier texte et émet `CopyLastTextTriggered`, vers `4362301`.

Voxen possède déjà `dictation.copyLast` et `lastFinalText`, mais le bouton de récupération de la capsule n’apparaissait qu’à l’état d’erreur ; les menus contextuels de la capsule et de l’icône système ne proposaient pas cette copie. Adaptation bornée recommandée : ajouter « Copier le dernier texte », désactivé tant qu’aucun texte n’existe. Cette copie reste une action explicite de l’utilisateur, y compris après une insertion réussie. Aucun nouveau stockage audio n’est nécessaire.

## Fonctions déjà présentes dans Voxen à conserver

L’interface Voxen dispose déjà d’une capsule déplaçable, d’un niveau vocal calculé depuis le son capturé, d’un menu au clic droit, du choix et du test de microphone, de l’arrêt après silence, de l’annulation du traitement, d’une conservation de la transcription lorsque la reformulation échoue, de l’historique optionnel et de la restauration du presse-papiers configurable. Cette passe n’a pas conclu qu’il fallait reconstruire ces fonctions ou copier les ressources graphiques de Wispr.

## Limites et éléments non prouvés

- Les graphes REA restent partiels : imports, alias minifiés, feature flags et chemins dynamiques ne sont pas tous résolus. Le succès du parsing n’établit pas l’activation d’une fonction.
- Les actions, raccourcis par défaut et conditions ci-dessus sont des observations statiques ; aucun essai interactif Wispr, trafic réseau ou téléchargement Wispr n’a eu lieu.
- Aucun modèle serveur, durée de conservation audio, politique active de déploiement, signature de paquet ou rollback automatique n’est établi par ces segments.
- Les pages de réunions, d’équipes et d’abonnement ne sont pas couvertes par cette passe. La présence de leurs noms dans un bundle ne suffit pas à prouver leur comportement.
- La visibilité du bouton « Mettre à jour » seulement après détection et le cercle de téléchargement sont des exigences Voxen ; ce rapport ne les attribue pas sans preuve à l’interface actuelle de Wispr.

## Implémentation retenue dans Voxen 0.3.5

- Annonce masquée pendant une simple recherche, en l’absence de version plus récente ou dans une copie sans mises à jour prises en charge.
- Cercle et pourcentage calculés à partir des octets réellement reçus du paquet officiel. Taille reçue, taille totale et débit affichés ; aucune progression simulée.
- Téléchargement et vérification distingués. L’action d’installation apparaît après préparation native, et le redémarrage attend la fin de la dictée et la sauvegarde des notes.
- Échap réservé temporairement à l’annulation pendant une dictée ; la touche est libérée ensuite. Copie de la dernière dictée uniquement sur action explicite dans les menus.
- Historique borné des tentatives d’installation, pause automatique après trois échecs et vérification manuelle toujours disponible.

Le module Windows Electron expose les états Squirrel mais pas de progression chiffrée dans son API publique. Voxen mesure donc son propre flux HTTPS vers le moteur Squirrel par un relais limité à la boucle locale, avec contrôle de taille et d’empreinte du paquet ; le moteur natif reste responsable de son application. Référence : [documentation officielle autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater).

Les tests de transport utilisent de vrais flux HTTP locaux avec des paquets synthétiques. Les essais de l’interface sont isolés : aucune capture micro, aucune clé lue et aucun envoi réseau. Le premier cycle complet de la nouvelle version vers une version suivante reste distinct de ces tests.
