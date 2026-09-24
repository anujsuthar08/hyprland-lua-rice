#!/usr/bin/env python3
"""rofi script mode: emoji picker.  `rofi -show emoji`, or the "Emoji" tab.

Search by name OR keyword ("fire", "party", "happy"): the data is the CLDR
set GTK itself ships (compiled into libgtk-4, English), read at first use
into ~/.cache/hypr-shell/emoji.tsv — nothing to install. Recently used
emoji come first (last 12). Enter copies the emoji to the clipboard (typing
into other windows via ydotool is unreliable for emoji, so this copies —
paste with Ctrl+V; wl-clip-persist keeps it after the picker closes).

Skin tone: the first row shows the current tone; Enter on it cycles
neutral -> light -> medium-light -> medium -> medium-dark -> dark. The tone
applies to every emoji that supports one (hands, people, gestures).

Why the derivation below exists: GTK stores ONLY the light-tone variant of
those emoji (307 of them; the neutral 👍/👋/🙏 has no entry of its own), so a
picker that simply skips modifier sequences silently loses every one of them.
The neutral emoji is rebuilt by removing the modifier, and other tones by
swapping it.

rofi script-mode protocol (rofi-script(5)): ROFI_RETV 0 = first call,
1 = a row was chosen; the row's `info` carries the BASE (neutral) emoji.
"""
import os, subprocess, sys

CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "hypr-shell", "emoji.tsv")
STATE_DIR = os.path.join(os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state")), "hypr-shell")
RECENT = os.path.join(STATE_DIR, "emoji-recent")
TONE = os.path.join(STATE_DIR, "emoji-tone")
MAX_RECENT = 12
CACHE_VERSION = "#v4"
LIGHT = 0x1F3FB
TONES = [("neutral", None), ("light", 0x1F3FB), ("medium-light", 0x1F3FC), ("medium", 0x1F3FD),
         ("medium-dark", 0x1F3FE), ("dark", 0x1F3FF)]
MODS = range(0x1F3FB, 0x1F3FF + 1)
# Emoji whose neutral form is text-presentation by default: without U+FE0F they
# render as a monochrome symbol once the tone modifier is gone.
NEEDS_VS16 = {0x261D, 0x26F9, 0x270C, 0x270D, 0x1F3CB, 0x1F3CC, 0x1F574, 0x1F575, 0x1F590}
TONE_ROW = "::tone"


def neutral(codes):
    """Codepoints of the light variant -> the neutral emoji (modifier removed)."""
    out = []
    for c in codes:
        if c in MODS:
            continue
        out.append(c)
        if c in NEEDS_VS16 and c == codes[0]:
            out.append(0xFE0F)
    return out


def build_cache():
    import gi
    gi.require_version("Gtk", "4.0")
    from gi.repository import Gio, GLib, Gtk  # noqa: F401 (importing Gtk registers its resources)

    data = Gio.resources_lookup_data("/org/gtk/libgtk/emoji/en.data", 0)
    v = GLib.Variant.new_from_bytes(GLib.VariantType.new("a(aussasasu)"), data, True)
    rows, seen = [], set()
    for i in range(v.n_children()):
        codes, name, _n2, kw, _k2, _g = v.get_child_value(i).unpack()
        mods = [c for c in codes if c in MODS]
        if 0 in codes:
            # GTK marks "the tone modifier goes here" with a literal 0 codepoint for
            # emoji that are text-presentation by default (✌ ☝ ✍ 🏋 🕵 ...). Neutral
            # form: that slot is the emoji-presentation selector U+FE0F; tone
            # template: it is the light modifier (swapped for the chosen tone).
            base = "".join(chr(0xFE0F if c == 0 else c) for c in codes)
            template = "".join(chr(LIGHT if c == 0 else c) for c in codes)
        elif mods:
            # Couples (holding hands / kiss / couple-with-heart): GTK stores exactly one
            # row per pairing, both modifier slots always the SAME tone (light) - there is
            # no asymmetric (e.g. dark + light) sequence in the data to pick from. A single
            # tone setting still applies cleanly: neutral() strips every modifier slot and
            # apply_tone() swaps every LIGHT occurrence, both already generic over count.
            base = "".join(map(chr, neutral(codes)))
            template = "".join(map(chr, codes))  # the light variant, tone swapped in at use
        else:
            base, template = "".join(map(chr, codes)), ""
        if base in seen:
            continue
        seen.add(base)
        rows.append("%s\t%s\t%s\t%s" % (base, name, " ".join(kw), template))
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w", encoding="utf-8") as f:
        f.write(CACHE_VERSION + "\n" + "\n".join(rows) + "\n")


def load():
    ok = False
    try:
        with open(CACHE, encoding="utf-8") as f:
            ok = f.readline().strip() == CACHE_VERSION
    except OSError:
        pass
    if not ok:
        build_cache()
    out = []
    with open(CACHE, encoding="utf-8") as f:
        next(f)
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) == 4:
                out.append(parts)
    return out


def read_lines(path):
    try:
        with open(path, encoding="utf-8") as f:
            return [l.strip() for l in f if l.strip()]
    except OSError:
        return []


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def tone_index():
    t = (read_lines(TONE) or ["neutral"])[0]
    names = [n for n, _ in TONES]
    return names.index(t) if t in names else 0


def apply_tone(base, template, idx):
    """The emoji to show/copy for the current tone."""
    cp = TONES[idx][1]
    if not template or cp is None:
        return base
    return "".join(chr(cp) if ord(c) == LIGHT else c for c in template)


def remember(base):
    rec = [base] + [g for g in read_lines(RECENT) if g != base]
    write_text(RECENT, "\n".join(rec[:MAX_RECENT]) + "\n")


def row(shown, name, kw, base):
    # text is what is shown and filtered; meta adds invisible search terms
    return "%s   %s\0meta\x1f%s\x1finfo\x1f%s\n" % (shown, name, kw, base)


def render(message_extra=""):
    emoji = load()
    idx = tone_index()
    by_base = {b: (b, n, k, t) for b, n, k, t in emoji}
    rec = [by_base[g] for g in read_lines(RECENT) if g in by_base]
    seen = {r[0] for r in rec}
    tname = TONES[idx][0]
    out = ["\0prompt\x1fEmoji\n",
           "\0message\x1f%sEnter copies  ·  search by name or keyword (fire, party, happy…)\n" % message_extra]
    hand = apply_tone("\U0001F44B", "\U0001F44B\U0001F3FB", idx)
    out.append("%s   Skin tone: %s   (Enter to change)\0meta\x1fskin tone colour color setting preference\x1finfo\x1f%s\n" % (hand, tname, TONE_ROW))
    for b, n, k, t in rec:
        out.append(row(apply_tone(b, t, idx), n, k, b))
    for b, n, k, t in emoji:
        if b not in seen:
            out.append(row(apply_tone(b, t, idx), n, k, b))
    sys.stdout.write("".join(out))


retv = os.environ.get("ROFI_RETV", "0")
info = os.environ.get("ROFI_INFO", "")

if retv == "1" and info == TONE_ROW:
    nxt = (tone_index() + 1) % len(TONES)
    write_text(TONE, TONES[nxt][0] + "\n")
    render("Skin tone: %s  ·  " % TONES[nxt][0])
elif retv == "1":
    by_base = {b: t for b, _n, _k, t in load()}
    glyph = apply_tone(info, by_base.get(info, ""), tone_index())
    if glyph:
        subprocess.run(["wl-copy", "--", glyph], check=False)
        remember(info)
else:
    render()
