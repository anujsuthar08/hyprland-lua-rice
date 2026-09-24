#!/usr/bin/env python3
"""Screenshot and recording gallery.  `rofi -show shots`, or the "Shots" tab.

  Enter          screenshot: copy the image to the clipboard   recording: play it
  Alt+1          open in the default app
  Alt+2          annotate a screenshot with swappy
  Alt+3          show in the file manager
  Shift+Delete   move to the Trash (recoverable — never deletes for good)

Newest first, screenshots from ~/Pictures/screenshots and recordings from
~/Videos/ScreenRecords. Thumbnails are made once (ImageMagick for images, ffmpeg for a
video's first second) and cached by file path + modification time, so an edited file
gets a fresh one.

rofi script protocol: ROFI_RETV 0 first call, 1 Enter, 3 Shift+Delete, 10.. custom keys
(enabled with `use-hot-keys` in the header; Alt+1 = 10, Alt+2 = 11, Alt+3 = 12).
"""
import hashlib, os, subprocess, sys, time

PICS = os.environ.get("XDG_PICTURES_DIR", os.path.expanduser("~/Pictures")) + "/screenshots"
VIDS = os.environ.get("XDG_VIDEOS_DIR", os.path.expanduser("~/Videos")) + "/ScreenRecords"
CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "hypr-shell", "shot-thumbs")
IMG = (".png", ".jpg", ".jpeg", ".webp")
VID = (".mp4", ".mkv", ".webm")
LIMIT = 80


def files():
    out = []
    for d, kind in ((PICS, "shot"), (VIDS, "rec")):
        try:
            for e in os.scandir(d):
                if e.is_file() and e.name.lower().endswith(IMG if kind == "shot" else VID):
                    out.append((e.stat().st_mtime, e.stat().st_size, e.path, kind))
        except OSError:
            pass
    out.sort(reverse=True)
    return out[:LIMIT]


def thumb(path, mtime, kind):
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, hashlib.md5(("%s|%d" % (path, mtime)).encode()).hexdigest() + ".png")
    if os.path.exists(f) and os.path.getsize(f) > 0:
        return f
    if kind == "shot":
        cmd = ["magick", path + "[0]", "-thumbnail", "160x160", "png:" + f]
    else:
        cmd = ["ffmpeg", "-v", "error", "-y", "-ss", "1", "-i", path, "-frames:v", "1", "-vf", "scale=160:-2", f]
    try:
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        pass
    if os.path.exists(f) and os.path.getsize(f) > 0:
        return f
    try: os.remove(f)
    except OSError: pass
    return None


def human_size(n):
    return "%.1f MB" % (n / 1048576) if n >= 1048576 else "%d KB" % max(1, n // 1024)


def when(ts):
    d = time.time() - ts
    if d < 60: return "just now"
    if d < 3600: return "%d min ago" % (d // 60)
    if d < 86400: return "%d h ago" % (d // 3600)
    return time.strftime("%d %b %H:%M", time.localtime(ts))


def render(message=None):
    rows = files()
    out = ["\0prompt\x1fShots\n", "\0use-hot-keys\x1ftrue\n",
           "\0message\x1f%s\n" % (message or "Enter copy / play  ·  Alt+1 open  ·  Alt+2 annotate  ·  Alt+3 folder  ·  Shift+Del trash")]
    if not rows:
        out.append(" \0nonselectable\x1ftrue\n")  # rofi quits on an empty list (see rofi-calc.sh)
        out.append("No screenshots or recordings yet (PRINT takes one)\0nonselectable\x1ftrue\n")
    for mtime, size, path, kind in rows:
        label = "%s   %s  ·  %s" % ("Screenshot" if kind == "shot" else "Recording", when(mtime), human_size(size))
        t = thumb(path, mtime, kind)
        out.append("%s\0info\x1f%s%s\n" % (label, path, "\x1ficon\x1f" + t if t else ""))
    sys.stdout.write("".join(out))


def spawn(*cmd):
    subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def act(retv, path):
    if not path or not os.path.isfile(path):
        return
    is_img = path.lower().endswith(IMG)
    if retv == 1:
        if is_img:
            with open(path, "rb") as f:
                p = subprocess.Popen(["wl-copy", "-t", "image/png" if path.lower().endswith(".png") else "image/jpeg"],
                                     stdin=f, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            subprocess.run(["notify-send", "-a", "Screenshot", "Copied to clipboard", os.path.basename(path)])
        else:
            spawn("xdg-open", path)
    elif retv == 10:
        spawn("xdg-open", path)
    elif retv == 11 and is_img:
        spawn("swappy", "-f", path)
    elif retv == 12:
        spawn("xdg-open", os.path.dirname(path))
    elif retv == 3:
        subprocess.run(["gio", "trash", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    retv = int(os.environ.get("ROFI_RETV", "0"))
    if retv == 0:
        render()
    else:
        act(retv, os.environ.get("ROFI_INFO", ""))
        if retv == 3:
            render()  # stay open on the refreshed list
