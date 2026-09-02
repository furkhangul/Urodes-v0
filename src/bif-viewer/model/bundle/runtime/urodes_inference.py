from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import torch
from torchvision.ops import nms

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

# Required before loading the frozen torch checkpoint.
import urodes_ignore_yolo26_v2_3  # noqa: F401

from ultralytics import YOLO


def sha256_file(path: str | Path) -> str:
    path = Path(path)
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def logit_bias_score(score: torch.Tensor, bias: float) -> torch.Tensor:
    p = score.clamp(1e-7, 1 - 1e-7)
    logits = torch.log(p / (1 - p))
    return torch.sigmoid(logits + float(bias))


class UroDesV5Final:
    def __init__(
        self,
        bundle_root: str | Path,
        device: str | int | None = None,
        strict_sha: bool = True,
    ):
        self.root = Path(bundle_root).resolve()
        self.cfg = json.loads(
            (self.root / "config" / "pipeline_config.json").read_text(
                encoding="utf-8"
            )
        )

        self.model_path = self.root / self.cfg["active_model_relpath"]
        self.module_path = self.root / self.cfg["true_ignore_module_relpath"]

        if strict_sha:
            actual_model = sha256_file(self.model_path)
            expected_model = self.cfg["active_model_sha256"]
            if actual_model != expected_model:
                raise RuntimeError(
                    f"MODEL_SHA256_MISMATCH expected={expected_model} actual={actual_model}"
                )

            actual_module = sha256_file(self.module_path)
            expected_module = self.cfg["true_ignore_module_sha256"]
            if actual_module != expected_module:
                raise RuntimeError(
                    f"MODULE_SHA256_MISMATCH expected={expected_module} actual={actual_module}"
                )

        if device is None:
            device = os.environ.get(
                "URODES_DEVICE",
                "0" if torch.cuda.is_available() else "cpu",
            )
        self.device = device
        self.model = YOLO(str(self.model_path))

        self.source_names = {
            int(k): str(v) for k, v in self.cfg["source_classes"].items()
        }
        self.clinical_map = {
            int(k): v for k, v in self.cfg["clinical5_mapping"].items()
        }

    def predict(self, image, image_id: str | None = None):
        cg = self.cfg["candidate_generation"]
        cal = self.cfg["score_calibration"]
        pp = self.cfg["final_postprocess"]

        results = self.model.predict(
            source=image,
            imgsz=int(self.cfg["input"]["ultralytics_imgsz"]),
            conf=float(cg["conf"]),
            iou=float(cg["iou"]),
            max_det=int(cg["max_det"]),
            agnostic_nms=bool(cg["agnostic_nms"]),
            end2end=bool(cg["end2end"]),
            device=self.device,
            verbose=False,
            stream=False,
        )
        if len(results) != 1:
            raise RuntimeError(f"Expected one image result, got {len(results)}")

        r = results[0]
        h, w = map(int, r.orig_shape)
        detections = []
        candidate_count = 0
        candidate_max_det_saturated = False

        if r.boxes is not None and len(r.boxes):
            boxes = r.boxes.xyxy.detach().cpu().float()
            raw_scores = r.boxes.conf.detach().cpu().float()
            classes = r.boxes.cls.detach().cpu().long()

            candidate_count = int(len(raw_scores))
            candidate_max_det_saturated = (
                candidate_count >= int(cg["max_det"])
            )

            # Frozen global ATYPICAL calibration BEFORE final class-agnostic NMS.
            calibrated_scores = raw_scores.clone()
            atypical_id = int(cal["native_class_id"])
            mask = classes == atypical_id
            if bool(mask.any()):
                calibrated_scores[mask] = logit_bias_score(
                    raw_scores[mask],
                    float(cal["logit_bias"]),
                )

            keep = nms(
                boxes,
                calibrated_scores,
                float(pp["nms_iou"]),
            )
            keep = keep[: int(pp["max_det"])]
            threshold = float(pp["score_threshold"])

            for idx in keep.tolist():
                score = float(calibrated_scores[idx])
                if score < threshold:
                    continue

                source_id = int(classes[idx])
                clinical = self.clinical_map[source_id]

                detections.append({
                    "bbox_xyxy": [float(x) for x in boxes[idx].tolist()],
                    "score": score,
                    "raw_score": float(raw_scores[idx]),
                    "native_class_id": source_id,
                    "native_class_name": self.source_names[source_id],
                    "clinical_class_id": int(clinical["id"]),
                    "clinical_class_name": str(clinical["name"]),
                })

        detections.sort(key=lambda x: -x["score"])

        if image_id is None:
            try:
                image_id = Path(str(r.path)).stem
            except Exception:
                image_id = None

        return {
            "schema_version": "UroDesV5DetectionOutput/1.0",
            "image_id": image_id,
            "image_width": w,
            "image_height": h,
            "pipeline_name": self.cfg["pipeline_name"],
            "model_seed": int(self.cfg["active_seed"]),
            "model_sha256": self.cfg["active_model_sha256"],
            "score_threshold": float(pp["score_threshold"]),
            "atypical_logit_bias": float(cal["logit_bias"]),
            "final_nms_iou": float(pp["nms_iou"]),
            "candidate_count": candidate_count,
            "candidate_max_det_saturated": candidate_max_det_saturated,
            "detections": detections,
        }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle-root", required=True)
    ap.add_argument("--image", required=True)
    ap.add_argument("--output", default=None)
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    pipe = UroDesV5Final(
        bundle_root=args.bundle_root,
        device=args.device,
    )
    result = pipe.predict(args.image)
    text = json.dumps(result, indent=2, ensure_ascii=False)

    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()
