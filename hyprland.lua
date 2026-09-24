--
-- Hyprland 0.56.x — entry point
--
-- Language is LUA, not hyprlang. See NOTES/02-lua-api-verified.md for
-- the empirically verified API; several things in the wiki and in
-- circulating dotfiles are wrong for 0.56.
--
-- package.path is set to THIS FILE'S directory, so `require("conf.x")`
-- resolves the same whether we run from the clone (testing) or from
-- ~/.config/hypr (deployed). Verified, not assumed.
--
-- Test:  Hyprland -c <repo>/hyprland.lua
--

-- Machine-local overrides: untracked files that never leave this machine (see
-- conf/local.example.lua). `conf.local` loads FIRST (monitors, GPU/driver env);
-- `conf.local_late` loads LAST (anything that must override the shared config).
-- A file that does not exist is fine; one that EXISTS but is broken is reported
-- (log + notification) rather than silently skipped — and does not abort the rest.
local function load_local(mod)
  local ok, err = pcall(require, mod)
  if not ok and not tostring(err):find("module '" .. mod .. "' not found", 1, true) then
    hl.print("[local] " .. mod .. " failed: " .. tostring(err))
    pcall(function()
      hl.notification.create({ text = mod .. " failed: " .. tostring(err), timeout = 10000, icon = "error" })
    end)
  end
end

load_local("conf.local")
require("conf.env")
require("conf.looks")
require("conf.input")
require("conf.rules")
require("conf.binds")
require("conf.autostart")
load_local("conf.local_late")
