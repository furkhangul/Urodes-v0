"""Minimal backend integration example."""

from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
PACKAGE_ROOT = HERE.parent

if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from viewer_adapter import UroDesViewerAdapter

# Create ONCE at backend/application startup.
urodes = UroDesViewerAdapter(
    bundle_root=PACKAGE_ROOT,
    device=None,       # GPU 0 if available, otherwise CPU
    strict_sha=True,
)


def analyze_tile(image_path: str):
    return urodes.predict_viewer(
        image=image_path,
        class_mode="clinical5",
    )


if __name__ == "__main__":
    import argparse
    import json

    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--class-mode", choices=["clinical5", "native8"], default="clinical5")
    args = ap.parse_args()

    print(json.dumps(
        urodes.predict_viewer(args.image, class_mode=args.class_mode),
        indent=2,
        ensure_ascii=False,
    ))
