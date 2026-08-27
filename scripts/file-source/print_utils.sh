#!/usr/bin/env bash

# Terminal renkleri
if [[ -t 1 ]]; then
  GREEN="\033[0;32m"
  RED="\033[0;31m"
  YELLOW="\033[1;33m"
  MAGENTA="\033[0;35m"
  CYAN="\033[0;36m"
  BLUE="\033[0;34m"
  BOLD="\033[1m"
  RESET="\033[0m"
else
  GREEN=""
  RED=""
  YELLOW=""
  MAGENTA=""
  CYAN=""
  BLUE=""
  BOLD=""
  RESET=""
fi

print_step() {
  echo -e "${CYAN}${BOLD}==>${RESET} ${CYAN}$*${RESET}"
}

print_success() {
  echo -e "${GREEN}OK:${RESET} $*"
}

print_error() {
  echo -e "${RED}HATA:${RESET} $*" >&2
}

print_warning() {
  echo -e "${YELLOW}UYARI:${RESET} $*"
}

print_manual() {
  echo -e "${MAGENTA}MANUEL ADIM:${RESET} $*"
}

print_info() {
  echo -e "${BLUE}INFO:${RESET} $*"
}