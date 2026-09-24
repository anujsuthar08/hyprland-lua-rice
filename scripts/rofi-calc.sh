#!/usr/bin/env bash
# rofi script mode: a calculator.  `rofi -show calc` or the "Calc" tab.
#
#   type an expression, Enter -> the result appears; Enter on it copies it.
#
# The expression is parsed with Python's `ast` and only arithmetic, a few
# math functions and the constants pi/e are allowed — it is NEVER eval()'d
# as code, so typing something hostile into the launcher can't run it.
#
# rofi script-mode protocol (rofi-script(5)): ROFI_RETV 0 = first call,
# 1 = a listed row was chosen, 2 = custom text was entered. A script that
# prints no rows makes rofi quit, so the first call prints a hint row.
set -u

row() { printf '%s\0info\x1f%s\n' "$1" "$2"; }

evaluate() {
  python3 - "$1" <<'PY'
import ast, math, operator, sys
expr = sys.argv[1].strip().replace("^", "**")
if not expr or len(expr) > 200:
    sys.exit(1)
OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
       ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv,
       ast.Mod: operator.mod, ast.Pow: operator.pow}
UN = {ast.UAdd: operator.pos, ast.USub: operator.neg}
FN = {"sqrt": math.sqrt, "sin": math.sin, "cos": math.cos, "tan": math.tan,
      "ln": math.log, "log": math.log10, "exp": math.exp, "abs": abs,
      "round": round, "floor": math.floor, "ceil": math.ceil,
      "fact": math.factorial}
CONST = {"pi": math.pi, "e": math.e}

def ev(n):
    if isinstance(n, ast.Expression): return ev(n.body)
    if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)): return n.value
    if isinstance(n, ast.Name) and n.id in CONST: return CONST[n.id]
    if isinstance(n, ast.UnaryOp) and type(n.op) in UN: return UN[type(n.op)](ev(n.operand))
    if isinstance(n, ast.BinOp) and type(n.op) in OPS:
        a, b = ev(n.left), ev(n.right)
        if isinstance(n.op, ast.Pow) and abs(b) > 1000: raise ValueError("exponent too large")
        return OPS[type(n.op)](a, b)
    if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in FN and not n.keywords:
        return FN[n.func.id](*[ev(a) for a in n.args])
    raise ValueError("not allowed")

# ── unit conversion: "<amount> <unit> in|to|as <unit>" ──────────────────
# The amount may itself be an expression ("2*3 km to m"). Categories: length,
# mass, volume, time, speed, area, data, temperature, currency. Currency
# rates come from the network (see CURRENCY section below) and are cached
# to disk, so a currency query only ever blocks on a fetch when the cache
# is missing or stale — same shape as weatherState.ts's refresh/cache/stale
# pattern, just synchronous since this whole script is one-shot per query.
import re, os, json, time, subprocess
CONV = re.compile(r"^\s*(.+?)\s*([A-Za-z°µ][A-Za-z°µ/0-9]*)\s+(?:in|to|as|into)\s+([A-Za-z°µ][A-Za-z°µ/0-9]*)\s*$", re.I)

T = {  # unit -> (category, factor to the category's base unit)
    "length": {"mm": .001, "cm": .01, "m": 1, "km": 1000, "in": .0254, "ft": .3048, "yd": .9144, "mi": 1609.344, "nmi": 1852},
    "mass": {"mg": 1e-6, "g": .001, "kg": 1, "t": 1000, "oz": .028349523125, "lb": .45359237, "st": 6.35029318},
    "volume": {"ml": .001, "l": 1, "m3": 1000, "tsp": .00492892159375, "tbsp": .01478676478125, "floz": .0295735295625,
               "cup": .2365882365, "pt": .473176473, "qt": .946352946, "gal": 3.785411784},
    "time": {"ms": .001, "s": 1, "min": 60, "h": 3600, "d": 86400, "wk": 604800, "yr": 31557600},
    "speed": {"m/s": 1, "km/h": 1000 / 3600, "mph": .44704, "kn": 1852 / 3600, "ft/s": .3048},
    "area": {"cm2": 1e-4, "m2": 1, "km2": 1e6, "ha": 1e4, "ft2": .09290304, "ac": 4046.8564224, "mi2": 2589988.110336},
}
DATA = {"b": .125, "B": 1, "KB": 1e3, "MB": 1e6, "GB": 1e9, "TB": 1e12,
        "KiB": 1024, "MiB": 2**20, "GiB": 2**30, "TiB": 2**40}  # case matters: b (bit) vs B (byte)
