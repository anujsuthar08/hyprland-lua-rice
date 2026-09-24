#!/usr/bin/env python3
"""Generate assets/default-wallpaper.jpg: a dark mesh-gradient wallpaper.

Purely procedural (my own maths, no third-party artwork), so it carries no licence
problem and a fresh clone has something to theme from. Deterministic: same seed, same
image. Several distinct hues on purpose — matugen picks its palette from the most
saturated colours, so a one-hue image gives a flat theme.

  scripts/gen-default-wallpaper.py [out.jpg] [width height]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "assets" / "default-wallpaper.jpg"
W, H = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 4 else (2560, 1440)
rng = np.random.default_rng(7)

y, x = np.mgrid[0:H, 0:W].astype(np.float32)
x /= W
y /= H
aspect = W / H

img = np.zeros((H, W, 3), np.float32)
img[:] = (0.035, 0.040, 0.075)  # deep blue-black base

# (cx, cy, radius, colour, strength): soft glows spread over the frame
blobs = [
    (0.18, 0.25, 0.55, (0.30, 0.34, 0.95), 0.85),   # indigo, top left
    (0.80, 0.20, 0.45, (0.85, 0.28, 0.62), 0.70),   # magenta, top right
    (0.62, 0.85, 0.60, (0.10, 0.62, 0.78), 0.75),   # teal, bottom
    (0.05, 0.90, 0.40, (0.55, 0.22, 0.85), 0.55),   # violet, bottom left
    (0.95, 0.75, 0.35, (0.95, 0.55, 0.30), 0.35),   # warm accent, right edge
]
for cx, cy, r, col, s in blobs:
    d2 = ((x - cx) * aspect) ** 2 + (y - cy) ** 2
    g = np.exp(-d2 / (2 * (r / 2.2) ** 2)) * s
    img += g[..., None] * np.array(col, np.float32)

# gentle vignette, then a touch of grain so the gradients do not band
v = 1.0 - 0.45 * (((x - 0.5) * aspect) ** 2 + (y - 0.5) ** 2)
img *= np.clip(v, 0.4, 1.0)[..., None]
img = 1 - np.exp(-img * 1.35)                      # soft tone-map, keeps highlights from clipping
img += rng.normal(0, 0.006, img.shape).astype(np.float32)

out.parent.mkdir(parents=True, exist_ok=True)
Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(out, quality=92, subsampling=0, optimize=True)
print(f"wrote {out} ({W}x{H}, {out.stat().st_size // 1024} KiB)")
