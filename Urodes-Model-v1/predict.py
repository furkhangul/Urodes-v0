from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import torch
from ultralytics import YOLO

PACKAGE_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL = PACKAGE_DIR / "best_urocell_yolo26l.pt"
DEFAULT_CONFIG = PACKAGE_DIR / "config.json"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}


def load_config(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def choose_device(requested: str) -> str | int:
    if requested != "auto":
        if requested.isdigit():
            return int(requested)
        return requested
    if torch.cuda.is_available():
        return 0
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def collect_images(input_path: Path) -> tuple[list[Path], Path]:
    if input_path.is_file():
        if input_path.suffix.lower() not in IMAGE_EXTENSIONS:
            raise ValueError(f"Desteklenmeyen görüntü uzantısı: {input_path.suffix}")
        return [input_path.resolve()], input_path.resolve().parent
    if input_path.is_dir():
        root = input_path.resolve()
        files = sorted(
            p.resolve()
            for p in root.rglob("*")
            if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
        )
        if not files:
            raise RuntimeError(f"Görüntü bulunamadı: {input_path}")
        return files, root
    raise FileNotFoundError(f"Girdi bulunamadı: {input_path}")


def pair_metrics(first_box, second_box):
    ax1, ay1, ax2, ay2 = map(float, first_box)
    bx1, by1, bx2, by2 = map(float, second_box)
    intersection_width = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    intersection_height = max(0.0, min(ay2, by2) - max(ay1, by1))
    intersection = intersection_width * intersection_height
    first_width, first_height = max(0.0, ax2 - ax1), max(0.0, ay2 - ay1)
    second_width, second_height = max(0.0, bx2 - bx1), max(0.0, by2 - by1)
    first_area = first_width * first_height
    second_area = second_width * second_height
    union = first_area + second_area - intersection
    iou = intersection / union if union > 0 else 0.0
    smaller_area = min(first_area, second_area)
    intersection_over_smaller = intersection / smaller_area if smaller_area > 0 else 0.0
    area_ratio = smaller_area / max(first_area, second_area) if max(first_area, second_area) > 0 else 0.0

    first_center = ((ax1 + ax2) / 2.0, (ay1 + ay2) / 2.0)
    second_center = ((bx1 + bx2) / 2.0, (by1 + by2) / 2.0)
    center_distance = float(np.hypot(
        first_center[0] - second_center[0],
        first_center[1] - second_center[1],
    ))
    smaller_diagonal = min(
        float(np.hypot(first_width, first_height)),
        float(np.hypot(second_width, second_height)),
    )
    normalized_center_distance = center_distance / max(smaller_diagonal, 1e-6)
    return iou, intersection_over_smaller, normalized_center_distance, area_ratio


def deduplicate_detections(boxes, classes, confidences, cfg):
    if len(boxes) == 0:
        return np.empty(0, dtype=int), np.empty(0, dtype=int)

    class_agnostic = bool(cfg["class_agnostic"])
    iou_threshold = float(cfg["iou_threshold"])
    ios_threshold = float(cfg["intersection_over_smaller"])
    center_threshold = float(cfg["center_distance"])
    min_area_ratio = float(cfg["minimum_area_ratio"])

    order = np.argsort(-confidences)
    kept = []
    removed = []
    for candidate_index in order:
        duplicate = False
        for kept_index in kept:
            if not class_agnostic and classes[candidate_index] != classes[kept_index]:
                continue
            iou, ios, center_distance, area_ratio = pair_metrics(
                boxes[candidate_index], boxes[kept_index]
            )
            duplicate = (
                iou >= iou_threshold
                or (ios >= ios_threshold and center_distance <= 0.30)
                or (
                    iou >= 0.25
                    and center_distance <= center_threshold
                    and area_ratio >= min_area_ratio
                )
            )
            if duplicate:
                break
        if duplicate:
            removed.append(int(candidate_index))
        else:
            kept.append(int(candidate_index))
    return np.asarray(kept, dtype=int), np.asarray(removed, dtype=int)


def class_color(class_id: int):
    rng = np.random.default_rng(int(class_id) * 7919 + 17)
    return tuple(int(value) for value in rng.integers(50, 240, size=3))


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]):
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(
        description="UroCell YOLO26-L inference + notebook ile aynı duplicate bbox temizliği"
    )
    parser.add_argument("--input", required=True, help="Tek görüntü veya görüntü klasörü")
    parser.add_argument("--output", default="urocell_predictions", help="Çıktı klasörü")
    parser.add_argument("--model", default=str(DEFAULT_MODEL), help=".pt model yolu")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="config.json yolu")
    parser.add_argument("--device", default="auto", help="auto, cpu, mps veya CUDA index (örn. 0)")
    parser.add_argument("--no-overlays", action="store_true", help="Kutulu görüntüleri kaydetme")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser()
    output_dir = Path(args.output).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    config = load_config(Path(args.config).expanduser())
    model_path = Path(args.model).expanduser()
    if not model_path.exists():
        raise FileNotFoundError(f"Model bulunamadı: {model_path}")

    image_paths, input_root = collect_images(input_path)
    device = choose_device(args.device)
    use_half = isinstance(device, int) and torch.cuda.is_available()

    model = YOLO(str(model_path))
    model_names = model.names
    if isinstance(model_names, list):
        model_names = {index: name for index, name in enumerate(model_names)}

    categories = [
        {"id": int(class_id) + 1, "name": str(name), "supercategory": "cell"}
        for class_id, name in sorted(model_names.items())
    ]

    overlay_dir = output_dir / "overlays"
    if not args.no_overlays:
        overlay_dir.mkdir(parents=True, exist_ok=True)

    images = []
    annotations = []
    manifest_rows = []
    qc_rows = []
    annotation_id = 1
    raw_prediction_count = 0
    duplicate_removed_count = 0

    results = model.predict(
        source=[str(path) for path in image_paths],
        imgsz=int(config["image_size"]),
        conf=float(config["confidence"]),
        iou=float(config["nms_iou"]),
        batch=int(config["batch"]),
        device=device,
        half=use_half,
        stream=True,
        verbose=False,
    )

    for image_id, (source_path, result) in enumerate(zip(image_paths, results), start=1):
        relative_name = source_path.relative_to(input_root).as_posix()
        image_height, image_width = result.orig_shape
        images.append({
            "id": image_id,
            "file_name": relative_name,
            "width": int(image_width),
            "height": int(image_height),
        })

        overlay = result.orig_img.copy()
        if result.boxes is not None and len(result.boxes) > 0:
            boxes = result.boxes.xyxy.detach().cpu().numpy()
            classes = result.boxes.cls.detach().cpu().numpy().astype(int)
            confidences = result.boxes.conf.detach().cpu().numpy()
            raw_prediction_count += len(boxes)
            kept_indices, removed_indices = deduplicate_detections(
                boxes, classes, confidences, config["dedup"]
            )
            duplicate_removed_count += len(removed_indices)
        else:
            boxes = np.empty((0, 4), dtype=float)
            classes = np.empty(0, dtype=int)
            confidences = np.empty(0, dtype=float)
            kept_indices = np.empty(0, dtype=int)
            removed_indices = np.empty(0, dtype=int)

        qc_rows.append({
            "file_name": relative_name,
            "raw_prediction_count": int(len(boxes)),
            "kept_prediction_count": int(len(kept_indices)),
            "duplicate_removed_count": int(len(removed_indices)),
        })

        for detection_index in kept_indices:
            x1, y1, x2, y2 = map(float, boxes[detection_index])
            width = max(0.0, x2 - x1)
            height = max(0.0, y2 - y1)
            if width <= 1 or height <= 1:
                continue

            class_id = int(classes[detection_index])
            confidence = float(confidences[detection_index])
            class_name = str(model_names[class_id])

            annotations.append({
                "id": annotation_id,
                "image_id": image_id,
                "category_id": class_id + 1,
                "bbox": [round(x1, 4), round(y1, 4), round(width, 4), round(height, 4)],
                "area": round(width * height, 4),
                "iscrowd": 0,
                "score": round(confidence, 6),
            })
            manifest_rows.append({
                "annotation_id": annotation_id,
                "file_name": relative_name,
                "class_name": class_name,
                "confidence": confidence,
                "x": x1,
                "y": y1,
                "width": width,
                "height": height,
            })

            if not args.no_overlays:
                color = class_color(class_id)
                point1 = (int(round(x1)), int(round(y1)))
                point2 = (int(round(x2)), int(round(y2)))
                cv2.rectangle(overlay, point1, point2, color, 2)
                label = f"{class_name} {confidence:.2f}"
                (text_width, text_height), baseline = cv2.getTextSize(
                    label, cv2.FONT_HERSHEY_SIMPLEX, 0.38, 1
                )
                text_y = max(text_height + baseline + 3, point1[1])
                cv2.rectangle(
                    overlay,
                    (point1[0], text_y - text_height - baseline - 3),
                    (min(image_width - 1, point1[0] + text_width + 4), text_y + 2),
                    color,
                    -1,
                )
                cv2.putText(
                    overlay,
                    label,
                    (point1[0] + 2, text_y - baseline),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.38,
                    (0, 0, 0),
                    1,
                    cv2.LINE_AA,
                )

            annotation_id += 1

        if not args.no_overlays:
            overlay_path = overlay_dir / relative_name
            overlay_path.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(overlay_path), overlay)

    predictions_coco = {
        "info": {
            "description": "UroCell YOLO26-L direct inference with duplicate bbox cleanup",
            "method": "yolo26l_direct_deduplicated",
            "confidence_threshold": float(config["confidence"]),
            "nms_iou": float(config["nms_iou"]),
            "dedup": config["dedup"],
        },
        "licenses": [],
        "images": images,
        "annotations": annotations,
        "categories": categories,
    }

    (output_dir / "predictions.coco.json").write_text(
        json.dumps(predictions_coco, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    write_csv(
        output_dir / "predictions.csv",
        manifest_rows,
        ["annotation_id", "file_name", "class_name", "confidence", "x", "y", "width", "height"],
    )
    write_csv(
        output_dir / "dedup_qc.csv",
        qc_rows,
        ["file_name", "raw_prediction_count", "kept_prediction_count", "duplicate_removed_count"],
    )

    class_counts = Counter(row["class_name"] for row in manifest_rows)
    summary = {
        "method": "yolo26l_direct_deduplicated",
        "model": model_path.name,
        "device": str(device),
        "images": len(images),
        "raw_predictions": int(raw_prediction_count),
        "annotations": len(annotations),
        "duplicates_removed": int(duplicate_removed_count),
        "class_counts": dict(sorted(class_counts.items())),
        "config": config,
    }
    (output_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"Tamamlandı: {len(images)} görüntü")
    print(f"Ham bbox: {raw_prediction_count}")
    print(f"Duplicate kaldırıldı: {duplicate_removed_count}")
    print(f"Tutulan bbox: {len(annotations)}")
    print(f"Çıktı: {output_dir}")


if __name__ == "__main__":
    main()
