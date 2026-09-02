from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from viewer_adapter import UroDesViewerAdapter


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--device", default=None)
    args = ap.parse_args()

    pipe = UroDesViewerAdapter(ROOT, device=args.device, strict_sha=True)
    out = pipe.predict_viewer(args.image, class_mode="clinical5")

    print(json.dumps({
        "status": "PASS",
        "image_id": out["image_id"],
        "detections": len(out["detections"]),
        "telemetry": out["telemetry"],
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
