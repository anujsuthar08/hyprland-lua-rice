#!/usr/bin/env python3
"""Cursor click highlighter — a visual ripple at the click point, for tutorial-quality
screen recordings (pairs with record.sh / SUPER+SHIFT+R). PowerToys' "Mouse Highlighter",
basically.

  click-highlight.py start [&]     run the daemon (foreground; caller backgrounds it)
  click-highlight.py stop          stop it if running (no-op otherwise)

Hyprland's own IPC has no raw pointer-button event (checked live: `socat`'d socket2 while
clicking — only window/focus events came through), so this reads real input devices via
`python-evdev` instead (packages/optional.txt), same "input" group access ydotool already
needs. It only WATCHES for a button press (a boolean, per device, no coordinate math); the
actual position is asked from Hyprland itself via `hyprctl cursorpos -j` at that instant —
sidesteps re-deriving cursor accel/multi-monitor math from raw REL_X/REL_Y deltas, which
would drift from what's really on screen.

State lives in $XDG_RUNTIME_DIR/click-highlight/pid, same shape as scripts/record.sh's
screenrecord state — one pid file, checked against /proc, no second source of truth.
"""
import json, os, selectors, signal, subprocess, sys, time

from evdev import InputDevice, ecodes, list_devices

RT = os.path.join(os.environ.get("XDG_RUNTIME_DIR", "/tmp"), "click-highlight")
PID_FILE = os.path.join(RT, "pid")
BUTTON_NAMES = {ecodes.BTN_LEFT: "left", ecodes.BTN_RIGHT: "right", ecodes.BTN_MIDDLE: "middle"}

# Some touchpad drivers report the same physical click on TWO devices at once
# (a legacy "Mouse"-named node and the native multitouch "Touchpad" node) —
# confirmed on this machine: `ASUF1203:00 2808:0217 Mouse` +
# `... Touchpad` are separate /dev/input/event* nodes. A per-button debounce
# collapses that into the one highlight a human actually clicked, regardless
# of which device(s) reported it.
DEBOUNCE_S = 0.05


def pointer_devices():
    for path in list_devices():
        try:
            dev = InputDevice(path)
        except OSError:
            continue
        caps = dev.capabilities().get(ecodes.EV_KEY, [])
        if ecodes.BTN_LEFT in caps:
            yield dev


def cursor_pos():
    out = subprocess.run(["hyprctl", "cursorpos", "-j"], capture_output=True, text=True, timeout=1)
    pos = json.loads(out.stdout)
    return pos["x"], pos["y"]


def notify(x, y, button):
    subprocess.run(["ags", "request", "-i", "shell", "click-highlight", f"{x},{y},{button}"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def run():
    os.makedirs(RT, exist_ok=True)
    with open(PID_FILE, "w", encoding="utf-8") as f:
        f.write(str(os.getpid()))

    devices = list(pointer_devices())
    if not devices:
        print("no pointer devices found (needs the 'input' group)", file=sys.stderr)
        sys.exit(1)

    sel = selectors.DefaultSelector()
    for dev in devices:
        sel.register(dev, selectors.EVENT_READ)

    def cleanup(*_a):
        try:
            os.remove(PID_FILE)
        except OSError:
            pass
        sys.exit(0)

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    last_fire = 0.0
    try:
        while True:
            for key, _mask in sel.select():
                dev = key.fileobj
                for event in dev.read():
                    if event.type != ecodes.EV_KEY or event.value != 1:
                        continue
                    button = BUTTON_NAMES.get(event.code)
                    if button is None:
                        continue
                    now = time.monotonic()
                    if now - last_fire < DEBOUNCE_S:
                        continue
                    last_fire = now
                    try:
                        x, y = cursor_pos()
                        notify(x, y, button)
                    except Exception as e:
                        print(f"click-highlight: {e}", file=sys.stderr)
    finally:
        cleanup()


def stop():
    try:
        with open(PID_FILE, encoding="utf-8") as f:
            pid = int(f.read().strip())
    except (OSError, ValueError):
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        os.remove(PID_FILE)
    except OSError:
        pass


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "start":
        run()
    elif cmd == "stop":
        stop()
    else:
        print(__doc__)
        sys.exit(1)
