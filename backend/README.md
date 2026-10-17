# Backend Supabase

Backend facultatif de compte et synchronisation pour Voxen. Aucun identifiant de projet réel ni secret n’est fourni dans ce dépôt.

## Installation

Sur un projet Supabase vide, exécuter dans cet ordre, avec l’éditeur SQL administratif :

1. `schema.sql` : quatre tables, validation des données, politiques RLS et fonctions de synchronisation.
2. `optimize.sql` : index de la clé étrangère et optimisation des politiques.
3. `tests/rls.sql` : vérifications avec deux utilisateurs synthétiques sans email, suivies d’un rollback intégral.

Activer l’authentification par email et configurer l’envoi des emails dans Supabase. Le client accepte un code OTP ou l’adresse complète du bouton de connexion reçue par email, dans un champ masqué. La délivrabilité dépend de la configuration email du projet.

Copier `assets/cloud-config.example.json` vers `assets/cloud-config.json`, puis renseigner l’URL du projet et sa clé **publishable**. Ne jamais utiliser de clé secrète ou `service_role` dans une application desktop.

## Contrat

- `voxen_profiles` : nom d’affichage du propriétaire.
- `voxen_devices` : présence des appareils du propriétaire.
- `voxen_workspaces` : état courant, avec révision.
- `voxen_workspace_versions` : vingt derniers états envoyés.
- `rpc/voxen_get_workspace`, corps `{}` : `{revision, state, updated_at}`. Un espace inexistant renvoie la révision zéro.
- `rpc/voxen_put_workspace`, corps `{p_state, p_expected_revision, p_device_id}` : `{conflict, revision, updated_at}`. Une révision périmée provoque un conflit ; aucun écrasement automatique par nouvelle tentative.

L’identité vient de `auth.uid()`. Les quatre tables utilisent RLS avec contrôle du propriétaire et refus des sessions anonymes. Les RPC sont `SECURITY INVOKER`, avec chemin de recherche explicite. Le verrou transactionnel couvre aussi la création du premier espace.

Les instantanés sont limités à 8 Mio. Ils contiennent une liste explicite de préférences, dictionnaire, remplacements, styles, transformations et, uniquement si sélectionnés, notes et historique. Aucun audio, clé API ou paramètre de périphérique n’est accepté.

## Limites

La synchronisation utilise des instantanés d’espace, pas une fusion collaborative ligne par ligne. L’utilisateur choisit la version PC ou compte en conflit. Les tables restent éditables par leur propriétaire via leurs droits RLS ; le contrôle de révision et la rotation des versions constituent le contrat des RPC utilisées par Voxen.

Désactiver une catégorie ne supprime pas ses copies déjà envoyées. Pas de suppression de compte intégrée à cette version. Les sauvegardes locales se récupèrent techniquement dans la table SQLite `CloudBackups` ; aucun bouton de restauration n’est fourni pour le moment.

Les tests SQL sont séquentiels. Ils ne remplacent pas un essai de concurrence avec deux connexions réelles, ni les tests de connexion email et de synchronisation sur deux PC.
