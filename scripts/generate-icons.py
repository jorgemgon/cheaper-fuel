"""Generate the PWA icons (192, 512 and a maskable 512).

Run once; the PNGs are committed under web/public.
    python scripts/generate-icons.py
"""
from __future__ import annotations

import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "web", "public"))

BACKGROUND = (11, 15, 20, 255)
GREEN = (70, 211, 154)
AMBER = (240, 180, 41)
INK = (5, 32, 47, 255)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arialbd.ttf",
    r"C:\Windows\Fonts\segoeuib.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def gradient(size: int) -> Image.Image:
    column = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        column.putpixel(
            (0, y),
            (
                round(GREEN[0] + (AMBER[0] - GREEN[0]) * t),
                round(GREEN[1] + (AMBER[1] - GREEN[1]) * t),
                round(GREEN[2] + (AMBER[2] - GREEN[2]) * t),
            ),
        )
    return column.resize((size, size))


def build(size: int, scale: float) -> Image.Image:
    image = Image.new("RGBA", (size, size), BACKGROUND)
    draw = ImageDraw.Draw(image)

    radius = int(size * 0.22)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BACKGROUND, outline=(34, 48, 61, 255), width=max(1, size // 128))

    disc = int(size * scale)
    offset = (size - disc) // 2

    mask = Image.new("L", (disc, disc), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, disc - 1, disc - 1], fill=255)
    image.paste(gradient(disc), (offset, offset), mask)

    font = load_font(int(disc * 0.56))
    text = "€"
    box = draw.textbbox((0, 0), text, font=font)
    text_width = box[2] - box[0]
    text_height = box[3] - box[1]
    draw.text(
        (size / 2 - text_width / 2 - box[0], size / 2 - text_height / 2 - box[1]),
        text,
        font=font,
        fill=INK,
    )

    return image


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    build(192, 0.62).save(os.path.join(OUT_DIR, "icon-192.png"))
    build(512, 0.62).save(os.path.join(OUT_DIR, "icon-512.png"))
    # Maskable icons need the artwork inside the 80% safe zone.
    build(512, 0.50).save(os.path.join(OUT_DIR, "maskable-512.png"))
    print(f"Wrote icons to {OUT_DIR}")


if __name__ == "__main__":
    main()
