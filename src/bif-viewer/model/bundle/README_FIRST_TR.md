# UroDes V5 Viewer Pipeline Integration v1.0

Bu ZIP, hazır viewer/backend'e **final UroDes V5 pipeline'ını** entegre etmek içindir.

## En kritik kural

`models/UroDes_V5_YOLO26s_TRUE_IGNORE_seed0_FINAL.pt` dosyasını tek başına
`YOLO(pt)` ile çağırıp sonucu final inference olarak kullanmayın.

Final sıra:

1. YOLO26s seed0 O2M candidate inference
2. ATYPICAL native class 4 skoruna +0.30 logit bias
3. calibrated skorlarla class-agnostic NMS IoU=0.30
4. final max_det=300
5. frozen VALID threshold=0.2516763508319855
6. Native-8 / Clinical-5 mapping

## En kolay entegrasyon

Uygulama başlangıcında bir kez:

```python
from integration.viewer_adapter import UroDesViewerAdapter

urodes = UroDesViewerAdapter(
    bundle_root="/path/to/UroDes_V5_VIEWER_PIPELINE_INTEGRATION_v1.0",
    device=0,
)
```

Her tile:

```python
result = urodes.predict_viewer(
    image="/path/to/tile.jpg",
    class_mode="clinical5",
)
```

Viewer box listesi:

```python
result["detections"]
```

Eski `xyxy/conf/cls/name` tüketen backend'e en yakın geçiş:

```python
rows = urodes.predict_legacy_rows(image_path, class_mode="clinical5")
```

Detay: `docs/01_IMPLEMENTATION_GUIDE_TR.md`
