#!/usr/bin/env python3
"""Timers, pomodoro and stopwatch.  `rofi -show timer`, or the "Timer" tab.

  type a duration, Enter   25   25m   90s   1h   1h30   1:30 (= 1 min 30 s)   25m tea
                           a bare number is MINUTES; anything after the duration is the label
  pick a preset            5 / 10 / 25 / 45 min, Pomodoro, Stopwatch
  Stop                     shown first while something is running

Pomodoro is the standard 25 min work / 5 min break, with a 15 min break after every
4th round; it advances by itself and notifies at each change. A timer that ends
notifies once and clears.

How it works: rofi calls this script; `start` records the end time in
~/.local/state/hypr-shell/timer.json (the bar reads that file for its countdown) and
schedules `rofi-timer.py done` with a transient systemd user timer (unit hypr-timer).
systemd does the waiting, so nothing here stays running, a shell restart cannot lose a
timer, and there is exactly one timer at a time.

CLI (used by the above, and handy from a terminal):
  rofi-timer.py start <seconds> [label]   rofi-timer.py pomo   rofi-timer.py stopwatch
  rofi-timer.py stop                      rofi-timer.py status
"""
import json, os, re, subprocess, sys, time

STATE = os.path.join(os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state")), "hypr-shell", "timer.json")
UNIT = "hypr-timer"
SELF = os.path.abspath(__file__)
WORK, SHORT, LONG, ROUNDS = 25 * 60, 5 * 60, 15 * 60, 4


def load():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def save(s):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    if s is None:
        try: os.remove(STATE)
        except OSError: pass
        return
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f)
    os.replace(tmp, STATE)  # atomic: the bar may be reading it


def sh(*cmd):
    return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def notify(title, body="", urgency="normal"):
    sh("notify-send", "-a", "Timer", "-u", urgency, title, body)
    sh("canberra-gtk-play", "-i", "complete")  # a sound if the theme has one; harmless if not


def unschedule():
    sh("systemctl", "--user", "stop", UNIT + ".timer", UNIT + ".service")


def schedule(seconds):
    unschedule()
    sh("systemd-run", "--user", "--unit=" + UNIT, "--collect", "--quiet",
       "--on-active=%ds" % max(1, int(seconds)), sys.executable, SELF, "done")


def fmt(sec):
    sec = max(0, int(sec))
    h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
    return "%d:%02d:%02d" % (h, m, s) if h else "%d:%02d" % (m, s)


