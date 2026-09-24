#!/usr/bin/env python3
"""Set the weather location.   weather-city.py "Berlin"   [--pick N]

Looks the city up ONCE with Open-Meteo's geocoder (only the city name is
sent — no IP address lookups anywhere) and saves the coordinates to
~/.local/state/hypr-shell/weather.json. The shell reads that file; nothing
else about you leaves the machine (each refresh sends just the saved
latitude/longitude to api.open-meteo.com).

Several places share a name, so the candidates are printed; the first
result (Open-Meteo ranks by population) is used unless --pick N is given.
"""
import json, os, sys, urllib.parse, urllib.request

STATE = os.path.join(os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state")), "hypr-shell", "weather.json")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    pick = 1
    if "--pick" in sys.argv:
        pick = int(sys.argv[sys.argv.index("--pick") + 1]); args = [a for a in args if a != str(pick)]
    if not args:
        print(__doc__); return 2
    q = urllib.parse.urlencode({"name": args[0], "count": 6, "language": "en", "format": "json"})
    with urllib.request.urlopen("https://geocoding-api.open-meteo.com/v1/search?" + q, timeout=15) as r:
        res = json.load(r).get("results") or []
    if not res:
        print(f"no place found for {args[0]!r}"); return 1
    for i, p in enumerate(res, 1):
        print(f"  {i}. {p['name']}, {p.get('admin1','?')}, {p.get('country','?')}  ({p['latitude']:.3f}, {p['longitude']:.3f})"
              f"  pop={p.get('population','?')}  {'<- chosen' if i == pick else ''}")
    p = res[pick - 1]
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE, "w", encoding="utf-8") as f:
        json.dump({"name": p["name"], "region": p.get("admin1", ""), "country": p.get("country", ""),
                   "lat": p["latitude"], "lon": p["longitude"], "tz": p.get("timezone", "auto")}, f, indent=1)
    print("saved ->", STATE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
