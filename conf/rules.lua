--
-- Window / workspace / layer rules.
-- Form: hl.window_rule({ match = { class = "..." }, <props> })
--
-- ⚠️ These are REGEX (Hyprland matches with RE2), NOT Lua patterns. The
-- Lua escapes `%-` and `%.` that stood here matched a literal "%-" / "%."
-- — so every hyphenated or dotted class below silently never matched and
-- its window opened tiled (verified by spawning each one). In a regex a
-- plain `-` needs no escape and a literal dot is `[.]`. Rules that don't
-- match do NOT error: test with `kitty --class <name>` and read `.floating`.
local float = {
  "^(pavucontrol)$",
  "^(blueman-manager)$",
  "^(nm-connection-editor)$",
  "^(org[.]pulseaudio[.]pavucontrol)$",
  "^(xdg-desktop-portal-gtk)$",
  "^(qt5ct)$",
  "^(qt6ct)$",
}

for _, class in ipairs(float) do
  hl.window_rule({ match = { class = class }, float = true })
end

-- Picture-in-picture: float, pin, keep out of the way
hl.window_rule({
  match = { title = "^(Picture-in-Picture)$" },
  float = true,
  pin   = true,
  size  = "480 270",
  -- bottom-right, monitor-relative. NOT "100%-500 100%-300": that hyprlang
  -- percent syntax is silently ignored under the Lua config (the window just
  -- opened centred). Expressions in parentheses work; verified by probing.
  move  = "(monitor_w-500) (monitor_h-300)",
})

-- File-chooser style dialogs
hl.window_rule({ match = { title = "^(Open File|Save File|Save As|Open Folder)$" }, float = true })

-- Never idle-lock while something is fullscreen (video)
hl.window_rule({ match = { fullscreen = true }, idle_inhibit = "fullscreen" })

-- NOTE: there is no `floating` / `tiled` match property — both are
-- rejected as "unknown match property". Valid matchers confirmed so
-- far: class, title, fullscreen, xwayland. So a "square off tiled
-- windows" rule isn't expressible here; rounding stays global.

--
-- Workspace rules: 1-9 persist so the bar always has something to show.
--
-- Deliberately NOT pinned to a monitor. These were originally
-- `monitor = "eDP-1"`, which is a trap: a workspace_rule naming an
-- output that does not exist right now is INERT — the workspaces
-- simply are not created. That made them vanish on any other output
-- (an external display, or a nested test instance), which is how the
-- bar ended up with nothing highlighted in testing.
--
-- A conditional pin is not possible here either: monitors are not
-- enumerable at config-parse time. `hl.get_monitors()` returns an
-- EMPTY table while the config body runs and only fills in by
-- `hyprland.start` (verified), so there is nothing to branch on at the
-- point these rules have to be declared.
--
--
-- Per-workspace layouts (Hyprland 0.54+; scrolling and monocle are built in, no plugin).
-- `layout` in a workspace_rule was verified by reading tiledLayout back for a window-less
-- workspace, and by re-tiling real windows when the rule is changed at runtime.
--   dwindle    windows split the space (a binary tree): the default, for terminals and editors
--   scrolling  windows are columns on an endless strip you scroll along: docs, browsers, chat
--   monocle    one window fills the workspace, the rest stack behind it: focus, video
-- SUPER+ALT+Space cycles the layout of the CURRENT workspace at runtime (see binds.lua);
-- a config reload puts it back to what this table says.
local LAYOUTS = { [7] = "scrolling", [8] = "scrolling", [9] = "monocle" }

for i = 1, 9 do
  hl.workspace_rule({
    workspace  = tostring(i),
    persistent = i <= 5,
    layout     = LAYOUTS[i] or "dwindle",
  })
end

--
-- Named project workspaces used to live here (web / hackathon / rice /
-- research, persistent so the bar always showed them). REMOVED
-- 2026-09-01: they were only ever empty, so all they did was put four
-- dead chips in the bar. A workshop now opens on whatever workspace you
-- are already on — see the SUPER+P submap in conf/binds.lua.
--
-- The AGS Workspaces widget still has its named-workspace branch
-- (negative ids, `w/h/r/s` ordering). It is dormant rather than wrong:
-- nothing creates a named workspace now, so the branch matches nothing.
-- Left in place because it is the correct handling if one ever appears.
--
--
-- Layer rules: blur the shell surfaces AGS puts up.
-- Namespaces must match the ones the AGS windows are given.
--
--
-- ignore_alpha matters more than the blur flag does. A layer window is
-- blurred across its WHOLE surface, and the bar's window is the full
-- 1920x50 strip with one small capsule painted in the middle of it —
-- so without a threshold Hyprland blurs a full-width band of wallpaper
-- that nothing is drawn on. Invisible over a smooth gradient, obvious
-- the moment the wallpaper has detail in it. 0.1 = leave anything
-- under 10% alpha alone, which is the value his pre-rebuild rice used
-- on every one of these namespaces.
for _, ns in ipairs({ "bar", "notifications", "launcher", "rofi", "cheatsheet", "osd", "control-center",
                      "wallpaper-switcher", "switcher" }) do
  hl.layer_rule({ match = { namespace = ns }, blur = true })
  hl.layer_rule({ match = { namespace = ns }, ignore_alpha = 0.1 })
  -- xray = blur the WALLPAPER, not whatever window happens to sit
  -- under the capsule. Two reasons, both good: the bar's tint stops
  -- lurching every time a dark terminal takes focus, and the blur
  -- source becomes a static image, which is a large saving when the
  -- capsule is spring-animating its width and re-blurring every frame.
  hl.layer_rule({ match = { namespace = ns }, xray = true })
end

-- NB: rofi registers its layer surface as namespace "rofi", not
-- "launcher" — the launcher was never blurred until "rofi" joined the
-- list above (verified with `hyprctl layers` while it was open).

-- Menus/tooltips the bar puts up are separate surfaces; blur them too
-- or a popover over the glass capsule lands as a flat opaque rectangle.
hl.layer_rule({ match = { namespace = "bar" }, blur_popups = true })
hl.layer_rule({ match = { namespace = "launcher" }, blur_popups = true })
