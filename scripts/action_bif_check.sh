#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/file-source/print_utils.sh"

DOMAIN="localhost"
COMPOSE_FILE="$ROOT_DIR/src/bif-viewer/docker-compose.yml"

print_step "BIF room health check başlatılıyor..."

print_step "BIF app healthy durumu bekleniyor..."

for i in {1..60}; do
  HEALTH_STATUS="$(
    docker inspect bif-viewer-app \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      2>/dev/null || true
  )"

  if [[ "$HEALTH_STATUS" == "healthy" ]]; then
    print_success "BIF app healthy."
    break
  fi

  if [[ "$HEALTH_STATUS" == "unhealthy" ]]; then
    print_error "BIF app unhealthy."
    print_manual "Kontrol et: docker logs --tail=160 bif-viewer-app"
    exit 1
  fi

  if [[ "$i" -eq 60 ]]; then
    print_error "BIF app 60 saniye içinde healthy olmadı. Son durum: ${HEALTH_STATUS:-unknown}"
    print_manual "Kontrol et: docker logs --tail=160 bif-viewer-app"
    exit 1
  fi

  print_info "BIF app henüz hazır değil: ${HEALTH_STATUS:-unknown} ($i/60)"
  sleep 1
done

echo ""
print_info "BIF container durumları:"
docker compose -f "$COMPOSE_FILE" ps

echo ""
print_step "[1/5] BIF backend internal health kontrolü..."

BACKEND_CODE="$(
  docker run --rm --network local-dev curlimages/curl:8.10.1 \
    -s --max-time 10 \
    -o /dev/null \
    -w "%{http_code}" \
    http://bif-viewer-app:8080/bif-viewer/
)"

if [[ "$BACKEND_CODE" == "200" ]]; then
  print_success "BIF backend internal 200 OK."
else
  print_error "BIF backend internal beklenen gibi değil. HTTP_CODE=$BACKEND_CODE"
  print_manual "Kontrol et: docker logs --tail=120 bif-viewer-app"
  exit 1
fi

echo ""
print_step "[2/5] BIF frontend internal kontrolü..."

FRONTEND_HTML="$(
  docker run --rm --network local-dev curlimages/curl:8.10.1 \
    -s --max-time 10 \
    http://bif-viewer-app:80/bif-viewer/
)"

if echo "$FRONTEND_HTML" | grep -qi "<!doctype html"; then
  print_success "BIF frontend internal HTML dönüyor."
else
  print_error "BIF frontend internal HTML beklenen gibi değil."
  print_manual "Kontrol et: docker logs --tail=120 bif-viewer-app"
  exit 1
fi

if echo "$FRONTEND_HTML" | grep -q "assets/index-"; then
  print_success "BIF frontend asset referansı var."
else
  print_warning "BIF frontend HTML içinde asset referansı okunamadı."
fi

echo ""
print_step "[3/5] Gateway üzerinden BIF auth redirect kontrolü..."

LOCATION="$(
  curl -skI --max-time 10 "https://${DOMAIN}/bif-viewer/" \
    | tr -d '\r' \
    | grep -i '^location:' || true
)"

if echo "$LOCATION" | grep -q "https://${DOMAIN}/keycloak/realms/gateway/protocol/openid-connect/auth"; then
  print_success "BIF route doğru şekilde gateway realm login'e yönleniyor."
  print_info "$LOCATION"
elif echo "$LOCATION" | grep -q "https://${DOMAIN}/oauth2/start"; then
  print_success "BIF route oauth2 start'a yönleniyor."
  print_info "$LOCATION"
else
  print_error "BIF route beklenen auth redirect'i üretmedi."
  print_info "Location: ${LOCATION:-boş}"
  print_manual "Kontrol et: docker logs --tail=120 gateway-nginx"
  exit 1
fi

echo ""
print_step "[4/5] BIF public asset kontrolü..."

ASSET_LOCATION="$(
  docker run --rm --network local-dev curlimages/curl:8.10.1 \
    -sk --max-time 10 \
    "http://bif-viewer-app:80/bif-viewer/" \
    | grep -o 'assets/index-[^"]*\.js' \
    | head -1 || true
)"

if [[ -z "$ASSET_LOCATION" ]]; then
  print_warning "Frontend asset dosyası index HTML içinden okunamadı."
else
  print_success "Frontend asset bulundu: $ASSET_LOCATION"

  if docker run --rm --network local-dev curlimages/curl:8.10.1 \
    -sk --max-time 10 \
    "http://bif-viewer-app:80/bif-viewer/${ASSET_LOCATION}" \
    | grep -q "localhost:8443"; then
    print_error "BIF frontend asset içinde localhost:8443 bulundu."
    exit 1
  else
    print_success "BIF frontend asset içinde localhost:8443 yok."
  fi
fi

echo ""
print_step "[5/5] BIF userinfo endpoint public auth kontrolü..."

USERINFO_CODE="$(
  curl -sk --max-time 10 \
    -o /dev/null \
    -w "%{http_code}" \
    "https://${DOMAIN}/oauth2/userinfo"
)"

if [[ "$USERINFO_CODE" == "401" || "$USERINFO_CODE" == "403" ]]; then
  print_success "/oauth2/userinfo authsuz erişimde korumalı. HTTP_CODE=$USERINFO_CODE"
elif [[ "$USERINFO_CODE" == "200" ]]; then
  print_warning "/oauth2/userinfo 200 döndü. Tarayıcıda aktif cookie olabilir; bu fatal değil."
else
  print_warning "/oauth2/userinfo beklenmeyen HTTP_CODE=$USERINFO_CODE"
fi

echo ""
print_success "BIF room health check tamamlandı."
print_manual "Tarayıcı testi: https://${DOMAIN}/bif-viewer/"