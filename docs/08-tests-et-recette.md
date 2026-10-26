<!-- VisionPharma · documentation projet · v3.1 · 2026-10-26 -->

# Tests et recette — VisionPharma Officine

Stratégie inspirée de **ISO/IEC/IEEE 29119** : tests automatisés à chaque modification, scénarios de recette joués par des pharmaciens, vérifications de sécurité selon **OWASP ASVS 5.0**.

---

## 1. Niveaux de test

| Niveau | Outil | Portée | Quand |
|---|---|---|---|
| Unitaire et domaine | Vitest | Règles métier pures : FEFO, totaux, politique d'ordonnance, empreintes, GS1 | À chaque modification |
| Intégration de l'API | Vitest + `fastify.inject` sur une base SQLite temporaire | Chaque route × chaque rôle × chaque erreur prévue | À chaque modification |
| Bout en bout | Playwright, navigateur réel, serveur réel | Parcours de recette de la section 3 | À chaque fusion sur la branche principale |
| Charge et résistance | Script de charge, 10 clients | NFR-PE-01 à 03, S-04 | J10 puis à chaque version |
| Panne | Coupure brutale du processus pendant une vente, disque plein, miroir de sauvegarde absent | NFR-RE-01, B-02 | J10 puis à chaque version |
| Sécurité | Liste ASVS, analyse des dépendances, SAST, test d'intrusion | SEC-* | J10, J13, puis chaque année |

**Règle** : chaque test porte l'identifiant de l'exigence dans son nom, par exemple `it('S-02 FEFO prend le lot qui périme le plus tôt')`.

---

## 2. Invariants testés par propriétés

