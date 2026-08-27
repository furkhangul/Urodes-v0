FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MODEL_PATH=/model/best.pt \
    DEFAULT_CONF=0.25 \
    DEFAULT_IOU=0.5 \
    DEFAULT_IMGSZ=640

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    libgl1 libglib2.0-0 libxcb1 libx11-6 libxext6 libxrender1 libsm6 libxkbcommon0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchvision==0.20.1 \
    && pip install -r /dev/stdin <<'EOF'
fastapi==0.115.6
uvicorn[standard]==0.34.0
python-multipart==0.0.20
pillow==11.1.0
numpy==2.2.1
ultralytics==8.3.62
EOF

COPY app /app

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=20 --start-period=120s \
  CMD curl -sf http://127.0.0.1:8000/health >/dev/null || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
