--
-- Dev harness — NOT part of the real config.
--
--   Hyprland -c <repo>/verify.lua
--
-- Loads the real config, then round-trips every option we set to prove
-- it actually applied. This exists because hl.config accepts unknown
-- keys silently: "no errors in the log" does NOT mean "it worked".
--
-- Writes /tmp/hypr-verify.txt
--
local f = io.open("/tmp/hypr-verify.txt", "w")
local function w(s) f:write(s, "\n"); f:flush() end

require("conf.env")
require("conf.looks")
require("conf.input")
require("conf.rules")
require("conf.binds")
require("conf.autostart")

local expect = {
  { "general.gaps_in",                     5 },
  { "general.gaps_out",                    12 },
  { "general.border_size",                 2 },
  { "general.layout",                      "dwindle" },
  { "general.resize_on_border",            true },
  { "decoration.rounding",                 12 },
  { "decoration.inactive_opacity",         0.94 },
  { "decoration.blur.enabled",             true },
  { "decoration.blur.size",                6 },
  { "decoration.blur.passes",              3 },
  { "decoration.shadow.enabled",           true },
  { "decoration.shadow.range",             20 },
  { "dwindle.preserve_split",              true },
  { "dwindle.smart_resizing",              true },
  { "misc.disable_hyprland_logo",          true },
  { "misc.vrr",                            1 },
  { "debug.vfr",                           true },
  { "input.kb_layout",                     "us" },
  { "input.follow_mouse",                  1 },
  { "input.repeat_rate",                   40 },
  { "input.touchpad.natural_scroll",       true },
  { "input.touchpad.tap_to_click",         true },
  { "input.touchpad.tap_and_drag",         true },
  { "input.touchpad.disable_while_typing", true },
  { "input.touchpad.clickfinger_behavior", true },
  { "gestures.workspace_swipe_distance",   300 },
  { "gestures.workspace_swipe_forever",    true },
  { "binds.workspace_back_and_forth",      true },
  { "general.col.active_border",           nil },  -- just prove it reads
  { "general.col.inactive_border",         nil },
}

local pass, fail = 0, 0
for _, e in ipairs(expect) do
  local path, want = e[1], e[2]
  local ok, got = pcall(hl.get_config, path)

  -- gaps read back as {top,bottom,left,right}
  if type(got) == "table" and got.top ~= nil then got = got.top end

  local verdict
  if not ok or got == nil then
    verdict = "MISSING  (wrong option name — silently ignored)"
    fail = fail + 1
  elseif want == nil then
    verdict = "readable = " .. tostring(got)
    pass = pass + 1
  elseif type(want) == "number" and math.abs(got - want) < 0.001 then
    verdict = "ok"
    pass = pass + 1
  elseif got == want then
    verdict = "ok"
    pass = pass + 1
  else
    verdict = ("MISMATCH got=%s want=%s"):format(tostring(got), tostring(want))
    fail = fail + 1
  end
  w(("%-42s %s"):format(path, verdict))
end

w("")
w(("PASS %d   FAIL %d"):format(pass, fail))
f:close()
