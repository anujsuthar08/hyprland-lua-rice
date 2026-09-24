#!/usr/bin/env python3
"""Network toggles for the Control Center: airplane mode, VPN, hotspot.

  net-toggles.py state                 JSON: what exists and what is on
  net-toggles.py airplane on|off
  net-toggles.py vpn <profile> up|down
  net-toggles.py hotspot on|off

Kept out of the shell so the decisions can be tested with a fake `nmcli`.

Design rules (each one is a mistake this avoids):
  * Airplane mode = block ALL radios (rfkill), and it only reads "on" when Wi-Fi AND
    Bluetooth are both soft-blocked; one radio off is not airplane mode.
  * A VPN tile exists only if NetworkManager has a vpn/wireguard profile.
  * A hotspot on a machine whose ONLY connection is its one Wi-Fi adapter would
    disconnect you from the internet the moment it started, so `hotspot on` refuses
    unless another uplink (Ethernet, a phone over USB) is connected, and `state`
    reports the hotspot as unavailable in that case.
  * The hotspot password is generated once, kept in a 0600 file, never printed to logs.
"""
import json, os, secrets, socket, subprocess, sys

STATE_DIR = os.path.join(os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state")), "hypr-shell")
HOTSPOT_FILE = os.path.join(STATE_DIR, "hotspot.json")
HOTSPOT_CON = "hypr-hotspot"


def run(*cmd, timeout=15):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout
    except (OSError, subprocess.TimeoutExpired):
        return 1, ""


def nm(*args):
    rc, out = run("nmcli", "-t", *args)
    return out.splitlines() if rc == 0 else []


def split(line):  # nmcli -t escapes ':' inside a field as '\:'
    out, cur, esc = [], "", False
    for ch in line:
        if esc: cur += ch; esc = False
        elif ch == "\\": esc = True
        elif ch == ":": out.append(cur); cur = ""
        else: cur += ch
    out.append(cur)
    return out


def rfkill_blocked(kind):
    rc, out = run("rfkill", "-n", "-o", "SOFT", "list", kind)
    vals = [l.strip() for l in out.splitlines() if l.strip()]
    return bool(vals) and all(v == "blocked" for v in vals)


def connections():
    return [split(l) for l in nm("-f", "NAME,TYPE,DEVICE,ACTIVE", "connection", "show")]


def other_uplink():
    """A connected device that is NOT the wifi adapter (ethernet, usb tether…)."""
    for l in nm("-f", "DEVICE,TYPE,STATE", "device"):
        dev, typ, st = (split(l) + ["", "", ""])[:3]
        if typ in ("ethernet", "gsm") and st.startswith("connected") and "externally" not in st:
            return True
    return False


def wifi_device():
    for l in nm("-f", "DEVICE,TYPE", "device"):
        dev, typ = (split(l) + ["", ""])[:2]
        if typ == "wifi":
            return dev
    return None


def state():
    rows = [(c + [""] * 4)[:4] for c in connections()]  # name, type, device, active
    vpns = [{"name": n, "active": act == "yes"} for n, t, d, act in rows if t in ("vpn", "wireguard")]
    active_hs = any(n == HOTSPOT_CON and act == "yes" for n, t, d, act in rows)
    return {
        "airplane": rfkill_blocked("wlan") and rfkill_blocked("bluetooth"),
        "vpns": vpns,
        "hotspot": {"active": active_hs, "available": active_hs or (wifi_device() is not None and other_uplink())},
    }


def notify(title, body=""):
    run("notify-send", "-a", "Network", title, body)


def airplane(on):
    return run("rfkill", "block" if on else "unblock", "all")[0]


def vpn(name, up):
    rc, _ = run("nmcli", "connection", "up" if up else "down", "id", name, timeout=45)
    if rc != 0: notify("VPN failed", name)
    return rc


def hotspot(on):
    if not on:
        return run("nmcli", "connection", "down", HOTSPOT_CON)[0]
    if not other_uplink():
        notify("Hotspot not started", "This machine's only connection is its Wi-Fi adapter; starting a hotspot would disconnect you.")
        return 2
    dev = wifi_device()
    if not dev: return 3
    cfg = {}
    try:
        with open(HOTSPOT_FILE, encoding="utf-8") as f: cfg = json.load(f)
    except (OSError, ValueError):
        pass
    if not cfg.get("password"):
        cfg = {"ssid": socket.gethostname()[:24], "password": secrets.token_urlsafe(9)}
        os.makedirs(STATE_DIR, exist_ok=True)
        fd = os.open(HOTSPOT_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f: json.dump(cfg, f)
    run("nmcli", "connection", "delete", HOTSPOT_CON)
    rc, _ = run("nmcli", "device", "wifi", "hotspot", "ifname", dev, "con-name", HOTSPOT_CON,
                "ssid", cfg["ssid"], "password", cfg["password"], timeout=30)
    notify("Hotspot on" if rc == 0 else "Hotspot failed", "Network: %s   Password: %s" % (cfg["ssid"], cfg["password"]) if rc == 0 else "")
    return rc


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["state"]: print(json.dumps(state()))
    elif a[:1] == ["airplane"] and len(a) == 2: sys.exit(airplane(a[1] == "on"))
    elif a[:1] == ["vpn"] and len(a) == 3: sys.exit(vpn(a[1], a[2] == "up"))
    elif a[:1] == ["hotspot"] and len(a) == 2: sys.exit(hotspot(a[1] == "on"))
    else: print(__doc__); sys.exit(1)
