
import cv2
import torch
import torch.nn as nn

from PIL import Image
from ultralytics import YOLO
from torchvision import transforms
from torchvision.models import convnext_tiny


class UrodesModel:

    def __init__(
        self,
        detector_path="models/detector.pt",
        classifier_path="models/classifier.pt"
    ):

        self.device = torch.device(
            "cuda"
            if torch.cuda.is_available()
            else "cpu"
        )

        # --------------------------------------------
        # Detector
        # --------------------------------------------

        self.detector = YOLO(
            detector_path
        )

        # --------------------------------------------
        # Classifier
        # --------------------------------------------

        checkpoint = torch.load(
            classifier_path,
            map_location=self.device,
            weights_only=False
        )

        self.classes = checkpoint["classes"]

        image_size = checkpoint.get(
            "image_size",
            224
        )

        self.classifier = convnext_tiny(
            weights=None
        )

        self.classifier.classifier[2] = nn.Linear(
            self.classifier.classifier[2].in_features,
            len(self.classes)
        )

        self.classifier.load_state_dict(
            checkpoint["model"]
        )

        self.classifier = self.classifier.to(
            self.device
        )

        self.classifier.eval()

        self.transform = transforms.Compose([

            transforms.Resize(
                (image_size, image_size)
            ),

            transforms.ToTensor(),

            transforms.Normalize(
                [0.485, 0.456, 0.406],
                [0.229, 0.224, 0.225]
            )
        ])

        # FINAL AYARLAR

        self.detect_conf = 0.20
        self.class_conf = 0.30

        self.context = 0.25


    def predict(self, image_path):

        image = cv2.imread(
            image_path
        )

        if image is None:
            raise ValueError(
                "Görüntü okunamadı."
            )

        H, W = image.shape[:2]

        # ============================================
        # DETECTION
        # ============================================

        result = self.detector.predict(

            source=image,

            imgsz=1024,

            conf=self.detect_conf,

            iou=0.50,

            agnostic_nms=True,

            max_det=1000,

            device=(
                0
                if self.device.type == "cuda"
                else "cpu"
            ),

            verbose=False

        )[0]

        boxes = (
            result.boxes.xyxy
            .cpu()
            .numpy()
        )

        detect_confs = (
            result.boxes.conf
            .cpu()
            .numpy()
        )

        results = []

        # ============================================
        # CLASSIFICATION
        # ============================================

        for box, detect_conf in zip(
            boxes,
            detect_confs
        ):

            x1, y1, x2, y2 = (
                box.astype(int)
            )

            bw = x2 - x1
            bh = y2 - y1

            if bw <= 0 or bh <= 0:
                continue

            pad_x = int(
                bw * self.context
            )

            pad_y = int(
                bh * self.context
            )

            cx1 = max(
                0,
                x1 - pad_x
            )

            cy1 = max(
                0,
                y1 - pad_y
            )

            cx2 = min(
                W,
                x2 + pad_x
            )

            cy2 = min(
                H,
                y2 + pad_y
            )

            crop = image[
                cy1:cy2,
                cx1:cx2
            ]

            if crop.size == 0:
                continue

            crop = cv2.cvtColor(
                crop,
                cv2.COLOR_BGR2RGB
            )

            tensor = (
                self.transform(
                    Image.fromarray(crop)
                )
                .unsqueeze(0)
                .to(self.device)
            )

            with torch.no_grad():

                logits = self.classifier(
                    tensor
                )

                probabilities = torch.softmax(
                    logits,
                    dim=1
                )

                class_conf, pred_cls = (
                    probabilities.max(
                        dim=1
                    )
                )

            class_conf = float(
                class_conf.item()
            )

            pred_cls = int(
                pred_cls.item()
            )

            class_name = (
                self.classes[pred_cls]
            )

            if (
                class_conf
                <
                self.class_conf
            ):
                class_name = "ignore"

            results.append({

                "class": class_name,

                "class_confidence":
                    round(
                        class_conf,
                        4
                    ),

                "detection_confidence":
                    round(
                        float(detect_conf),
                        4
                    ),

                "box": [
                    int(x1),
                    int(y1),
                    int(x2),
                    int(y2)
                ]
            })

        return results
