#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/file-source/print_utils.sh"

COMPOSE_FILE="$ROOT_DIR/src/bif-viewer/docker-compose.yml"

print_step "BIF room ayağa kaldırılıyor..."

if [[ ! -f "$COMPOSE_FILE" ]]; then
  print_error "BIF compose dosyası bulunamadı: $COMPOSE_FILE"
  exit 1
fi

print_warning "Bu script setup veya gateway check çalıştırmaz."
print_manual "Öncesinde manuel olarak şu sıranın tamamlanmış olması gerekir:"
echo "  ./scripts/action_setup.sh"
echo "  ./scripts/action_gateway_up.sh"
echo "  ./scripts/action_gateway_check.sh"

echo ""
print_info "BIF Docker Compose build/up başlatılıyor..."
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans

print_step "BIF gateway room config etkinleştiriliyor..."
if [[ -f "$ROOT_DIR/src/gateway/config/nginx/rooms-disabled/bif-viewer.conf" ]]; then
  mv "$ROOT_DIR/src/gateway/config/nginx/rooms-disabled/bif-viewer.conf" \
     "$ROOT_DIR/src/gateway/config/nginx/rooms-enabled/bif-viewer.conf"
  print_success "BIF room config enabled."
elif [[ -f "$ROOT_DIR/src/gateway/config/nginx/rooms-enabled/bif-viewer.conf" ]]; then
  print_info "BIF room config zaten enabled."
else
  print_warning "BIF room config bulunamadı."
fi

echo ""
print_info "BIF container durumları:"
docker compose -f "$COMPOSE_FILE" ps

echo ""
print_info "Gateway nginx config test ediliyor..."
docker exec gateway-nginx nginx -t

echo ""
print_info "Gateway nginx reload ediliyor..."
docker exec gateway-nginx nginx -s reload

echo ""
print_success "BIF room up komutu tamamlandı."

print_manual "Sonraki manuel kontrol:"
echo "  ./scripts/action_bif_check.sh"
