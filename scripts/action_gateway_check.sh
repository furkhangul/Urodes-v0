#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/file-source/print_utils.sh"

COMPOSE_FILE="$ROOT_DIR/src/gateway/docker-compose.yml"
DOMAIN="localhost"
REALM="gateway"

print_step "Gateway hall health check başlatılıyor..."

print_info "Container durumları:"
docker compose -f "$COMPOSE_FILE" ps

echo ""

print_step "[1/3] Internal Keycloak issuer kontrolü..."

INTERNAL_ISSUER="$(
  docker run --rm --network local-dev curlimages/curl:8.10.1 \
    -sS "http://gateway-nginx:8090/keycloak/realms/${REALM}/.well-known/openid-configuration" \
    | grep -o '"issuer":"[^"]*"' || true
)"

EXPECTED_ISSUER="\"issuer\":\"https://${DOMAIN}/keycloak/realms/${REALM}\""

if [[ "$INTERNAL_ISSUER" == "$EXPECTED_ISSUER" ]]; then
  print_success "Internal issuer doğru: $INTERNAL_ISSUER"
else
  print_error "Internal issuer beklenen gibi değil."
  print_info "Beklenen: $EXPECTED_ISSUER"
  print_info "Gelen   : ${INTERNAL_ISSUER:-boş}"
  exit 1
fi

echo ""

print_step "[2/3] Public Keycloak endpoint kontrolü..."

HTTP_CODE="$(
  curl -sk -o /tmp/gateway_keycloak_check.json -w "%{http_code}" \
    "https://${DOMAIN}/keycloak/realms/${REALM}/.well-known/openid-configuration"
)"

if [[ "$HTTP_CODE" == "200" ]]; then
  print_success "Public Keycloak endpoint 200 OK."
else
  print_error "Public Keycloak endpoint beklenen gibi değil. HTTP_CODE=$HTTP_CODE"
  print_manual "Kontrol et: docker logs --tail=80 viewer_tunnel_daemon"
  exit 1
fi

PUBLIC_ISSUER="$(grep -o '"issuer":"[^"]*"' /tmp/gateway_keycloak_check.json || true)"

if [[ "$PUBLIC_ISSUER" == "$EXPECTED_ISSUER" ]]; then
  print_success "Public issuer doğru: $PUBLIC_ISSUER"
else
  print_error "Public issuer beklenen gibi değil."
  print_info "Beklenen: $EXPECTED_ISSUER"
  print_info "Gelen   : ${PUBLIC_ISSUER:-boş}"
  exit 1
fi

echo ""

print_step "[3/3] OAuth başlangıç yönlendirmesi kontrolü..."

LOCATION="$(
  curl -skI "https://${DOMAIN}/oauth2/start?rd=https://${DOMAIN}/" \
    | tr -d '\r' \
    | grep -i '^location:' || true
)"

if echo "$LOCATION" | grep -q "https://${DOMAIN}/keycloak/realms/${REALM}/protocol/openid-connect/auth"; then
  print_success "OAuth start doğru şekilde gateway realm'e yönleniyor."
  print_info "$LOCATION"
else
  print_warning "OAuth start location beklenen gibi görünmüyor."
  print_info "Location: ${LOCATION:-boş}"
  print_manual "Bu her zaman fatal olmayabilir; tarayıcı testiyle de doğrulayacağız."
fi

echo ""

print_success "Gateway hall health check tamamlandı."
print_manual "Sonraki adım: BIF room'u ayağa kaldırmak."
