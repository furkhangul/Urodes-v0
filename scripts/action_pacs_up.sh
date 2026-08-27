#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/file-source/print_utils.sh"

COMPOSE_FILE="$ROOT_DIR/src/pacs-viewer/docker-compose.yml"

ENABLED_CONF="$ROOT_DIR/src/gateway/config/nginx/rooms-enabled/pacs-viewer.conf"
DISABLED_CONF="$ROOT_DIR/src/gateway/config/nginx/rooms-disabled/pacs-viewer.conf"

PACS_DATA_DIR="$ROOT_DIR/src/pacs-viewer/data"
PACS_DB_DIR="$PACS_DATA_DIR/db"
PACS_ARC_DIR="$PACS_DATA_DIR/arc"
PACS_LDAP_DIR="$PACS_DATA_DIR/ldap"
PACS_SLAPD_DIR="$PACS_DATA_DIR/slapd.d"

ARC_IMAGE="dcm4che/dcm4chee-arc-psql:5.34.3"
DB_IMAGE="dcm4che/postgres-dcm4chee:11.22-34"
LDAP_IMAGE="dcm4che/slapd-dcm4chee:2.6.10-34.3"

RESET_PACS_DATA="${RESET_PACS_DATA:-no}"

print_step "PACS room ayağa kaldırılıyor..."

if [[ ! -f "$COMPOSE_FILE" ]]; then
  print_error "PACS compose dosyası bulunamadı: $COMPOSE_FILE"
  exit 1
fi

print_warning "Bu script setup veya gateway check çalıştırmaz."
print_manual "Öncesinde manuel olarak şu sıranın tamamlanmış olması gerekir:"
echo "  ./scripts/action_setup.sh"
echo "  ./scripts/action_gateway_up.sh"
echo "  ./scripts/action_gateway_check.sh"

echo ""
print_step "PACS gateway room config başlangıçta güvenli moda alınıyor..."

mkdir -p "$ROOT_DIR/src/gateway/config/nginx/rooms-enabled"
mkdir -p "$ROOT_DIR/src/gateway/config/nginx/rooms-disabled"

if [[ -f "$ENABLED_CONF" ]]; then
  mv "$ENABLED_CONF" "$DISABLED_CONF"
  print_warning "PACS room config geçici olarak disabled edildi."
elif [[ -f "$DISABLED_CONF" ]]; then
  print_info "PACS room config zaten disabled."
else
  print_warning "PACS room config bulunamadı."
fi

if docker inspect gateway-nginx >/dev/null 2>&1; then
  docker exec gateway-nginx nginx -t
  docker exec gateway-nginx nginx -s reload
fi

echo ""
print_step "PACS image'ları hazır mı kontrol ediliyor..."

docker image inspect "$ARC_IMAGE" >/dev/null 2>&1 || docker pull "$ARC_IMAGE"
docker image inspect "$DB_IMAGE" >/dev/null 2>&1 || docker pull "$DB_IMAGE"
docker image inspect "$LDAP_IMAGE" >/dev/null 2>&1 || docker pull "$LDAP_IMAGE"

get_image_uid() {
  local image="$1"
  local user_expr="$2"

  docker run --rm --entrypoint sh "$image" -c "$user_expr" 2>/dev/null
}

ARC_UID="$(get_image_uid "$ARC_IMAGE" 'id -u')"
ARC_GID="$(get_image_uid "$ARC_IMAGE" 'id -g')"

DB_UID="$(get_image_uid "$DB_IMAGE" 'id -u postgres 2>/dev/null || id -u')"
DB_GID="$(get_image_uid "$DB_IMAGE" 'id -g postgres 2>/dev/null || id -g')"

LDAP_UID="$(get_image_uid "$LDAP_IMAGE" 'id -u ldap 2>/dev/null || id -u')"
LDAP_GID="$(get_image_uid "$LDAP_IMAGE" 'id -g ldap 2>/dev/null || id -g')"

print_info "ARC_UID=$ARC_UID ARC_GID=$ARC_GID"
print_info "DB_UID=$DB_UID DB_GID=$DB_GID"
print_info "LDAP_UID=$LDAP_UID LDAP_GID=$LDAP_GID"

echo ""
print_step "PACS container temizliği kontrol ediliyor..."

