
import os
import uuid
import shutil

from fastapi import FastAPI, UploadFile, File
from inference import UrodesModel


app = FastAPI(
    title="Urodes AI API"
)

model = UrodesModel()

UPLOAD_DIR = "uploads"

os.makedirs(
    UPLOAD_DIR,
    exist_ok=True
)


@app.get("/")
def home():

    return {
        "status": "ok",
        "model": "Urodes V1 + V5"
    }


@app.post("/predict")
async def predict(
    file: UploadFile = File(...)
):

    extension = os.path.splitext(
        file.filename
    )[1]

    filename = (
        f"{uuid.uuid4()}"
        f"{extension}"
    )

    path = os.path.join(
        UPLOAD_DIR,
        filename
    )

    with open(
        path,
        "wb"
    ) as buffer:

        shutil.copyfileobj(
            file.file,
            buffer
        )

    results = model.predict(
        path
    )

    os.remove(path)

    return {
        "cell_count": len(results),
        "detections": results
    }
