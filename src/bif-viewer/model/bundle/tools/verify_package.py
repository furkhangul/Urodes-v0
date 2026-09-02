from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "PACKAGE_SHA256SUMS.txt"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    checked = 0
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        expected, rel = line.split("  ", 1)
        p = ROOT / rel
        if not p.exists():
            raise SystemExit(f"MISSING: {rel}")
        actual = sha256_file(p)
        if actual != expected:
            raise SystemExit(
                f"SHA256 FAIL: {rel}\nexpected={expected}\nactual={actual}"
            )
        checked += 1
    print(f"PACKAGE VERIFY: PASS ({checked} files)")


if __name__ == "__main__":
    main()
