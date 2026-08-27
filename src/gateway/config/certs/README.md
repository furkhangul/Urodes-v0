# Certificates

Bu refactor paketinde gerçek sertifika/private key tutulmaz.
Gateway nginx şu anda `/etc/nginx/internal-certs/shared-dev.crt` ve `.key` bekler.
Cloudflare Origin sertifikanı kendi ortamında bu path'e mount et veya nginx.conf içindeki pathleri kendi cert pathine göre değiştir.
