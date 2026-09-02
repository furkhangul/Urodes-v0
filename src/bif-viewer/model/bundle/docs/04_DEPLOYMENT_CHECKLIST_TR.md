# Deployment / Viewer Kabul Checklist

- [ ] `python tools/verify_package.py` PASS
- [ ] Ultralytics 8.4.126
- [ ] PyTorch/Torchvision uyumlu
- [ ] Pipeline startup'ta bir kez yükleniyor
- [ ] Raw `.pt` final inference kaldırıldı
- [ ] `strict_sha=True`
- [ ] 640x640 koordinat sistemi korunuyor
- [ ] Clinical-5 / Native-8 mod açık seçiliyor
- [ ] `conf` final confidence olarak kullanılıyor
- [ ] ikinci NMS yok
- [ ] ikinci scientific threshold yok
- [ ] ATYPICAL +0.30 tekrar uygulanmıyor
- [ ] telemetry loglanıyor
- [ ] smoke test PASS
- [ ] birkaç tile üzerinde overlay manuel kontrol edildi
- [ ] backend restart sonrası model SHA aynı
