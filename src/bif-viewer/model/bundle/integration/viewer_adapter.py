from __future__ import annotations

import sys
import threading
from pathlib import Path
from typing import Any, Literal

BUNDLE_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = BUNDLE_ROOT / "runtime"

if str(RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(RUNTIME_DIR))

from urodes_inference import UroDesV5Final  # noqa: E402

ClassMode = Literal["clinical5", "native8"]


class UroDesViewerAdapter:
    """
    Viewer-facing adapter for the frozen UroDes V5 pipeline.

    Do NOT apply a second scientific threshold, calibration or NMS after this
    adapter. UroDesV5Final already applies the frozen final pipeline.
    """

    def __init__(
        self,
        bundle_root: str | Path | None = None,
        device: str | int | None = None,
        strict_sha: bool = True,
        serialize_predict: bool = True,
    ):
        self.bundle_root = Path(bundle_root or BUNDLE_ROOT).resolve()
        self.pipeline = UroDesV5Final(
            bundle_root=self.bundle_root,
            device=device,
            strict_sha=strict_sha,
        )
        self._lock = threading.Lock() if serialize_predict else None

    def _predict(self, image: Any, image_id: str | None = None) -> dict:
        if self._lock is None:
            return self.pipeline.predict(image=image, image_id=image_id)
        with self._lock:
            return self.pipeline.predict(image=image, image_id=image_id)

    def predict(self, image: Any, image_id: str | None = None) -> dict:
        """Canonical frozen pipeline output."""
        return self._predict(image, image_id=image_id)

    def predict_viewer(
        self,
        image: Any,
        image_id: str | None = None,
        class_mode: ClassMode = "clinical5",
    ) -> dict:
        """
        Viewer-friendly output.

        clinical5:
          OTHER_CELL / BENIGN / ATYPICAL / SUSPICIOUS / MALIGNANT

        native8:
          HISTIOSIT / LENFOSIT / PMN / SKUAMOZ_EPITEL /
          ATYPICAL / BENIGN / SUSPICIOUS / MALIGNANT
        """
        if class_mode not in {"clinical5", "native8"}:
            raise ValueError("class_mode must be 'clinical5' or 'native8'")

        out = self._predict(image, image_id=image_id)
        items = []

        for d in out["detections"]:
            if class_mode == "clinical5":
                cls_id = int(d["clinical_class_id"])
                cls_name = str(d["clinical_class_name"])
            else:
                cls_id = int(d["native_class_id"])
                cls_name = str(d["native_class_name"])

            items.append({
                "xyxy": list(d["bbox_xyxy"]),
                "conf": float(d["score"]),
                "raw_conf": float(d["raw_score"]),
                "cls": cls_id,
                "name": cls_name,
                "native_class_id": int(d["native_class_id"]),
                "native_class_name": str(d["native_class_name"]),
                "clinical_class_id": int(d["clinical_class_id"]),
                "clinical_class_name": str(d["clinical_class_name"]),
            })

        return {
            "image_id": out["image_id"],
            "width": out["image_width"],
            "height": out["image_height"],
            "class_mode": class_mode,
            "detections": items,
            "telemetry": {
                "candidate_count": out["candidate_count"],
                "candidate_max_det_saturated": out["candidate_max_det_saturated"],
                "model_sha256": out["model_sha256"],
                "score_threshold": out["score_threshold"],
                "atypical_logit_bias": out["atypical_logit_bias"],
                "final_nms_iou": out["final_nms_iou"],
            },
        }

    def predict_legacy_rows(
        self,
        image: Any,
        image_id: str | None = None,
        class_mode: ClassMode = "clinical5",
    ) -> list[dict]:
        """Compatibility helper: [{xyxy, conf, cls, name, ...}, ...]."""
        return self.predict_viewer(
            image=image,
            image_id=image_id,
            class_mode=class_mode,
        )["detections"]
