#!/usr/bin/env python3
"""Renders the illustrations of docs/design-system.md into docs/assets/design-*.svg.

The colours are read from design/tokens.json, so the palette in the guide
cannot drift from the app. Each SVG is self-contained (the logo is embedded as
a data URI) so it renders in GitHub, on the website and in an <img> tag.

The "planned" logo is a preview: the left eye of frontend/public/logo.png is
hue-shifted to the product blue. It is replaced by the real asset once the
vector master exists (docs/design-system.md, section Logo).

Needs Pillow (`python3 -m pip install pillow`).

    python3 scripts/design-guide-assets.py            # write the SVGs
    python3 scripts/design-guide-assets.py --check    # fail if they are stale
"""
import base64
import colorsys
import io
import re
import sys
from html import escape
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "frontend/src/generated/tokens.css"
LOGO = ROOT / "frontend/public/logo.png"
OUT = ROOT / "docs/assets"
FONT = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"


# ── tokens ────────────────────────────────────────────────────────────────────
def parse_block(block):
    return {
        m.group(1): tuple(float(v) for v in m.groups()[1:])
        for m in re.finditer(r"--color-([\w-]+):\s*hsl\((\d+) (\d+)% (\d+)%\)", block)
    }


def load_tokens():
    css = CSS.read_text()
    dark_block = css[css.index("@theme"): css.index('[data-theme="light"]')]
    light_block = css[css.index('[data-theme="light"]'):]
    dark = parse_block(dark_block)
    light = {**dark, **parse_block(light_block)}
    return dark, light


def rgb(hsl):
    h, s, l = hsl
    r, g, b = colorsys.hls_to_rgb(h / 360, l / 100, s / 100)
    return round(r * 255), round(g * 255), round(b * 255)


def hexc(hsl):
    return "#%02x%02x%02x" % rgb(hsl)


def label(hsl):
    return "hsl(%d %d%% %d%%)" % hsl


def lum(hsl):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (f(v) for v in rgb(hsl))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ink_on(hsl):
    """Readable label colour on a swatch."""
    return "#0b0d12" if lum(hsl) > 0.35 else "#f4f6fa"


# ── logo ──────────────────────────────────────────────────────────────────────
def load_logos():
    src = Image.open(LOGO).convert("RGBA")
    alpha = src.split()[3]
    hsv = src.convert("RGB").convert("HSV")
    h, s, v = hsv.split()

    def mask(pred):
        hm = h.point(lambda x: 255 if pred(x) else 0)
        sm = s.point(lambda x: 255 if x > 38 else 0)
        return ImageChops.multiply(hm, sm)

    teal = mask(lambda x: 95 <= x <= 140)
    shift = round(213 / 360 * 255) - round(168 / 360 * 255)
    h2 = h.point(lambda x: (x + shift) % 256)
    s2 = s.point(lambda x: min(255, int(x * 1.5)))
    planned = Image.merge(
        "HSV", (Image.composite(h2, h, teal), Image.composite(s2, s, teal), v)
    ).convert("RGB")
    planned.putalpha(alpha)

    def uri(im, size=384):
        buf = io.BytesIO()
        im.resize((size, size), Image.LANCZOS).save(buf, "PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    return uri(src), uri(planned)


# ── svg helpers ───────────────────────────────────────────────────────────────
class Sheet:
    def __init__(self, w, h, title, desc):
        self.w, self.h, self.parts, self.defs, self.imgs = w, h, [], [], {}
        self.title, self.desc = title, desc

    def add(self, s):
        self.parts.append(s)

    def rect(self, x, y, w, h, fill, r=0, stroke=None, sw=1, dash=None):
        st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        da = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{st}{da}/>')

    def text(self, x, y, s, size=13, fill="#e6eaf2", weight=400, anchor="start", mono=False, opacity=None):
        fam = MONO if mono else FONT
        op = f' opacity="{opacity}"' if opacity is not None else ""
        self.add(
            f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}"{op}>{escape(s)}</text>'
        )

    def image(self, uri, x, y, size):
        """Place the (384 px) logo; each distinct image is embedded once per file and reused."""
        ident = self.imgs.setdefault(uri, f"logo{len(self.imgs)}")
        self.add(f'<use href="#{ident}" transform="translate({x} {y}) scale({size / 384:.5f})"/>')

    def svg(self):
        body = "\n  ".join(self.parts)
        imgs = "".join(f'<image id="{i}" href="{u}" width="384" height="384"/>' for u, i in self.imgs.items())
        self.defs.insert(0, imgs)
        defs = "  <defs>" + "".join(self.defs) + "</defs>\n"
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
            f'width="{self.w}" height="{self.h}" role="img" aria-labelledby="t d">\n'
            f"  <title id=\"t\">{escape(self.title)}</title>\n"
            f"  <desc id=\"d\">{escape(self.desc)}</desc>\n"
            f"{defs}"
            f'  <rect width="{self.w}" height="{self.h}" rx="16" fill="{SHEET_BG}"/>\n  {body}\n</svg>\n'
        )


