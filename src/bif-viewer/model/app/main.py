import base64
import io
import logging
import os
import time

import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("bif-model")

MODEL_PATH = os.environ.get("MODEL_PATH", "/model/best.pt")
DEFAULT_CONF = float(os.environ.get("DEFAULT_CONF", "0.25"))
DEFAULT_IOU = float(os.environ.get("DEFAULT_IOU", "0.5"))
DEFAULT_IMGSZ = int(os.environ.get("DEFAULT_IMGSZ", "640"))

app = FastAPI(title="BIF Viewer Model Service", version="1.0.0")

_model = None
_names = None
_model_meta = {}


def _lookup_names(obj):
    for attr in ("names",):
        try:
            names = getattr(obj, attr)
            if isinstance(names, dict) and names:
                return {int(k): str(v) for k, v in names.items()}
            if isinstance(names, (list, tuple)) and names:
                return {i: str(n) for i, n in enumerate(names)}
        except Exception:
            pass
    return None


def load_model():
    global _model, _names, _model_meta
    logger.info("Model yükleniyor: %s", MODEL_PATH)
    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(f"Model dosyası bulunamadı: {MODEL_PATH}")

    from ultralytics import YOLO

    try:
        model = YOLO(MODEL_PATH, task="detect")
        names = _lookup_names(model)
        if names is None:
            names = _lookup_names(getattr(model, "model", None))
        meta = {"loaded_by": "ultralytics.YOLO"}
        logger.info("ultralytics.YOLO ile yüklendi")
    except Exception as exc:
        logger.warning("YOLO yükleme başarısız (%s), torch.jit fallback deneniyor", exc)
        import torch

        jit = torch.jit.load(MODEL_PATH, map_location="cpu")
        jit.eval()
        model = jit
        names = _lookup_names(jit)
        meta = {"loaded_by": "torch.jit"}
        logger.info("torch.jit ile yüklendi")

    if names is None:
        try:
            nc = int(getattr(model.model, "nc", 0)) if hasattr(model, "model") else 0
        except Exception:
            nc = 0
        if nc <= 0:
            nc = 80
        names = {i: str(i) for i in range(nc)}
        logger.warning("Sınıf isimleri bulunamadı; numerik isimler kullanılıyor (0..%d)", nc - 1)

    _model = model
    _names = names
    _model_meta = {
        "path": MODEL_PATH,
        **meta,
        "class_count": len(names),
        "classes": [names[i] for i in sorted(names)],
        "defaults": {"conf": DEFAULT_CONF, "iou": DEFAULT_IOU, "imgsz": DEFAULT_IMGSZ},
    }
    logger.info("Model hazır: %d sınıf -> %s", len(names), _model_meta["classes"])


@app.on_event("startup")
def _startup():
    load_model()


@app.get("/health")
def health():
    ok = _model is not None
    return JSONResponse({"status": "ok" if ok else "loading"}, status_code=200 if ok else 503)


@app.get("/info")
def info():
    return {"status": "ok", "model": _model_meta}


def _decode_image(raw: bytes) -> np.ndarray:
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Görüntü çözümlenemedi: {exc}")
    if img.mode != "RGB":
        img = img.convert("RGB")
    return np.asarray(img)


def _run_inference(img: np.ndarray, conf: float, iou: float, imgsz: int):
    if hasattr(_model, "predict"):
        results = _model.predict(
            source=img,
            conf=conf,
            iou=iou,
            imgsz=imgsz,
            verbose=False,
            device="cpu",
        )
        result = results[0]
        names = _names
        detections = []
        if result.boxes is not None and len(result.boxes) > 0:
            boxes = result.boxes.xyxy.cpu().numpy().tolist()
            confs = result.boxes.conf.cpu().numpy().tolist()
            cls_ids = result.boxes.cls.cpu().numpy().astype(int).tolist()
            for bbox, c, ci in zip(boxes, confs, cls_ids):
                detections.append(
                    {
                        "class_id": int(ci),
                        "class_name": names.get(int(ci), str(int(ci))),
                        "confidence": round(float(c), 4),
                        "bbox": [round(v, 1) for v in bbox],
                    }
                )
        try:
            # Sadece kutu + renk; etiket/conf metni çizilmez
            annotated = result.plot(labels=False, conf=False)
        except Exception:
            try:
                annotated = result.plot()
            except Exception:
                annotated = img
        summary = {}
        for d in detections:
            summary[d["class_name"]] = summary.get(d["class_name"], 0) + 1
        return detections, summary, annotated

    # torch.jit fallback: ham forward (NMS dahil edilmişse [N,6] çıktı beklenir)
    import torch

    tensor = torch.from_numpy(np.ascontiguousarray(img.transpose(2, 0, 1))).float().div(255).unsqueeze(0)
    with torch.inference_mode():
        out = _model(tensor)
    detections = []
    try:
        arr = out[0].cpu().numpy()
        for row in arr:
            if len(row) >= 6:
                confs = row[4:]
                cls_id = int(np.argmax(confs))
                score = float(confs[cls_id])
                if score >= conf:
                    detections.append(
                        {
                            "class_id": cls_id,
                            "class_name": _names.get(cls_id, str(cls_id)),
                            "confidence": round(score, 4),
                            "bbox": [round(v, 1) for v in row[:4]],
                        }
                    )
    except Exception as exc:
        logger.warning("jit çıktı ayrıştırılamadı: %s", exc)
    summary = {}
    for d in detections:
        summary[d["class_name"]] = summary.get(d["class_name"], 0) + 1
    return detections, summary, img


@app.post("/predict")
async def predict(
    request: Request,
    conf: float = Query(DEFAULT_CONF, ge=0.01, le=1.0),
    iou: float = Query(DEFAULT_IOU, ge=0.05, le=0.95),
    imgsz: int = Query(DEFAULT_IMGSZ, ge=64, le=2048),
    file: UploadFile | None = File(None),
):
    if _model is None:
        raise HTTPException(status_code=503, detail="Model henüz yüklenmedi")

    if file is not None:
        raw = await file.read()
    else:
        raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail="Görüntü gövdesi boş")

    img = _decode_image(raw)
    t0 = time.perf_counter()
    detections, summary, annotated = _run_inference(img, conf, iou, imgsz)
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

    ann_b64 = None
    if annotated is not None:
        pil = Image.fromarray(np.asarray(annotated)[..., ::-1])
        buf = io.BytesIO()
        pil.save(buf, format="PNG")
        ann_b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    return {
        "status": "ok",
        "model": _model_meta,
        "input_shape": [int(img.shape[1]), int(img.shape[0])],
        "conf": conf,
        "iou": iou,
        "imgsz": imgsz,
        "inference_ms": elapsed_ms,
        "total": len(detections),
        "detections": detections,
        "summary": summary,
        "annotated_image": ann_b64,
    }
