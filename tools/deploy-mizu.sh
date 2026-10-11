#!/usr/bin/env bash
# Deploy the local checkout to the existing mizu.reddie.id Docker installation.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

ENV_DIR="${MIZU_ENV_DIR:-$HOME/.config/mizu}"
TAG="local-$(TZ=Asia/Jakarta date +%Y%m%d-%H%M%S)"
WEB_IMAGE="mizu:$TAG"
API_IMAGE="mizu-api:$TAG"

for file in web.env api.env; do
  test -r "$ENV_DIR/$file" || { echo "File tidak terbaca: $ENV_DIR/$file" >&2; exit 1; }
done
exec 9>"/tmp/mizu-deploy-${UID}.lock"
flock -n 9 || { echo 'Deploy Mizu lain sedang berjalan.' >&2; exit 1; }
docker inspect mizu mizu-api mizu-db >/dev/null
docker network inspect mizu-net >/dev/null
docker volume inspect mizu-storage >/dev/null
OLD_WEB="$(docker inspect --format '{{.Image}}' mizu)"
OLD_API="$(docker inspect --format '{{.Image}}' mizu-api)"

echo "Membangun web dan API: $TAG"
DOCKER_BUILDKIT=1 docker build --secret "id=dotenv,src=$ENV_DIR/web.env" -t "$WEB_IMAGE" .
DOCKER_BUILDKIT=1 docker build -t "$API_IMAGE" backend

echo 'Menerapkan migrasi sebelum mengganti container...'
docker run --rm --network mizu-net --env-file "$ENV_DIR/api.env" \
  --entrypoint /usr/local/bin/migrate "$API_IMAGE" -allow-remote -apply
verify_status=0
docker run --rm --network mizu-net --env-file "$ENV_DIR/api.env" \
  --entrypoint /usr/local/bin/migrate "$API_IMAGE" -allow-remote -verify || verify_status=$?
if [ "$verify_status" = 3 ]; then
  echo 'Skema berbeda dari migrasi. Deploy dihentikan; container lama tetap berjalan.' >&2
  exit 1
elif [ "$verify_status" != 0 ]; then
  echo "Peringatan: pemeriksaan skema tidak dapat dijalankan (exit $verify_status)." >&2
fi

start_api() {
  docker run -d --name mizu-api --restart unless-stopped --stop-timeout 30 \
    --network mizu-net --env-file "$ENV_DIR/api.env" -v mizu-storage:/app/storage \
    --log-opt max-size=50m --log-opt max-file=5 "$1"
}
start_web() {
  docker run -d --name mizu --restart unless-stopped --network mizu-net \
    --env-file "$ENV_DIR/web.env" -v mizu-storage:/app/storage \
    -p 127.0.0.1:8144:3000 --log-opt max-size=50m --log-opt max-file=5 "$1"
}
rollback() {
  trap - ERR INT TERM
  set +e
  echo 'Deploy gagal. Menjalankan kembali image sebelumnya; migrasi tidak dibatalkan.' >&2
  docker stop mizu mizu-api >/dev/null 2>&1
  docker rm mizu mizu-api >/dev/null 2>&1
  start_api "$OLD_API"
  start_web "$OLD_WEB"
  exit 1
}

docker tag "$OLD_WEB" mizu:previous
docker tag "$OLD_API" mizu-api:previous
trap rollback ERR INT TERM
docker stop mizu mizu-api >/dev/null
docker rm mizu mizu-api >/dev/null
start_api "$API_IMAGE"
start_web "$WEB_IMAGE"

echo 'Menunggu web, database, dan API...'
ready=0
for attempt in $(seq 1 60); do
  if docker exec mizu-api /usr/local/bin/api -healthcheck >/dev/null 2>&1 && \
    curl -fsS --max-time 10 http://127.0.0.1:8144/api/ready >/dev/null && \
    curl -fsS --max-time 10 http://127.0.0.1:8144/login >/dev/null && \
    curl -sS --max-time 10 -o /dev/null -D - http://127.0.0.1:8144/api/auth/me | rg -qi '^x-request-id:'; then
    ready=1
    break
  fi
  sleep 2
done
test "$ready" = 1
trap - ERR INT TERM
echo "Deploy selesai: https://mizu.reddie.id ($TAG)"
echo 'Buka ulang halaman atau tekan Ctrl+Shift+R di browser.'
