#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/scripts/file-source/print_utils.sh" ]]; then
  source "$ROOT_DIR/scripts/file-source/print_utils.sh"
else
  print_step() { echo "==> $*"; }
  print_success() { echo "OK: $*"; }
  print_error() { echo "HATA: $*" >&2; }
  print_warning() { echo "UYARI: $*"; }
  print_info() { echo "INFO: $*"; }
  print_manual() { echo "MANUEL ADIM: $*"; }
fi

REMOTE_URL="${1:-https://github.com/rationedivide/the_server_bone.git}"
COMMIT_MESSAGE="${2:-Initial stable gateway bif pacs baseline}"
TAG_NAME="${3:-}"
PUSH_MODE="${4:-auto}"   # auto | normal | force-with-lease | no-push

GIT_USER_NAME="${GIT_USER_NAME:-Ratione Divide}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-rationedivide@gmail.com}"
REMOTE_BACKUP_PREFIX="${REMOTE_BACKUP_PREFIX:-backup/remote-main-before-first-publish}"
ALLOW_REMOTE_OVERWRITE="${ALLOW_REMOTE_OVERWRITE:-yes}"   # yes | no

print_step "Git ilk kurulum + ilk commit/push işlemi başlatılıyor..."
print_info "Remote URL: $REMOTE_URL"
print_info "Commit mesajı: $COMMIT_MESSAGE"
print_info "Tag: ${TAG_NAME:-yok}"
print_info "Push mode: $PUSH_MODE"
print_info "Remote overwrite policy: $ALLOW_REMOTE_OVERWRITE"

install_package_if_missing() {
  local bin_name="$1"
  local package_name="$2"

  if command -v "$bin_name" >/dev/null 2>&1; then
    print_success "$bin_name mevcut."
    return 0
  fi

  print_warning "$bin_name bulunamadı. Kurulum deneniyor..."

  if command -v apt >/dev/null 2>&1; then
    sudo apt update
    sudo apt install -y "$package_name"
  else
    print_error "$bin_name otomatik kurulamıyor. Bu sistemde apt yok."
    print_manual "Önce manuel kur, sonra script'i tekrar çalıştır."
    exit 1
  fi

  if command -v "$bin_name" >/dev/null 2>&1; then
    print_success "$bin_name kuruldu."
  else
    print_error "$bin_name kurulamadı."
    exit 1
  fi
}

safe_git_reset_stage() {
  git reset >/dev/null 2>&1 || true
}

write_safe_gitignore() {
  cat > .gitignore <<'EOF_GITIGNORE'
# Secrets / env
.env
**/.env
**/.env.*
!**/.env.example

# Cloudflare / TLS / private cert material
infra/certs/*
!infra/certs/.gitkeep
!infra/certs/**/.gitkeep
*.key
*.pem
*.p12
*.pfx
*.crt
!*.example.crt

# Runtime data - BIF
src/bif-viewer/data/dropzone/*
!src/bif-viewer/data/dropzone/.gitkeep

src/bif-viewer/data/inbox/*
!src/bif-viewer/data/inbox/.gitkeep

src/bif-viewer/data/slides/*
!src/bif-viewer/data/slides/.gitkeep

src/bif-viewer/data/**/*.bif

# Runtime data - PACS
src/pacs-viewer/data/db/*
src/pacs-viewer/data/arc/*
src/pacs-viewer/data/ldap/*
src/pacs-viewer/data/slapd.d/*

!src/pacs-viewer/data/arc/.gitkeep
!src/pacs-viewer/data/ldap/.gitkeep
!src/pacs-viewer/data/slapd.d/.gitkeep

# Test / staging data
test_data/*
!test_data/.gitkeep

# Medical / large files
*.dcm
*.dicom
*.bif
*.svs
*.ndpi
*.tiff
*.tif

# Logs / temp
*.log
logs/
tmp/
temp/
.cache/
.DS_Store

# Build outputs
node_modules/
**/node_modules/
dist/
build/
target/
*.class
__pycache__/
*.pyc
.venv/
venv/

# Archives
*.tar
*.tar.gz
*.zip

# IDE
.idea/
.vscode/
EOF_GITIGNORE
}

