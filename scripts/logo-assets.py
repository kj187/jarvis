#!/usr/bin/env python3
"""Derives every raster and variant of the Jarvis logo from the vector master.

Source of truth:   design/assets/logo.svg
Derived (do not edit or resize by hand):
    frontend/public/logo.png              1024 x 1024, transparent
    frontend/public/favicon-16x16.png     16 x 16
    frontend/public/favicon-32x32.png     32 x 32
    frontend/public/favicon.ico           16, 32 and 48 px
    frontend/public/apple-touch-icon.png  180 x 180
    design/assets/logo-mono-dark.svg      one colour (ink), for light backgrounds
    design/assets/logo-mono-light.svg     one colour (ivory), for dark backgrounds

The master only uses absolute M/C/Z paths, translate() and circles, so it is
rasterised here with Pillow (4x supersampled) — no browser or Inkscape needed.

Needs Pillow (`python3 -m pip install pillow`).

    python3 scripts/logo-assets.py            # write the derived files
    python3 scripts/logo-assets.py --check    # fail if any of them is stale
"""
import io
import re
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "design/assets/logo.svg"
PUBLIC = ROOT / "frontend/public"
ASSETS = ROOT / "design/assets"
SS = 4  # supersampling factor
BIG = 1024 * SS
INK, IVORY = "#17121C", "#F2E6D4"
TOKEN = re.compile(r"[MCZ]|-?\d+\.?\d*")


