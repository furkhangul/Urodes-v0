# UroDes V5 Viewer Entegrasyon Yönergesi

## 1. Neyi değiştiriyoruz?

Mevcut backend şu mantıktaysa:

```python
model = YOLO(MODEL_PATH)
results = model.predict(image)
```

bu final sistem için kaldırılmalıdır. UroDes V5 yalnız `.pt` değildir.

Final pipeline:
- seed0 checkpoint
- TRUE-IGNORE custom module
- O2M candidate inference
- ATYPICAL +0.30 logit calibration
- class-agnostic NMS IoU 0.30
- max_det 300
- frozen threshold 0.2516763508319855
- Native-8 -> Clinical-5 mapping

## 2. Ortam

Closure ortamı:
- Ultralytics 8.4.126
- PyTorch 2.11.0+cu128
- Torchvision 0.26.0+cu128
- CUDA 12.8

Ultralytics'i 8.4.126 olarak pinleyin.
PyTorch/Torchvision hedef GPU/CUDA ile uyumlu eşleşmiş bir çift olmalıdır.

## 3. Klasörü olduğu gibi yerleştirin

Örnek:

```text
/opt/urodes/UroDes_V5_VIEWER_PIPELINE_INTEGRATION_v1.0/
```

Bu klasör `bundle_root` olur.

## 4. Pipeline'ı application startup'ta bir kez yükleyin

```python
from integration.viewer_adapter import UroDesViewerAdapter

urodes = UroDesViewerAdapter(
    bundle_root=URODES_BUNDLE_ROOT,
    device=0,
    strict_sha=True,
)
```

Her request'te model yeniden yüklenmemelidir.

## 5. Tile inference

```python
payload = urodes.predict_viewer(
    image=image_path,
    class_mode="clinical5",
)
```

Clinical-5:
- 0 OTHER_CELL
- 1 BENIGN
- 2 ATYPICAL
- 3 SUSPICIOUS
- 4 MALIGNANT

Native-8 gerekiyorsa `class_mode="native8"`.

## 6. Input

Canonical tile: 640x640.

En güvenli input: dosya yolu.
PIL Image kullanılabilir.
`cv2.imread()` BGR NumPy da kullanılabilir.

Elinizde RGB NumPy array varsa kanal sırasını özellikle doğrulayın; en güvenlisi PIL RGB
veya görüntü dosya yoludur.

## 7. Box

`xyxy = [x1,y1,x2,y2]` orijinal tile pixel koordinatıdır.

Viewer tile'ı ekranda scale ediyorsa yalnız çizim katmanında scale edin.

## 8. Confidence

Final bilimsel skor:
`detection["conf"]`

`raw_conf` debug içindir.
ATYPICAL'te conf ve raw_conf farklı olabilir; beklenen davranıştır.

## 9. YAPILMAYACAKLAR

Viewer/backend:
- ikinci NMS uygulamayacak
- ikinci scientific threshold uygulamayacak
- ATYPICAL +0.30'u tekrar uygulamayacak
- class-aware NMS'e dönmeyecek
- frozen threshold'u değiştirmeyecek
- `.pt` dosyasını bypass inference olarak kullanmayacak

## 10. Concurrency

Adapter varsayılan olarak predict'i lock ile serialize eder.
Birden fazla worker gerekiyorsa worker başına ayrı pipeline instance önerilir.

## 11. WSI

Pipeline tile-level'dır.
WSI viewer mevcut tile->global koordinat dönüşümünü kendisi yapmaya devam eder.

## 12. Telemetry

Loglanması önerilen:
- candidate_count
- candidate_max_det_saturated
- model_sha256
- score_threshold
- atypical_logit_bias
- final_nms_iou

`candidate_max_det_saturated=True` olursa loglayın; parametreyi runtime'da değiştirmeyin.

## 13. Integrity

```bash
python tools/verify_package.py
```

Final model SHA256:
`c8914bec6e808dc09427a8c7dd638a6d44f551ca85245fd0b72ef5813ad3fe80`

TRUE-IGNORE SHA256:
`611bb908ba291fcea8274c9a2bc4315147f8a6ff95ba16f33c1fcbc7ee6df739`

## 14. Smoke

```bash
python integration/smoke_test.py --image /path/to/640x640_tile.jpg --device 0
```

## 15. Entegrasyon kabul kriterleri

- package verify PASS
- startup'ta tek model instance
- direct `.pt` final inference kaldırılmış
- box overlay doğru
- final conf kullanılıyor
- ikinci NMS/threshold yok
- ATYPICAL bias tekrar yok
- telemetry loglanıyor
- restart sonrası model SHA aynı
