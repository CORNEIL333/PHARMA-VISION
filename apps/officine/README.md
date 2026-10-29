# VisionPharma Officine — gestionnaire d'officine

Gestionnaire d'officine hors ligne : un serveur local dans l'officine (Node.js + SQLite), une interface web servie par ce serveur, et une application de bureau (Tauri 2) pour les postes de travail. Aucune connexion Internet n'est nécessaire ni utilisée.

| Dossier | Contenu |
|---|---|
| `server/` | API Fastify, domaine métier, sécurité, tâches planifiées, tests Vitest |
| `web/` | Interface React (16 écrans, thème sombre et clair), tests Playwright |
| `desktop/` | Application de bureau Tauri 2 : appairage, épinglage TLS, impression ESC/POS, mises à jour signées |
| `scripts/` | init, import-catalog, backup, restore, verify-ledger, publish-desktop |
| `deploy/` | Dockerfile, docker-compose, service systemd, script de mise à jour avec retour arrière |
| `data/` | Échantillon de catalogue (147 lignes, annexe I2) |

## Prérequis

- Node.js 24 LTS (22.12 au minimum).
- Pour l'application de bureau : Rust stable et les prérequis Tauri 2 (WebView2 sous Windows, `libwebkit2gtk-4.1-dev` sous Ubuntu).
- Sous Windows, si `npm ci` n'arrive pas à télécharger `better-sqlite3`, installer « Visual Studio Build Tools » (charge de travail C++).

## Démarrer en développement

```
npm ci && npm --prefix web ci
npm run init -- --data ./data-local     # clés, autorité locale, certificat, base ; affiche UNE FOIS la clé de récupération
npm run build:web                        # interface (web/dist), servie par le serveur
npm start                                # https://localhost:8443
```

Ouvrir `https://localhost:8443` : l'écran de configuration initiale crée le titulaire (mot de passe, double authentification, clé de récupération recopiée). L'autorité locale (`data-local/tls/ca.pem`) doit être installée dans le magasin de confiance du navigateur ou du poste ; son empreinte s'affiche sur l'écran de connexion et dans Système.

Interface en développement avec rechargement à chaud : `npm run dev:web` (http://localhost:5173, appels `/api` relayés vers `https://localhost:8443`).

Ensuite, en tant que titulaire :
1. **Dossier de l'officine** (bandeau en haut de l'écran) : identité, autorisation MINSANTE, titulaire, localisation, fiscalité (NIU, RCCM), horaires, personnel, protection des données, tiers payant, grossistes. Détail : `../../docs/11-dossier-installation.md`.
2. **Système → Catalogue** : importer le CSV du référentiel (format de l'annexe I).
3. **Comptes** : créer pharmaciens, préparateurs et caissiers (mot de passe temporaire à changer à la première connexion).
4. **Système → Postes** : générer un code d'appairage pour chaque poste équipé de l'application de bureau.

## Installation en production

### Docker

```
cp deploy/.env.example deploy/.env
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml run --rm officine node dist/scripts/init.js --data /data --name officine.local --ip 192.168.1.10
docker compose -f deploy/docker-compose.yml up -d
```

L'image tourne sans droits root, système de fichiers en lecture seule, toutes capacités retirées ; les données sont dans le volume `officine-data`.

### Ubuntu Server 24.04, service systemd

```
sudo useradd --system --home /var/lib/visionpharma --shell /usr/sbin/nologin vpofficine
sudo install -d -o vpofficine -g vpofficine -m 0700 /var/lib/visionpharma
# sur la machine de build : npm ci && npm --prefix web ci && npm run build && npm prune --omit=dev
#   puis archiver package.json, node_modules, dist, web/dist et data dans visionpharma-officine-<version>.tar.gz
sudo install -d /opt/visionpharma/releases/<version> && sudo tar -xzf visionpharma-officine-<version>.tar.gz -C /opt/visionpharma/releases/<version>
sudo ln -sfn /opt/visionpharma/releases/<version> /opt/visionpharma/current
sudo -u vpofficine node /opt/visionpharma/current/dist/scripts/init.js --data /var/lib/visionpharma
sudo cp deploy/visionpharma-officine.service /etc/systemd/system/ && sudo systemctl enable --now visionpharma-officine
```

Mise à jour avec sauvegarde préalable et retour automatique si le contrôle de santé échoue : `sudo deploy/update.sh visionpharma-officine-<nouvelle version>.tar.gz`.

Variables d'environnement : `VP_DATA_DIR` (`./data-local`), `VP_HOST` (`0.0.0.0`), `VP_PORT` (`8443`), `VP_LOG_LEVEL` (`info`), `VP_WEB_DIST` (`web/dist` s'il existe), `VP_EXPIRY_BLOCK_DAYS` (`0`), `VP_REQUIRE_TLS` (`true` ; `false` seulement en développement, journalisé).

