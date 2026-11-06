"""
Key-art comparison centre for scenario 03 NEON RAIN: puts a render next to the key art
(assets/textures/menu/night.jpg) and scores how close it is, region by region.

    python3 tools/night/compare_art.py render.png out_dir [--crop x0,y0,x1,y1] [--name tag]

Writes into out_dir:
  <tag>_side.png    art | render (scaled to the art's 1672 x 941)
  <tag>_blend.png   50 / 50 mix (positions line up when the image looks single)
  <tag>_edges.png   the render with the art's edges drawn over it in cyan
  <tag>_regions.png render with each named region boxed and scored
and prints a table: per region the mean colour difference (0 = identical, CIE76 dE in Lab) and
the brightness / warmth / saturation of art vs render, so a run says WHAT is off (too dark,
too blue, ...) and WHERE. Regions follow the key art's layout (lamp, mug, wheel, crates, ...).
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "..", "..", "assets", "textures", "menu", "night.jpg")
W, H = 1672, 941

# Named regions of the key art (x0, y0, x1, y1), the parts we model piece by piece.
REGIONS = {
    "lamp": (0, 0, 300, 230),
    "mug": (0, 320, 230, 580),
    "plantBL": (0, 600, 230, 941),
    "window": (300, 0, 1300, 110),
    "plantTR": (1400, 0, 1672, 150),
    "crates": (1450, 130, 1672, 470),
    "wheel": (1430, 420, 1672, 680),
    "pencil": (1460, 680, 1672, 941),
    "frameL": (170, 170, 340, 941),
    "frameB": (300, 820, 1560, 941),
    "frameR": (1250, 100, 1520, 830),
    "blocksTop": (340, 130, 1250, 380),
    "blocksL": (290, 380, 520, 820),
    "blocksR": (1080, 380, 1440, 640),
    "floor": (520, 450, 1250, 820),
    "tank": (760, 640, 900, 800),
}


def srgb_to_lab(img):
    a = img / 255.0
    a = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = a @ M.T
    xyz /= np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16
    A = 500 * (f[..., 0] - f[..., 1])
    B = 200 * (f[..., 1] - f[..., 2])
    return np.stack([L, A, B], -1)


def stats(img):
    lab = srgb_to_lab(img)
    L = lab[..., 0].mean()
    warm = (img[..., 0].mean() - img[..., 2].mean())
    sat = np.hypot(lab[..., 1], lab[..., 2]).mean()
    return L, warm, sat


def main():
    args = sys.argv[1:]
    render_path, out = args[0], args[1]
    tag = args[args.index("--name") + 1] if "--name" in args else "cmp"
    os.makedirs(out, exist_ok=True)
    art = Image.open(ART).convert("RGB").resize((W, H))
    ren = Image.open(render_path).convert("RGB").resize((W, H))
    a = np.asarray(art, np.float32)
    r = np.asarray(ren, np.float32)

    side = Image.new("RGB", (W * 2 + 8, H), (20, 20, 20))
    side.paste(art, (0, 0))
    side.paste(ren, (W + 8, 0))
    side.save(os.path.join(out, f"{tag}_side.png"))
    Image.blend(art, ren, 0.5).save(os.path.join(out, f"{tag}_blend.png"))

    edges = art.convert("L").filter(ImageFilter.GaussianBlur(1.2)).filter(ImageFilter.FIND_EDGES)
    e = np.asarray(edges, np.float32)
    e = (e > 28).astype(np.float32)
    over = r.copy()
    over[e > 0] = over[e > 0] * 0.3 + np.array([0, 255, 255]) * 0.7
    Image.fromarray(over.astype(np.uint8)).save(os.path.join(out, f"{tag}_edges.png"))

    la, lr = srgb_to_lab(a), srgb_to_lab(r)
    de = np.sqrt(((la - lr) ** 2).sum(-1))
    reg = ren.copy()
    d = ImageDraw.Draw(reg)
    print(f"{'region':10s} {'dE':>6s} | {'L art':>6s} {'L ren':>6s} | {'warm a':>7s} {'warm r':>7s} | {'sat a':>6s} {'sat r':>6s}")
    total = []
    for name, (x0, y0, x1, y1) in REGIONS.items():
        dd = de[y0:y1, x0:x1].mean()
        total.append(dd)
        La, wa, sa = stats(a[y0:y1, x0:x1])
        Lr, wr, sr = stats(r[y0:y1, x0:x1])
        print(f"{name:10s} {dd:6.1f} | {La:6.1f} {Lr:6.1f} | {wa:7.1f} {wr:7.1f} | {sa:6.1f} {sr:6.1f}")
        col = (80, 255, 120) if dd < 15 else (255, 210, 60) if dd < 25 else (255, 80, 80)
        d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=col, width=2)
        d.text((x0 + 4, y0 + 4), f"{name} {dd:.0f}", fill=col)
    print(f"{'ALL':10s} {de.mean():6.1f}   (mean of regions {np.mean(total):.1f})")
    reg.save(os.path.join(out, f"{tag}_regions.png"))


if __name__ == "__main__":
    main()
