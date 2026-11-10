"""Train a wall calibration head on whole-plan splits. Requires Pillow, numpy and onnxruntime."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SIZE = 512
MEAN = np.array([.485, .456, .406], dtype=np.float32)
STD = np.array([.229, .224, .225], dtype=np.float32)
PALETTE = np.array([[200, 200, 200], [255, 60, 60], [60, 120, 255],
                    [60, 220, 120], [20, 20, 20]], dtype=np.int32)
TEST = {4, 8, 13, 18, 23, 28, 33, 38}
VALIDATION = {3, 7, 12, 17, 22, 27, 32, 37}


def examples(dataset, session):
    rng = np.random.default_rng(211)
    seen = set()
    for mask in sorted([*(dataset / '已標註').glob('*-mask.png'),
                        *(dataset / '範例').glob('*-mask.png')]):
        number = int(mask.stem.removesuffix('-mask'))
        original = (dataset / '待標註' / f'{number}.png') if number > 4 else mask.with_name(f'{number}.jpg')
        source = Image.open(original).convert('RGB')
        label = Image.open(mask).convert('RGB')
        if source.size != label.size:
            raise ValueError(f'Misaligned pair: {number}')
        signature = hashlib.sha256(source.tobytes()).digest()
        if signature in seen:
            raise ValueError(f'Duplicate plan: {number}')
        seen.add(signature)
        width, height = (int(v * SIZE / max(source.size) + .5) for v in source.size)
        x, y = (SIZE - width) // 2, (SIZE - height) // 2
        rgb = np.empty((SIZE, SIZE, 3), dtype=np.float32)
        rgb[:] = np.rint(MEAN * 255) / 255
        rgb[y:y+height, x:x+width] = np.asarray(source.resize((width, height), Image.Resampling.BILINEAR)) / 255
        tensor = ((rgb - MEAN) / STD).transpose(2, 0, 1)[None]
        logits = session.run(None, {'input': tensor})[0][0, :, y:y+height, x:x+width].reshape(5, -1).T
        colors = np.asarray(label.resize((width, height), Image.Resampling.NEAREST), dtype=np.int32).reshape(-1, 3)
        distances = ((colors[:, None] - PALETTE) ** 2).sum(axis=2)
        valid = np.flatnonzero(distances.min(axis=1) <= 35**2)
        if number not in TEST | VALIDATION:
            valid = rng.choice(valid, min(6000, len(valid)), replace=False)
        logits = logits[valid]
        truth = distances[valid].argmin(axis=1) == 1
        if not truth.any():
            raise ValueError(f'No wall labels: {number}')
        margin = logits[:, 1] - logits[:, [0, 2, 3, 4]].max(axis=1)
        features = np.column_stack([np.clip(logits, -16, 16), np.clip(margin, -16, 16), np.ones(len(logits))])
        yield number, features, truth, margin


def fit(features, truth):
    coefficients = np.array([0., 0., 0., 0., 0., 1., 0.])
    penalty = np.diag([.005] * 6 + [.0001])
    for _ in range(16):
        probability = 1 / (1 + np.exp(-np.clip(features @ coefficients, -25, 25)))
        curvature = probability * (1 - probability)
        gradient = features.T @ (probability - truth) / len(truth) + penalty @ coefficients
        hessian = (features.T * curvature) @ features / len(truth) + penalty
        delta = np.linalg.solve(hessian, gradient)
        coefficients -= delta
        if np.linalg.norm(delta) < 1e-6:
            break
    return coefficients


def metrics(prepared, blend, offset):
    counts = np.zeros(3)
    per_plan = []
    for truth, margin, fitted in prepared:
        predicted = (1 - blend) * margin + blend * fitted + offset > 0
        tp = np.count_nonzero(truth & predicted)
        fp = np.count_nonzero(~truth & predicted)
        fn = np.count_nonzero(truth & ~predicted)
        counts += [tp, fp, fn]
        per_plan.append(tp / (tp + fp + fn))
    tp, fp, fn = counts
    return {'iou': round(float(np.mean(per_plan)), 5), 'precision': round(tp / max(tp + fp, 1), 5),
            'recall': round(tp / max(tp + fn, 1), 5)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'public/models/domira-wall-calibration.json')
    args = parser.parse_args()
    backbone = ROOT / 'public/models/unet-int8.onnx'
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(str(backbone), options, providers=['CPUExecutionProvider'])
    train, validation, test = [], [], []
    for number, features, truth, margin in examples(args.dataset, session):
        (test if number in TEST else validation if number in VALIDATION else train).append((features, truth, margin))
        print(f'Prepared plan {number}', flush=True)
    if min(len(train), len(validation), len(test)) < 4:
        raise ValueError('Missing training, validation or test pairs')
    coefficients = fit(np.concatenate([v[0] for v in train]), np.concatenate([v[1] for v in train]))
    def prepare(group):
        return [(truth, margin, x @ coefficients) for x, truth, margin in group]
    validation = prepare(validation)
    test = prepare(test)
    candidates = [(0, 0)] + [(blend, offset) for blend in (.25, .5, .75, 1) for offset in (-.5, 0, .5, 1, 1.5)]
    blend, offset = max(candidates, key=lambda c: metrics(validation, *c)['iou'])
    report = {'format': 'domira.wall-calibration.v1', 'backboneSha256': hashlib.sha256(backbone.read_bytes()).hexdigest(),
              'weights': coefficients.tolist(), 'blend': blend, 'offset': offset,
              'plans': {'train': len(train), 'validation': len(validation), 'test': len(test)},
              'test': {'baseline': metrics(test, 0, 0), 'calibrated': metrics(test, blend, offset)}}
    print(json.dumps(report, indent=2), flush=True)
    baseline, calibrated = report['test']['baseline'], report['test']['calibrated']
    # The review overlay favors precision: an invented wall can suggest a false partition.
    # Keep the held-out check as a release guard, separate from candidate selection.
    if blend == 0 or calibrated['precision'] <= baseline['precision'] or calibrated['iou'] < baseline['iou'] - .01:
        raise SystemExit('Calibration failed the conservative-overlay release guard.')
    args.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