prepare_gitkeep_dirs() {
  mkdir -p infra/certs
  touch infra/certs/.gitkeep

  mkdir -p src/bif-viewer/data/dropzone
  mkdir -p src/bif-viewer/data/inbox
  mkdir -p src/bif-viewer/data/slides
  touch src/bif-viewer/data/dropzone/.gitkeep
  touch src/bif-viewer/data/inbox/.gitkeep
  touch src/bif-viewer/data/slides/.gitkeep

  mkdir -p src/pacs-viewer/data/arc
  mkdir -p src/pacs-viewer/data/ldap
  mkdir -p src/pacs-viewer/data/slapd.d
  touch src/pacs-viewer/data/arc/.gitkeep
  touch src/pacs-viewer/data/ldap/.gitkeep
  touch src/pacs-viewer/data/slapd.d/.gitkeep

  mkdir -p test_data
  touch test_data/.gitkeep

  rm -f src/pacs-viewer/data/db/.gitkeep 2>/dev/null || true
  print_info "src/pacs-viewer/data/db içine .gitkeep konulmadı. PostgreSQL initdb için boş kalmalı."
}

check_staged_sensitive_files() {
  local bad
  bad="$(
    git diff --cached --name-only \
      | grep -Ei '(^|/)\.env$|\.key$|\.pem$|\.crt$|\.p12$|\.pfx$|\.bif$|\.dcm$|\.dicom$|\.svs$|\.ndpi$|\.tiff$|\.tif$|src/pacs-viewer/data/db|src/pacs-viewer/data/arc/data|src/pacs-viewer/data/arc/log|src/bif-viewer/data/slides/.+\.bif|test_data/.+\.(bif|dcm|dicom)$' \
      || true
  )"

  if [[ -n "$bad" ]]; then
    print_error "Commit'e girmemesi gereken dosyalar staged görünüyor:"
    echo "$bad"
    echo ""
    print_warning "Stage geri alınıyor."
    safe_git_reset_stage
    exit 1
  fi

  print_success "Staged hassas/veri dosyası görünmüyor."
}

check_tracked_sensitive_files() {
  local bad
  bad="$(
    git ls-files \
      | grep -Ei '(^|/)\.env$|\.key$|\.pem$|\.crt$|\.p12$|\.pfx$|\.bif$|\.dcm$|\.dicom$|src/pacs-viewer/data/db|src/pacs-viewer/data/arc/data|src/pacs-viewer/data/arc/log|src/bif-viewer/data/slides/.+\.bif' \
      || true
  )"

  if [[ -n "$bad" ]]; then
    print_error "Git içinde hassas/veri dosyası görünüyor:"
    echo "$bad"
    exit 1
  fi

  print_success "Git içinde hassas/veri dosyası yok."
}

push_with_policy() {
  local remote_main_exists="no"
  local local_head
  local backup_branch
  local force_needed="no"

  local_head="$(git rev-parse HEAD)"

  if [[ "$PUSH_MODE" == "no-push" ]]; then
    print_warning "PUSH_MODE=no-push verildi. Commit oluşturuldu ama push yapılmadı."
    return 0
  fi

  if git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
    remote_main_exists="yes"
  fi

  if [[ "$remote_main_exists" != "yes" ]]; then
    print_info "Remote main branch yok. İlk push yapılıyor."
    git push -u origin main
    return 0
  fi

  print_info "Remote main branch mevcut. Remote geçmişi fetch ediliyor."
  git fetch origin main

  if [[ "$(git rev-parse origin/main)" == "$local_head" ]]; then
    print_success "Remote main zaten local HEAD ile aynı."
    git branch --set-upstream-to=origin/main main 2>/dev/null || true
    return 0
  fi

  if git merge-base --is-ancestor origin/main HEAD; then
    print_info "Remote main local geçmişin içinde. Normal push yapılacak."
    git push -u origin main
    return 0
  fi

  if git merge-base --is-ancestor HEAD origin/main; then
    print_warning "Remote main local HEAD'in ilerisinde. First publish local çalışma ağacını ana kaynak kabul edecek."
    force_needed="yes"
  else
    print_warning "Remote main ile local main ayrışmış veya unrelated. First publish local çalışma ağacını ana kaynak kabul edecek."
    force_needed="yes"
  fi

  if [[ "$PUSH_MODE" == "normal" ]]; then
    print_error "PUSH_MODE=normal olduğu için remote üzerine yazılmadı."
    print_info "Bu script local stabil ağacı ana kaynak kabul ediyorsa PUSH_MODE=auto veya force-with-lease kullanılmalı."
    exit 1
  fi

  if [[ "$PUSH_MODE" != "auto" && "$PUSH_MODE" != "force-with-lease" ]]; then
    print_error "Geçersiz PUSH_MODE: $PUSH_MODE"
    print_info "Geçerli değerler: auto | normal | force-with-lease | no-push"
    exit 1
  fi

  if [[ "$ALLOW_REMOTE_OVERWRITE" != "yes" ]]; then
    print_error "Remote overwrite policy izin vermiyor: ALLOW_REMOTE_OVERWRITE=$ALLOW_REMOTE_OVERWRITE"
    exit 1
  fi

  if [[ "$force_needed" == "yes" ]]; then
    backup_branch="${REMOTE_BACKUP_PREFIX}-$(date +%Y%m%d_%H%M%S)"

    print_warning "Remote main üzerine force-with-lease uygulanmadan önce remote backup branch oluşturuluyor."
    print_info "Backup branch: $backup_branch"

    git branch -f "$backup_branch" origin/main
    git push origin "$backup_branch"

    print_warning "Local main GitHub main üzerine güvenli şekilde yazılıyor: --force-with-lease"
    git push --force-with-lease -u origin main
  fi
}

