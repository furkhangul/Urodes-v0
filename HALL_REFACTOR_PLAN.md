# Hall / Room Refactor v1

Bu paket, gateway'i "hall", BIF/PACS gibi projeleri de "room" olarak ele alan ilk sadeleştirme turudur.

## Kararlar

1. Tek giriş noktası: `https://localhost`.
2. Tek Keycloak realm: `gateway`.
3. Tek oauth2-proxy: `gateway-oauth2-proxy` ve prefix `/oauth2`.
4. Gateway core, oda detaylarını bilmez; `/etc/nginx/rooms-enabled/*.conf` include eder.
5. Oda ekleme/çıkarma, dosya enable/disable ile yapılır.
6. Gateway dışındaki servislerde TLS kaldırılır; iç servisler HTTP konuşur.
7. Proje içindeki Nginx sadece static frontend servis eder; auth/proxy/SSL gateway'dedir.

## Oda ekleme

```bash
# oda servislerini başlat
cd ~/Desktop/bif-viewer
docker compose up -d --build

# gateway room dosyasını enable et
cp ~/Desktop/bif-viewer/gateway-plugin/nginx.conf ~/Desktop/gateway/config/nginx/rooms-enabled/bif-viewer.conf

# gateway reload
docker exec gateway-nginx nginx -t
docker exec gateway-nginx nginx -s reload
```

## Oda çıkarma

```bash
rm ~/Desktop/gateway/config/nginx/rooms-enabled/bif-viewer.conf
docker exec gateway-nginx nginx -t
docker exec gateway-nginx nginx -s reload

cd ~/Desktop/bif-viewer
docker compose down
```

## Keycloak notu

Mevcut Keycloak volume'ü eski `bif-viewer` ve `pacs-viewer` realm'lerini içeriyorsa, yeni `gateway.realm.json` otomatik olarak eski realm'leri silmez. Geliştirme ortamında temiz import için:

```bash
cd ~/Desktop/gateway
docker compose down
# DİKKAT: sadece geliştirme ortamında
# docker volume rm gateway-keycloak-data
docker compose up -d
```

Kalıcı/canlı ortamda volume silme yerine Keycloak Admin UI'dan `gateway` realm, group ve kullanıcıları oluştur.

## Cloudflare Tunnel

Tunnel route:

```text
localhost -> https://gateway-nginx:443
Origin Server Name: localhost
```

## Testler

```bash
curl -vk https://localhost/keycloak/realms/gateway/.well-known/openid-configuration
curl -vk https://localhost/bif-viewer/
curl -vk https://localhost/pacs-viewer/
curl -vk https://localhost/dcm4chee-arc/ui2/
```
