#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(dirname "$(realpath "$0")")")")"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/file-source/print_utils.sh"

ENV_PATH="$ROOT_DIR/src/gateway/.env"
ENV_EXAMPLE_PATH="$ROOT_DIR/src/gateway/.env.example"

print_step "[3/4] Gateway .env kontrol ediliyor..."

if [[ ! -f "$ENV_PATH" ]]; then
  if [[ -f "$ENV_EXAMPLE_PATH" ]]; then
    cp "$ENV_EXAMPLE_PATH" "$ENV_PATH"
    print_warning "src/gateway/.env oluşturuldu."
    print_manual "Lütfen gerçek değerleri gir: nano src/gateway/.env"
    exit 1
  else
    print_error ".env.example bulunamadı: $ENV_EXAMPLE_PATH"
    exit 1
  fi
fi

required_vars=(
  "CLOUDFLARE_TUNNEL_TOKEN"
  "KEYCLOAK_ADMIN"
  "KEYCLOAK_ADMIN_PASSWORD"
  "KEYCLOAK_DB_USER"
  "KEYCLOAK_DB_PASSWORD"
)

missing=0

for var in "${required_vars[@]}"; do
  if ! grep -qE "^${var}=.+" "$ENV_PATH"; then
    print_error "Eksik veya boş değişken: $var"
    missing=1
  fi
done

if grep -qE "replace-me|change-me|BURAYA_GERCEK_TOKEN" "$ENV_PATH"; then
  print_error ".env içinde placeholder değerler var."
  print_manual "Lütfen gerçek değerlerle değiştir: nano src/gateway/.env"
  missing=1
fi

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

print_success "Gateway .env hazır."