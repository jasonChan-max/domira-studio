"""Continue the existing two-class YOLO; never install a candidate automatically.

Artifacts, private samples and checkpoints stay outside tracked source. Window
inference must retain the incumbent model when evaluating a door-only update.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--samples", type=Path, required=True)
    p.add_argument("--dataset", type=Path, required=True)
    p.add_argument("--model", type=Path, required=True)
    p.add_argument("--project", type=Path, required=True)
    p.add_argument("--name", default="yolo-n-v3-confusers")
    p.add_argument("--epochs", type=int, default=100)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--export-only", type=Path)
    p.add_argument("--calibration", type=Path)
    p.add_argument("--negative-subset", choices=["all", "fixed-window"], default="all")
    p.add_argument("--base-dataset", type=Path)
    a = p.parse_args()
    from ultralytics import YOLO

    if a.export_only:
        model = YOLO(a.export_only)
        # Export directly: onnxslim is optional, and this runtime has no pip.
        out = model.export(format="onnx", imgsz=640, opset=12, simplify=False,
                           quantize=8, data=str(a.calibration or a.dataset / "data.yaml"), device="cpu")
        print(json.dumps({"export": str(out), "bytes": Path(out).stat().st_size,
                          "sha256": digest(Path(out))}), flush=True)
        return
    pairs = []
    for image in sorted((a.samples / "images").glob("*.jpg")):
        label = a.samples / "labels" / (image.stem + ".txt")
        if Image.open(image).size != (160, 160):
            raise ValueError(f"Unexpected image size: {image}")
        lines = label.read_text(encoding="utf-8").strip().splitlines()
        for line in lines:
            cls, x, y, w, h = map(float, line.split())
            if cls != 0 or not all(0 <= v <= 1 for v in (x, y, w, h)) or w <= 0 or h <= 0:
                raise ValueError(f"Invalid door annotation: {label}")
        pairs.append((image, label, bool(lines)))
    if len(pairs) != 11 or sum(positive for _, _, positive in pairs) != 4:
        raise ValueError("Expected exactly 7 negative and 4 positive patches")
    original_stems = {image.stem for image, _, _ in pairs}
    if a.negative_subset == "fixed-window":
        if not a.base_dataset:
            raise ValueError("A subset trial requires an isolated dataset and --base-dataset")
        pairs = [p for p in pairs if p[2] or p[0].stem.startswith("cf-煙台固定窗-")]
    if a.base_dataset:
        if a.dataset.exists():
            raise FileExistsError(f"Refusing to overwrite trial dataset: {a.dataset}")
        import yaml
        for kind in ("images", "labels"):
            for split in ("train", "val"):
                target_dir = a.dataset / kind / split
                target_dir.mkdir(parents=True)
                for source in (a.base_dataset / kind / split).iterdir():
                    if source.is_file() and source.stem not in original_stems and source.suffix.lower() in (".jpg", ".jpeg", ".png", ".txt"):
                        shutil.copyfile(source, target_dir / source.name)
        config = yaml.safe_load((a.base_dataset / "data.yaml").read_text(encoding="utf-8"))
        config["path"] = str(a.dataset.resolve())
        (a.dataset / "data.yaml").write_text(yaml.safe_dump(config, allow_unicode=True), encoding="utf-8")
    # Preflight all collisions before making any dataset changes.
    for image, label, _ in pairs:
        for source, kind in ((image, "images"), (label, "labels")):
            target = a.dataset / kind / "train" / source.name
            if target.exists() and digest(source) != digest(target):
                raise FileExistsError(f"Different existing sample, refusing overwrite: {target}")
    manifest = {"baseCheckpoint": str(a.model), "baseSha256": digest(a.model),
                "epochsRequested": a.epochs, "batch": 8, "imgsz": 640,
                "seed": 0, "warmupEpochs": 3, "negativeSubset": a.negative_subset, "samples": []}
    for image, label, positive in pairs:
        manifest["samples"].append({"name": image.name, "imageSha256": digest(image),
                                    "labelSha256": digest(label), "positive": positive})
        for source, kind in ((image, "images"), (label, "labels")):
            shutil.copyfile(source, a.dataset / kind / "train" / source.name)
    (a.dataset / "labels" / "train.cache").unlink(missing_ok=True)
    a.manifest.parent.mkdir(parents=True, exist_ok=True)
    a.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    model = YOLO(a.model)
    if model.names != {0: "door", 1: "window"}:
        raise ValueError(f"Unexpected checkpoint classes: {model.names}")
    results = model.train(data=str(a.dataset / "data.yaml"), epochs=a.epochs,
                          batch=8, imgsz=640, warmup_epochs=3, device=0,
                          project=str(a.project), name=a.name, exist_ok=False,
                          patience=25, workers=0, seed=0, deterministic=True,
                          verbose=True)
    manifest["runDirectory"] = str(results.save_dir)
    manifest["bestCheckpoint"] = str(Path(results.save_dir) / "weights" / "best.pt")
    a.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
