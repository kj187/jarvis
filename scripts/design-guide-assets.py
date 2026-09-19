#!/usr/bin/env python3
"""Renders the illustrations of docs/design-system.md into docs/assets/design-*.svg.

Colours are read from frontend/src/generated/tokens.css (itself generated from design/tokens.json),
radii from design/tokens.json, and the logo from frontend/public/logo.png plus the mono variants in
design/assets — so the images cannot drift from the product. Each SVG is self-contained (images are
embedded as data URIs): it renders on GitHub, on the docs site and in an <img> tag.

Needs Pillow (`python3 -m pip install pillow`).

    python3 scripts/design-guide-assets.py            # write the SVGs
    python3 scripts/design-guide-assets.py --check    # fail if they are stale
"""
import base64
import colorsys
import io
import json
import re
import sys
from html import escape
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "frontend/src/generated/tokens.css"
TOKENS = ROOT / "design/tokens.json"
LOGO = ROOT / "frontend/public/logo.png"
MONO_DARK = ROOT / "design/assets/logo-mono-dark.svg"
MONO_LIGHT = ROOT / "design/assets/logo-mono-light.svg"
OUT = ROOT / "docs/assets"
FONT = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
W = 960
PAD = 32
INNER = W - 2 * PAD
SHEET_BG = "#12151c"
INK = "#e6eaf2"
INK2 = "#9aa4b5"
ROLES = ["critical", "warning", "info", "neutral", "success", "attention", "claim"]


# ── tokens ────────────────────────────────────────────────────────────────────
def parse_block(block):
    """{name: (h, s, l, alpha)} from `--color-x: hsl(H S% L%)` / `hsl(H S% L% / A)`."""
    out = {}
    for m in re.finditer(r"--color-([\w-]+):\s*hsl\((\d+) (\d+)% (\d+)%(?: / ([\d.]+))?\)", block):
        out[m.group(1)] = (float(m.group(2)), float(m.group(3)), float(m.group(4)), float(m.group(5) or 1))
    return out


def load_tokens():
    css = CSS.read_text()
    dark = parse_block(css[css.index("@theme"): css.index('[data-theme="light"]')])
    light = {**dark, **parse_block(css[css.index('[data-theme="light"]'):])}
    return dark, light


def rgb(c):
    h, s, l = c[0], c[1], c[2]
    r, g, b = colorsys.hls_to_rgb(h / 360, l / 100, s / 100)
    return round(r * 255), round(g * 255), round(b * 255)


def hexc(c):
    return "#%02x%02x%02x" % rgb(c)


def label(c):
    return "hsl(%d %d%% %d%%)" % (c[0], c[1], c[2])


def lum(c):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (f(v) for v in rgb(c))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ink_on(c):
    """Readable label colour on an opaque swatch."""
    return "#0b0d12" if lum(c) > 0.35 else "#f4f6fa"


# ── images ────────────────────────────────────────────────────────────────────
def png_uri(path, size=384):
    im = Image.open(path).convert("RGBA").resize((size, size), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def svg_uri(path):
    return "data:image/svg+xml;base64," + base64.b64encode(path.read_bytes()).decode()


# ── svg helpers ───────────────────────────────────────────────────────────────
class Sheet:
    def __init__(self, h, title, desc):
        self.w, self.h, self.parts, self.imgs = W, h, [], {}
        self.title, self.desc = title, desc

    def add(self, s):
        self.parts.append(s)

    def rect(self, x, y, w, h, fill, r=0, stroke=None, sw=1, dash=None, opacity=None):
        st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        da = f' stroke-dasharray="{dash}"' if dash else ""
        op = f' fill-opacity="{opacity}"' if opacity is not None else ""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{op}{st}{da}/>')

    def text(self, x, y, s, size=13, fill=INK, weight=400, anchor="start", mono=False, opacity=None):
        fam = MONO if mono else FONT
        op = f' opacity="{opacity}"' if opacity is not None else ""
        self.add(
            f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}"{op}>{escape(s)}</text>'
        )

    def image(self, uri, x, y, size):
        """Place a 384-unit image; each distinct image is embedded once per file and reused."""
        ident = self.imgs.setdefault(uri, f"img{len(self.imgs)}")
        self.add(f'<use href="#{ident}" transform="translate({x} {y}) scale({size / 384:.5f})"/>')

    def svg(self):
        body = "\n  ".join(self.parts)
        imgs = "".join(f'<image id="{i}" href="{u}" width="384" height="384"/>' for u, i in self.imgs.items())
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
            f'width="{self.w}" height="{self.h}" role="img" aria-labelledby="t d">\n'
            f'  <title id="t">{escape(self.title)}</title>\n'
            f'  <desc id="d">{escape(self.desc)}</desc>\n'
            f"  <defs>{imgs}</defs>\n"
            f'  <rect width="{self.w}" height="{self.h}" rx="16" fill="{SHEET_BG}"/>\n  {body}\n</svg>\n'
        )