SHEET_BG = "#12151c"
INK = "#e6eaf2"
INK2 = "#9aa4b5"


def heading(sh, title, sub):
    sh.text(32, 44, title, 20, INK, 700)
    sh.text(32, 68, sub, 13, INK2)


# ── sheets ────────────────────────────────────────────────────────────────────
# All sheets are 960 px wide: the docs column is narrow, so type stays >= 12 px.
W = 960
PAD = 32
INNER = W - 2 * PAD  # 896


def heading(sh, title, sub):
    sh.text(PAD, 44, title, 22, INK, 700)
    sh.text(PAD, 70, sub, 14, INK2)


def sheet_banner(D, L, plan):
    sh = Sheet(W, 170, "Jarvis Design System",
               "The Jarvis owl logo with the words Design System and a row of the palette: product blue, coral, the status colours and the neutral surfaces.")
    sh.image(plan, 28, 20, 130)
    sh.text(184, 76, "Jarvis Design System", 34, INK, 700)
    sh.text(184, 106, "One look for the app, the docs, screenshots and videos.", 15, INK2)
    chips = [D["link"], (6, 68, 60), D["severity-critical"], D["severity-warning"], D["severity-info"],
             D["card"], D["muted"], D["control"]]
    for i, c in enumerate(chips):
        sh.rect(184 + i * 46, 126, 38, 22, hexc(c), 6, stroke="#3a4050")
    return sh


def sheet_logo(D, L, cur, plan):
    sh = Sheet(W, 430, "Jarvis logo: today and planned",
               "The owl logo with its teal and coral eyes today, and the planned version with the left eye in product blue, each on the dark and the light background.")
    heading(sh, "Logo — today and planned", "Left: what ships now. Right: left eye to product blue, coral eye stays.")
    gap, mid = 14, 28
    pw = (INNER - 3 * gap - mid) / 4
    y0, ph = 96, 256
    cols = [("Today · dark", cur, D), ("Today · light", cur, L), ("Planned · dark", plan, D), ("Planned · light", plan, L)]
    for i, (name, uri, T) in enumerate(cols):
        x = PAD + i * (pw + gap) + (mid if i >= 2 else 0)
        sh.rect(x, y0, pw, ph, hexc(T["background"]), 12, stroke="#2a2f3a")
        sh.image(uri, x + (pw - 176) / 2, y0 + 20, 176)
        sh.text(x + pw / 2, y0 + ph - 20, name, 14, ink_on(T["background"]), 600, "middle")
    sh.text(PAD, 386, "The PNG (1024 × 1024, transparent) is the only master today; the planned version is a preview.", 13, INK2)
    sh.text(PAD, 408, "On dark, the dark outline merges with the surface — check the silhouette at target size.", 13, INK2)
    return sh


def sheet_sizes(D, L, plan):
    sh = Sheet(W, 440, "Jarvis logo at small sizes",
               "The planned owl logo rendered at 128, 64, 48, 32, 24 and 16 pixels on the dark and the light background.")
    heading(sh, "Logo — at real sizes", "Where it has to stay recognisable: header mark, favicon, touch icon.")
    sizes = [128, 64, 48, 32, 24, 16]
    y0, ph = 96, 156
    for row, (name, T) in enumerate([("Dark", D), ("Light", L)]):
        y = y0 + row * (ph + 12)
        sh.rect(PAD, y, INNER, ph, hexc(T["background"]), 12, stroke="#2a2f3a")
        sh.text(PAD + 20, y + 26, name, 14, ink_on(T["background"]), 600)
        x = 150
        for sz in sizes:
            sh.image(plan, x, y + 14 + (128 - sz) / 2, sz)
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


def sheet_neutral(D, L, plan):
    sh = Sheet(W, 690, "Neutral colour tokens",
               "Swatches of the neutral surface, edge and text tokens in the dark and the light theme, with their HSL and hex values.")
    heading(sh, "Neutrals — surfaces and edges", "Values are read from design/tokens.json.")
    sh.image(plan, W - 88, 14, 56)
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


