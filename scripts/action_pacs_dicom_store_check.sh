#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/file-source/print_utils.sh"

HOST="${1:-localhost}"
PORT="${2:-11113}"
AEC="${3:-DCM4CHEE}"
AET="${4:-TEST_AE}"
DICOM_DIR="${5:-$ROOT_DIR/test_data/dicom_staging}"

LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

TS="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="$LOG_DIR/pacs_dicom_store_check_${TS}.log"

print_step "PACS DICOM C-STORE manuel test başlatılıyor..."

print_info "HOST=$HOST"
print_info "PORT=$PORT"
print_info "AEC=$AEC"
print_info "AET=$AET"
print_info "DICOM_DIR=$DICOM_DIR"
print_info "LOG_FILE=$LOG_FILE"

echo ""
print_step "[1/5] storescu kontrol ediliyor..."

if ! command -v storescu >/dev/null 2>&1; then
  print_warning "storescu bulunamadı."

  if command -v apt >/dev/null 2>&1; then
    print_info "dcmtk kuruluyor..."
    sudo apt update
    sudo apt install -y dcmtk
  else
    print_error "storescu bulunamadı ve otomatik kurulamıyor."
    print_manual "Önce DCMTK/storescu kur."
    exit 1
  fi
fi

print_success "storescu mevcut: $(storescu --version 2>&1 | head -1 || true)"

echo ""
print_step "[2/5] PACS container durumu kontrol ediliyor..."

if ! docker inspect pacs-viewer-arc >/dev/null 2>&1; then
  print_error "pacs-viewer-arc container bulunamadı."
  print_manual "Önce çalıştır:"
  echo "  ./scripts/action_pacs_up.sh"
  exit 1
fi

ARC_STATUS="$(docker inspect pacs-viewer-arc --format '{{.State.Status}}' 2>/dev/null || true)"

if [[ "$ARC_STATUS" != "running" ]]; then
  print_error "pacs-viewer-arc running değil. STATUS=$ARC_STATUS"
  print_manual "Kontrol et:"
  echo "  docker logs --tail=200 pacs-viewer-arc"
  exit 1
fi

print_success "pacs-viewer-arc running."

echo ""
print_step "[3/5] DICOM port kontrol ediliyor..."

if timeout 3 bash -c "cat < /dev/null > /dev/tcp/$HOST/$PORT" 2>/dev/null; then
  print_success "DICOM port açık: $HOST:$PORT"
else
  print_error "DICOM port erişilemiyor: $HOST:$PORT"
  print_manual "Kontrol et:"
  echo "  docker ps | grep pacs-viewer-arc"
  echo "  ./scripts/action_pacs_check.sh"
  exit 1
fi

echo ""
print_step "[4/5] Test DICOM dosyaları kontrol ediliyor..."

if [[ ! -d "$DICOM_DIR" ]]; then
  print_error "DICOM test klasörü bulunamadı: $DICOM_DIR"
  exit 1
fi

mapfile -t DICOM_FILES < <(find "$DICOM_DIR" -maxdepth 1 -type f | sort)

if [[ "${#DICOM_FILES[@]}" -eq 0 ]]; then
  print_error "DICOM test klasöründe dosya yok: $DICOM_DIR"
  exit 1
fi

print_success "Test dosyası sayısı: ${#DICOM_FILES[@]}"

printf '%s\n' "${DICOM_FILES[@]}" | sed -n '1,20p'

if [[ "${#DICOM_FILES[@]}" -gt 20 ]]; then
  print_info "İlk 20 dosya gösterildi."
fi

echo ""
print_step "[5/5] storescu ile DICOM gönderiliyor..."

{
  echo "Timestamp: $(date -Is)"
  echo "Command:"
  echo "storescu $HOST $PORT -aec $AEC -aet $AET $DICOM_DIR/*"
  echo ""
  echo "Files:"
  printf '%s\n' "${DICOM_FILES[@]}"
  echo ""
  echo "storescu output:"
} > "$LOG_FILE"

if storescu "$HOST" "$PORT" -aec "$AEC" -aet "$AET" "${DICOM_FILES[@]}" >> "$LOG_FILE" 2>&1; then
  print_success "storescu gönderimi başarılı."
else
  print_error "storescu gönderimi başarısız."
  print_manual "Logu incele:"
  echo "  cat $LOG_FILE"
  exit 1
fi

echo ""
print_success "PACS DICOM C-STORE manuel test tamamlandı."
print_info "Log: $LOG_FILE"

echo ""
print_manual "Ardından tarayıcıda kontrol:"
echo "  https://localhost/dcm4chee-arc/ui2/"
echo "  https://localhost/pacs-viewer/"