def heading(sh, title, sub):
    sh.text(PAD, 44, title, 22, INK, 700)
    sh.text(PAD, 70, sub, 14, INK2)


# ── sheets ────────────────────────────────────────────────────────────────────
def sheet_banner(D, L, ctx):
    sh = Sheet(170, "Jarvis Design System",
               "The Jarvis owl logo with the words Design System and a row of the palette: product blue, coral, the status colours and the neutral surfaces.")
    sh.image(ctx["logo"], 28, 20, 130)
    sh.text(184, 76, "Jarvis Design System", 34, INK, 700)
    sh.text(184, 106, "One look for the app, the docs, screenshots and videos.", 15, INK2)
    chips = [D["link"], ctx["coral_d"], D["critical-solid"], D["warning-solid"], D["info-solid"], D["success-solid"], D["card"], D["control"]]
    for i, c in enumerate(chips):
        sh.rect(184 + i * 46, 126, 38, 22, hexc(c), 6, stroke="#3a4050")
    return sh


def sheet_logo(D, L, ctx):
    sh = Sheet(430, "The Jarvis logo",
               "The owl logo in colour on the dark and the light background, and its two one-colour variants: ink on light and ivory on dark.")
    heading(sh, "The logo", "Colour on both themes, and the one-colour variants for print and single-colour use.")
    gap = 14
    pw = (INNER - 3 * gap) / 4
    y0, ph = 96, 256
    tiles = [("Colour · dark", ctx["logo"], D["background"]), ("Colour · light", ctx["logo"], L["background"]),
             ("One colour · ink", ctx["mono_dark"], L["background"]), ("One colour · ivory", ctx["mono_light"], D["background"])]
    for i, (name, uri, bg) in enumerate(tiles):
        x = PAD + i * (pw + gap)
        sh.rect(x, y0, pw, ph, hexc(bg), 12, stroke="#2a2f3a")
        sh.image(uri, x + (pw - 176) / 2, y0 + 20, 176)
        sh.text(x + pw / 2, y0 + ph - 20, name, 14, ink_on(bg), 600, "middle")
    sh.text(PAD, 386, "The vector master is design/assets/logo.svg; every file here is derived from it.", 13, INK2)
    sh.text(PAD, 408, "Left eye product blue, right eye coral, outline #17121C, face #F2E6D4.", 13, INK2)
    return sh


def sheet_sizes(D, L, ctx):
    sh = Sheet(440, "The logo at small sizes",
               "The owl logo rendered at 128, 64, 48, 32, 24 and 16 pixels on the dark and the light background.")
    heading(sh, "The logo at real sizes", "Where it has to stay recognisable: header mark, favicon, touch icon.")
    sizes = [128, 64, 48, 32, 24, 16]
    y0, ph = 96, 156
    for row, (name, T) in enumerate([("Dark", D), ("Light", L)]):
        y = y0 + row * (ph + 12)
        sh.rect(PAD, y, INNER, ph, hexc(T["background"]), 12, stroke="#2a2f3a")
        sh.text(PAD + 20, y + 26, name, 14, ink_on(T["background"]), 600)
        x = 150
        for sz in sizes:
            sh.image(ctx["logo"], x, y + 14 + (128 - sz) / 2, sz)
            sh.text(x + sz / 2, y + ph - 10, f"{sz} px", 12, ink_on(T["background"]), 400, "middle", opacity=0.8)
            x += sz + 56
    return sh


def swatch_row(sh, T, x, y, names, w, h=76, gap=10):
    for i, n in enumerate(names):
        c = T[n]
        xx = x + i * (w + gap)
        sh.rect(xx, y, w, h, hexc(c), 10, stroke="#3a4050")
        ink = ink_on(c)
        sh.text(xx + 12, y + 26, n, 15, ink, 700)
        sh.text(xx + 12, y + 46, label(c), 12, ink, 400, mono=True, opacity=0.92)
        sh.text(xx + 12, y + 64, hexc(c), 12, ink, 400, mono=True, opacity=0.92)


