#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/file-source/print_utils.sh"

DOMAIN="localhost"
COMPOSE_FILE="$ROOT_DIR/src/pacs-viewer/docker-compose.yml"

print_step "PACS room health check başlatılıyor..."

echo ""
print_step "PACS container durumları bekleniyor..."

for i in {1..120}; do
  DB_HEALTH="$(docker inspect pacs-viewer-db --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
  LDAP_HEALTH="$(docker inspect pacs-viewer-ldap --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
  ARC_STATUS="$(docker inspect pacs-viewer-arc --format '{{.State.Status}}' 2>/dev/null || true)"
  APP_STATUS="$(docker inspect pacs-viewer-app --format '{{.State.Status}}' 2>/dev/null || true)"

  if [[ "$DB_HEALTH" == "healthy" && "$LDAP_HEALTH" == "healthy" && "$ARC_STATUS" == "running" && "$APP_STATUS" == "running" ]]; then
    print_success "PACS temel container durumları hazır."
    break
  fi

  if [[ "$i" -eq 120 ]]; then
    print_error "PACS containerları 120 saniye içinde hazır olmadı."
    print_info "DB=$DB_HEALTH LDAP=$LDAP_HEALTH ARC=$ARC_STATUS APP=$APP_STATUS"
    print_manual "Kontrol et:"
    echo "  docker compose -f src/pacs-viewer/docker-compose.yml ps"
    echo "  docker logs --tail=160 pacs-viewer-arc"
    echo "  docker logs --tail=160 pacs-viewer-app"
    exit 1
  fi

  print_info "Bekleniyor: DB=$DB_HEALTH LDAP=$LDAP_HEALTH ARC=$ARC_STATUS APP=$APP_STATUS ($i/120)"
  sleep 1
done

echo ""
print_info "PACS container durumları:"
docker compose -f "$COMPOSE_FILE" ps

echo ""
print_step "[1/5] PACS frontend internal kontrolü..."

FRONTEND_CODE="$(
  docker run --rm --network local-dev curlimages/curl:8.10.1 \
    -s --max-time 10 \
    -o /dev/null \
    -w "%{http_code}" \
    http://pacs-viewer-app:80/pacs-viewer/
)"

if [[ "$FRONTEND_CODE" == "200" ]]; then
  print_success "PACS frontend internal 200 OK."
else
  print_warning "PACS frontend /pacs-viewer/ internal HTTP_CODE=$FRONTEND_CODE"
  print_info "Root path de deneniyor..."

  ROOT_CODE="$(
    docker run --rm --network local-dev curlimages/curl:8.10.1 \
      -s --max-time 10 \
      -o /dev/null \
      -w "%{http_code}" \
      http://pacs-viewer-app:80/
  )"

  if [[ "$ROOT_CODE" == "200" ]]; then
    print_success "PACS frontend root internal 200 OK."
  else
    print_error "PACS frontend internal beklenen gibi değil. /pacs-viewer=$FRONTEND_CODE root=$ROOT_CODE"
    print_manual "Kontrol et: docker logs --tail=120 pacs-viewer-app"
    exit 1
  fi
fi

echo ""
print_step "[2/5] dcm4chee internal kontrolü..."

ARC_CODE="$(
  docker run --rm --network local-dev curlimages/curl:8.10.1 \
    -s --max-time 20 \
    -o /dev/null \
    -w "%{http_code}" \
    http://pacs-viewer-arc:8080/dcm4chee-arc/ui2/
)"

if [[ "$ARC_CODE" == "200" || "$ARC_CODE" == "302" || "$ARC_CODE" == "401" ]]; then
  print_success "dcm4chee internal erişilebilir. HTTP_CODE=$ARC_CODE"
else
  print_error "dcm4chee internal beklenen gibi değil. HTTP_CODE=$ARC_CODE"
  print_manual "Kontrol et: docker logs --tail=160 pacs-viewer-arc"
  exit 1
fi

echo ""
print_step "[3/5] DICOM C-STORE port kontrolü..."

if timeout 5 bash -lc "cat < /dev/null > /dev/tcp/127.0.0.1/11113" 2>/dev/null; then
  print_success "Host DICOM port açık: 11113"
else
  print_error "Host DICOM port açık görünmüyor: 11113"
  print_manual "Kontrol et: docker compose -f src/pacs-viewer/docker-compose.yml ps"
  exit 1
fi

echo ""
print_step "[4/5] Public PACS viewer auth redirect kontrolü..."

LOCATION="$(
  curl -skI --max-time 10 "https://${DOMAIN}/pacs-viewer/" \
    | tr -d '\r' \
    | grep -i '^location:' || true
)"

if echo "$LOCATION" | grep -q "https://${DOMAIN}/keycloak/realms/gateway/protocol/openid-connect/auth"; then
  print_success "PACS viewer route gateway realm login'e yönleniyor."
  print_info "$LOCATION"
elif echo "$LOCATION" | grep -q "https://${DOMAIN}/oauth2/sign_in"; then
  print_success "PACS viewer route oauth2 sign_in'e yönleniyor."
  print_info "$LOCATION"
else
  print_error "PACS viewer route beklenen auth redirect'i üretmedi."
  print_info "Location: ${LOCATION:-boş}"
  print_manual "Kontrol et: docker logs --tail=120 gateway-nginx"
  exit 1
fi

echo ""
print_step "[5/5] Public dcm4chee UI admin auth kontrolü..."

DCM_LOCATION="$(
  curl -skI --max-time 10 "https://${DOMAIN}/dcm4chee-arc/ui2/" \
    | tr -d '\r' \
    | grep -i '^location:' || true
)"

if echo "$DCM_LOCATION" | grep -q "https://${DOMAIN}/keycloak/realms/gateway/protocol/openid-connect/auth"; then
  print_success "dcm4chee UI gateway realm login'e yönleniyor."
  print_info "$DCM_LOCATION"
elif echo "$DCM_LOCATION" | grep -q "https://${DOMAIN}/oauth2/sign_in"; then
  print_success "dcm4chee UI oauth2 sign_in'e yönleniyor."
  print_info "$DCM_LOCATION"
else
  print_error "dcm4chee UI beklenen auth redirect'i üretmedi."
  print_info "Location: ${DCM_LOCATION:-boş}"
  print_manual "Kontrol et: docker logs --tail=120 gateway-nginx"
  exit 1
fi

echo ""
print_success "PACS room health check tamamlandı."
print_manual "Tarayıcı testi: https://${DOMAIN}/pacs-viewer/"
print_manual "dcm4chee admin UI testi: https://${DOMAIN}/dcm4chee-arc/ui2/"
print_manual "DICOM gönderim portu: storescu <server-ip> 11113 ..."