ALIAS = {
    "millimeter": "mm", "millimetre": "mm", "centimeter": "cm", "centimetre": "cm", "meter": "m", "metre": "m",
    "kilometer": "km", "kilometre": "km", "inch": "in", "inches": "in", "foot": "ft", "feet": "ft", "yard": "yd",
    "mile": "mi", "miles": "mi", "milligram": "mg", "gram": "g", "kilogram": "kg", "kilo": "kg", "kilos": "kg",
    "tonne": "t", "ounce": "oz", "pound": "lb", "lbs": "lb", "stone": "st", "milliliter": "ml", "millilitre": "ml",
    "liter": "l", "litre": "l", "liters": "l", "litres": "l", "teaspoon": "tsp", "tablespoon": "tbsp", "cups": "cup",
    "pint": "pt", "quart": "qt", "gallon": "gal", "gallons": "gal", "second": "s", "sec": "s", "seconds": "s",
    "minute": "min", "minutes": "min", "mins": "min", "hour": "h", "hours": "h", "hr": "h", "hrs": "h", "day": "d",
    "days": "d", "week": "wk", "weeks": "wk", "year": "yr", "years": "yr", "kmh": "km/h", "kph": "km/h", "knot": "kn",
    "knots": "kn", "sqm": "m2", "sqft": "ft2", "acre": "ac", "acres": "ac", "hectare": "ha",
    "celsius": "c", "°c": "c", "centigrade": "c", "fahrenheit": "f", "°f": "f", "kelvin": "k",
}
TEMP = {"c", "f", "k"}

DATA_LOW = {"kb": "KB", "mb": "MB", "gb": "GB", "tb": "TB", "kib": "KiB", "mib": "MiB", "gib": "GiB", "tib": "TiB",
            "byte": "B", "bytes": "B", "bit": "b", "bits": "b",
            "kilobyte": "KB", "kilobytes": "KB", "megabyte": "MB", "megabytes": "MB", "gigabyte": "GB",
            "gigabytes": "GB", "terabyte": "TB", "terabytes": "TB"}

# ── currency: "<amount> <code> in|to|as <code>" ─────────────────────────
# Rates from frankfurter.dev (ECB reference rates, no key, updated once a
# weekday) - the same "keyless, network can fail" shape as weatherState.ts,
# cached to disk so most queries never touch the network at all.
CUR_CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "hypr-shell", "currency.json")
CUR_TTL = 12 * 3600  # ECB publishes once a day; no need to refetch more than a couple times a day
CUR_ALIAS = {  # common words, not codes (codes are matched case-insensitively below)
    "dollar": "USD", "dollars": "USD", "buck": "USD", "bucks": "USD",
    "euro": "EUR", "euros": "EUR",
    "pound": "GBP", "pounds": "GBP", "quid": "GBP", "sterling": "GBP",
    "rupee": "INR", "rupees": "INR",
    "yen": "JPY",
    "yuan": "CNY", "rmb": "CNY", "renminbi": "CNY",
    "franc": "CHF", "francs": "CHF",
    "krona": "SEK", "kronor": "SEK", "krone": "NOK", "kroner": "NOK",
    "won": "KRW", "real": "BRL", "reais": "BRL", "peso": "MXN", "pesos": "MXN",
    "rand": "ZAR", "lira": "TRY", "baht": "THB", "ringgit": "MYR",
    "rupiah": "IDR", "shekel": "ILS", "shekels": "ILS", "zloty": "PLN", "forint": "HUF",
}
# Gate ONLY (avoids a network hit for garbage 3-letter strings) - real ISO
# 4217 codes, a superset of what frankfurter.dev actually carries; whether
# a code the gate lets through is actually priced is checked against the
# live rates dict, not this list.
ISO_CODES = {
    "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CNY", "HKD", "NZD", "SEK", "KRW",
    "SGD", "NOK", "MXN", "ZAR", "TRY", "BRL", "TWD", "DKK", "PLN", "THB", "IDR", "HUF",
    "CZK", "ILS", "CLP", "PHP", "AED", "COP", "SAR", "MYR", "RON", "INR", "RUB", "PKR",
    "BDT", "VND", "EGP", "NGN", "UAH", "KES", "ARS", "ISK", "BGN", "HRK",
}

def currency_code(u):
    lo = CUR_ALIAS.get(u.lower())
    if lo: return lo
    return u.upper() if u.upper() in ISO_CODES else None

