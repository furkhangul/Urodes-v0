#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/file-source/print_utils.sh"

HOST_DROPZONE="$ROOT_DIR/src/bif-viewer/data/dropzone"
HOST_INBOX="$ROOT_DIR/src/bif-viewer/data/inbox"
HOST_SLIDES="$ROOT_DIR/src/bif-viewer/data/slides"

print_step "BIF dropzone kontrolü"
mkdir -p "$HOST_DROPZONE" "$HOST_INBOX" "$HOST_SLIDES"

print_info "Host dropzone klasörü: $HOST_DROPZONE"
print_info "Container dropzone karşılığı: /app/dropzone"

echo ""
print_step "Dropzone son dosyalar"
find "$HOST_DROPZONE" -maxdepth 1 -type f -printf "%TY-%Tm-%Td %TH:%TM:%TS %12s %p\n" 2>/dev/null | sort | tail -20 || true

echo ""
print_step "Inbox son dosyalar"
find "$HOST_INBOX" -maxdepth 5 -type f -printf "%TY-%Tm-%Td %TH:%TM:%TS %12s %p\n" 2>/dev/null | sort | tail -20 || true

echo ""
print_step "Slides son dosyalar"
find "$HOST_SLIDES" -maxdepth 5 -type f -printf "%TY-%Tm-%Td %TH:%TM:%TS %12s %p\n" 2>/dev/null | sort | tail -20 || true

echo ""
print_step "Container mount kontrolü"
docker exec bif-viewer-app sh -lc 'ls -lah /app/dropzone /app/inbox /app/slides | head -80'

print_manual "BIF dosyasını dropzone'a koy: cp /path/to/file.bif src/bif-viewer/data/dropzone/"
print_manual "Sonra master panelde Dropzone > İçe Aktar ile inbox pipeline'a al."
