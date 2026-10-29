<!-- VisionPharma · documentation projet · v1.0 · 2026-10-29 -->

# Recette — couverture automatique et procédures manuelles

Chaque scénario du document 08 (§3) est soit vérifié par un test automatique, soit décrit ici pas à pas pour être joué par une personne (matériel réel, poste neuf, chronométrage, imprimante). Résultat à consigner dans le procès-verbal de recette (J12).

## 1. Couverture automatique

| Scénario | Test | Commande |
|---|---|---|
| RC-02 comptes et écrans par rôle | `web/e2e/app.spec.ts` « UI-13 U-03 … » ; `server/test/rbac.test.ts` | `npm run test:e2e` ; `npm test` |
| RC-03 réception de 20 lignes par scan GS1 | `server/test/recette.test.ts` « RC-03 » | `npm test` |
| RC-04 vente de 3 articles, rendu, FEFO | `recette.test.ts` « RC-04 » ; e2e « UI-03 UI-04 » (au clavier) | idem |
| RC-05 antibiotique, ordonnance, photo chiffrée | `server/test/safety.test.ts` « O-02 », « O-04 » ; e2e « UI-05 » | idem |
| RC-06 lot rappelé | `safety.test.ts` « Q-02 » ; e2e « Q-02 » | idem |
| RC-07 lot périmé, rapport des péremptions | `recette.test.ts` « RC-07 » | idem |
| RC-08 dernière boîte sur deux caisses | `stock.test.ts` « S-04 » (deux processus) ; `recette.test.ts` « RC-08 » | idem |
| RC-09 vente d'un produit jamais réceptionné | `sales.test.ts` « V-05 » ; `reports.test.ts` « P-01 » | idem |
| RC-10 demande → suggestion → réception | `recette.test.ts` « RC-10 » | idem |
| RC-11 annulation par le pharmacien | `sales.test.ts` « V-07 » ; `reports.test.ts` « P-01 » | idem |
| RC-12 clôture avec écart | `sales.test.ts` « V-08 » ; e2e « UI-15 V-08 » | idem |
| RC-13 inventaire de rayon, deux écarts | `recette.test.ts` « RC-13 » | idem |
| RC-14 coupure brutale pendant une vente | `recette.test.ts` « RC-14 » (processus tué par SIGKILL en pleine transaction) | idem |
| RC-15 octet altéré, `verify-ledger` | `recette.test.ts` « RC-15 » (commande réelle, code de sortie 2) | idem |
| RC-16 sauvegarde, machine neuve, restauration | `backup.test.ts` « B-04 nouvelle machine » | idem |
| RC-17 verrouillage après 5 échecs | `auth.http.test.ts` « A-04 » | idem |
| RC-18 caissier sur une route d'ajustement | `recette.test.ts` « RC-18 » (403 et `security.access_denied`) | idem |
| RC-19 1 500 ventes sur 5 postes | `recette.test.ts` « RC-19 » (10 lignes par vente, p95 < 500 ms) | idem |
| RC-22 faux serveur (autre autorité) | `desktop/src-tauri/tests/pinning.rs` contre un vrai serveur | `npm run desktop:pinning-test` |
| RC-25 navigation vers une adresse externe | `desktop/src-tauri/src/tests.rs` « w04 » | `npm run desktop:test` |

## 2. Procédures manuelles

### RC-01 — Installation sur une machine neuve (objectif : moins de 30 minutes)
1. Mini-PC sous Ubuntu Server 24.04, réseau local, onduleur branché. Démarrer le chronomètre.
2. Suivre `apps/officine/README.md`, section « Installation native » (ou « Docker »).
3. `init` : recopier la clé de récupération sur papier ; relever l'empreinte de l'autorité.
4. Depuis un poste, ouvrir `https://<serveur>:8443`, vérifier l'empreinte affichée, faire la configuration initiale (TOTP sur un téléphone).
5. Écran Système → Catalogue : importer le CSV du grossiste ; écran « Dossier de l'officine » : saisir au moins l'identité et les contacts.
6. Se déconnecter puis se reconnecter avec le TOTP. Arrêter le chronomètre. **Attendu :** moins de 30 minutes.