def sheet_brand(D, L, plan):
    sh = Sheet(W, 560, "Brand, status and interaction colours",
               "The planned owl logo next to the product blue and coral brand colours, the four status colours, and the interaction colours in both themes.")
    heading(sh, "Brand, status and interaction", "Blue and coral come from the logo's eyes. Status colours mean exactly one thing.")
    sh.rect(PAD, 96, 206, 430, hexc(D["background"]), 12, stroke="#2a2f3a")
    sh.image(plan, PAD + 3, 112, 200)
    sh.text(PAD + 103, 340, "left eye → product blue", 13, INK, 600, "middle")
    sh.text(PAD + 103, 362, "right eye → coral", 13, INK, 600, "middle")
    sh.text(PAD + 103, 398, "Teal is retired.", 13, INK2, 400, "middle")
    sh.text(PAD + 103, 458, "Preview — the final logo", 12, INK2, 400, "middle")
    sh.text(PAD + 103, 476, "follows the vector master.", 12, INK2, 400, "middle")

    x0, pitch = 262, 172

    def group(y, title, items, note=None):
        sh.text(x0, y, title, 16, INK, 600)
        if note:
            sh.text(x0 + 90, y, note, 12, INK2)
        for i, (name, cd, cl) in enumerate(items):
            xx = x0 + i * pitch
            for j, (c, tag) in enumerate(((cd, "dark"), (cl, "light"))):
                sh.rect(xx + j * 74, y + 12, 70, 66, hexc(c), 8, stroke="#3a4050")
                sh.text(xx + j * 74 + 8, y + 32, tag, 12, ink_on(c), 400, opacity=0.9)
                sh.text(xx + j * 74 + 8, y + 68, hexc(c), 11.5, ink_on(c), 400, mono=True, opacity=0.95)
            sh.text(xx, y + 98, name, 13, INK, 600)

    coral_d, coral_l = (6, 68, 60), (6, 65, 46)
    group(120, "Brand", [("Product blue", D["link"], L["link"]), ("Coral (site accent)", coral_d, coral_l)],
          "sparing; never a status colour")
    group(256, "Status", [(n, D["severity-" + n], L["severity-" + n]) for n in ("critical", "warning", "info", "none")],
          "tokens; components still use palette classes")
    group(392, "Interaction", [("focus ring", D["ring"], L["ring"]), ("field edge", D["control"], L["control"])])
    return sh


def sheet_states(D, L, plan):
    sh = Sheet(W, 470, "Implemented control states",
               "A text field with its edge, the same field focused with the two pixel ring, toggles in off and on state, buttons and meaningful versus decorative muted text, in dark and light.")
    heading(sh, "Controls — what the accessibility rules look like",
            "Field edge and focus ring ≥ 3:1, visible off-state track, muted text at full strength.")
    sh.image(plan, W - 88, 14, 56)
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


def sheet_header(D, L, plan):
    sh = Sheet(W, 430, "Planned app header with owl mark",
               "Mock-up of the compact app header at 44 pixels height, shown at 1.3 times, with the small owl mark before the Alerts and Silences tabs, in dark and light, above a sample alert card.")
    heading(sh, "Header — planned owl mark", "Mock-up at the real 44 px header height (shown 1.3×). Space and mobile are checked before building.")
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
        ident = sh.imgs.setdefault(plan, f"logo{len(sh.imgs)}")
        g.append(f'<use href="#{ident}" transform="translate(10 7) scale({30 / 384:.5f})"/>')
        r(52, 8, 84, 36, hexc(T["background"]), 3, hexc(T["border"]))
        g.append('<circle cx="66" cy="27" r="3" fill="#f97316"/>')
        t(75, 31, "Alerts  12", 12, fg, 600)
        g.append('<circle cx="154" cy="27" r="3" fill="#60a5fa"/>')
        t(163, 31, "Silences  3", 12, mut, 600)
        g.append(f'<circle cx="{Wl - 230}" cy="22" r="3.5" fill="#22c55e"/>')
        t(Wl - 221, 26, "2/2", 12, mut)
        r(Wl - 130, 9, 118, 26, hexc(T["primary"]), 5)
        t(Wl - 121, 26, "Create silence", 12, hexc(T["primary-foreground"]), 600)
        r(12, 54, Wl - 24, 34, hexc(T["card"]), 6, hexc(T["border"]))
        r(12, 54, 3, 34, hexc(T["severity-critical"]), 1)
        t(26, 75, "KubePodCrashLooping", 12, fg, 600)
        t(180, 75, "severity=critical · cluster=prod-eu", 11.5, mut)
        sh.add(f'<g transform="translate({PAD} {y + 22}) scale({k})">' + "".join(g) + "</g>")
    return sh


