#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(dirname "$(realpath "$0")")")")"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/file-source/print_utils.sh"

NETWORK_NAME="local-dev"

print_step "[1/4] Docker network kontrol ediliyor..."

if docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  print_success "Docker network zaten mevcut: $NETWORK_NAME"
else
  print_warning "Docker network bulunamadı: $NETWORK_NAME"
  print_info "Yeni network oluşturuluyor..."
  docker network create "$NETWORK_NAME" >/dev/null
  print_success "Docker network oluşturuldu: $NETWORK_NAME"
fi

NETWORK_ID="$(docker network inspect "$NETWORK_NAME" --format '{{.Id}}' 2>/dev/null || true)"
NETWORK_DRIVER="$(docker network inspect "$NETWORK_NAME" --format '{{.Driver}}' 2>/dev/null || true)"
NETWORK_SUBNET="$(docker network inspect "$NETWORK_NAME" --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null || true)"

print_info "Network ID: ${NETWORK_ID:-unknown}"
print_info "Driver: ${NETWORK_DRIVER:-unknown}"

if [[ -n "$NETWORK_SUBNET" ]]; then
  print_info "Subnet: $NETWORK_SUBNET"
else
  print_warning "Subnet bilgisi okunamadı."
fi