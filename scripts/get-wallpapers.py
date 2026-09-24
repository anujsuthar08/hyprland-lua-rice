#!/usr/bin/env python3
"""Catalogue the wallpaper collection for the AGS wallpaper switcher.

    get-wallpapers.py --list          JSON {category: [path, ...]}, builds thumbnails
    get-wallpapers.py --list --fast   same, but skips thumbnail generation
    get-wallpapers.py --current       JSON {desktop|lockscreen|sddm: path or null}
    get-wallpapers.py --thumb <file>  print the thumbnail path for one wallpaper
    get-wallpapers.py --prune         drop thumbnails whose wallpaper is gone

Replaces the old ~/.config/ags/scripts/get-wallpapers.sh. Two differences
that matter:

  * JSON is emitted by a JSON encoder, not by pasting quotes together.
    The old script built `"path"` strings by hand, which corrupts the
    output for any filename containing a quote or backslash. The booru
    filenames in this collection are hashes today, but "add custom
    wallpaper" lets arbitrary names in.

  * Thumbnails are 16:9 centre-crops, so every tile is the same shape
    AND that shape is the screen's. The old script generated
    fit-inside thumbs in bulk but square ones on the "add" path, so
    added wallpapers never matched the grid.

Thumbnails live in ~/.cache/wallpaper-thumbs, mirroring the collection's
folder structure, always .jpg. Deliberately NOT inside the ags config
dir (a personal collection, not part of the repo).
"""

import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HOME = Path.home()
ROOT = HOME / ".config/wallpapers"
THUMBS = HOME / ".cache/wallpaper-thumbs"
STATE = HOME / ".cache/wallpaper-state"

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".svg"}
VIDEO_EXT = {".mp4", ".webm", ".mkv", ".mov"}
# .gif is animated but magick reads frame 0, so it thumbnails like an image
ANIMATED_EXT = VIDEO_EXT | {".gif"}
ALL_EXT = IMAGE_EXT | VIDEO_EXT | {".gif"}

THUMB_W = 384
THUMB_H = 216   # 16:9, same shape as the screen it will end up on
TARGETS = ("desktop", "lockscreen", "sddm")


def wallpapers():
    """Every wallpaper under ROOT, excluding the lockscreen staging file."""
    out = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in ALL_EXT:
            continue
        # lockscreen/ holds the *applied* copy, not a choosable wallpaper
        if path.relative_to(ROOT).parts[0] == "lockscreen":
            continue
        out.append(path)
    return out


def thumb_path(wallpaper: Path) -> Path:
    rel = wallpaper.relative_to(ROOT).with_suffix(".jpg")
    return THUMBS / rel


def build_thumb(wallpaper: Path) -> None:
    dest = thumb_path(wallpaper)
    if dest.exists() and dest.stat().st_mtime >= wallpaper.stat().st_mtime:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    ext = wallpaper.suffix.lower()

    if ext in VIDEO_EXT:
        # `thumbnail` picks a representative frame rather than frame 0,
        # which for a lot of these is a fade-in from black.
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error", "-i", str(wallpaper),
            "-vf", f"thumbnail,scale={THUMB_W}:{THUMB_H}:force_original_aspect_ratio=increase,"
                   f"crop={THUMB_W}:{THUMB_H}",
            "-frames:v", "1", str(dest),
        ]
    else:
        src = f"{wallpaper}[0]" if ext == ".gif" else str(wallpaper)
        cmd = [
            "magick", src,
            "-resize", f"{THUMB_W}x{THUMB_H}^",
            "-gravity", "center", "-extent", f"{THUMB_W}x{THUMB_H}",
            "-quality", "85", "-strip", str(dest),
        ]

    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=60)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        # A single unreadable file must not take the whole catalogue down;
        # the switcher renders a placeholder when the thumbnail is missing.
        dest.unlink(missing_ok=True)


def prune_thumbs(valid: set) -> None:
    if not THUMBS.is_dir():
        return
    keep = {thumb_path(w) for w in valid}
    for t in THUMBS.rglob("*.jpg"):
        if t not in keep:
            t.unlink(missing_ok=True)


def cmd_list(fast: bool) -> None:
    found = wallpapers()

    if not fast:
        # magick/ffmpeg are the slow part and they are independent per
        # file, so fan out. os.cpu_count() workers keeps a first run on
        # ~100 wallpapers to a few seconds instead of a minute.
        with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as pool:
            list(pool.map(build_thumb, found))
        prune_thumbs(set(found))

    catalog: dict[str, list[str]] = {}
    for w in found:
        category = str(w.parent.relative_to(ROOT))
        catalog.setdefault(category, []).append(str(w))

    json.dump(catalog, sys.stdout)
    sys.stdout.write("\n")


def cmd_current() -> None:
    out = {}
    for target in TARGETS:
        f = STATE / target
        try:
            value = f.read_text().strip()
        except OSError:
            value = ""
        out[target] = value or None
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")


def main() -> int:
    argv = sys.argv[1:]
    if not argv or argv[0] == "--list":
        cmd_list(fast="--fast" in argv)
    elif argv[0] == "--current":
        cmd_current()
    elif argv[0] == "--thumb":
        if len(argv) < 2:
            print("usage: get-wallpapers.py --thumb <file>", file=sys.stderr)
            return 1
        print(thumb_path(Path(argv[1])))
    elif argv[0] == "--prune":
        prune_thumbs(set(wallpapers()))
    else:
        print(__doc__, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
