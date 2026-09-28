"""PWA icons from the existing logo (web/components/Header.tsx's <Mark/>: a tyre with the water
standing at its hub). Redrawn with Pillow rather than rasterized from the SVG (no SVG renderer in
requirements.txt) -- same shapes, fixed brand colours instead of currentColor/var(--accent).

    python -m scripts.make_icons
"""
import pathlib
from PIL import Image, ImageDraw

BG = (7, 11, 16, 255)  # --bg (dark theme), web/app/globals.css
INK = (231, 238, 245, 255)  # near-white stroke, readable on BG at icon size
ACCENT = (103, 232, 249, 255)  # --accent (dark theme)
OUT = pathlib.Path(__file__).resolve().parent.parent / "web/public/icons"

SS = 4  # supersample factor for anti-aliasing


def draw_mark(size, pad_frac=0.0):
    """One tyre-and-waterline icon, `size`x`size`, with `pad_frac` empty margin on each side
    (maskable icons want ~10% safe-zone padding so platform masks don't clip the mark)."""
    s = size * SS
    img = Image.new("RGBA", (s, s), BG)
    d = ImageDraw.Draw(img)
    pad = s * pad_frac
    cx, cy, r = s / 2, s * 0.46, (s - 2 * pad) * 0.34
    ring_w = r * 0.34
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=INK, width=round(ring_w))
    hub = r * 0.24
    d.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=INK)
    water_top = cy + r * 0.55
    d.rectangle([pad, water_top, s - pad, s - pad], fill=(*ACCENT[:3], 90))
    d.line([(pad, water_top), (s - pad, water_top)], fill=ACCENT, width=round(s * 0.012))
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    draw_mark(192).save(OUT / "icon-192.png")
    draw_mark(512).save(OUT / "icon-512.png")
    draw_mark(512, pad_frac=0.1).save(OUT / "icon-maskable-512.png")
    draw_mark(180).convert("RGB").save(OUT / "apple-touch-icon.png")  # apple ignores alpha
    print(f"wrote icons to {OUT}")


if __name__ == "__main__":
    main()
