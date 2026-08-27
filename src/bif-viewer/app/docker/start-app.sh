#!/bin/sh
set -eu

JAVA_OPTS="${JAVA_OPTS:-}"

java $JAVA_OPTS -jar /app/app.jar &
JAVA_PID=$!

cleanup() {
  if kill -0 "$JAVA_PID" 2>/dev/null; then
    kill "$JAVA_PID"
    wait "$JAVA_PID" || true
  fi
}

trap cleanup INT TERM

# DÜZELTME BURADA: context-path'e göre kontrol et
until curl --silent --fail http://127.0.0.1:8080/bif-viewer/ >/dev/null; do
  if ! kill -0 "$JAVA_PID" 2>/dev/null; then
    wait "$JAVA_PID"
    exit 1
  fi
  sleep 2
done

# Nginx hata log yolunu düzeltelim (standart yol)
mkdir -p /var/log/nginx
exec nginx -g "daemon off;"