### RC-16 — Effacement complet puis restauration (complète le test automatique)
1. Faire quelques ventes, puis Système → Sauvegardes → « Sauvegarder maintenant » ; copier l'archive `.vpbak` sur une clé USB.
2. Réinstaller le système du serveur (ou utiliser une autre machine).
3. `npm run init -- --data <nouveau>`, puis `npm run restore -- --data <nouveau> --file <clé USB>/vp-….vpbak --recovery-key <clé papier>`.
4. **Attendu :** sortie `"ok": true` ; ventes, stocks et comptes identiques ; événement `system.restored`. Les postes doivent être réappairés si le certificat a changé (nouvelle autorité).

### RC-20 — Mise à jour qui échoue au contrôle de santé
1. Installation native avec `/opt/visionpharma/current` (README).
2. Préparer une archive volontairement défectueuse (par exemple `dist/server/src/main.js` remplacé par `process.exit(1)`).
3. `sudo deploy/update.sh <archive défectueuse>`.
4. **Attendu :** sauvegarde créée, bascule, échec du contrôle, retour automatique à la version précédente (« version précédente rétablie », code 1), données intactes (`npm run verify-ledger`).

### RC-21 — Installation de l'application de bureau sur un poste Windows neuf (moins de 5 minutes)
Prérequis humains : installateur signé (certificat de signature de code) produit par la CI ; autorité locale de l'officine installée dans le magasin « Autorités de certification racines de confiance » du poste (fichier `tls/ca.pem` du serveur ; installation par l'administrateur).
1. Installer `VisionPharma Officine_x.y.z_x64-setup.exe` (sans droits d'administrateur).
2. Au premier lancement : saisir l'adresse du serveur, comparer l'empreinte affichée à celle de l'écran Système.
3. Sur le serveur, Système → Postes → « Générer un code » ; le saisir sur le poste avec le nom du poste.
4. **Attendu :** le poste apparaît dans la liste (titulaire), l'interface s'ouvre sur la caisse ; durée totale inférieure à 5 minutes.

### RC-22 — Faux serveur sur le réseau (complète le test automatique)
1. Sur une autre machine, `npm run init` puis `npm start` (autre autorité), à l'adresse IP du vrai serveur (débrancher le vrai serveur).
2. Relancer l'application d'un poste appairé ou menu Poste → Reconnecter.
3. **Attendu :** écran bloquant « Serveur non reconnu », seul bouton « Réessayer » ; aucune page du faux serveur ne s'affiche.

### RC-23 — Mise à jour signée, puis paquet altéré
Prérequis : clé de mise à jour générée en CI (`tauri signer generate`), clé publique dans `tauri.conf.json`.
1. Produire la version x.y.z+1 en CI ; sur le serveur : `npm run publish-desktop -- --version x.y.z+1 --dir <paquets>`.
2. Relancer un poste : la fenêtre « Mise à jour disponible » propose l'installation ; installer. **Attendu :** redémarrage sur la nouvelle version.
3. Republier une version x.y.z+2 en modifiant un octet du paquet après signature. **Attendu :** « Mise à jour refusée » (signature invalide), le poste reste sur sa version.

### RC-24 — Ticket ESC/POS et tiroir-caisse
1. Imprimante 80 mm réseau ESC/POS (port 9100) et tiroir branché sur l'imprimante.
2. Sur le poste : menu Poste → Imprimante… → adresse `IP:9100` → « Imprimer un ticket de test » (accents corrects).
3. Faire une vente en espèces. **Attendu :** ticket conforme à V-06 (officine, NIU et RCCM si saisis, numéro, date, caissier, lignes avec lot et péremption, total, paiements, rendu, empreinte courte), tiroir ouvert, aucune boîte de dialogue.
Limite connue : les imprimantes USB sous Windows ne sont pas prises en charge en direct (impression du système en secours).

### RC-25 — Navigation forcée (complète le test automatique)
1. Dans la caisse d'un poste, ouvrir les outils de développement est impossible en version de production ; utiliser un lien externe injecté par le serveur de test, ou la palette avec une adresse externe.
2. **Attendu :** rien ne s'ouvre, ni dans l'application ni dans un navigateur.
