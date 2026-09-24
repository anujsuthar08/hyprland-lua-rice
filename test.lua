--
-- Dev harness — NOT the real config.
--
--   Hyprland -c <repo>/test.lua
--
-- Loads the real config, runs the shell from the DEV directory
-- (<repo>/ags), opens windows, pops rofi with the dev theme, then
-- screenshots. Lets us see the whole thing before deploying.
--
require("conf.env")
require("conf.looks")
require("conf.input")
require("conf.rules")
require("conf.binds")
-- deliberately NOT conf.autostart

-- the repo dir = the first package.path entry ("<dir>/?.lua"); same trick conf/ used to use
local REPO = package.path:match("^(.-)/%?%.lua")

hl.on("hyprland.start", function()
  hl.exec_cmd("ags run -d " .. REPO .. "/ags > /tmp/ags-test.log 2>&1")
  hl.exec_cmd("sh -c 'sleep 2; kitty'")
  hl.exec_cmd("sh -c 'sleep 5; cd " .. REPO .. "/rofi && rofi -config ./config.rasi -theme ./theme.rasi -show drun > /tmp/rofi-test.log 2>&1'")
  hl.exec_cmd("sh -c \"sleep 9; hyprctl configerrors > /tmp/cfgerr.txt 2>&1; grim /tmp/nested-shot.png 2>/dev/null\"")
end)
