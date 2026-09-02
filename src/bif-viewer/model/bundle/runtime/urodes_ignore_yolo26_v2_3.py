
from __future__ import annotations

import csv
import os
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch

from ultralytics.cfg import get_cfg
from ultralytics.data.dataset import YOLODataset
from ultralytics.models.yolo.detect import DetectionTrainer
from ultralytics.nn.tasks import DetectionModel
from ultralytics.utils import RANK, colorstr
from ultralytics.utils.loss import E2ELoss, v8DetectionLoss
from ultralytics.utils.ops import xywh2xyxy
from ultralytics.utils.tal import make_anchors
from ultralytics.utils.torch_utils import unwrap_model

IGNORE_SENTINEL=-1.0


def normalize_model_args_for_loss(model):
    """
    Return model with a complete Ultralytics training-argument namespace.

    Raw .pt loads may expose a partial dict lacking box/cls/dfl. Build the
    pinned package's default training cfg first, then overlay only recognized
    raw-model fields. This preserves model-known values while guaranteeing the
    full loss hyperparameter set.
    """
    raw=getattr(model,"args",None)

    if raw is not None and not isinstance(raw,dict):
        # Trainer-built models normally already have a complete namespace.
        missing=[k for k in ("box","cls","dfl","epochs") if not hasattr(raw,k)]
        if not missing:
            return model

        raw=vars(raw)

    raw=dict(raw or {})
    cfg=get_cfg()
    valid=set(vars(cfg))

    for k,v in raw.items():
        if k in valid:
            setattr(cfg,k,v)

    for required in ("box","cls","dfl","epochs"):
        if not hasattr(cfg,required):
            raise AttributeError(
                f"Normalized cfg missing loss hyperparameter: {required}"
            )

    model.args=cfg
    return model


def load_ignore_map(csv_path,split="train"):
    split=str(split).lower()
    out=defaultdict(list)
    with open(csv_path,"r",encoding="utf-8-sig",newline="") as f:
        for r in csv.DictReader(f):
            if str(r["split"]).lower()!=split:
                continue
            if r["region_type"]!="ignore":
                continue
            x,y,w,h=map(float,[r["x"],r["y"],r["w"],r["h"]])
            if not np.isfinite([x,y,w,h]).all() or w<=0 or h<=0:
                raise ValueError(f"Invalid IGNORE row: {r}")
            out[str(r["canonical_image_id"])].append((x,y,w,h))
    return dict(out)


class IgnoreYOLODataset(YOLODataset):
    def __init__(self,*args,ignore_csv,ignore_split="train",**kwargs):
        self.ignore_csv=str(ignore_csv)
        self.ignore_split=str(ignore_split).lower()
        self.ignore_map=load_ignore_map(self.ignore_csv,self.ignore_split)
        super().__init__(*args,**kwargs)

    def update_labels_info(self,label):
        stem=Path(label["im_file"]).stem
        regs=self.ignore_map.get(stem,[])

        if regs:
            h,w=label["ori_shape"]
            extra=[]
            for x,y,bw,bh in regs:
                x1=max(0.0,min(float(w),x))
                y1=max(0.0,min(float(h),y))
                x2=max(0.0,min(float(w),x+bw))
                y2=max(0.0,min(float(h),y+bh))
                if x2<=x1 or y2<=y1:
                    continue
                extra.append([
                    ((x1+x2)/2)/w,
                    ((y1+y2)/2)/h,
                    (x2-x1)/w,
                    (y2-y1)/h
                ])

            if extra:
                e=np.asarray(extra,dtype=np.float32)
                label["bboxes"]=np.concatenate(
                    [label["bboxes"].astype(np.float32,copy=False),e],axis=0
                )
                sent=np.full((len(e),1),IGNORE_SENTINEL,dtype=np.float32)
                label["cls"]=np.concatenate(
                    [label["cls"].astype(np.float32,copy=False),sent],axis=0
                )

        return super().update_labels_info(label)


