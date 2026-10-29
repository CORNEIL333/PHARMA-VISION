<!-- VisionPharma · rapport · 2026-10-29 -->

# Bilan de la phase A — gestionnaire d'officine (`apps/officine`)

**État : terminé côté code.** Toutes les exigences **M** et **S** de la spécification (docs/05) sont faites ou attendent une intervention humaine documentée. Une seule ligne reste « à faire » : DOS-03 (TVA de la parapharmacie), qui demande d'abord une décision fiscale. Aucun commit Git n'a été fait : le dépôt n'est pas initialisé, et le choix revient au porteur du projet.

## 1. Résultats des vérifications (29 octobre 2026, poste Windows de développement)

| Vérification | Résultat |
|---|---|
| `npm run typecheck` (serveur et interface) | OK |
| `npm run lint` | OK |
| `npm test` (Vitest, serveur) | **378 tests verts**, 1 ignoré (échantillon de catalogue absent du dépôt), 27 fichiers |
| `npm run test:e2e` (Playwright sur un vrai serveur) | **21 scénarios verts**, axe sans violation sérieuse ni critique, captures sombre et clair dans `docs/screenshots/` |
| `npm run desktop:test` (Rust) | 13 tests verts ; `cargo fmt --check` et `cargo clippy -- -D warnings` propres |
| `npm run desktop:pinning-test` | Vert : l'empreinte vue par l'application est celle du serveur ; une autre autorité est refusée |
| `npm audit --audit-level=high` (serveur, web, bureau) | 0 vulnérabilité |
| `cargo audit` | 0 vulnérabilité ; 5 avertissements sur des dépendances indirectes Linux de Tauri (§5) |
| SBOM | `docs/sbom/officine-server.cdx.json`, `docs/sbom/officine-web.cdx.json` (CycloneDX) |
| Build de production | `npm run build` OK ; serveur compilé démarré en TLS, santé et interface vérifiées |

## 2. Ce qui est construit

| Domaine | Exigences | Où |
|---|---|---|
| Installation, TLS, empreinte | I-01 à I-06 | `security/keys.ts`, `x509.ts`, `tls.ts` (chaîne complète), `scripts/init.ts` |
| Authentification, comptes, droits | A-01 à A-08, U-01 à U-03 | `domain/auth.ts`, `security/*`, `http/hooks.ts` (refus tracés : `security.access_denied`) |
| Catalogue | C-01 à C-07 | `domain/search.ts`, `catalog.ts` (code interne EAN-13 préfixe 20), `gs1.ts`, `catalogImport.ts` |
| Stock et inventaire | S-01 à S-09 | `domain/stock.ts`, `inventory.ts` |
| Fournisseurs, commandes, réception, retours | R-01 à R-06 | `domain/suppliers.ts`, `orders.ts`, `orderExport.ts`, `receptions.ts` |
| Caisse et ventes | V-01 à V-10 | `domain/cash.ts`, `sales.ts`, `receipt.ts` |
| Ordonnances | O-01 à O-06 | `domain/prescriptions.ts` (photo AES-256-GCM, contre-signature sur le poste du caissier) |
| Rappels et péremptions | Q-01 à Q-05 | `domain/recalls.ts`, FEFO de `stock.ts` |
| Demandes non satisfaites | D-01 à D-03 | `domain/demand.ts` |
| Rapports | P-01 à P-08 | `domain/reports.ts` (CSV avec neutralisation des formules) |
| Journal | J-01 à J-06 | `domain/ledger.ts`, `verify.ts`, `ledgerExport.ts` |
| Sauvegarde et restauration | B-01 à B-05 | `domain/backup.ts` (VPBAK1), `tar.ts`, `jobs/backup.ts`, `scripts/backup.ts`, `restore.ts` |
| Garde | G-01 | `domain/duty.ts`, caisse de garde séparée |
| Interface | UI-01 à UI-16 | `web/src/screens/*` |
| Application de bureau | W-02 à W-09, W-11, DW-01 à DW-06 | `desktop/src-tauri/src/*`, `desktop/pairing/*`, `domain/desktop.ts`, `domain/devices.ts` |
| Dossier d'installation (demande du porteur) | DOS-01 | `domain/profile.ts`, écran `/dossier`, docs/11 |
| Exploitation | spec §9 | `deploy/` (Docker, systemd durci, `update.sh` avec retour arrière) |
| Recette | RC-02 à RC-19, RC-22, RC-25 automatisés | `server/test/recette.test.ts` (dont la coupure brutale RC-14 par SIGKILL) ; docs/manual-tests.md |