def sheet_neutral(D, L, ctx):
    sh = Sheet(690, "Neutral colour tokens",
               "Swatches of the neutral surface, edge and text tokens in the dark and the light theme, with their HSL and hex values.")
    heading(sh, "Neutrals — surfaces and edges", "Values come from design/tokens.json.")
    sh.image(ctx["logo"], W - 88, 14, 56)
    w = (INNER - 30) / 4
    for row, (name, T) in enumerate([("Dark (default)", D), ("Light", L)]):
        y = 118 + row * 292
        sh.text(PAD, y - 12, name, 16, INK, 600)
        swatch_row(sh, T, PAD, y, ["background", "header", "card", "input"], w)
        swatch_row(sh, T, PAD, y + 86, ["muted", "accent", "border", "control"], w)
        bg = hexc(T["background"])
        sh.rect(PAD, y + 174, INNER, 64, bg, 10, stroke="#3a4050")
        sh.text(PAD + 20, y + 214, "foreground", 16, hexc(T["foreground"]), 600)
        sh.text(PAD + 150, y + 214, "muted-foreground", 16, hexc(T["muted-foreground"]), 400)
        sh.text(PAD + 340, y + 214, "link", 16, hexc(T["link"]), 600)
        sh.rect(PAD + 430, y + 188, 110, 36, "none", 7, stroke=hexc(T["ring"]), sw=2)
        sh.text(PAD + 485, y + 212, "ring", 14, hexc(T["ring"]), 600, "middle")
        sh.rect(PAD + 580, y + 188, 110, 36, bg, 7, stroke=hexc(T["control"]), sw=1.5)
        sh.text(PAD + 635, y + 212, "control", 14, hexc(T["foreground"]), 400, "middle")
    return sh


def sheet_brand(D, L, ctx):
    sh = Sheet(420, "Brand and interaction colours",
               "The owl logo next to the product blue and coral brand colours and the interaction colours in both themes.")
    heading(sh, "Brand and interaction", "Blue and coral are the logo's two eyes; coral is a sparing accent, never a status colour.")
    sh.rect(PAD, 96, 206, 300, hexc(D["background"]), 12, stroke="#2a2f3a")
    sh.image(ctx["logo"], PAD + 3, 112, 200)
    sh.text(PAD + 103, 340, "left eye → product blue", 13, INK, 600, "middle")
    sh.text(PAD + 103, 362, "right eye → coral", 13, INK, 600, "middle")
    x0, pitch = 262, 172

    def group(y, title, items, note=None):
        sh.text(x0, y, title, 16, INK, 600)
        if note:
            sh.text(x0 + 100, y, note, 12, INK2)
        for i, (name, cd, cl) in enumerate(items):
            xx = x0 + i * pitch
            for j, (c, tag) in enumerate(((cd, "dark"), (cl, "light"))):
                sh.rect(xx + j * 74, y + 12, 70, 66, hexc(c), 8, stroke="#3a4050")
                sh.text(xx + j * 74 + 8, y + 32, tag, 12, ink_on(c), 400, opacity=0.9)
                sh.text(xx + j * 74 + 8, y + 68, hexc(c), 11.5, ink_on(c), 400, mono=True, opacity=0.95)
            sh.text(xx, y + 98, name, 13, INK, 600)

    group(120, "Brand", [("Product blue", D["link"], L["link"]), ("Coral (site accent)", ctx["coral_d"], ctx["coral_l"])],
          "sparing; never a status colour")
    group(256, "Interaction", [("focus ring", D["ring"], L["ring"]), ("field edge", D["control"], L["control"])])
    return sh


def sheet_status(D, L, ctx):
    sh = Sheet(560, "Status roles",
               "The seven status roles, each with text, fill, edge and solid colour, shown as a badge in the dark and the light theme.")
    heading(sh, "Status roles", "Text on a tinted fill with an edge, plus a solid for dots and stripes. Text is at least 4.5:1 on its fill.")
    y0 = 96
    colw = INNER / 2
    for col, (name, T) in enumerate([("Dark", D), ("Light", L)]):
        x = PAD + col * colw + (8 if col else 0)
        w = colw - 8
        sh.rect(x, y0, w, 440, hexc(T["card"]), 12, stroke="#2a2f3a")
        sh.text(x + 20, y0 + 28, name, 14, hexc(T["muted-foreground"]), 600)
        for i, role in enumerate(ROLES):
            y = y0 + 48 + i * 55
            soft, edge, fg, solid = T[f"{role}-soft"], T[f"{role}-edge"], T[f"{role}-fg"], T[f"{role}-solid"]
            sh.text(x + 20, y + 22, role, 13, hexc(T["foreground"]), 600)
            bx = x + 130
            sh.rect(bx, y, 110, 32, hexc(soft), 6, stroke=hexc(edge), sw=1, opacity=soft[3])
            sh.text(bx + 55, y + 21, role.capitalize(), 13, hexc(fg), 700, "middle")
            sh.add(f'<circle cx="{bx + 132}" cy="{y + 16}" r="6" fill="{hexc(solid)}"/>')
            sh.rect(bx + 150, y + 1, 4, 30, hexc(solid), 2)
    return sh


