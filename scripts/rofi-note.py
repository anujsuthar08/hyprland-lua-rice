#!/usr/bin/env python3
"""rofi script mode: quick notes.  `rofi -show note`, or the "Note" tab.

  type a note, Enter        save it (when nothing on the list matches it)
  Ctrl+Enter                save exactly what you typed, even if it matches
  Enter on a listed note    copy it to the clipboard
  Ctrl+Space on a note      edit it in place (pulls its text into the entry
                            box — edit it, then Enter/Ctrl+Enter to save)
  Shift+Delete              remove the note
  \n  in what you type      a line break (rofi's entry box is single-line —
                            there is no way to type a real one)

Typing also FILTERS the list, so it doubles as search. Newest first.
Stored in ~/.local/share/hypr-shell/notes.jsonl (plain JSON lines, real
"\n"s inside the text, easy to read or grep) and mirrored, append-only,
into the Obsidian vault (~/Obsidian/NOTES/quick-notes.md) as each note
is saved (including an edit — the vault keeps every version, never
rewrites one) — see `mirror_to_obsidian`. This list is a scratch inbox;
the vault copy is the permanent one and is never affected by
Shift+Delete here.

### Why editing works the way it does

rofi's script-mode protocol has no field that pushes text into the
still-open entry box — the only BUILT-IN way to get a row's text back
into the box for editing is `-kb-row-select` (Ctrl+Space by default),
which is entirely client-side: it never calls this script at all, so
there is no ROFI_INFO telling us which note it came from.

The first design tried a custom keybinding instead (kb-custom-1,
ROFI_RETV==10) so the script itself could see the target id and
relaunch rofi with `-filter` prefilled. That does not work in THIS
launcher: with multiple modes configured (`rofi/config.rasi`'s
`modes:`), rofi hard-wires kb-custom-1..N to "switch to mode N" —
verified by testing kb-custom-1 with no script involved at all (jumped
straight to the Apps tab) and kb-custom-12, past the last of the 11
configured modes (jumped to Apps too, so it is not even bounded by the
mode count). The script's RETV==10 branch never ran either time.

So the id has to travel inside the text Ctrl+Space copies. Confirmed
by direct test (a throwaway rofi mode with a row whose raw/filter
value and `\0display` value were deliberately different strings):
Ctrl+Space inserts the **`\0display` string**, not the row's own
value — so a marker only in the row value (tried first) never reaches
the entry box at all. It has to live in `\0display` itself, which
means it is now part of what every note LOOKS like in the list too:
each row shows an "id-glyph" prefix before its text. Saving strips a
leading marker whose id resolves to a real note (plus the trailing
"age" suffix that Ctrl+Space also drags in, since that is part of the
same display string) and treats the remainder as an in-place edit;
anything else (no marker, one that does not resolve, or hand-typed)
just saves as a new note's literal text rather than erroring.

Multi-line text in the list is shown "\n"-escaped (the same form you'd
type), not with a prettier separator, because Ctrl+Space copies this
exact string back into the entry box — a prettier but non-reparseable
separator would make editing a multi-line note paste back something
this script can no longer reconstruct.

rofi script-mode protocol (rofi-script(5)): ROFI_RETV 0 = first call,
1 = a row was chosen, 2 = custom text was entered, 3 = a row was deleted.
"""
import json, os, re, subprocess, sys, time

