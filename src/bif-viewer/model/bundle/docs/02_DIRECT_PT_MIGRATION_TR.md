# Direct `.pt` -> Frozen Pipeline Geçişi

## Önce

```python
model = YOLO(MODEL_PATH)
results = model.predict(image)
```

## Sonra

Startup:

```python
urodes = UroDesViewerAdapter(
    bundle_root=URODES_BUNDLE_ROOT,
    device=0,
)
```

Inference:

```python
rows = urodes.predict_legacy_rows(
    image=image_path,
    class_mode="clinical5",
)
```

`rows` eski viewer çizim koduna yakın yapı verir:

```python
[
  {
    "xyxy": [x1,y1,x2,y2],
    "conf": 0.81,
    "cls": 2,
    "name": "ATYPICAL"
  }
]
```

Bu compatibility helper pipeline'ı bypass etmez; final calibration/NMS/threshold uygulanır.