def sheet_states(D, L, ctx):
    sh = Sheet(470, "Control states",
               "A text field with its edge, the same field focused with the two pixel ring, toggles in off and on state, buttons and meaningful versus decorative muted text, in dark and light.")
    heading(sh, "Controls — what the accessibility rules look like",
            "Field edge and focus ring ≥ 3:1, visible off-state track, muted text at full strength.")
    sh.image(ctx["logo"], W - 88, 14, 56)
    for row, (name, T) in enumerate([("Dark", D), ("Light", L)]):
        y = 96 + row * 184
        sh.rect(PAD, y, INNER, 170, hexc(T["card"]), 12, stroke="#2a2f3a")
        sh.text(PAD + 20, y + 26, name, 13, hexc(T["muted-foreground"]), 600)
        fg, mut, bg = hexc(T["foreground"]), hexc(T["muted-foreground"]), hexc(T["background"])
        x = PAD + 20
        sh.text(x, y + 54, "Field", 12, mut)
        sh.rect(x, y + 64, 170, 36, bg, 6, stroke=hexc(T["control"]), sw=1)
        sh.text(x + 12, y + 88, "Search alerts…", 13, mut)
        x2 = x + 190
        sh.text(x2, y + 54, "Field, focused", 12, mut)
        sh.rect(x2, y + 64, 170, 36, bg, 6, stroke=hexc(T["control"]), sw=1)
        sh.rect(x2 - 1, y + 63, 172, 38, "none", 7, stroke=hexc(T["ring"]), sw=2)
        sh.text(x2 + 12, y + 88, "severity=critical", 13, fg)
        x3 = x2 + 190
        sh.text(x3, y + 54, "Toggle off / on", 12, mut)
        sh.rect(x3, y + 72, 44, 24, hexc(T["control"]), 12)
        sh.rect(x3 + 4, y + 76, 16, 16, bg, 8)
        sh.rect(x3 + 54, y + 72, 44, 24, hexc(T["primary"]), 12)
        sh.rect(x3 + 78, y + 76, 16, 16, bg, 8)
        x4 = x3 + 122
        sh.text(x4, y + 54, "Text", 12, mut)
        sh.text(x4, y + 78, "foreground", 13, fg, 600)
        sh.text(x4, y + 98, "muted, meaningful", 13, mut)
        sh.text(x4, y + 118, "decorative only", 13, mut, opacity=0.45)
        sh.text(x, y + 136, "Buttons", 12, mut)
        sh.rect(x + 66, y + 118, 120, 36, hexc(T["primary"]), 6)
        sh.text(x + 126, y + 141, "Create silence", 12.5, hexc(T["primary-foreground"]), 600, "middle")
        sh.rect(x + 196, y + 118, 80, 36, "none", 6, stroke=hexc(T["border"]), sw=1)
        sh.text(x + 236, y + 141, "Cancel", 12.5, fg, 400, "middle")
        sh.rect(x + 286, y + 118, 120, 36, hexc(T["primary"]), 6)
        sh.rect(x + 284, y + 116, 124, 40, "none", 8, stroke=hexc(T["ring"]), sw=2)
        sh.text(x + 346, y + 141, "Focused", 12.5, hexc(T["primary-foreground"]), 600, "middle")
    return sh


def sheet_radii(D, L, ctx):
    sh = Sheet(300, "Corner radius roles",
               "The five corner radius roles: compact, control, surface, overlay and pill, each shown as a box with its value.")
    heading(sh, "Corner radii", "Five roles instead of one-off values: rounded-compact … rounded-pill.")
    uses = {"compact": "chips, table cells", "control": "fields, buttons", "surface": "cards, panels",
            "overlay": "dialogs, floating layers", "pill": "badges, dots"}
    w = (INNER - 4 * 14) / 5
    for i, (name, val) in enumerate(ctx["radii"].items()):
        x = PAD + i * (w + 14)
        px = 9999 if name == "pill" else round(float(val.replace("rem", "")) * 16)
        sh.rect(x, 100, w, 96, hexc(D["card"]), min(px, 48), stroke=hexc(D["control"]), sw=1.5)
        sh.text(x + w / 2, 156, "pill" if name == "pill" else f"{px} px", 16, INK, 700, "middle")
        sh.text(x + w / 2, 226, f"rounded-{name}", 13, INK, 600, "middle")
        sh.text(x + w / 2, 246, uses[name], 12, INK2, 400, "middle")
    return sh