FILE = os.path.join(os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")), "hypr-shell", "notes.jsonl")
MAX_SHOWN = 300
EDIT_GLYPH = "\u270e"  # a lowercase pencil ("edit" marker) — see the module docstring
EDIT_MARKER = re.compile("^" + EDIT_GLYPH + r"(\d+) ")
AGE_SUFFIX = re.compile(r"   ·   (now|\d+[mhd])$")  # matches ago()'s own output, stripped from a Ctrl+Space edit

# Append-only mirror into the PKM vault. One-way and by design never
# reconciled with `notes.jsonl`: this list is a scratch inbox (Shift+Delete
# clears it once you've acted on a note), the vault entry is the permanent
# record. Deleting from rofi does NOT touch this file.
OBSIDIAN_FILE = os.path.expanduser("~/Obsidian/NOTES/quick-notes.md")
OBSIDIAN_HEADER = (
    "# Quick notes\n\n"
    "Captured from the Hyprland launcher's Note tab (SUPER+SHIFT+E), one line "
    "per save. Append-only — deleting a note from the launcher does not "
    "remove it here.\n\n"
)


def mirror_to_obsidian(note):
    # Best-effort: a missing/unmounted vault must never block saving the
    # actual note, so any failure here is swallowed.
    try:
        os.makedirs(os.path.dirname(OBSIDIAN_FILE), exist_ok=True)
        day = time.strftime("%Y-%m-%d", time.localtime(note["t"]))
        stamp = time.strftime("%-I:%M %p", time.localtime(note["t"]))

        exists = os.path.exists(OBSIDIAN_FILE)
        last_heading = None
        if exists:
            with open(OBSIDIAN_FILE, encoding="utf-8") as f:
                for line in f:
                    if line.startswith("## "):
                        last_heading = line.strip()

        chunk = "" if exists else OBSIDIAN_HEADER
        if last_heading != "## " + day:
            chunk += ("\n" if exists else "") + "## %s\n\n" % day
        # Extra lines are indented two spaces so CommonMark keeps them
        # part of the SAME bullet instead of starting new list items.
        note_lines = note["text"].split("\n")
        chunk += "- %s — %s\n" % (stamp, note_lines[0])
        for extra in note_lines[1:]:
            chunk += "  %s\n" % extra

        with open(OBSIDIAN_FILE, "a", encoding="utf-8") as f:
            f.write(chunk)
    except OSError:
        pass


def load():
    notes = []
    try:
        with open(FILE, encoding="utf-8") as f:
            for line in f:
                try:
                    n = json.loads(line)
                    if isinstance(n.get("text"), str) and n["text"].strip():
                        notes.append(n)
                except ValueError:
                    pass
    except OSError:
        pass
    return notes


def save(notes):
    os.makedirs(os.path.dirname(FILE), exist_ok=True)
    tmp = FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for n in notes:
            f.write(json.dumps(n, ensure_ascii=False) + "\n")
    os.replace(tmp, FILE)  # atomic: a crash mid-write cannot leave half a file


def ago(ts):
    s = max(0, int(time.time() - ts))
    if s < 60: return "now"
    if s < 3600: return "%dm" % (s // 60)
    if s < 86400: return "%dh" % (s // 3600)
    return "%dd" % (s // 86400)


def render(notes, message):
    out = ["\0prompt\x1fNote\n", "\0message\x1f%s\n" % message]
    if not notes:
        # rofi QUITS when a script prints no rows, so an empty list still needs one;
        # a single space can never match what is typed (see rofi-calc.sh)
        out.append(" \0nonselectable\x1ftrue\n")
    for n in sorted(notes, key=lambda x: -x.get("t", 0))[:MAX_SHOWN]:
        # `flat` is what typed text FILTERS against (search across lines,
        # same flattening as before multi-line notes existed). `display`
        # is what's actually shown AND what Ctrl+Space copies back into
        # the entry box — see the module docstring for why those have to
        # be the same string, and why it carries the edit marker.
        flat = " ".join(n["text"].split())
        shown = n["text"].replace("\n", "\\n")
        display = "%s%s %s   ·   %s" % (EDIT_GLYPH, n["id"], shown, ago(n.get("t", 0)))
        out.append("%s\0display\x1f%s\x1finfo\x1f%s\n" % (flat, display, n["id"]))
    sys.stdout.write("".join(out))


HELP = "Enter saves  ·  Ctrl+Enter forces  ·  Ctrl+Space edits  ·  \\n = line break  ·  Shift+Delete removes"
retv = os.environ.get("ROFI_RETV", "0")
notes = load()


def find(nid):
    return next((n for n in notes if str(n["id"]) == str(nid)), None)


if retv == "1":  # copy the chosen note, then let rofi close
    note = find(os.environ.get("ROFI_INFO", ""))
    if note:
        subprocess.run(["wl-copy", "--", note["text"]], check=False)
elif retv == "2":  # a note was submitted: an edit (marker prefix) or a new one
    raw = sys.argv[1] if len(sys.argv) > 1 else ""
    editing = None
    m = EDIT_MARKER.match(raw)
    if m:
        editing = find(m.group(1))
        if editing:
            raw = raw[m.end():]
            raw = AGE_SUFFIX.sub("", raw)  # Ctrl+Space also drags in "   ·   <age>"
    # Literal "\n" (backslash, n) splits into a real line break; each
    # resulting line gets its OWN whitespace collapsed, same as the
    # single-line behaviour before multi-line notes existed.
    text = "\n".join(" ".join(line.split()) for line in raw.split("\\n")).strip("\n")
    if text and editing:
        editing["text"] = text[:2000]
        editing["t"] = int(time.time())  # bumped: "last touched", same as a fresh note
        save(notes)
        mirror_to_obsidian(editing)
        render(notes, "Edited  ·  " + HELP)
    elif text:
        nid = max([n["id"] for n in notes] + [0]) + 1
        note = {"id": nid, "t": int(time.time()), "text": text[:2000]}
        notes.append(note)
        save(notes)
        mirror_to_obsidian(note)
        render(notes, "Saved  ·  " + HELP)
    else:
        render(notes, HELP)
elif retv == "3":  # delete
    gone = os.environ.get("ROFI_INFO", "")
    notes = [n for n in notes if str(n["id"]) != gone]
    save(notes)
    render(notes, "Removed  ·  " + HELP)
else:
    render(notes, HELP)
