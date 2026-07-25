"""Generates the NEONAMP desktop icon.

Keeps the identity already set by the deck's favicon in public/index.html —
a dark rounded tile with a cyan play triangle — and gives it the neon
treatment the deck itself uses: a magenta chromatic fringe, a cyan bloom,
and faint scanlines on the sizes large enough to show them.

    python desktop/icon/make_icon.py

Writes neonamp.ico (Explorer, taskbar) and window-icon.rgba (the raw
64x64 RGBA the shell hands to tao for the window/alt-tab icon).
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).parent

# Deck palette, from public/style.css
VOID = (0x07, 0x04, 0x0F)
PANEL2 = (0x1A, 0x0F, 0x3A)
LINE2 = (0x3D, 0x2A, 0x75)
CYAN = (0x21, 0xE6, 0xC1)
MAG = (0xFF, 0x4F, 0x9A)

SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
SS = 8  # supersample factor; everything below is drawn at size * SS


def rounded_mask(n: int, radius: float) -> Image.Image:
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, n - 1, n - 1), radius, fill=255)
    return mask


def backdrop(n: int) -> Image.Image:
    """Vertical PANEL2 -> VOID gradient, the deck's panel shading."""
    grad = Image.new("RGB", (1, n))
    px = grad.load()
    for y in range(n):
        t = y / max(n - 1, 1)
        # ease toward VOID so the top stays lit and the bottom goes black
        t = t**0.85
        px[0, y] = tuple(round(a + (b - a) * t) for a, b in zip(PANEL2, VOID))
    return grad.resize((n, n), Image.NEAREST)


def triangle(n: int, dx: float = 0.0, dy: float = 0.0) -> list[tuple[float, float]]:
    """Play triangle, nudged right of centre so it reads as optically centred."""
    pts = [(0.365, 0.255), (0.365, 0.745), (0.755, 0.500)]
    return [((x + dx) * n, (y + dy) * n) for x, y in pts]


def render(size: int) -> Image.Image:
    n = size * SS
    detailed = size >= 48
    mask = rounded_mask(n, n * 0.225)

    tile = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    tile.paste(backdrop(n), (0, 0))
    tile.putalpha(mask)

    # ── magenta chromatic fringe, offset down-right behind the blade ──
    fringe = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(fringe).polygon(triangle(n, 0.028, 0.020), fill=(*MAG, 255))
    fringe = fringe.filter(ImageFilter.GaussianBlur(n * 0.028))
    tile.alpha_composite(Image.composite(fringe, Image.new("RGBA", (n, n)), mask))

    # ── cyan bloom ──
    bloom = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(bloom).polygon(triangle(n), fill=(*CYAN, 200))
    bloom = bloom.filter(ImageFilter.GaussianBlur(n * 0.045))
    tile.alpha_composite(Image.composite(bloom, Image.new("RGBA", (n, n)), mask))

    # ── the blade itself ──
    blade = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(blade).polygon(triangle(n), fill=(*CYAN, 255))
    if detailed:  # a touch of softening only where it won't cost sharpness
        blade = blade.filter(ImageFilter.GaussianBlur(n * 0.0015))
    tile.alpha_composite(blade)

    # ── scanlines: invisible clutter below 48px, texture above it ──
    if detailed:
        lines = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        d = ImageDraw.Draw(lines)
        step = max(int(n / size * 3), 3)
        for y in range(0, n, step):
            d.rectangle((0, y, n, y + step // 3), fill=(0, 0, 0, 46))
        tile.alpha_composite(Image.composite(lines, Image.new("RGBA", (n, n)), mask))

    # ── border, drawn last so nothing bleeds over it ──
    border = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        (0, 0, n - 1, n - 1),
        n * 0.225,
        outline=(*LINE2, 255),
        width=max(int(n * 0.016), SS // 2),
    )
    tile.alpha_composite(border)

    icon = tile.resize((size, size), Image.LANCZOS)
    # LANCZOS can leave faint halo pixels outside the rounded silhouette
    icon.putalpha(Image.composite(icon.getchannel("A"), Image.new("L", (size, size)),
                                  rounded_mask(size * 4, size * 4 * 0.225)
                                  .resize((size, size), Image.LANCZOS)))
    return icon


def main() -> None:
    frames = [render(s) for s in SIZES]

    ico = OUT / "neonamp.ico"
    frames[-1].save(ico, format="ICO", sizes=[(s, s) for s in SIZES])
    print(f"wrote {ico} ({ico.stat().st_size} bytes, {len(SIZES)} sizes)")

    window = render(64)
    raw = OUT / "window-icon.rgba"
    raw.write_bytes(window.tobytes())
    print(f"wrote {raw} (64x64 RGBA, {raw.stat().st_size} bytes)")

    # contact sheet, for eyeballing the small sizes
    sheet = Image.new("RGBA", (sum(s + 8 for s in SIZES), 264), (24, 24, 30, 255))
    x = 0
    for size, frame in zip(SIZES, frames):
        sheet.alpha_composite(frame, (x + 4, 260 - size))
        x += size + 8
    sheet.save(OUT / "preview.png")
    print(f"wrote {OUT / 'preview.png'}")


if __name__ == "__main__":
    main()
