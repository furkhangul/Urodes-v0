#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/file-source/print_utils.sh"

COMPOSE_FILE="$ROOT_DIR/src/gateway/docker-compose.yml"

print_step "Gateway hall ayağa kaldırılıyor..."

if [[ ! -f "$COMPOSE_FILE" ]]; then
  print_error "Gateway compose dosyası bulunamadı: $COMPOSE_FILE"
  exit 1
fi

print_info "Docker Compose build/up başlatılıyor..."
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans

print_step "Gateway başlangıcı için room configleri güvenli moda alınıyor..."
mkdir -p "$ROOT_DIR/src/gateway/config/nginx/rooms-enabled"
mkdir -p "$ROOT_DIR/src/gateway/config/nginx/rooms-disabled"
disable_room_if_upstream_missing() {
  local room_name="$1"
  local required_container="$2"

  local enabled_conf="$ROOT_DIR/src/gateway/config/nginx/rooms-enabled/${room_name}.conf"
  local disabled_conf="$ROOT_DIR/src/gateway/config/nginx/rooms-disabled/${room_name}.conf"

  if [[ ! -f "$enabled_conf" ]]; then
    return 0
  fi

  local running="false"
  running="$(docker inspect "$required_container" --format '{{.State.Running}}' 2>/dev/null || echo false)"

  if [[ "$running" != "true" ]]; then
    mv "$enabled_conf" "$disabled_conf"
    print_warning "${room_name}.conf disabled edildi; gerekli upstream çalışmıyor: ${required_container}"
  else
    print_info "${room_name}.conf enabled bırakıldı; upstream çalışıyor: ${required_container}"
  fi
}
disable_room_if_upstream_missing "bif-viewer" "bif-viewer-app"
disable_room_if_upstream_missing "pacs-viewer" "pacs-viewer-app"

echo ""
print_info "Gateway container durumları:"
docker compose -f "$COMPOSE_FILE" ps

echo ""
print_success "Gateway hall up komutu tamamlandı."

print_manual "Sonraki manuel kontrol:"
echo "  ./scripts/action_gateway_check.sh"