## Sauvegarde et restauration

- Automatique chaque jour à l'heure réglée dans Système → Paramètres (14 archives conservées), copie miroir sur un disque USB si un répertoire est réglé.
- Manuelle : Système → Sauvegardes, ou `npm run backup -- --data <répertoire>`.
- Restauration sur la même machine : Système → Sauvegardes → « Restaurer » (titulaire ré-authentifié ; le service redémarre).
- Restauration sur une machine neuve (service arrêté) :

```
npm run init -- --data ./data-neuve
npm run restore -- --data ./data-neuve --file /media/usb/vp-….vpbak --recovery-key XXXX-XXXX-…
```

L'archive (format VPBAK1, AES-256-GCM) est entièrement vérifiée, journal compris, avant tout remplacement ; l'ancien état est conservé dans `pre-restore-<horodatage>/`.

## Application de bureau des postes

```
npm run desktop:dev        # développement (tauri dev)
npm run desktop:test       # tests Rust : ESC/POS, navigation, capacités figées, configuration
npm run desktop:pinning-test   # épinglage TLS contre un vrai serveur (faux serveur refusé)
npm run desktop:build      # installateurs ; en CI seulement (signature de code et clé de mise à jour)
```

Au premier lancement : adresse du serveur, comparaison de l'empreinte avec celle de l'écran Système, puis code d'appairage à 8 chiffres. Le menu « Poste » règle l'imprimante ESC/POS réseau (`IP:9100`). Publication d'une mise à jour signée : `npm run publish-desktop -- --version X.Y.Z --dir <paquets et .sig>`.

À faire par une personne avant la production : générer la clé de mise à jour (`npx tauri signer generate`) et placer la clé publique dans `desktop/src-tauri/tauri.conf.json` ; signer les installateurs (certificat Authenticode) ; installer l'autorité locale dans le magasin de confiance de chaque poste.

## Vérifications

```
npm run typecheck          # serveur et interface
npm run lint
npm test                   # Vitest (serveur), dont les scénarios de recette automatisés
npm run test:e2e           # Playwright sur un vrai serveur ; axe ; captures dans ../../docs/screenshots
npm run desktop:test
npm run verify-ledger -- --data ./data-local   # 0 = journal intact, 2 = défaut détecté (seq indiqué)
```

Recette : `../../docs/manual-tests.md` (couverture automatique et procédures manuelles). Avancement : `../../docs/PROGRESS.md`.

## Sécurité, en bref

TLS obligatoire (autorité locale ECDSA P-256), sessions en cookie `HttpOnly`/`Secure`/`SameSite=Strict`, CSRF sur toute écriture, matrice des droits côté serveur, ré-authentification pour les actions sensibles, mots de passe scrypt, TOTP, journal chaîné SHA-256 avec points de contrôle Ed25519, photos d'ordonnance chiffrées, aucune donnée de santé dans les journaux techniques, aucun appel réseau sortant. Le répertoire de données (base, clés, sauvegardes) n'est jamais servi par HTTP.