if [[ "$RESET_PACS_DATA" == "yes" ]]; then
  print_warning "RESET_PACS_DATA=yes verildi. PACS containerları, named volume'ları ve host runtime data silinecek."

  docker stop pacs-viewer-app pacs-viewer-arc pacs-viewer-db pacs-viewer-ldap 2>/dev/null || true
  docker rm pacs-viewer-app pacs-viewer-arc pacs-viewer-db pacs-viewer-ldap 2>/dev/null || true

  docker volume ls --format '{{.Name}}' \
    | grep -E 'pacs|pacs-viewer' \
    | xargs -r docker volume rm || true

  sudo rm -rf "$PACS_DB_DIR"
  sudo rm -rf "$PACS_ARC_DIR"
  sudo rm -rf "$PACS_LDAP_DIR"
  sudo rm -rf "$PACS_SLAPD_DIR"
else
  print_info "RESET_PACS_DATA verilmedi. Mevcut PACS data korunacak."
fi

echo ""
print_step "PACS runtime klasörleri hazırlanıyor..."

# Bu klasörler daha önce container kullanıcılarına chown edilmiş olabilir.
# Bu yüzden repeatable çalışması için mkdir/touch/rm işlemleri sudo ile yapılır.
sudo mkdir -p "$PACS_DB_DIR"

sudo mkdir -p "$PACS_ARC_DIR"
sudo mkdir -p "$PACS_ARC_DIR/data"
sudo mkdir -p "$PACS_ARC_DIR/data/content"
sudo mkdir -p "$PACS_ARC_DIR/log"
sudo mkdir -p "$PACS_ARC_DIR/tmp"
sudo mkdir -p "$PACS_ARC_DIR/deployments"
sudo mkdir -p "$PACS_ARC_DIR/configuration"

sudo mkdir -p "$PACS_LDAP_DIR"
sudo mkdir -p "$PACS_SLAPD_DIR"

sudo touch "$PACS_ARC_DIR/.gitkeep"
sudo touch "$PACS_LDAP_DIR/.gitkeep"
sudo touch "$PACS_SLAPD_DIR/.gitkeep"

sudo rm -f "$PACS_DB_DIR/.gitkeep"

print_info "PostgreSQL DB klasörüne .gitkeep konulmadı: $PACS_DB_DIR"

echo ""
print_step "PACS bind mount izinleri düzeltiliyor..."

sudo chown -R "${ARC_UID}:${ARC_GID}" "$PACS_ARC_DIR"
sudo chmod -R a+rwX "$PACS_ARC_DIR"

sudo chown -R "${DB_UID}:${DB_GID}" "$PACS_DB_DIR"
sudo chmod -R u+rwX,g+rwX "$PACS_DB_DIR"

sudo chown -R "${LDAP_UID}:${LDAP_GID}" "$PACS_LDAP_DIR" "$PACS_SLAPD_DIR"
sudo chmod -R u+rwX,g+rwX "$PACS_LDAP_DIR" "$PACS_SLAPD_DIR"

print_success "PACS bind mount izinleri hazır."

echo ""
print_info "PACS data izin özeti:"
ls -ldn "$PACS_DB_DIR" "$PACS_ARC_DIR" "$PACS_ARC_DIR/data/content" "$PACS_ARC_DIR/log" "$PACS_LDAP_DIR" "$PACS_SLAPD_DIR"

echo ""
print_step "PACS compose içindeki PGDATA kontrol ediliyor..."

if grep -q "PGDATA:" "$COMPOSE_FILE"; then
  print_success "PGDATA tanımı mevcut."
else
  print_warning "PGDATA tanımı görünmedi. PostgreSQL bind mount sorunları yaşanabilir."
  print_manual "pacs-viewer-db environment altına şunu ekle:"
  echo "  PGDATA: /var/lib/postgresql/data/pgdata"
fi

echo ""
print_info "PACS Docker Compose build/up başlatılıyor..."
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans

echo ""
print_step "PACS servislerinin stabil hale gelmesi bekleniyor..."

SUCCESS_COUNT=0