Ces invariants sont vérifiés par des tests à génération aléatoire (des centaines de séquences d'opérations) en plus des cas fixes :

1. **Conservation du stock** : pour tout lot, stock = réceptions − ventes + annulations ± ajustements − destructions − retours.
2. **Non-négativité** : aucun lot sauf le lot de régularisation n'est jamais négatif.
3. **Atomicité** : après une erreur injectée au milieu d'une commande, l'état et le journal sont identiques à l'état d'avant.
4. **Chaîne** : après toute séquence d'opérations, `verify-ledger` renvoie `ok`.
5. **Caisse** : pour toute session clôturée, attendu = fond + espèces encaissées − rendu − espèces remboursées.
6. **Sûreté** : aucune séquence ne produit la vente d'un lot rappelé ou périmé, ni d'un produit soumis à ordonnance sans ordonnance validée.

---

## 3. Scénarios de recette (bout en bout)

Chaque scénario est joué par Playwright **et** par un pharmacien en J12.

| N° | Scénario | Résultat attendu |
|---|---|---|
| RC-01 | Installation sur une machine neuve, configuration initiale, import du catalogue | Moins de 30 minutes ; le titulaire se connecte avec le TOTP |
| RC-02 | Le titulaire crée un pharmacien, un préparateur et un caissier | Chaque compte se connecte et ne voit que ses écrans |
| RC-03 | Réception d'une livraison de 20 lignes par scan GS1, sans bon de commande | 20 fiches activées, lots et péremptions corrects, stock à jour |
| RC-04 | Vente de 3 articles en espèces, avec rendu de monnaie et impression du ticket | Moins de 60 secondes ; stock décrémenté sur les bons lots |
| RC-05 | Vente d'un antibiotique : le caissier est bloqué, le pharmacien saisit l'ordonnance avec photo et valide | Vente liée à l'ordonnance ; photo illisible sur le disque |
| RC-06 | Scan d'un lot rappelé | Alerte bloquante, vente impossible |
| RC-07 | Scan d'un lot périmé | Vente impossible ; le lot apparaît dans le rapport de péremptions |
| RC-08 | Deux caisses vendent en même temps la dernière boîte | Une seule vente réussit ; l'autre affiche « stock insuffisant » sans perdre le panier |
| RC-09 | Vente d'un produit jamais réceptionné, pendant la période de démarrage | Vente acceptée, marquée « à régulariser », visible dans la clôture |
| RC-10 | Le client demande un produit en rupture : saisie de la demande, puis suggestion de commande et réception | La demande apparaît dans la liste, puis se résout à la réception |
| RC-11 | Annulation d'une vente par le pharmacien | Ré-authentification demandée ; stock revenu sur les mêmes lots ; motif dans la clôture |
| RC-12 | Clôture de caisse avec un écart de 500 XAF | Écart calculé et affiché ; point de contrôle créé |
| RC-13 | Inventaire d'un rayon avec deux écarts | Mouvements d'inventaire corrects ; valeur de l'écart dans le rapport |
| RC-14 | Coupure de courant (arrêt brutal du serveur) pendant la validation d'une vente | Au redémarrage, la vente est soit entièrement présente, soit absente ; le journal se vérifie |
| RC-15 | Altération manuelle d'un octet de la base | `verify-ledger` signale le `seq` concerné |
| RC-16 | Sauvegarde, effacement complet de la machine, restauration avec la clé de récupération | Données, ventes et journal identiques ; vérification `ok` |
| RC-17 | 5 mots de passe faux | Compte verrouillé 15 minutes ; événement dans le journal |
| RC-18 | Un caissier appelle directement une route d'ajustement de stock | 403 ; tentative tracée |
| RC-19 | Journée complète simulée : 1 500 ventes sur 5 postes | Aucune erreur ; temps de réponse dans les cibles ; journal `ok` |
| RC-20 | Mise à jour vers une version qui échoue au contrôle de santé | Retour automatique à la version précédente, sans perte de données |
| RC-21 | Installation de l'application de bureau sur un poste Windows neuf, puis appairage avec le code affiché sur le serveur | Moins de 5 minutes ; le poste apparaît dans la liste ; la caisse s'ouvre |
| RC-22 | Un second serveur VisionPharma (autre autorité) est mis sur le réseau à la même adresse | L'application affiche « Serveur non reconnu » et refuse de s'ouvrir |
| RC-23 | Mise à jour de l'application publiée par le serveur, puis paquet modifié d'un octet | La mise à jour valide s'installe ; le paquet modifié est refusé |
| RC-24 | Impression d'un ticket et ouverture du tiroir depuis la caisse, sans boîte de dialogue | Ticket conforme à V-06 ; tiroir ouvert |
| RC-25 | Navigation forcée vers une adresse externe depuis l'interface | Bloquée |

---

## 4. Matrice de traçabilité

| Groupe d'exigences | Fichiers de tests attendus | Scénarios de recette |
|---|---|---|
| I-01 à I-06 | `test/install.*.test.ts` | RC-01 |
| A-01 à A-08, U-01 à U-03 | `test/auth.*.test.ts`, `test/rbac.matrix.test.ts` | RC-02, RC-17, RC-18 |
| C-01 à C-07 | `test/catalog.*.test.ts`, `test/gs1.test.ts` | RC-03, RC-09 |
| S-01 à S-09 | `test/stock.*.test.ts`, `test/invariants.property.test.ts` | RC-08, RC-13 |
| R-01 à R-06 | `test/orders.*.test.ts` | RC-03, RC-10 |
| V-01 à V-10 | `test/sales.*.test.ts`, `test/cash.*.test.ts` | RC-04, RC-11, RC-12, RC-14 |
| O-01 à O-06 | `test/prescriptions.*.test.ts` | RC-05 |
| Q-01 à Q-05 | `test/recalls.*.test.ts`, `test/expiry.*.test.ts` | RC-06, RC-07 |
| D-01 à D-03 | `test/demand.*.test.ts` | RC-10 |
| P-01 à P-08 | `test/reports.*.test.ts` | RC-12, RC-13 |
| J-01 à J-06 | `test/ledger.*.test.ts` (dont les vecteurs de l'annexe C) | RC-14, RC-15 |
| B-01 à B-05 | `test/backup.*.test.ts` | RC-16 |
| W-01 à W-11 | `desktop/src-tauri/tests/*` (Rust), `test/devices.*.test.ts` (serveur), contrôle des capacités Tauri | RC-21 à RC-25 |
| NFR-PE, NFR-RE | `test/perf/*`, `test/resilience/*` | RC-19, RC-20 |

---

## 5. Liste de contrôle de sécurité (extrait ASVS 5.0)

À cocher en J10 et J13. Chaque ligne renvoie à la preuve (test, configuration ou capture).

| Chapitre ASVS 5.0 | Points clés vérifiés |
|---|---|
| Encodage et assainissement | Requêtes SQL toutes paramétrées ; sortie HTML échappée par React ; aucun `dangerouslySetInnerHTML` |
| Validation | Schéma sur chaque entrée ; champs inconnus refusés ; tailles maximales |
| Logique métier | Invariants de la section 2 ; limites de débit ; anti-rejeu des actions sensibles |
| Fichiers | Type vérifié par signature, taille maximale, chiffrement, aucun nom de fichier venant du client |
| API et web services | Méthodes HTTP strictes, CORS fermé (même origine), erreurs RFC 9457 sans fuite |
| En-têtes et configuration HTTP | CSP, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` |
| Authentification | SEC-AU-01 à 07 |
| Gestion de session | Jeton aléatoire, empreinte en base, expirations, révocation |
| Autorisation | Matrice testée de façon exhaustive, refus par défaut |
| Jetons autonomes | Aucun JWT au MVP |
| Cryptographie | Profil de la section 4 du document 06 ; aucune primitive maison |
| Communications sécurisées | TLS 1.3 ou 1.2 AEAD, sur le réseau local aussi |
| Configuration | Aucun secret dans le code ni dans le dépôt ; droits des fichiers de clés vérifiés au démarrage |
| Protection des données | Minimisation, chiffrement, rétention, `Cache-Control: no-store` |
| Journalisation et gestion des erreurs | Journal chaîné pour la sécurité ; journaux techniques sans donnée de santé |
| Code sécurisé et architecture | Couches séparées, dépendances minimales, SBOM, analyse des dépendances (npm et `cargo audit`) |
| Application de bureau | Capacités Tauri limitées à W-05, origine unique, épinglage de l'autorité, mises à jour signées, installateurs signés |
