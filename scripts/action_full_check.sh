#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/file-source/print_utils.sh"

print_step "Full sistem kontrolü başlatılıyor..."

print_step "[1/5] Gateway check"
./scripts/action_gateway_check.sh

print_step "[2/5] BIF check"
./scripts/action_bif_check.sh

print_step "[3/5] BIF dropzone check"
./scripts/action_bif_dropzone_check.sh

print_step "[4/5] PACS check"
./scripts/action_pacs_check.sh

print_step "[5/5] PACS dicom store check"
./scripts/action_pacs_dicom_store_check.sh

print_success "Full sistem kontrolü tamamlandı."