## 3. Ce qui attend une personne, et pourquoi

| Point | Raison | Procédure |
|---|---|---|
| W-01 installateurs signés | Certificat de signature de code (Authenticode) et clé de mise à jour Tauri : secrets de la CI | README « Application de bureau » |
| Autorité locale sur les postes | La WebView valide le TLS avec le magasin du système : l'autorité de l'officine doit y être installée | docs/manual-tests.md RC-21 |
| RC-01, RC-20, RC-21, RC-23, RC-24 | Mini-PC réel, chronométrage, imprimante de référence, paquets signés | docs/manual-tests.md §2 |
| W-10 effets de fenêtre | Contrôle visuel | — |
| DOS-02 dossier d'installation | Validation par l'ONPC, la DPML et un conseil fiscal des points « à confirmer » | docs/11 |
| DOS-03 TVA de la parapharmacie | Décision fiscale avant de modifier le calcul des ventes | docs/11 §5 |
| `keyring` pour le secret du poste | Dépendance hors liste autorisée (GUARDRAILS 19) | QUESTIONS Q-21 |

## 4. Hypothèses principales

Voir docs/QUESTIONS.md Q-01 à Q-22. Les plus structurantes :
- Le cookie de poste `vp_dev` est posé au démarrage par un jeton à usage unique (Q-22), faute de pouvoir ajouter un en-tête aux requêtes de la WebView.
- Le journal ne reçoit aucune donnée personnelle du dossier : seulement les noms des champs modifiés et une empreinte (Q-17).
- Les ventes en régularisation sont actives 30 jours après le premier événement du journal (V-05).
- Une restauration est vérifiée puis appliquée au redémarrage du service (B-04).
- Les lectures de rappels utilisent `report.stock` et les alertes de fraude `settings.edit`, pour ne pas ajouter d'action hors de la matrice (test U-03).

## 5. Risques connus

1. **Import et sauvegarde en mémoire** : l'archive de sauvegarde est construite en mémoire (base et photos). Cela convient pour quelques centaines de mégaoctets, au-delà il faudra passer en flux.
2. **Verrou d'écriture pendant l'import** : un import de 50 000 lignes prend environ 9 s et bloque les ventes pendant ce temps. L'import se fait donc hors des heures d'ouverture.
3. **Recherche** : `LIKE '%terme%'` mesuré sous 150 ms à 50 000 fiches. Pour un référentiel beaucoup plus gros, passer à FTS5.
4. **Dépendances Linux de Tauri** : `cargo audit` signale quatre crates non maintenues (`proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive`) et une alerte « unsound » (`glib`, RUSTSEC-2024-0429). Elles n'ont pas de vulnérabilité connue, et elles se mettront à jour avec Tauri.
5. **Impression** : seules les imprimantes ESC/POS réseau (TCP 9100) sont prises en charge en direct. Les imprimantes USB sous Windows passent par l'impression du système.
6. **QR code de la double authentification** : il n'est pas généré. La clé s'affiche en texte, à saisir dans l'application d'authentification.
7. **Points réglementaires** : la loi n° 90/035 n'a pas pu être lue en texte intégral (docs/11).

## 6. Commandes

```
cd apps/officine
npm ci && npm --prefix web ci
npm run init -- --data ./data-local && npm run build:web && npm start
npm run typecheck && npm run lint && npm test && npm run test:e2e
npm run desktop:test && npm run desktop:pinning-test
npm run verify-ledger -- --data ./data-local
```

Phase B (serveur central) : non commencée, conformément à la demande (« terminer la création du gestionnaire d'officine »).
