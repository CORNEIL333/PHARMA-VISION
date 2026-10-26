# VisionPharma Officine — serveur local

Gestionnaire d'officine hors ligne. Ce dossier contient le serveur (Node.js + SQLite). L'interface (`web/`) et l'application de bureau (`desktop/`) restent à construire : voir `../../docs/PROGRESS.md`.

## Prérequis

- Node.js 24 LTS (22.12 minimum).
- Sous Windows : si `npm ci` n'arrive pas à télécharger le binaire précompilé de `better-sqlite3`, installer « Visual Studio Build Tools » (charge de travail C++) puis relancer.

## Démarrer en développement

```
npm ci
npm run init -- --data ./data-local          # crée les clés, l'autorité locale, le certificat et la base
npm start                                     # https://localhost:8443
```

`init` affiche **une seule fois** la clé de récupération : la recopier sur papier. Elle est demandée à la configuration initiale.

Pour tester l'API sans interface :

```
curl --cacert data-local/tls/ca.pem https://localhost:8443/api/v1/health
```

Variables d'environnement : `VP_DATA_DIR` (défaut `./data-local`), `VP_HOST` (`0.0.0.0`), `VP_PORT` (`8443`), `VP_LOG_LEVEL` (`info`), `VP_REQUIRE_TLS` (`true` ; `false` seulement en développement, journalisé).

## Vérifications

```
npm run typecheck
npm run lint
npm test                                      # Vitest
npm run verify-ledger -- --data ./data-local  # 0 = journal intact, 2 = défaut détecté
```

## Ce qui est construit

| Domaine | Exigences | Où |
|---|---|---|
| Initialisation, TLS, empreinte | I-01, I-05, I-06 | `security/keys.ts`, `security/x509.ts`, `tls.ts`, `scripts/init.ts` |
| Journal chaîné et vérification | J-01 à J-04, J-06 | `domain/ledger.ts`, `domain/verify.ts`, `domain/jcs.ts` |
| Configuration initiale | I-02, I-03 | `domain/setup.ts` |
| Authentification, sessions, droits | A-01 à A-08 | `domain/auth.ts`, `security/*`, `http/hooks.ts` |
| Comptes | U-01 à U-03 | `domain/users.ts`, `http/routes/users.ts` |

Le répertoire de données contient la base, les clés (`keys/`, droits 0600) et les certificats (`tls/`). Il n'est jamais servi par HTTP.
