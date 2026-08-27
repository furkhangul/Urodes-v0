#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(dirname "$(dirname "$(realpath "$0")")")"
cd "$ROOT_DIR"

############################################################

chmod +x ./scripts/file-source/print_utils.sh
chmod +x ./scripts/file-source/docker_network.sh
chmod +x ./scripts/file-source/cert_check.sh
chmod +x ./scripts/file-source/gateway_env_check.sh

chmod +x ./scripts/action_gateway_up.sh
chmod +x ./scripts/action_gateway_check.sh

chmod +x ./scripts/action_bif_up.sh
chmod +x ./scripts/action_bif_check.sh
chmod +x ./scripts/action_bif_dropzone_check.sh

chmod +x ./scripts/action_pacs_up.sh
chmod +x ./scripts/action_pacs_check.sh
chmod +x ./scripts/action_pacs_dicom_store_check.sh

chmod +x ./scripts/action_full_check.sh
chmod +x ./scripts/action_git_first_publish.sh

chmod +x ./scripts/action_reset_runtime_keep_images.sh

############################################################

./scripts/file-source/docker_network.sh
./scripts/file-source/cert_check.sh
./scripts/file-source/gateway_env_check.sh

############################################################

source "$ROOT_DIR/scripts/file-source/print_utils.sh"

print_manual "Sonraki manuel adım:"
echo "  ./scripts/action_gateway_up.sh"