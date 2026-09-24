#!/usr/bin/env python3
"""Manage the world clocks shown under the calendar (click the bar clock).

  worldclock.py add "Tokyo"          add a city (matched against the IANA zone names)
  worldclock.py add "Asia/Tokyo" "Tokyo office"    add a zone with your own label
  worldclock.py remove "Tokyo"
  worldclock.py list
  worldclock.py clear

The list lives in ~/.local/state/hypr-shell/worldclock.json; the shell re-reads it every
half minute. Matching: an exact zone id (America/New_York), else a city name
("new york", "tokyo"), with a few aliases for places whose zone is named after another
city (delhi/mumbai -> Asia/Kolkata). If a name is ambiguous the candidates are listed.
"""
import json, os, sys, zoneinfo

FILE = os.path.join(os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state")), "hypr-shell", "worldclock.json")
ALIASES = {"delhi": "Asia/Kolkata", "mumbai": "Asia/Kolkata", "bombay": "Asia/Kolkata", "bangalore": "Asia/Kolkata",
           "bengaluru": "Asia/Kolkata", "india": "Asia/Kolkata", "ahmedabad": "Asia/Kolkata", "vadodara": "Asia/Kolkata",
           "sf": "America/Los_Angeles", "san francisco": "America/Los_Angeles", "seattle": "America/Los_Angeles",
           "nyc": "America/New_York", "boston": "America/New_York", "toronto": "America/Toronto",
           "beijing": "Asia/Shanghai", "china": "Asia/Shanghai", "korea": "Asia/Seoul", "uk": "Europe/London",
           "berlin": "Europe/Berlin", "utc": "UTC"}


def load():
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
        return [c for c in d if isinstance(c, dict) and c.get("tz")]
    except (OSError, ValueError):
        return []


def save(cities):
    os.makedirs(os.path.dirname(FILE), exist_ok=True)
    tmp = FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cities, f, ensure_ascii=False)
    os.replace(tmp, FILE)  # atomic: the shell may be reading it


def pretty(zone):
    return zone.split("/")[-1].replace("_", " ")


def find(query):
    zones = zoneinfo.available_timezones()
    q = query.strip()
    if q in zones: return [q]
    key = q.lower().replace("_", " ")
    if key in ALIASES: return [ALIASES[key]]
    exact = [z for z in zones if pretty(z).lower() == key]
    if exact: return sorted(exact)
    return sorted(z for z in zones if key in pretty(z).lower() and not z.startswith(("Etc/", "SystemV/", "US/", "posix", "right")))


def main(a):
    cities = load()
    if a[:1] == ["add"] and len(a) >= 2:
        hits = find(a[1])
        if not hits:
            print("no zone matches %r (try the city name, or an id like Europe/Paris)" % a[1]); return 1
        if len(hits) > 1:
            print("%r is ambiguous, use one of:\n  %s" % (a[1], "\n  ".join(hits[:12]))); return 1
        tz = hits[0]
        alias = ALIASES.get(a[1].strip().lower().replace("_", " "))
        name = a[2] if len(a) > 2 else (a[1].strip().title() if alias else pretty(tz))  # "delhi" stays "Delhi"
        if any(c["tz"] == tz for c in cities):
            print("%s is already on the list" % tz); return 0
        cities.append({"name": name, "tz": tz}); save(cities)
        print("added %s (%s)" % (name, tz)); return 0
    if a[:1] == ["remove"] and len(a) >= 2:
        k = a[1].lower()
        keep = [c for c in cities if k not in (c["name"].lower(), c["tz"].lower())]
        if len(keep) == len(cities):
            print("nothing called %r on the list" % a[1]); return 1
        save(keep); print("removed %s" % a[1]); return 0
    if a[:1] == ["list"]:
        for c in cities: print("%-20s %s" % (c["name"], c["tz"]))
        return 0
    if a[:1] == ["clear"]:
        save([]); print("cleared"); return 0
    print(__doc__); return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
