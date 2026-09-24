#!/usr/bin/env python3
"""Audit every hl.config option against the RUNNING compositor.

hl.config accepts unknown keys silently, and `check.sh` cannot see a
misspelt or dropped option. This loads conf/theme, conf/looks and
conf/input under a stub `hl` (system lua5.4), records every leaf passed to
hl.config, then asks `hyprctl getoption <path> -j` for each one:

  MISSING  the option name does not exist (it was silently dropped)
  DIFFER   it exists but the live value is not what the config sets

Run it in the live session after editing looks.lua / input.lua.
  scripts/audit-options.py
(Gradients and `drag_lock`-style enums are compared loosely; window/layer
RULES are not covered — test those by spawning a window, see CLAUDE.md.)
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))  # the repo, wherever it is cloned
LUA = r'''
package.path = "%s/?.lua;" .. package.path
local out = {}
local function isleaf(v) return type(v) ~= "table" or v.colors ~= nil end
local function flatten(prefix, t)
  for k, v in pairs(t) do
    local key = prefix == "" and tostring(k) or (prefix .. ":" .. tostring(k))
    if isleaf(v) then
      local ty = type(v); if ty == "table" then ty = "gradient"; v = "gradient" end
      out[#out + 1] = key .. "\t" .. ty .. "\t" .. tostring(v)
    else flatten(key, v) end
  end
end
local stub; stub = setmetatable({}, { __index = function() return stub end, __call = function() return stub end })
hl = setmetatable({ config = function(t) flatten("", t) end }, { __index = function() return stub end })
for _, m in ipairs({ "conf.theme", "conf.looks", "conf.input" }) do pcall(require, m) end
for _, l in ipairs(out) do print(l) end
''' % ROOT


def argb(s):
    m = re.match(r"rgba\(([0-9a-fA-F]{6})([0-9a-fA-F]{2})?\)", s)
    if m: return ((m.group(2) or "ff") + m.group(1)).lower()
    m = re.match(r"rgb\(([0-9a-fA-F]{6})\)", s)
    if m: return "ff" + m.group(1).lower()
    m = re.match(r"#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$", s)
    if m: return ((m.group(2) or "ff") + m.group(1)).lower()
    return s.lower()


def main():
    dump = subprocess.run(["lua5.4", "-e", LUA], capture_output=True, text=True, cwd=ROOT)
    rows = [l.split("\t") for l in dump.stdout.splitlines() if l.count("\t") == 2]
    ok, problems = 0, []
    for path, ty, val in rows:
        r = subprocess.run(["hyprctl", "getoption", path, "-j"], capture_output=True, text=True, timeout=10)
        try: j = json.loads(r.stdout)
        except ValueError:
            problems.append(f"MISSING  {path}  (configured {ty} {val}): {r.stdout.strip()[:60]}"); continue
        if ty == "gradient": ok += 1; continue
        if "bool" in j: live, want = j["bool"], val == "true"
        elif "css" in j: live, want = float(j["css"].split()[0]), float(val)
        elif "int" in j and ty == "number": live, want = float(j["int"]), float(val)
        elif "int" in j and ty == "boolean": live, want = bool(j["int"]), val == "true"
        elif "float" in j: live, want = float(j["float"]), float(val)
        elif "gradient" in j: live, want = j["gradient"].split()[0].lower(), argb(val)
        elif "str" in j: live, want = j["str"], val
        elif "custom" in j: live, want = j["custom"], val
        else: problems.append(f"UNKNOWN  {path}: {json.dumps(j)[:80]}"); continue
        same = abs(live - want) < 1e-4 if isinstance(live, float) and isinstance(want, float) else live == want
        if same: ok += 1
        else: problems.append(f"DIFFER   {path}: configured {want!r}, live {live!r}")
    print(f"checked {len(rows)} options: {ok} match, {len(problems)} problem(s)")
    for p in problems: print("  " + p)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
