# UroCell YOLO26-L — Kullanıma Hazır Paket

Bu paket `best_urocell_yolo26l.pt` modelini ve `UroCell_Raw_Inference_YOLO26_Direct_Deduplicated.ipynb` içindeki inference + duplicate bbox temizliği davranışını birlikte içerir.

## Gereksinim

- Python 3.10+ önerilir
- NVIDIA GPU varsa otomatik CUDA kullanır
- Apple Silicon Mac'te MPS, diğer durumlarda CPU'ya düşer

## Kurulum

```bash
python -m venv .venv
```

macOS / Linux:

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Kullanım

Tek görüntü:

```bash
python predict.py --input /path/to/image.jpg
```

Klasör:

```bash
python predict.py --input /path/to/images --output results
```

Belirli cihaz seçmek için:

```bash
python predict.py --input /path/to/images --device 0
python predict.py --input /path/to/images --device cpu
python predict.py --input /path/to/images --device mps
```

Kutulu görseller gerekmiyorsa:

```bash
python predict.py --input /path/to/images --no-overlays
```

## Çıktılar

`--output` klasöründe:

- `predictions.coco.json` — COCO formatında bbox + sınıf tahminleri
- `predictions.csv` — satır bazlı tahmin manifesti
- `dedup_qc.csv` — görüntü başına duplicate temizliği sayıları
- `summary.json` — çalıştırma özeti ve sınıf sayıları
- `overlays/` — kutulu görseller (`--no-overlays` verilmezse)

## Notebook ile eşleşen varsayılanlar

- Image size: `640`
- Confidence: `0.10`
- YOLO NMS IoU: `0.45`
- Batch: `8`
- Duplicate cleanup: class-agnostic
- Dedup IoU: `0.45`
- Intersection / smaller box: `0.78`
- Normalized center distance: `0.22`
- Minimum area ratio: `0.40`

Bu değerler `config.json` üzerinden değiştirilebilir.