# ── parse the master ──────────────────────────────────────────────────────────
def hex_rgba(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def parse_master(svg):
    """Return [(kind, id_or_class, fill, geometry)] in document order."""
    out = []
    for m in re.finditer(r"<(path|circle)\b([^>]*)/>", svg):
        kind, attrs = m.group(1), m.group(2)
        a = dict(re.findall(r'([\w-]+)="([^"]*)"', attrs))
        name = a.get("id") or a.get("class")
        if kind == "circle":
            out.append(("circle", name, a["fill"], (float(a["cx"]), float(a["cy"]), float(a["r"])), a))
            continue
        tx = ty = 0.0
        t = re.match(r"translate\(([-\d.]+)[, ]+([-\d.]+)\)", a.get("transform", ""))
        if t:
            tx, ty = float(t.group(1)), float(t.group(2))
        out.append(("path", name, a["fill"], flatten(a["d"], tx, ty), a))
    return out


def flatten(d, tx, ty, steps=24):
    """M/C/Z path data -> list of polylines (each a list of (x, y))."""
    toks = TOKEN.findall(d)
    polys, cur, i = [], [], 0
    pos = (0.0, 0.0)
    while i < len(toks):
        c = toks[i]
        if c == "M":
            if cur:
                polys.append(cur)
            pos = (float(toks[i + 1]) + tx, float(toks[i + 2]) + ty)
            cur = [pos]
            i += 3
        elif c == "C":
            i += 1
            # a C command may be followed by several implicit coordinate sextets
            while i < len(toks) and toks[i] not in "MCZ":
                x1, y1, x2, y2, x, y = (float(v) for v in toks[i:i + 6])
                p0, p1, p2, p3 = pos, (x1 + tx, y1 + ty), (x2 + tx, y2 + ty), (x + tx, y + ty)
                for s in range(1, steps + 1):
                    u = s / steps
                    k = 1 - u
                    cur.append((
                        k ** 3 * p0[0] + 3 * k * k * u * p1[0] + 3 * k * u * u * p2[0] + u ** 3 * p3[0],
                        k ** 3 * p0[1] + 3 * k * k * u * p1[1] + 3 * k * u * u * p2[1] + u ** 3 * p3[1],
                    ))
                pos = p3
                i += 6
        else:  # Z
            i += 1
    if cur:
        polys.append(cur)
    return polys


# ── rasterise ─────────────────────────────────────────────────────────────────
def render_big(elements):
    im = Image.new("RGBA", (BIG, BIG), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    for kind, _name, fill, geom, _a in elements:
        rgba = hex_rgba(fill)
        if kind == "circle":
            cx, cy, r = (v * SS for v in geom)
            dr.ellipse([cx - r, cy - r, cx + r, cy + r], fill=rgba)
        else:
            for poly in geom:
                dr.polygon([(x * SS, y * SS) for x, y in poly], fill=rgba)
    return im


def fit(big, size, pad, bbox):
    """Crop to the logo's bounding box, fit it into size - 2*pad, centre on a transparent square."""
    crop = big.crop(bbox)
    inner = size - 2 * pad
    scale = inner / max(crop.size)
    w, h = max(1, round(crop.width * scale)), max(1, round(crop.height * scale))
    small = crop.resize((w, h), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(small, ((size - w) // 2, (size - h) // 2))
    return canvas


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def ico_bytes(images):
    """PNG-compressed ICO container with one entry per image."""
    blobs = [png_bytes(i) for i in images]
    head = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b""
    for img, blob in zip(images, blobs):
        w = img.width if img.width < 256 else 0
        entries += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    return head + entries + b"".join(blobs)


# ── mono variants ─────────────────────────────────────────────────────────────
def mono_svg(master_svg, color, label):
    """Single-colour version: outline and beak in `color`, face/eyes/ear cup/arcs knocked out."""
    knock = re.findall(r'<(?:path|circle)\b[^>]*(?:class="(?:face|ear-cup|headset-arc)"|id="(?:left-eye|right-eye)")[^>]*/>', master_svg)
    lights = re.findall(r'<circle\b[^>]*id="(?:left|right)-highlight"[^>]*/>', master_svg)
    beak = re.findall(r'<path\b[^>]*class="beak"[^>]*/>', master_svg)
    sil = re.findall(r'<path\b[^>]*id="silhouette"[^>]*/>', master_svg)[0]
    sub = lambda s, f: re.sub(r'fill="#[0-9A-Fa-f]{6}"', f'fill="{f}"', s)
    masked = sub(sil, color).replace("<path ", '<path mask="url(#k)" ', 1)
    body = "\n".join(
        [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-labelledby="t">',
            f'  <title id="t">Jarvis ({label})</title>',
            "  <defs>",
            '    <mask id="k" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">',
            '      <rect width="1024" height="1024" fill="#fff"/>',
            *[f"      {sub(k, '#000')}" for k in knock],
            *[f"      {sub(k, '#fff')}" for k in lights],
            "    </mask>",
            "  </defs>",
            f"  {masked}",
            *[f"  {sub(b, color)}" for b in beak],
            *[f"  {sub(k, color)}" for k in lights],
            "</svg>",
            "",
        ]
    )
    return body


# ── main ──────────────────────────────────────────────────────────────────────
def outputs():
    master_svg = MASTER.read_text()
    elements = parse_master(master_svg)
    big = render_big(elements)
    bbox = tuple(v for v in big.split()[3].getbbox())
    files = {}
    files[PUBLIC / "logo.png"] = png_bytes(big.resize((1024, 1024), Image.LANCZOS))
    f16 = fit(big, 16, 0, bbox)
    f32 = fit(big, 32, 1, bbox)
    f48 = fit(big, 48, 1, bbox)
    files[PUBLIC / "favicon-16x16.png"] = png_bytes(f16)
    files[PUBLIC / "favicon-32x32.png"] = png_bytes(f32)
    files[PUBLIC / "favicon.ico"] = ico_bytes([f16, f32, f48])
    files[PUBLIC / "apple-touch-icon.png"] = png_bytes(fit(big, 180, 7, bbox))
    files[ASSETS / "logo-mono-dark.svg"] = mono_svg(master_svg, INK, "mono, for light backgrounds").encode()
    files[ASSETS / "logo-mono-light.svg"] = mono_svg(master_svg, IVORY, "mono, for dark backgrounds").encode()
    return files


def same(path, data):
    if not path.exists():
        return False
    if path.suffix == ".png":  # compare pixels, not encoder output
        return Image.open(path).convert("RGBA").tobytes() == Image.open(io.BytesIO(data)).convert("RGBA").tobytes()
    return path.read_bytes() == data


def main():
    check = "--check" in sys.argv
    files = outputs()
    stale = []
    for path, data in files.items():
        if check:
            if not same(path, data):
                stale.append(str(path.relative_to(ROOT)))
        else:
            path.write_bytes(data)
            print(f"wrote {path.relative_to(ROOT)} ({len(data) // 1024 or 1} KB)")
    if check and stale:
        sys.exit("stale logo assets: " + ", ".join(stale) + " — run scripts/logo-assets.py")


if __name__ == "__main__":
    main()
