"""Compare baked AO with a path-traced reference. Foreground only.

Pass bar: mean error <= 0.08 and p95 error <= 0.18.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent


def foreground(baked, trace):
    # Baked backdrop is #d8d8d8. Trace backdrop is black.
    b = baked.mean(axis=2) / 255
    t = trace.mean(axis=2) / 255
    return (np.abs(b - 216 / 255) > 0.055) & (t > 0.03)


def score_pair(image_b, image_t, label):
    if image_b.shape != image_t.shape or np.array_equal(image_b, image_t):
        print(f'{label}: missing or identical')
        return None
    mask = foreground(image_b, image_t)
    b = image_b.mean(axis=2) / 255
    t = image_t.mean(axis=2) / 255
    if mask.sum() < 500:
        print(f'{label}: not enough foreground')
        return None
    bn = b / max(float(np.percentile(b[mask], 90)), 1e-4)
    tn = t / max(float(np.percentile(t[mask], 90)), 1e-4)
    err = np.abs(bn - tn)
    mean = float(err[mask].mean())
    p95 = float(np.percentile(err[mask], 95))
    signed = float((bn - tn)[mask].mean())
    print(f'{label}: mean {mean:.3f}  p95 {p95:.3f}  signed {signed:+.3f}  pixels {int(mask.sum())}')
    heat = np.zeros_like(image_b)
    heat[..., 0] = np.clip((bn - tn) * 255, 0, 255)
    heat[..., 2] = np.clip((tn - bn) * 255, 0, 255)
    heat[..., 1] = 40
    heat[~mask] = 30
    side = np.concatenate([
        image_b.astype(np.uint8),
        image_t.astype(np.uint8),
        heat.astype(np.uint8),
    ], axis=1)
    return side


def crops_for(scenes, scene_id, cam):
    for scene in scenes:
        if scene.get('id') == scene_id:
            return (scene.get('crops') or {}).get(cam) or []
    return []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=HERE / 'out',
                        help='Directory of baked/trace/uniform PNGs')
    parser.add_argument('--scenes', type=Path, default=HERE / 'scenes.json')
    parser.add_argument('ids', nargs='*', help='Scene ids. Default: every scene in scenes.json')
    args = parser.parse_args()
    config = json.loads(args.scenes.read_text())
    scenes = config['scenes']
    bar = config.get('passBar') or {'mean': 0.08, 'p95': 0.18}
    ids = args.ids or [scene['id'] for scene in scenes]
    cams = ['hero', 'side', 'close']
    sheets = args.root / 'sheets'
    sheets.mkdir(parents=True, exist_ok=True)
    print(f"pass bar: mean <= {bar['mean']} and p95 <= {bar['p95']}")
    for kind in ('trace', 'uniform'):
        print(f'--- vs {kind} ---')
        for scene in ids:
            for cam in cams:
                baked = args.root / f'{scene}-baked-{cam}.png'
                other = args.root / f'{scene}-{kind}-{cam}.png'
                if not baked.exists() or not other.exists():
                    continue
                image_b = np.asarray(Image.open(baked).convert('RGB')).astype(np.float32)
                image_t = np.asarray(Image.open(other).convert('RGB')).astype(np.float32)
                side = score_pair(image_b, image_t, f'{scene} {cam} {kind}')
                if side is not None:
                    Image.fromarray(side).save(sheets / f'{scene}-{cam}-vs-{kind}.png')
                image = np.asarray(Image.open(baked).convert('RGB'))
                for crop in crops_for(scenes, scene, cam):
                    x, y, w, h = crop['x'], crop['y'], crop['w'], crop['h']
                    tile = image[y:y + h, x:x + w]
                    Image.fromarray(tile).save(sheets / f'{scene}-{cam}-{crop["name"]}-crop.png')
                    if other.exists():
                        ref = np.asarray(Image.open(other).convert('RGB'))
                        pair = np.concatenate([
                            tile,
                            ref[y:y + h, x:x + w],
                        ], axis=1)
                        Image.fromarray(pair).save(
                            sheets / f'{scene}-{cam}-{crop["name"]}-vs-{kind}.png')


if __name__ == '__main__':
    main()