def human(sec):
    sec = int(sec)
    parts = []
    if sec >= 3600: parts.append("%dh" % (sec // 3600))
    if sec % 3600 >= 60: parts.append("%dm" % (sec % 3600 // 60))
    if sec % 60 or not parts: parts.append("%ds" % (sec % 60))
    return " ".join(parts)


def parse(text):
    """'25' '25m' '90s' '1h30' '1h 30m' '1:30' + optional label -> (seconds, label) or None"""
    t = text.strip().lower()
    m = re.match(r"^(\d+):(\d{1,2})(?:\s+(.*))?$", t)
    if m:
        return int(m[1]) * 60 + int(m[2]), (m[3] or "").strip()
    m = re.match(r"^(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+)\s*s(?:ec(?:ond)?s?)?)?\s*(.*)$", t)
    if m and (m[1] or m[2] or m[3]):
        # "1h30" - a bare number straight after hours means minutes
        rest = m[4]
        mins = int(m[2] or 0)
        if m[1] and not m[2] and not m[3]:
            n = re.match(r"^(\d+)(?:\s+(.*))?$", rest)
            if n: mins, rest = int(n[1]), n[2] or ""
        secs = int(m[1] or 0) * 3600 + mins * 60 + int(m[3] or 0)
        if secs > 0: return secs, rest.strip()
    m = re.match(r"^(\d+)(?:\s+(.*))?$", t)  # bare number = minutes
    if m and int(m[1]) > 0:
        return int(m[1]) * 60, (m[2] or "").strip()
    return None


# ── actions ───────────────────────────────────────────────────────────────
def start_timer(seconds, label=""):
    now = time.time()
    save({"kind": "timer", "label": label, "start": now, "end": now + seconds, "total": seconds})
    schedule(seconds)


def start_phase(phase, rnd):
    secs = {"work": WORK, "break": SHORT, "long": LONG}[phase]
    now = time.time()
    save({"kind": "pomo", "phase": phase, "round": rnd, "label": {"work": "Focus", "break": "Break", "long": "Long break"}[phase],
          "start": now, "end": now + secs, "total": secs})
    schedule(secs)


def start_stopwatch():
    unschedule()
    save({"kind": "stopwatch", "label": "Stopwatch", "start": time.time()})


def stop():
    unschedule()
    s = load()
    save(None)
    if s and s.get("kind") == "stopwatch":
        notify("Stopwatch stopped", fmt(time.time() - s["start"]))


def done():  # called by systemd when the countdown ends
    s = load()
    if not s or s.get("kind") == "stopwatch":
        return
    if s["kind"] == "timer":
        save(None)
        notify("Timer finished", (s.get("label") or human(s["total"])), "critical")
    else:  # pomodoro: announce, then roll straight into the next phase
        rnd = s["round"]
        if s["phase"] == "work":
            nxt = "long" if rnd % ROUNDS == 0 else "break"
            notify("Focus round %d done" % rnd, "%s break — %s" % ("Long" if nxt == "long" else "Short", human(LONG if nxt == "long" else SHORT)))
            start_phase(nxt, rnd)
        else:
            notify("Break over", "Focus round %d — %s" % (rnd + 1, human(WORK)))
            start_phase("work", rnd + 1)


def status_line(s):
    if not s: return "idle"
    if s["kind"] == "stopwatch": return "Stopwatch %s" % fmt(time.time() - s["start"])
    left = s["end"] - time.time()
    return "%s %s left" % (s.get("label") or "Timer", fmt(left))


# ── rofi ─────────────────────────────────────────────────────────────────
PRESETS = [
    ("5 minutes", "t:300"), ("10 minutes", "t:600"), ("25 minutes", "t:1500"), ("45 minutes", "t:2700"),
    ("Pomodoro — 25 min focus / 5 min break", "pomo"), ("Stopwatch", "sw"),
]


def rofi_list(message=None):
    s = load()
    if s and s.get("kind") != "stopwatch" and s["end"] < time.time() - 5 and not sh("systemctl", "--user", "is-active", "--quiet", UNIT + ".timer"):
        save(None); s = None  # stale state (a timer that fired while nothing could notify)
    out = ["\0prompt\x1fTimer\n", "\0message\x1f%s\n" % (message or ("Running: " + status_line(s) if s else "Type a duration: 25   90s   1h30   5:00 tea"))]
    if s:
        out.append("Stop — %s\0info\x1fstop\x1ficon\x1fprocess-stop\n" % status_line(s))
    for label, key in PRESETS:
        out.append("%s\0info\x1f%s\n" % (label, key))
    sys.stdout.write("".join(out))


def rofi_main():
    retv = int(os.environ.get("ROFI_RETV", "0"))
    info = os.environ.get("ROFI_INFO", "")
    if retv == 0:
        return rofi_list()
    if retv == 2:  # custom text
        p = parse(sys.argv[1] if len(sys.argv) > 1 else "")
        if p is None:
            return rofi_list("Could not read that as a duration — try 25, 90s, 1h30 or 5:00")
        start_timer(*p)
        notify("Timer started", "%s%s" % (human(p[0]), (" — " + p[1]) if p[1] else ""), "low")
        return
    if retv == 1:
        if info == "stop": stop()
        elif info == "pomo": start_phase("work", 1); notify("Pomodoro started", "Focus round 1 — %s" % human(WORK), "low")
        elif info == "sw": start_stopwatch()
        elif info.startswith("t:"):
            n = int(info[2:]); start_timer(n); notify("Timer started", human(n), "low")


if __name__ == "__main__":
    a = sys.argv[1:]
    if "ROFI_RETV" in os.environ: rofi_main()
    elif a[:1] == ["start"] and len(a) >= 2: start_timer(int(a[1]), " ".join(a[2:]))
    elif a[:1] == ["pomo"]: start_phase("work", 1)
    elif a[:1] == ["stopwatch"]: start_stopwatch()
    elif a[:1] == ["stop"]: stop()
    elif a[:1] == ["done"]: done()
    elif a[:1] == ["status"]: print(status_line(load()))
    else: print(__doc__)
