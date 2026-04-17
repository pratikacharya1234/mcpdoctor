#!/usr/bin/env python3
"""
ansi-to-svg: convert colored terminal output to a standalone SVG terminal screenshot.

Produces the same kind of README hero image used by bun, ripgrep, fd, eza — a
monospace SVG framed by a mac-style window chrome, rendering the real ANSI
output captured from the CLI. Regeneratable and diff-friendly.
"""

from __future__ import annotations
import re
import sys
from html import escape

# 16-color xterm palette tuned for a dark terminal background
# (matches roughly what Apple Terminal / iTerm "Pro" theme emits)
PALETTE = {
    30: "#3E424D", 31: "#E06C75", 32: "#98C379", 33: "#E5C07B",
    34: "#61AFEF", 35: "#C678DD", 36: "#56B6C2", 37: "#ABB2BF",
    90: "#5C6370", 91: "#E06C75", 92: "#98C379", 93: "#E5C07B",
    94: "#61AFEF", 95: "#C678DD", 96: "#56B6C2", 97: "#FFFFFF",
    39: "#ABB2BF",  # default fg
}
BG = "#1E2127"
CHROME_BG = "#2A2E38"
FG_DEFAULT = "#ABB2BF"
FONT_FAMILY = "'SF Mono','Menlo','Consolas',monospace"

CHAR_W = 8.4   # px per glyph at 14px font
LINE_H = 20    # px per line
LEFT_PAD = 20
TOP_PAD = 44   # leaves room for window-chrome traffic lights
RIGHT_PAD = 20
BOT_PAD = 20

ANSI_RE = re.compile(r"\x1b\[([0-9;]*)m")
OSC_RE = re.compile(r"\x1b\].*?\x07")
SPINNER_RE = re.compile(r"^[\s\u2800-\u28FF\-\|/\\]+(Scanning|Detecting|Found|Probing).*$")


def strip_noise(text: str) -> str:
    """Drop ora spinner frames and OSC sequences that carry no visible content."""
    text = OSC_RE.sub("", text)
    lines = []
    for line in text.splitlines():
        clean = ANSI_RE.sub("", line).rstrip()
        if SPINNER_RE.match(clean):
            continue
        if clean.strip() == "":
            lines.append("")
            continue
        lines.append(line.rstrip())
    # Collapse runs of > 1 blank line
    out = []
    blank = 0
    for l in lines:
        if ANSI_RE.sub("", l).strip() == "":
            blank += 1
            if blank <= 1:
                out.append(l)
        else:
            blank = 0
            out.append(l)
    return "\n".join(out).strip("\n")


def parse_line(line: str):
    """Yield (text, fg, bold) runs for a single line."""
    pos = 0
    fg = FG_DEFAULT
    bold = False
    for m in ANSI_RE.finditer(line):
        if m.start() > pos:
            yield line[pos:m.start()], fg, bold
        codes = [int(c) for c in m.group(1).split(";") if c != ""]
        if not codes:
            codes = [0]
        for c in codes:
            if c == 0:
                fg, bold = FG_DEFAULT, False
            elif c == 1:
                bold = True
            elif c == 22:
                bold = False
            elif c == 39:
                fg = FG_DEFAULT
            elif c in PALETTE:
                fg = PALETTE[c]
        pos = m.end()
    if pos < len(line):
        yield line[pos:], fg, bold


def render(input_path: str, output_path: str, title: str = "mcpfix --roast") -> None:
    with open(input_path, "r", encoding="utf-8") as fh:
        raw = fh.read()
    content = strip_noise(raw)
    lines = content.split("\n")

    # Compute canvas size from the widest rendered line
    max_cols = max((len(ANSI_RE.sub("", l)) for l in lines), default=40)
    width = int(LEFT_PAD + RIGHT_PAD + max_cols * CHAR_W) + 4
    height = TOP_PAD + BOT_PAD + len(lines) * LINE_H

    out = []
    out.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" font-family="{FONT_FAMILY}" font-size="14">'
    )
    # Window chrome: rounded rect, title bar, traffic lights
    out.append(f'<rect width="{width}" height="{height}" rx="8" ry="8" fill="{BG}"/>')
    out.append(f'<rect width="{width}" height="28" rx="8" ry="8" fill="{CHROME_BG}"/>')
    out.append('<circle cx="16" cy="14" r="6" fill="#FF5F56"/>')
    out.append('<circle cx="36" cy="14" r="6" fill="#FFBD2E"/>')
    out.append('<circle cx="56" cy="14" r="6" fill="#27C93F"/>')
    out.append(
        f'<text x="{width // 2}" y="18" text-anchor="middle" '
        f'fill="#9DA5B4" font-size="12">{escape(title)}</text>'
    )
    # Terminal content
    for row, line in enumerate(lines):
        y = TOP_PAD + row * LINE_H
        col = 0
        out.append(f'<text x="{LEFT_PAD}" y="{y}" xml:space="preserve">')
        for text, fg, bold in parse_line(line):
            if not text:
                continue
            x_abs = LEFT_PAD + int(col * CHAR_W)
            weight = ' font-weight="bold"' if bold else ""
            out.append(
                f'<tspan x="{x_abs}" fill="{fg}"{weight}>{escape(text)}</tspan>'
            )
            col += len(text)
        out.append("</text>")
    out.append("</svg>")

    with open(output_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("usage: ansi-to-svg.py <input.ansi> <output.svg> [title]", file=sys.stderr)
        sys.exit(2)
    title = sys.argv[3] if len(sys.argv) > 3 else "mcpfix --roast"
    render(sys.argv[1], sys.argv[2], title)
    print(f"wrote {sys.argv[2]}")