_rates = None  # memoized per script run: resolve() may check both sides
_rates_stale = False  # a fetch failed and we fell back to an old cache
def get_rates():
    global _rates, _rates_stale
    if _rates is not None:
        return _rates
    cached = None
    try:
        with open(CUR_CACHE, encoding="utf-8") as f:
            cached = json.load(f)
    except (OSError, ValueError):
        pass
    if cached and time.time() - cached.get("fetched_at", 0) < CUR_TTL:
        _rates = cached["rates"]
        return _rates
    try:
        out = subprocess.run(
            ["curl", "-fsS", "--max-time", "6", "--retry", "1", "--retry-delay", "1",
             "https://api.frankfurter.dev/v1/latest?from=USD"],
            capture_output=True, text=True, timeout=8, check=True,
        )
        rates = json.loads(out.stdout)["rates"]
        rates["USD"] = 1.0  # the base is never included in its own rates dict
        os.makedirs(os.path.dirname(CUR_CACHE), exist_ok=True)
        with open(CUR_CACHE, "w", encoding="utf-8") as f:
            json.dump({"fetched_at": time.time(), "rates": rates}, f)
        _rates = rates
    except Exception:
        _rates = cached["rates"] if cached else False  # False = "tried and failed", not "unchecked"
        if cached: _rates_stale = True
    return _rates

def resolve(u):
    if u in DATA: return ("data", DATA[u])
    if u.lower() in DATA_LOW: return ("data", DATA[DATA_LOW[u.lower()]])
    k = u.lower()
    k = ALIAS.get(k, k)
    if k in TEMP: return ("temp", k)
    if k not in ALIAS.values() and k.endswith("s") and k[:-1] in ALIAS: k = ALIAS[k[:-1]]
    elif k not in sum((list(d) for d in T.values()), []) and k.endswith("s"): k = k[:-1]
    k = ALIAS.get(k, k)
    for cat, d in T.items():
        if k in d: return (cat, d[k])
    code = currency_code(u)
    if code:
        rates = get_rates()
        if rates and code in rates:
            return ("currency", 1.0 if code == "USD" else 1.0 / rates[code])
    return None

def to_c(v, u): return v if u == "c" else (v - 32) * 5 / 9 if u == "f" else v - 273.15
def from_c(v, u): return v if u == "c" else v * 9 / 5 + 32 if u == "f" else v + 273.15

def convert(e):
    m = CONV.match(e)
    if not m: return None
    amount, a, b = m.group(1), m.group(2), m.group(3)
    ra, rb = resolve(a), resolve(b)
    if not ra or not rb:
        # A currency-shaped token (a real ISO code) that didn't resolve means the
        # rates fetch failed outright, or frankfurter.dev just doesn't carry that
        # code - either way, say so instead of falling through to a bare "cannot
        # evaluate" that looks like the input was gibberish.
        bad = a if not ra and currency_code(a) else b if not rb and currency_code(b) else None
        if bad:
            rates = get_rates()
            if rates is False:
                raise ValueError("cannot convert %s: exchange rates unavailable (offline, nothing cached yet)" % bad)
            raise ValueError("cannot convert %s: not one of frankfurter.dev's supported currencies" % bad)
        return None                              # not a unit phrase: let the calculator try it
    if ra[0] != rb[0]: raise ValueError("cannot convert %s to %s" % (a, b))
    n = ev(ast.parse(amount, mode="eval"))
    if ra[0] == "temp": out = from_c(to_c(n, ra[1]), rb[1])
    else: out = n * ra[1] / rb[1]
    return ("%.6g" % out) + " " + b

try:
    r = convert(expr)
    if r is not None:
        print(r)
        if _rates_stale: print("STALE")   # 2nd line: bash strips it from the copyable value
        sys.exit(0)
    v = ev(ast.parse(expr, mode="eval"))
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15: v = int(v)
    print(v if isinstance(v, int) else f"{v:.12g}")
except ValueError as e:
    if str(e).startswith("cannot convert"): print(e)   # say WHY, instead of the generic message
    sys.exit(1)
except Exception:
    sys.exit(1)
PY
}

case "${ROFI_RETV:-0}" in
  0)
    printf '\0prompt\x1fCalc\n\0message\x1fEnter evaluates  ·  e.g. 12*(3+4)   2^10   5 km in mi   98.6 f to c   20 usd to eur\n'
    printf ' \0nonselectable\x1ftrue\n'
    ;;
  2)
    q="${1:-}"
    raw=$(evaluate "$q"); rc=$?
    if [ "$rc" -eq 0 ]; then
      out="${raw%%$'\n'*}"                       # 1st line only: the STALE marker (if any) never enters the copy value
      note=""; [ "$raw" != "$out" ] && note="  (offline, using cached exchange rates)"
      printf '\0prompt\x1fCalc\n\0message\x1f%s = %s%s   (Enter copies the result)\n' "$q" "$out" "$note"
      row "$out" "$out"
    else
      printf '\0message\x1f%s\n' "${out:-cannot evaluate: $q}"
      printf ' \0nonselectable\x1ftrue\n'
    fi
    ;;
  1)
    # a result row was chosen: copy it and let rofi close (no rows printed)
    [ -n "${ROFI_INFO:-}" ] && printf '%s' "$ROFI_INFO" | wl-copy
    ;;
esac
