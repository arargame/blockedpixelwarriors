"""
NEON RAIN: the street plate behind the window, taken from the key art itself.

The window plane shows a plate projected from the art camera. Its top frame is built here:
  - where the key art shows the street (above the tray's far beam, between the lamp, the plant and
    the crates) the art's own pixels are used - 1:1 with the art;
  - the title logo, the lamp, the plant and everything below the window line are filled in: the
    holes are inpainted from the art round them (OpenCV Telea) and blurred like the rest of the
    defocused street, and the parts below the window line come from the Blender plate
    (assets/textures/night/backdrop.jpg, build_night_backdrop.py) colour-matched to the art.

  python3 tools/night/build_art_plate.py   ->  assets/textures/night/backdrop_art.jpg
                                              (+ captures/night/art_plate_mask.png)
"""
import os
import cv2
import numpy as np

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
ART = os.path.join(ROOT, 'assets/textures/menu/night.jpg')
BLENDER = os.path.join(ROOT, 'assets/textures/night/backdrop.jpg')
OUT = os.path.join(ROOT, 'assets/textures/night/backdrop_art.jpg')

# The art's window line (x, y): above it the street shows, below it the desk and the tray.
WINDOW_LINE = [(0, 150), (280, 158), (700, 128), (1310, 88), (1450, 108), (1672, 100)]
# Foreground in front of the street in the art: the title logo, the lamp, the plant.
HOLES = [(540, 22, 1098, 262), (0, 0, 268, 340), (1398, 0, 1672, 222)]


def main():
    art = cv2.imread(ART)
    h, w = art.shape[:2]
    base = cv2.imread(BLENDER)
    base = cv2.resize(base, (w, h), interpolation=cv2.INTER_AREA)

    street = np.zeros((h, w), np.uint8)
    xs, ys = zip(*WINDOW_LINE)
    line = np.interp(np.arange(w), xs, ys)
    for x in range(w):
        street[: int(line[x]), x] = 255
    holes = np.zeros((h, w), np.uint8)
    for x0, y0, x1, y1 in HOLES:
        holes[y0:y1, x0:x1] = 255
    keep = cv2.bitwise_and(street, cv2.bitwise_not(holes))

    # Blender plate graded to the art's street (per-channel mean / std over the kept pixels).
    k = keep > 0
    graded = base.astype(np.float32)
    for c in range(3):
        a = art[..., c][k].astype(np.float32)
        b = base[..., c][k].astype(np.float32)
        graded[..., c] = (graded[..., c] - b.mean()) / (b.std() + 1e-3) * a.std() + a.mean()
    graded = np.clip(graded, 0, 255).astype(np.uint8)

    # Fill the holes from the art round them, then defocus them like the street.
    fill = art.copy()
    fill[k == 0] = graded[k == 0]
    hole_mask = cv2.bitwise_and(street, holes)
    inpainted = cv2.inpaint(fill, hole_mask, 21, cv2.INPAINT_TELEA)
    soft = cv2.GaussianBlur(inpainted, (0, 0), 14)
    hm = cv2.GaussianBlur(hole_mask.astype(np.float32) / 255, (0, 0), 6)[..., None]
    plate = inpainted.astype(np.float32) * (1 - hm) + soft.astype(np.float32) * hm

    # Below the window line: the Blender plate, feathered into the art over ~24 px.
    km = cv2.GaussianBlur(street.astype(np.float32) / 255, (0, 0), 10)[..., None]
    plate = plate * km + graded.astype(np.float32) * (1 - km)
    plate = np.clip(plate, 0, 255).astype(np.uint8)
    cv2.imwrite(OUT, plate, [cv2.IMWRITE_JPEG_QUALITY, 92])
    cap = os.path.join(ROOT, 'captures/night')
    os.makedirs(cap, exist_ok=True)
    cv2.imwrite(os.path.join(cap, 'art_plate_mask.png'), np.dstack([keep, hole_mask, street]))
    print('wrote', OUT)


if __name__ == '__main__':
    main()