def sheet_header(D, L, ctx):
    sh = Sheet(430, "The app header with the owl mark",
               "The compact app header at 44 pixels height, shown at 1.3 times, with the small owl mark before the Alerts and Silences tabs, in dark and light, above a sample alert card.")
    heading(sh, "The header", "The owl mark sits before the tabs at the real 44 px header height (shown 1.3×).")
    k = 1.3
    Wl = INNER / k
    for row, (name, T) in enumerate([("Dark", D), ("Light", L)]):
        y = 100 + row * 160
        fg, mut = hexc(T["foreground"]), hexc(T["muted-foreground"])
        sh.text(PAD, y + 12, name, 13, INK2, 600)
        g = []

        def r(x, yy, w, h, fill, rad=0, stroke=None):
            st = f' stroke="{stroke}"' if stroke else ""
            g.append(f'<rect x="{x}" y="{yy}" width="{w}" height="{h}" rx="{rad}" fill="{fill}"{st}/>')

        def t(x, yy, txt, size, fill, weight=400):
            g.append(f'<text x="{x}" y="{yy}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{fill}">{escape(txt)}</text>')

        r(0, 0, Wl, 96, hexc(T["background"]), 8)
        r(0, 0, Wl, 44, hexc(T["header"]), 8)
        r(0, 8, Wl, 36, hexc(T["header"]))
        r(0, 43, Wl, 1, hexc(T["border"]))
        ident = sh.imgs.setdefault(ctx["logo"], f"img{len(sh.imgs)}")
        g.append(f'<use href="#{ident}" transform="translate(10 8) scale({28 / 384:.5f})"/>')
        r(52, 8, 84, 36, hexc(T["background"]), 3, hexc(T["border"]))
        g.append(f'<circle cx="66" cy="27" r="3" fill="{hexc(T["attention-solid"])}"/>')
        t(75, 31, "Alerts  12", 12, fg, 600)
        g.append(f'<circle cx="154" cy="27" r="3" fill="{hexc(T["info-solid"])}"/>')
        t(163, 31, "Silences  3", 12, mut, 600)
        g.append(f'<circle cx="{Wl - 230}" cy="22" r="3.5" fill="{hexc(T["success-solid"])}"/>')
        t(Wl - 221, 26, "2/2", 12, mut)
        r(Wl - 130, 9, 118, 26, hexc(T["primary"]), 5)
        t(Wl - 121, 26, "Create silence", 12, hexc(T["primary-foreground"]), 600)
        r(12, 54, Wl - 24, 34, hexc(T["card"]), 6, hexc(T["border"]))
        r(12, 54, 3, 34, hexc(T["critical-solid"]), 1)
        t(26, 75, "KubePodCrashLooping", 12, fg, 600)
        t(180, 75, "severity=critical · cluster=prod-eu", 11.5, mut)
        sh.add(f'<g transform="translate({PAD} {y + 22}) scale({k})">' + "".join(g) + "</g>")
    return sh


SHEETS = {
    "design-banner": sheet_banner,
    "design-logo": sheet_logo,
    "design-logo-sizes": sheet_sizes,
    "design-colors-neutral": sheet_neutral,
    "design-colors-brand": sheet_brand,
    "design-status": sheet_status,
    "design-states": sheet_states,
    "design-radii": sheet_radii,
    "design-header": sheet_header,
}


def main():
    check = "--check" in sys.argv
    D, L = load_tokens()
    tokens = json.loads(TOKENS.read_text())

    def hsl4(v):
        h, s, l = (float(x.rstrip("%")) for x in v.split())
        return (h, s, l, 1.0)

    ctx = {
        "logo": png_uri(LOGO),
        "mono_dark": svg_uri(MONO_DARK),
        "mono_light": svg_uri(MONO_LIGHT),
        "coral_d": hsl4(tokens["brand"]["coral"]["dark"]),
        "coral_l": hsl4(tokens["brand"]["coral"]["light"]),
        "radii": tokens["radius"],
    }
    stale = []
    for name, build in SHEETS.items():
        svg = build(D, L, ctx).svg()
        path = OUT / f"{name}.svg"
        if check:
            if not path.exists() or path.read_text() != svg:
                stale.append(path.name)
        else:
            path.write_text(svg)
            print(f"wrote {path.relative_to(ROOT)} ({len(svg) // 1024} KB)")
    if check and stale:
        sys.exit("stale design guide assets: " + ", ".join(stale) + " — run scripts/design-guide-assets.py")


if __name__ == "__main__":
    main()
