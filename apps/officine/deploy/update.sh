#!/usr/bin/env bash
# Mise à jour du serveur (spec §9, RC-20) sur Ubuntu Server 24.04, installation native :
#   sudo ./update.sh /chemin/vers/visionpharma-officine-<version>.tar.gz
# 1. sauvegarde chiffrée immédiate (B-01) ; 2. décompression dans /opt/visionpharma/releases/<version> ;
# 3. bascule du lien /opt/visionpharma/current ; 4. redémarrage (les migrations s'appliquent au démarrage) ;
# 5. contrôle de santé pendant 60 s ; en cas d'échec, retour au lien précédent et redémarrage.
# Les migrations n'effacent jamais de données ; une base migrée reste lisible par la version précédente
# tant que la migration ne fait qu'ajouter (règle du projet). En cas de doute : restauration de la
# sauvegarde prise à l'étape 1 (npm run restore, voir README).
set -euo pipefail

ARCHIVE="${1:?archive de la nouvelle version attendue}"
BASE=/opt/visionpharma
DATA=/var/lib/visionpharma
SERVICE=visionpharma-officine
HEALTH="https://127.0.0.1:${VP_PORT:-8443}/api/v1/health"
CA="$DATA/tls/ca.pem"

log() { printf '%s  %s\n' "$(date -Iseconds)" "$*"; }

[ -f "$ARCHIVE" ] || { log "archive introuvable : $ARCHIVE"; exit 2; }
VERSION="$(basename "$ARCHIVE" .tar.gz)"
PREVIOUS="$(readlink -f "$BASE/current" || true)"
TARGET="$BASE/releases/$VERSION"

log "1/5 sauvegarde avant mise à jour"
sudo -u vpofficine node "$PREVIOUS/dist/scripts/backup.js" --data "$DATA"

log "2/5 installation de $VERSION"
install -d -m 0755 "$TARGET"
tar -xzf "$ARCHIVE" -C "$TARGET"

log "3/5 bascule vers $VERSION"
ln -sfn "$TARGET" "$BASE/current.new" && mv -T "$BASE/current.new" "$BASE/current"

log "4/5 redémarrage"
systemctl restart "$SERVICE"

log "5/5 contrôle de santé"
for _ in $(seq 1 30); do
  if curl -fsS --cacert "$CA" "$HEALTH" | grep -q '"status":"ok"'; then
    log "mise à jour réussie : $VERSION"
    exit 0
  fi
  sleep 2
done

log "ÉCHEC du contrôle de santé : retour à $PREVIOUS"
if [ -n "$PREVIOUS" ]; then
  ln -sfn "$PREVIOUS" "$BASE/current.new" && mv -T "$BASE/current.new" "$BASE/current"
  systemctl restart "$SERVICE"
  for _ in $(seq 1 30); do
    if curl -fsS --cacert "$CA" "$HEALTH" | grep -q '"status":"ok"'; then
      log "version précédente rétablie"
      exit 1
    fi
    sleep 2
  done
fi
log "la version précédente ne répond pas non plus : restaurer la sauvegarde (README, « Restauration »)"
exit 3