print_step "[1/10] Git kurulumu kontrol ediliyor..."
install_package_if_missing git git
print_info "$(git --version)"

print_step "[2/10] GitHub CLI kontrol ediliyor..."

if ! command -v gh >/dev/null 2>&1; then
  print_warning "gh bulunamadı. apt ile kurulum deneniyor..."
  if command -v apt >/dev/null 2>&1; then
    sudo apt update
    sudo apt install -y gh || true
  fi
fi

if command -v gh >/dev/null 2>&1; then
  print_success "GitHub CLI mevcut: $(gh --version | head -1)"

  if gh auth status >/dev/null 2>&1; then
    print_success "GitHub login aktif."
  else
    print_warning "GitHub login yapılmamış. Browser login başlatılıyor."
    gh auth login --hostname github.com --git-protocol https --web
    gh auth setup-git || true
  fi
else
  print_warning "GitHub CLI kurulamadı veya bulunamadı."
  print_warning "Push sırasında HTTPS credential/token gerekebilir."
fi

print_step "[3/10] Git repo hazırlanıyor..."

if [[ ! -d ".git" ]]; then
  print_warning ".git klasörü yok. git init yapılıyor..."
  git init
else
  print_success ".git klasörü mevcut."
fi

git branch -M main

git config user.name "$GIT_USER_NAME"
git config user.email "$GIT_USER_EMAIL"

print_success "Git user.name=$(git config user.name)"
print_success "Git user.email=$(git config user.email)"

print_step "[4/10] Remote origin ayarlanıyor..."

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

git remote -v

print_step "[5/10] .gitignore güvenli şekilde yazılıyor..."
write_safe_gitignore

print_step "[6/10] Gerekli boş klasör marker'ları hazırlanıyor..."
prepare_gitkeep_dirs

print_step "[7/10] Büyük dosya ön kontrolü yapılıyor..."

find . \
  -path './.git' -prune -o \
  -type f -size +50M \
  -printf "%12s %p\n" 2>/dev/null \
  | sort -nr \
  | head -50 || true

print_step "[8/10] Dosyalar stage ediliyor..."

git add .

print_step "Staged hassas/veri dosyası kontrolü yapılıyor..."
check_staged_sensitive_files

print_step "[9/10] Commit oluşturuluyor..."

git status --short

if git diff --cached --quiet; then
  print_warning "Commit edilecek değişiklik yok."
else
  git commit -m "$COMMIT_MESSAGE"
fi

if [[ -n "$TAG_NAME" ]]; then
  if git rev-parse "$TAG_NAME" >/dev/null 2>&1; then
    print_warning "Tag localde zaten var: $TAG_NAME"
  else
    print_step "Tag oluşturuluyor: $TAG_NAME"
    git tag -a "$TAG_NAME" -m "$COMMIT_MESSAGE"
  fi
fi

print_step "[10/10] Push işlemi yapılıyor..."
push_with_policy

if [[ -n "$TAG_NAME" ]]; then
  print_step "Tag push ediliyor: $TAG_NAME"

  if git ls-remote --exit-code --tags origin "$TAG_NAME" >/dev/null 2>&1; then
    print_warning "Remote tag zaten var: $TAG_NAME"
  else
    git push origin "$TAG_NAME"
  fi
fi

print_step "Son güvenlik kontrolü yapılıyor..."
check_tracked_sensitive_files

echo ""
print_success "Git ilk kurulum + ilk commit/push tamamlandı."
print_info "Remote: $REMOTE_URL"
print_info "Branch: main"
print_info "Son commit:"
git log --oneline --decorate -1

echo ""
print_info "Bundan sonra normal kullanım:"
echo "  git status"
echo "  git add ."
echo "  git commit -m \"Mesaj\""
echo "  git push"
