#!/usr/bin/env python3
"""One short line for the lock screen: "27°  Mainly clear". Reads the forecast the shell
already cached (~/.local/state/hypr-shell/weather-cache.json), so it makes no network
request and shows no place name — a lock screen is public. Prints nothing when weather
is not set up or the cache is more than 3 hours old (a stale temperature is worse than
none)."""
import json, os, sys, time

F = os.path.join(os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state")), "hypr-shell", "weather-cache.json")
# WMO codes, same wording as the bar's weather panel (ags/widget/bar/weatherState.ts)
LABEL = {0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Fog",
         51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
         61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
         71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
         80: "Light showers", 81: "Showers", 82: "Violent showers", 85: "Snow showers", 86: "Snow showers",
         95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with hail"}
try:
    with open(F, encoding="utf-8") as f:
        d = json.load(f)
    if time.time() * 1000 - d["fetchedAt"] > 3 * 3600 * 1000:
        sys.exit(0)
    c = d["raw"]["current"]
    print("%d°  %s" % (round(c["temperature_2m"]), LABEL.get(c["weather_code"], "")))
except (OSError, ValueError, KeyError, TypeError):
    pass