for i in {1..240}; do
  DB_HEALTH="$(
    docker inspect pacs-viewer-db \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      2>/dev/null || true
  )"

  LDAP_HEALTH="$(
    docker inspect pacs-viewer-ldap \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      2>/dev/null || true
  )"

  ARC_STATUS="$(
    docker inspect pacs-viewer-arc \
      --format '{{.State.Status}}' \
      2>/dev/null || true
  )"

  APP_STATUS="$(
    docker inspect pacs-viewer-app \
      --format '{{.State.Status}}' \
      2>/dev/null || true
  )"

  DNS_APP="no"
  DNS_ARC="no"

  if docker exec gateway-nginx getent hosts pacs-viewer-app >/dev/null 2>&1; then
    DNS_APP="yes"
  fi

  if docker exec gateway-nginx getent hosts pacs-viewer-arc >/dev/null 2>&1; then
    DNS_ARC="yes"
  fi

  ARC_CODE="$(
    docker run --rm --network local-dev curlimages/curl:8.10.1 \
      -s --connect-timeout 2 --max-time 8 \
      -o /dev/null \
      -w "%{http_code}" \
      http://pacs-viewer-arc:8080/dcm4chee-arc/ui2/ \
      2>/dev/null || true
  )"

  if [[ "$DB_HEALTH" == "healthy" \
        && "$LDAP_HEALTH" == "healthy" \
        && "$ARC_STATUS" == "running" \
        && "$APP_STATUS" == "running" \
        && "$DNS_APP" == "yes" \
        && "$DNS_ARC" == "yes" \
        && ( "$ARC_CODE" == "200" || "$ARC_CODE" == "302" || "$ARC_CODE" == "401" ) ]]; then

    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    print_info "PACS stabil sinyal: $SUCCESS_COUNT/5 DB=$DB_HEALTH LDAP=$LDAP_HEALTH ARC=$ARC_STATUS APP=$APP_STATUS ARC_CODE=$ARC_CODE"

    if [[ "$SUCCESS_COUNT" -ge 5 ]]; then
      print_success "PACS servisleri stabil."
      break
    fi
  else
    SUCCESS_COUNT=0
    print_info "Bekleniyor: DB=$DB_HEALTH LDAP=$LDAP_HEALTH ARC=$ARC_STATUS APP=$APP_STATUS DNS_APP=$DNS_APP DNS_ARC=$DNS_ARC ARC_CODE=${ARC_CODE:-boş} ($i/240)"
  fi

  if [[ "$i" -eq 240 ]]; then
    print_error "PACS servisleri 240 saniye içinde stabil hale gelmedi."
    print_info "DB=$DB_HEALTH LDAP=$LDAP_HEALTH ARC=$ARC_STATUS APP=$APP_STATUS DNS_APP=$DNS_APP DNS_ARC=$DNS_ARC ARC_CODE=${ARC_CODE:-boş}"
    print_manual "Kontrol et:"
    echo "  docker logs --tail=300 pacs-viewer-arc"
    echo "  docker compose -f src/pacs-viewer/docker-compose.yml ps"
    exit 1
  fi

  sleep 1
done

echo ""
print_step "PACS gateway room config etkinleştiriliyor..."

if [[ -f "$DISABLED_CONF" ]]; then
  mv "$DISABLED_CONF" "$ENABLED_CONF"
  print_success "PACS room config enabled."
elif [[ -f "$ENABLED_CONF" ]]; then
  print_info "PACS room config zaten enabled."
else
  print_error "PACS room config bulunamadı. Beklenen:"
  echo "  $DISABLED_CONF"
  echo "  $ENABLED_CONF"
  exit 1
fi

echo ""
print_info "PACS container durumları:"
docker compose -f "$COMPOSE_FILE" ps

echo ""
print_info "Gateway nginx config test ediliyor..."

if ! docker exec gateway-nginx nginx -t; then
  print_error "Gateway nginx config test başarısız. PACS config tekrar disabled ediliyor."

  if [[ -f "$ENABLED_CONF" ]]; then
    mv "$ENABLED_CONF" "$DISABLED_CONF"
  fi

  docker exec gateway-nginx nginx -t || true
  exit 1
fi

echo ""
print_info "Gateway nginx reload ediliyor..."
docker exec gateway-nginx nginx -s reload

echo ""
print_success "PACS room up komutu tamamlandı."

print_manual "Sonraki manuel kontrol:"
echo "  ./scripts/action_pacs_check.sh"
