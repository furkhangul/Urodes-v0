#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/scripts/file-source/print_utils.sh" ]]; then
  source "$ROOT_DIR/scripts/file-source/print_utils.sh"
else
  print_step() { echo "==> $*"; }
  print_success() { echo "OK: $*"; }
  print_warning() { echo "UYARI: $*"; }
  print_error() { echo "HATA: $*" >&2; }
  print_info() { echo "INFO: $*"; }
  print_manual() { echo "MANUEL ADIM: $*"; }
fi

CONFIRM="${1:-}"

if [[ "$CONFIRM" != "RESET_RUNTIME_KEEP_IMAGES" ]]; then
  print_error "Bu script gateway+BIF+PACS containerlarını, named volume'larını ve runtime data klasörlerini siler."
  echo ""
  echo "Silinmez:"
  echo "  - Docker image'ları"
  echo "  - src/gateway/.env"
  echo "  - infra/certs/"
  echo ""
  echo "Çalıştırmak için:"
  echo "  ./scripts/action_reset_runtime_keep_images.sh RESET_RUNTIME_KEEP_IMAGES"
  exit 1
fi

print_step "Runtime reset başlatılıyor. Image'lar korunacak."

CONTAINERS=(
  pacs-viewer-app
  pacs-viewer-arc
  pacs-viewer-db
  pacs-viewer-ldap
  bif-viewer-app
  bif-viewer-db
  gateway-nginx
  gateway-oauth2-proxy
  gateway-keycloak-1
  gateway-keycloak-2
  gateway-keycloak-db
  viewer_tunnel_daemon
)

print_step "Gateway room configleri güvenli moda alınıyor..."

mkdir -p "$ROOT_DIR/src/gateway/config/nginx/rooms-enabled"
mkdir -p "$ROOT_DIR/src/gateway/config/nginx/rooms-disabled"

for room in bif-viewer pacs-viewer; do
  if [[ -f "$ROOT_DIR/src/gateway/config/nginx/rooms-enabled/${room}.conf" ]]; then
    mv "$ROOT_DIR/src/gateway/config/nginx/rooms-enabled/${room}.conf" \
       "$ROOT_DIR/src/gateway/config/nginx/rooms-disabled/${room}.conf"
    print_warning "${room}.conf disabled edildi."
  elif [[ -f "$ROOT_DIR/src/gateway/config/nginx/rooms-disabled/${room}.conf" ]]; then
    print_info "${room}.conf zaten disabled."
  else
    print_warning "${room}.conf bulunamadı."
  fi
done

print_step "Mevcut refactor containerları tespit ediliyor..."

EXISTING=()
for c in "${CONTAINERS[@]}"; do
  if docker inspect "$c" >/dev/null 2>&1; then
    EXISTING+=("$c")
  fi
done

TMP_VOLUMES="$(mktemp)"

if [[ "${#EXISTING[@]}" -gt 0 ]]; then
  print_info "Containerlara bağlı named volume'lar kaydediliyor..."

  docker inspect "${EXISTING[@]}" \
    --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' \
    | sed '/^$/d' \
    | sort -u > "$TMP_VOLUMES"

  print_step "Containerlar durduruluyor..."
  docker stop "${EXISTING[@]}" || true

  print_step "Containerlar siliniyor..."
  docker rm "${EXISTING[@]}" || true
else
  print_info "Silinecek mevcut refactor container bulunamadı."
  : > "$TMP_VOLUMES"
fi

print_step "Project named volume'ları ek olarak tespit ediliyor..."

docker volume ls --format '{{.Name}}' \
  | grep -E '^(gateway|bif-viewer|pacs-viewer|the_server_bone)' \
  >> "$TMP_VOLUMES" || true

sort -u "$TMP_VOLUMES" -o "$TMP_VOLUMES"

print_step "Named volume'lar siliniyor..."

if [[ -s "$TMP_VOLUMES" ]]; then
  cat "$TMP_VOLUMES"
  while read -r v; do
    [[ -z "$v" ]] && continue
    docker volume rm "$v" || true
  done < "$TMP_VOLUMES"
else
  print_info "Silinecek named volume bulunmadı."
fi

rm -f "$TMP_VOLUMES"

print_step "Host runtime data klasörleri siliniyor..."

# BIF runtime data
sudo rm -rf "$ROOT_DIR/src/bif-viewer/data/dropzone"
sudo rm -rf "$ROOT_DIR/src/bif-viewer/data/inbox"
sudo rm -rf "$ROOT_DIR/src/bif-viewer/data/slides"

# PACS runtime data
sudo rm -rf "$ROOT_DIR/src/pacs-viewer/data/db"
sudo rm -rf "$ROOT_DIR/src/pacs-viewer/data/arc"
sudo rm -rf "$ROOT_DIR/src/pacs-viewer/data/ldap"
sudo rm -rf "$ROOT_DIR/src/pacs-viewer/data/slapd.d"

print_step "Runtime klasörleri yeniden hazırlanıyor..."

mkdir -p "$ROOT_DIR/src/bif-viewer/data/dropzone"
mkdir -p "$ROOT_DIR/src/bif-viewer/data/inbox"
mkdir -p "$ROOT_DIR/src/bif-viewer/data/slides"

touch "$ROOT_DIR/src/bif-viewer/data/dropzone/.gitkeep"
touch "$ROOT_DIR/src/bif-viewer/data/inbox/.gitkeep"
touch "$ROOT_DIR/src/bif-viewer/data/slides/.gitkeep"

chmod -R a+rwX "$ROOT_DIR/src/bif-viewer/data"

mkdir -p "$ROOT_DIR/src/pacs-viewer/data/db"
mkdir -p "$ROOT_DIR/src/pacs-viewer/data/arc"
mkdir -p "$ROOT_DIR/src/pacs-viewer/data/ldap"
mkdir -p "$ROOT_DIR/src/pacs-viewer/data/slapd.d"

touch "$ROOT_DIR/src/pacs-viewer/data/arc/.gitkeep"
touch "$ROOT_DIR/src/pacs-viewer/data/ldap/.gitkeep"
touch "$ROOT_DIR/src/pacs-viewer/data/slapd.d/.gitkeep"

rm -f "$ROOT_DIR/src/pacs-viewer/data/db/.gitkeep"

chmod -R a+rwX "$ROOT_DIR/src/pacs-viewer/data"

print_step "Image'lar korunuyor."

print_info "Mevcut ilgili image'lar:"
docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}' \
  | grep -E 'pacs-viewer|bif-viewer|dcm4che|keycloak|oauth2-proxy|cloudflared|nginx|postgres' || true

print_step "Son container kontrolü:"

docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' \
  | grep -E 'gateway-|viewer_tunnel_daemon|bif-viewer|pacs-viewer' || echo "OK: Refactor containerları yok."

print_success "Runtime reset tamamlandı. Image'lar silinmedi."

echo ""
print_manual "Şimdi sıfırdan kurulum için sırayla çalıştır:"
echo "  ./scripts/action_setup.sh"
echo "  ./scripts/action_gateway_up.sh"
echo "  ./scripts/action_gateway_check.sh"
echo ""
echo "  ./scripts/action_bif_up.sh"
echo "  ./scripts/action_bif_check.sh"
echo "  ./scripts/action_bif_dropzone_check.sh"
echo ""
echo "  ./scripts/action_pacs_up.sh"
echo "  ./scripts/action_pacs_check.sh"