def sheet_media(D, L, cur, plan):
    sh = Sheet(W, 400, "Media layouts with the logo",
               "Illustrative title-card layouts for video 16 by 9, a square social post and an Open Graph image, using the planned logo with blue and coral accents on the dark background.")
    heading(sh, "Video, social and Open Graph — layout sketch",
            "Illustrative: logo, safe area, blue glow and one coral accent. Final templates are planned.")
    bg = hexc(D["background"])
    blue, coral = hexc(D["link"]), hexc((6, 68, 60))

    def frame(x, y, w, h):
        sh.rect(x, y, w, h, bg, 10, stroke="#2a2f3a")
        gid = f"g{int(x)}"
        sh.defs.append(f'<radialGradient id="{gid}" cx="0.75" cy="0.2" r="0.8"><stop offset="0" stop-color="{blue}" stop-opacity="0.28"/><stop offset="1" stop-color="{blue}" stop-opacity="0"/></radialGradient>')
        sh.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="url(#{gid})"/>')
        m = round(min(w, h) * 0.08)
        sh.rect(x + m, y + m, w - 2 * m, h - 2 * m, "none", 4, stroke="#5b6478", sw=1, dash="4 4")
        return m

    y = 100
    x, w, h = PAD, 400, 225
    m = frame(x, y, w, h)
    sh.image(plan, x + m + 16, y + h / 2 - 54, 108)
    sh.text(x + m + 140, y + h / 2 - 12, "Jarvis", 34, INK, 700)
    sh.rect(x + m + 140, y + h / 2 + 4, 56, 4, coral, 2)
    sh.text(x + m + 140, y + h / 2 + 30, "Release title", 15, INK2)
    sh.text(x + w / 2, y + h + 24, "Video 1920 × 1080", 13, INK2, 400, "middle")

    x, w = PAD + 400 + 20, 225
    m = frame(x, y, w, h)
    sh.image(plan, x + w / 2 - 48, y + m + 12, 96)
    sh.text(x + w / 2, y + h - m - 52, "Jarvis", 26, INK, 700, "middle")
    sh.rect(x + w / 2 - 22, y + h - m - 42, 44, 4, coral, 2)
    sh.text(x + w / 2, y + h - m - 16, "Release title", 13, INK2, 400, "middle")
    sh.text(x + w / 2, y + h + 24, "Square 1080 × 1080", 13, INK2, 400, "middle")

    x, w, h2 = PAD + 400 + 20 + 225 + 20, INNER - 400 - 225 - 40, 110
    m = frame(x, y, w, h2)
    sh.image(plan, x + m + 4, y + h2 / 2 - 28, 56)
    sh.text(x + m + 68, y + h2 / 2 - 2, "Jarvis", 20, INK, 700)
    sh.rect(x + m + 68, y + h2 / 2 + 8, 32, 3, coral, 2)
    sh.text(x + w / 2, y + h2 + 24, "Open Graph 1200 × 630", 13, INK2, 400, "middle")
    sh.text(x, y + h2 + 60, "Dashed line: safe area.", 13, INK2)
    sh.text(x, y + h2 + 80, "Logo left, title right.", 13, INK2)
    return sh


SHEETS = {
    "design-banner": lambda D, L, cur, plan: sheet_banner(D, L, plan),
    "design-logo": lambda D, L, cur, plan: sheet_logo(D, L, cur, plan),
    "design-logo-sizes": lambda D, L, cur, plan: sheet_sizes(D, L, plan),
    "design-colors-neutral": lambda D, L, cur, plan: sheet_neutral(D, L, plan),
    "design-colors-brand": lambda D, L, cur, plan: sheet_brand(D, L, plan),
    "design-states": lambda D, L, cur, plan: sheet_states(D, L, plan),
    "design-header": lambda D, L, cur, plan: sheet_header(D, L, plan),
    "design-media": lambda D, L, cur, plan: sheet_media(D, L, cur, plan),
}


def main():
    check = "--check" in sys.argv
    D, L = load_tokens()
    cur, plan = load_logos()
    stale = []
    for name, build in SHEETS.items():
        sh = build(D, L, cur, plan)
        svg = sh.svg()
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
