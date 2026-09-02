# Viewer Output Contract

Canonical viewer payload:

```json
{
  "image_id": "tile_001",
  "width": 640,
  "height": 640,
  "class_mode": "clinical5",
  "detections": [],
  "telemetry": {}
}
```

Detection:

```json
{
  "xyxy": [10,20,60,80],
  "conf": 0.82,
  "raw_conf": 0.78,
  "cls": 2,
  "name": "ATYPICAL",
  "native_class_id": 4,
  "native_class_name": "ATYPICAL",
  "clinical_class_id": 2,
  "clinical_class_name": "ATYPICAL"
}
```

`conf` final calibrated skor, `raw_conf` calibration öncesi model skorudur.

Native-8:
0 HISTIOSIT
1 LENFOSIT
2 PMN
3 SKUAMOZ_EPITEL
4 ATYPICAL
5 BENIGN
6 SUSPICIOUS
7 MALIGNANT

Clinical-5:
0 OTHER_CELL
1 BENIGN
2 ATYPICAL
3 SUSPICIOUS
4 MALIGNANT