class IgnoreAwareDetectionLoss(v8DetectionLoss):
    def __init__(self,model,tal_topk=10,tal_topk2=None):
        model=normalize_model_args_for_loss(model)
        super().__init__(model,tal_topk=tal_topk,tal_topk2=tal_topk2)

        for required in ("box","cls","dfl","epochs"):
            if not hasattr(self.hyp,required):
                raise AttributeError(
                    f"Missing required loss hyperparameter after normalization: {required}"
                )

        self.last_debug={}

    @staticmethod
    def _biological_batch(batch):
        cls=batch["cls"].view(-1)
        keep=cls>=0
        out=dict(batch)
        out["cls"]=batch["cls"][keep]
        out["bboxes"]=batch["bboxes"][keep]
        out["batch_idx"]=batch["batch_idx"][keep]
        return out,~keep

    def _ignore_anchor_mask(self,batch,ignore_rows,anchor_centers,imgsz,batch_size):
        mask=torch.zeros(
            (batch_size,anchor_centers.shape[0]),
            dtype=torch.bool,device=self.device
        )
        if not bool(ignore_rows.any()):
            return mask

        ibox=batch["bboxes"][ignore_rows].to(self.device)
        ibidx=batch["batch_idx"][ignore_rows].long().to(self.device)

        scale=imgsz[[1,0,1,0]].to(self.device,dtype=ibox.dtype)
        boxes=xywh2xyxy(ibox*scale)

        ax=anchor_centers[:,0]
        ay=anchor_centers[:,1]

        for bi in ibidx.unique():
            r=boxes[ibidx==bi]
            inside=(
                (ax[None,:]>=r[:,0:1]) &
                (ax[None,:]<=r[:,2:3]) &
                (ay[None,:]>=r[:,1:2]) &
                (ay[None,:]<=r[:,3:4])
            )
            mask[int(bi)]=inside.any(dim=0)

        return mask

    def get_assigned_targets_and_loss(self,preds,batch):
        loss=torch.zeros(3,device=self.device)

        pred_distri=preds["boxes"].permute(0,2,1).contiguous()
        pred_scores=preds["scores"].permute(0,2,1).contiguous()

        anchor_points,stride_tensor=make_anchors(preds["feats"],self.stride,0.5)
        dtype=pred_scores.dtype
        batch_size=pred_scores.shape[0]
        imgsz=torch.tensor(
            preds["feats"][0].shape[2:],
            device=self.device,dtype=dtype
        )*self.stride[0]

        bio_batch,ignore_rows=self._biological_batch(batch)

        targets=torch.cat((
            bio_batch["batch_idx"].view(-1,1),
            bio_batch["cls"].view(-1,1),
            bio_batch["bboxes"]
        ),1)

        targets=self.preprocess(
            targets.to(self.device),
            batch_size,
            scale_tensor=imgsz[[1,0,1,0]]
        )

        gt_labels,gt_bboxes=targets.split((1,4),2)
        mask_gt=gt_bboxes.sum(2,keepdim=True).gt_(0.0)

        pred_bboxes=self.bbox_decode(anchor_points,pred_distri)

        _,target_bboxes,target_scores,fg_mask,target_gt_idx=self.assigner(
            pred_scores.detach().sigmoid(),
            (pred_bboxes.detach()*stride_tensor).type(gt_bboxes.dtype),
            anchor_points*stride_tensor,
            gt_labels,gt_bboxes,mask_gt
        )

        # TaskAlignedAssigner's n_max_boxes == 0 early-return path yields a
        # floating zeros_like mask, while the normal path yields bool.
        # Normalize the logical-mask contract before inversion/indexing.
        fg_mask_raw_dtype=str(fg_mask.dtype)
        fg_mask=fg_mask.bool()

        target_scores_sum=max(target_scores.sum(),1)

        bce_loss=self.bce(pred_scores,target_scores.to(dtype))
        if getattr(self,"class_weights",None) is not None:
            bce_loss*=self.class_weights

        ignore_anchor_mask=self._ignore_anchor_mask(
            batch,
            ignore_rows,
            anchor_points*stride_tensor,
            imgsz,
            batch_size
        )

        # Biological foreground always wins.
        ignore_bg_mask=ignore_anchor_mask & (~fg_mask)
        if ignore_bg_mask.any():
            bce_loss=bce_loss*(~ignore_bg_mask).unsqueeze(-1)

        loss[1]=bce_loss.sum()/target_scores_sum

        if fg_mask.sum():
            loss[0],loss[2]=self.bbox_loss(
                pred_distri,pred_bboxes,anchor_points,
                target_bboxes/stride_tensor,target_scores,
                target_scores_sum,fg_mask,imgsz,stride_tensor
            )

        loss[0]*=self.hyp.box
        loss[1]*=self.hyp.cls
        loss[2]*=self.hyp.dfl

        self.last_debug={
            "sentinel_boxes":int(ignore_rows.sum().item()),
            "ignore_anchors":int(ignore_anchor_mask.sum().item()),
            "fg_mask_raw_dtype":fg_mask_raw_dtype,
            "fg_mask_normalized_dtype":str(fg_mask.dtype),
            "foreground_anchors":int(fg_mask.sum().item()),
            "foreground_inside_ignore":int((ignore_anchor_mask&fg_mask).sum().item()),
            "masked_background_anchors":int(ignore_bg_mask.sum().item())
        }

        return (
            (fg_mask,target_gt_idx,target_bboxes,anchor_points,stride_tensor),
            loss,
            dict(zip(self.loss_names,loss.detach()))
        )


class IgnoreAwareE2ELoss(E2ELoss):
    def __init__(self,model):
        def loss_fn(model,tal_topk=10,tal_topk2=None):
            return IgnoreAwareDetectionLoss(
                model,tal_topk=tal_topk,tal_topk2=tal_topk2
            )
        super().__init__(model,loss_fn=loss_fn)


class IgnoreAwareDetectionModel(DetectionModel):
    def init_criterion(self):
        return IgnoreAwareE2ELoss(self)


class IgnoreAwareTrainer(DetectionTrainer):
    def get_model(self,cfg=None,weights=None,verbose=True):
        model=IgnoreAwareDetectionModel(
            cfg,nc=self.data["nc"],ch=self.data["channels"],
            verbose=verbose and RANK==-1
        )
        if weights:
            model.load(weights)
        return model

    def build_dataset(self,img_path,mode="train",batch=None):
        if mode!="train":
            return super().build_dataset(img_path,mode,batch)

        ignore_csv=os.environ.get("URODES_IGNORE_CSV")
        if not ignore_csv:
            raise RuntimeError("URODES_IGNORE_CSV is not set")

        gs=max(int(unwrap_model(self.model).stride.max()),32)

        return IgnoreYOLODataset(
            img_path=img_path,
            imgsz=self.args.imgsz,
            batch_size=batch,
            augment=True,
            hyp=self.args,
            rect=self.args.rect,
            cache=self.args.cache or None,
            single_cls=self.args.single_cls or False,
            stride=int(gs),
            pad=0.0,
            prefix=colorstr("train: "),
            task=self.args.task,
            classes=self.args.classes,
            data=self.data,
            fraction=self.args.fraction,
            ignore_csv=ignore_csv,
            ignore_split="train"
        )
