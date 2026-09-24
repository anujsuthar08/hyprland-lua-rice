--
-- Keybinds.  vim hjkl on SUPER, arrow keys aliased so nothing is lost.
--
-- Every dispatcher form here was verified against 0.56.2. In particular:
--   * hl.dsp.workspace is a TABLE, not callable.
--     workspace switching is  hl.dsp.workspace.move{ id = N }
--   * there is NO hl.dsp.window.move_to_workspace.
--     it is  hl.dsp.window.move{ workspace = N }
--   * resize takes numeric x/y only: hl.dsp.window.resize{ x = 40, y = 0 }
--   * submap takes a plain STRING: hl.dsp.submap("resize")
--
local M = "SUPER"

-- Every bind carries a description, "Group: what it does". The AGS
-- cheat sheet (widget/Cheatsheet.tsx) is generated from
-- `hyprctl binds -j`, which returns these — so it can never drift from
-- what is actually bound. Descriptions ending in "#<n>" are collapsed
-- into one row (1..0 workspace keys, etc.).
local function bind(keys, desc, disp, opts)
  local o = { description = desc }
  for k, v in pairs(opts or {}) do o[k] = v end
  hl.bind(keys, disp, o)
end

-- Apps in one place so they're easy to swap
local apps = {
  terminal  = "kitty",
  launcher  = "rofi -show drun",
  runner    = "rofi -show run",
  windows   = "rofi -show window",
  -- brave, not zen: `xdg-settings get default-web-browser` says
  -- brave-browser.desktop, and ~/.config/BraveSoftware is the only
  -- browser profile on the box (zen is installed but has no ~/.zen,
  -- i.e. never actually run).
  browser   = "brave",
  editor    = "code",
  files     = "thunar",
  mixer     = "pavucontrol",
  -- NO --grace: hyprlock's grace period lets ANY input in the first N
  -- seconds dismiss the lock without a password. It fired on a trackpad
  -- brush right after SUPER+L, and (via hypridle's before_sleep_cmd) on
  -- resume from suspend, which is the whole point of locking.
  lock      = "hyprlock",
  -- the launcher's own "Clip" mode (scripts/rofi-clip.sh): same theme,
  -- and Shift+Delete removes an entry from the history
  clipboard = "rofi -show clip",
  calculator = "rofi -show calc",
  emoji     = "rofi -show emoji",
  -- Ctrl+Space on a listed note (rofi's built-in kb-row-select) pulls
  -- its text back into the entry box to edit — see rofi-note.py for
  -- why this needed to be built around a stock rofi keybinding rather
  -- than -kb-custom-N, which turned out to be reserved for mode-
  -- switching in this multi-mode launcher and never reaches the script.
  note      = "rofi -show note",
  timer     = "rofi -show timer",
  ask       = "rofi -show ask",
  powermenu = "$HOME/.config/hypr/scripts/powermenu.sh",
}

-- ── launching ──────────────────────────────────────────────────────
bind(M .. "+Return",       "Launch: Terminal", hl.dsp.exec_cmd(apps.terminal))
bind(M .. "+SPACE",        "Launch: App launcher", hl.dsp.exec_cmd(apps.launcher))
bind(M .. "+R",            "Launch: Run command", hl.dsp.exec_cmd(apps.runner))
bind(M .. "+TAB",          "Launch: Window switcher", hl.dsp.exec_cmd(apps.windows))
bind(M .. "+B",            "Launch: Browser", hl.dsp.exec_cmd(apps.browser))
bind(M .. "+C",            "Launch: Editor", hl.dsp.exec_cmd(apps.editor))
bind(M .. "+E",            "Launch: Files", hl.dsp.exec_cmd(apps.files))
bind(M .. "+V",            "Launch: Clipboard history", hl.dsp.exec_cmd(apps.clipboard))
bind(M .. "+EQUAL",        "Launch: Calculator", hl.dsp.exec_cmd(apps.calculator))
bind(M .. "+PERIOD",       "Launch: Emoji picker", hl.dsp.exec_cmd(apps.emoji))
bind(M .. "+SHIFT+E",     "Launch: Quick note", hl.dsp.exec_cmd(apps.note))
bind(M .. "+T",           "Launch: Timer / pomodoro", hl.dsp.exec_cmd(apps.timer))
bind(M .. "+SHIFT+A",     "Launch: Ask the local AI", hl.dsp.exec_cmd(apps.ask))
bind(M .. "+L",            "Session: Lock screen", hl.dsp.exec_cmd(apps.lock))
bind(M .. "+ESCAPE",       "Session: Power menu", hl.dsp.exec_cmd(apps.powermenu))

-- ── window management ──────────────────────────────────────────────
bind(M .. "+Q", "Windows: Close", hl.dsp.window.close())
bind(M .. "+SHIFT+Q", "Windows: Force kill", hl.dsp.window.kill())

-- Alt-Tab switcher (ags/widget/Switcher.tsx). Hold Alt, tap Tab to step (most recent first),
-- release Alt to switch. The release binds are the hyprswitch pattern: a `release` bind on the
-- Alt key itself, non_consuming so Alt still reaches apps. `transparent = true` is ESSENTIAL: without
-- it the release never fires once Tab has been pressed in between (verified; the hyprlang flag `t`). `commit` is a no-op when no switch
-- is in progress, so releasing Alt after ordinary Alt shortcuts does nothing.
local sw = "ags request -i shell switcher "
bind("ALT+Tab", "Windows: Alt-Tab switcher (hold Alt, Tab to step)", hl.dsp.exec_cmd(sw .. "next"))
bind("ALT+SHIFT+Tab", "Windows: Alt-Tab switcher, backwards", hl.dsp.exec_cmd(sw .. "prev"))
bind("ALT+Alt_L", "Windows: Alt-Tab switcher, switch on Alt release", hl.dsp.exec_cmd(sw .. "commit"), { release = true, transparent = true, non_consuming = true })
bind("ALT+Alt_R", "Windows: Alt-Tab switcher, switch on Alt release", hl.dsp.exec_cmd(sw .. "commit"), { release = true, transparent = true, non_consuming = true })
bind(M .. "+F", "Windows: Fullscreen", hl.dsp.window.fullscreen({}))
bind(M .. "+SHIFT+F", "Windows: Toggle floating", hl.dsp.window.float({ action = "toggle" }))
bind(M .. "+SHIFT+O", "Windows: Pseudo-tile", hl.dsp.window.pseudo())   -- moved off SUPER+P (project submap)
bind(M .. "+SHIFT+I", "Windows: Pin", hl.dsp.window.pin())
bind(M .. "+SHIFT+C", "Windows: Center", hl.dsp.window.center())
bind(M .. "+G", "Windows: Toggle group", hl.dsp.group.toggle())
-- (ALT+TAB used to be a bare cycle_next here; the switcher above replaces it. Both firing made
-- every Alt+Tab skip a window. NB: key names are case-insensitive to Hyprland, so "Tab" and
-- "TAB" are the SAME key even though scripts/check.sh compares them as different strings.)

-- ── focus / move / swap: hjkl with arrow aliases ───────────────────
local dirs = {
  { key = "H", arrow = "left", dir = "left", name = "Left" },
  { key = "J", arrow = "down", dir = "down", name = "Down" },
  { key = "K", arrow = "up", dir = "up", name = "Up" },
  { key = "L", arrow = "right", dir = "right", name = "Right" },
}

for _, d in ipairs(dirs) do
  -- focus  (SUPER+L is the lock bind, so focus-right is arrows-only)
  if d.key ~= "L" then
    bind(M .. "+" .. d.key, "Focus: " .. d.name, hl.dsp.focus({ direction = d.dir }))
  end
  bind(M .. "+" .. d.arrow, "Focus: " .. d.name, hl.dsp.focus({ direction = d.dir }))

  -- move window
  bind(M .. "+SHIFT+" .. d.key,   "Move window: " .. d.name, hl.dsp.window.move({ direction = d.dir }))
  bind(M .. "+SHIFT+" .. d.arrow, "Move window: " .. d.name, hl.dsp.window.move({ direction = d.dir }))
end

-- ── resize (numeric x/y only) ──────────────────────────────────────
local STEP = 40
local resize = {
  { key = "H", arrow = "left",  x = -STEP, y = 0     },
  { key = "J", arrow = "down",  x = 0,     y =  STEP },
  { key = "K", arrow = "up",    x = 0,     y = -STEP },
  { key = "L", arrow = "right", x =  STEP, y = 0     },
}

for _, r in ipairs(resize) do
  bind(M .. "+CTRL+" .. r.key,   "Resize: " .. r.arrow:gsub("^%l", string.upper), hl.dsp.window.resize({ x = r.x, y = r.y }), { repeating = true })
  bind(M .. "+CTRL+" .. r.arrow, "Resize: " .. r.arrow:gsub("^%l", string.upper), hl.dsp.window.resize({ x = r.x, y = r.y }), { repeating = true })
end

-- ── workspaces ─────────────────────────────────────────────────────
--
-- Sending a window to another workspace is `move({ workspace = N, follow =
-- false })` — "follow" is the real option. `silent = true`, which stood
-- here, is not a field at all and was ignored: every SUPER+SHIFT+N
-- yanked the VIEW to that workspace along with the window. (Unknown
-- fields in these tables are silently dropped, so a typo never errors.)
--
-- ⚠️ Switching workspace is  hl.dsp.focus({ workspace = N }).
-- It is NOT hl.dsp.workspace.move — that one is
-- "move workspace to monitor" and needs a `monitor` field; called
-- without one it logs `'monitor' is required` and silently does
-- nothing. Verified by dispatching and reading get_active_workspace().
--
for i = 1, 9 do
  bind(M .. "+" .. i,       "Workspaces: Go to workspace #" .. i,       hl.dsp.focus({ workspace = i }))
  bind(M .. "+SHIFT+" .. i, "Workspaces: Send window to workspace #" .. i, hl.dsp.window.move({ workspace = i, follow = false }))
end
bind(M .. "+0",             "Workspaces: Go to workspace #10",       hl.dsp.focus({ workspace = 10 }))
bind(M .. "+SHIFT+0",       "Workspaces: Send window to workspace #10", hl.dsp.window.move({ workspace = 10, follow = false }))

bind(M .. "+mouse_down", "Workspaces: Next", hl.dsp.focus({ workspace = "+1" }))
bind(M .. "+mouse_up", "Workspaces: Previous", hl.dsp.focus({ workspace = "-1" }))

-- next/prev workspace lives on SUPER+ALT, NOT SUPER+CTRL.
-- SUPER+CTRL+hjkl is already the resize block above; binding these on
-- CTRL made SUPER+CTRL+H and SUPER+CTRL+L fire resize AND a workspace
-- switch on the same press. Hyprland registers both silently — no Lua
-- error, no configerror. `scripts/check.sh` now greps `hyprctl binds`
-- for duplicate (modmask, key) pairs so this cannot come back.
bind(M .. "+ALT+L", "Workspaces: Next", hl.dsp.focus({ workspace = "+1" }))
bind(M .. "+ALT+H", "Workspaces: Previous", hl.dsp.focus({ workspace = "-1" }))
bind(M .. "+ALT+right", "Workspaces: Next", hl.dsp.focus({ workspace = "+1" }))
bind(M .. "+ALT+left", "Workspaces: Previous", hl.dsp.focus({ workspace = "-1" }))
bind(M .. "+GRAVE", "Workspaces: Last used", hl.dsp.focus({ workspace = "previous" }))
bind(M .. "+N", "Workspaces: First empty", hl.dsp.focus({ workspace = "e+1" }))

-- scratchpad — uses the DEFAULT special workspace on purpose.
-- toggle_special({ name = "magic" }) ignores `name` and toggles the
-- default anyway, so naming it here would be a lie. See notes.
bind(M .. "+S", "Scratchpad: Toggle", hl.dsp.workspace.toggle_special({}))
bind(M .. "+SHIFT+S", "Scratchpad: Send window", hl.dsp.window.move({ workspace = "special", follow = false }))

-- ── mouse drag ─────────────────────────────────────────────────────
-- Hyprland's own example: drag() and resize() take NO arguments and the
-- bind needs `mouse = true`. This used to be `drag({ action = "resize" })`
-- — the argument was silently ignored, so SUPER+right-drag MOVED the
-- window instead of resizing it (verified with a real drag: position
-- changed, size did not). `mouse = true` is what makes it a mouse bind.
bind(M .. "+mouse:272", "Mouse: Drag to move window",   hl.dsp.window.drag(),   { mouse = true })
bind(M .. "+mouse:273", "Mouse: Drag to resize window", hl.dsp.window.resize(), { mouse = true })

-- ── media / brightness (locked = works on the lock screen) ─────────
local function audio(cmd) return hl.dsp.exec_cmd("wpctl " .. cmd) end
local lockrep = { locked = true, repeating = true }
local lockonly = { locked = true }

bind("XF86AudioRaiseVolume", "Media: Volume up", audio("set-volume -l 1.4 @DEFAULT_AUDIO_SINK@ 5%+"), lockrep)
bind("XF86AudioLowerVolume", "Media: Volume down", audio("set-volume @DEFAULT_AUDIO_SINK@ 5%-"),        lockrep)
bind("XF86AudioMute",        "Media: Mute", audio("set-mute @DEFAULT_AUDIO_SINK@ toggle"),       lockonly)
bind("XF86AudioMicMute",     "Media: Mute microphone", audio("set-mute @DEFAULT_AUDIO_SOURCE@ toggle"),     lockonly)

bind("XF86MonBrightnessUp",   "Media: Brightness up", hl.dsp.exec_cmd("brightnessctl set 5%+"), lockrep)
bind("XF86MonBrightnessDown", "Media: Brightness down", hl.dsp.exec_cmd("brightnessctl set 5%-"), lockrep)

bind("XF86AudioPlay",  "Media: Play / pause", hl.dsp.exec_cmd("playerctl play-pause"), lockonly)
bind("XF86AudioNext",  "Media: Next track", hl.dsp.exec_cmd("playerctl next"),       lockonly)
bind("XF86AudioPrev",  "Media: Previous track", hl.dsp.exec_cmd("playerctl previous"),   lockonly)

-- ── screenshots ────────────────────────────────────────────────────
local sh = "$HOME/.config/hypr/scripts/"

bind("PRINT", "Capture: Screenshot area", hl.dsp.exec_cmd(sh .. "screenshot.sh area"))
bind("SHIFT+PRINT", "Capture: Screenshot screen", hl.dsp.exec_cmd(sh .. "screenshot.sh screen"))
bind("CTRL+PRINT", "Capture: Screenshot window", hl.dsp.exec_cmd(sh .. "screenshot.sh window"))
bind(M .. "+SHIFT+X", "Capture: Screenshot and annotate", hl.dsp.exec_cmd(sh .. "screenshot.sh edit"))

-- ── screen recording (one toggle: starts if idle, stops if running) ──
-- ALT+PRINT sits beside the screenshot family: area / screen / area+audio.
bind("ALT+PRINT", "Capture: Record area (toggle)", hl.dsp.exec_cmd(sh .. "record.sh toggle area"))
bind("ALT+SHIFT+PRINT", "Capture: Record screen (toggle)", hl.dsp.exec_cmd(sh .. "record.sh toggle screen"))
bind("CTRL+ALT+PRINT", "Capture: Record area with audio", hl.dsp.exec_cmd(sh .. "record.sh toggle area audio"))
bind(M .. "+SHIFT+R", "Capture: Record area (toggle)", hl.dsp.exec_cmd(sh .. "record.sh toggle area"))
bind(M .. "+SHIFT+P", "Capture: Colour picker", hl.dsp.exec_cmd("hyprpicker -a"))
bind(M .. "+SHIFT+G", "Capture: Click highlighter (toggle)", hl.dsp.exec_cmd("ags request -i shell click-highlight-toggle"))
bind(M .. "+SHIFT+T", "Capture: Copy text from screen (OCR)", hl.dsp.exec_cmd(sh .. "ocr.sh"))
bind(M .. "+CTRL+T", "Capture: Translate text on screen (OCR + local model)", hl.dsp.exec_cmd(sh .. "ocr.sh translate"))
bind(M .. "+ALT+Q", "Capture: Read a QR code on screen", hl.dsp.exec_cmd(sh .. "screen-tools.sh qr"))
bind(M .. "+ALT+C", "Capture: Colour palette of a screen region", hl.dsp.exec_cmd(sh .. "screen-tools.sh palette"))

-- ── shell / theming ────────────────────────────────────────────────
-- SUPER+SHIFT+W opens the AGS wallpaper switcher (thumbnails,
-- categories, and the desktop / lock screen / login screen targets).
-- SUPER+ALT+W keeps the rofi text picker as the no-GUI fallback —
-- it still works if the shell is not running.
bind(M .. "+SHIFT+W", "Shell: Wallpaper picker", hl.dsp.exec_cmd("ags request -i shell toggle-wallpapers"))
bind(M .. "+ALT+W", "Shell: Wallpaper picker (rofi)", hl.dsp.exec_cmd(sh .. "wallpaper.sh"))
bind(M .. "+ALT+SHIFT+W", "Shell: Wallpaper slideshow (off / 15 min / 1 h)", hl.dsp.exec_cmd(sh .. "wallpaper.sh --slideshow cycle"))
bind(M .. "+SHIFT+N", "Shell: Quick settings", hl.dsp.exec_cmd("ags toggle control-center -i shell"))
bind(M .. "+F1",      "Shell: Keybind cheat sheet", hl.dsp.exec_cmd("ags toggle cheatsheet -i shell"))
bind(M .. "+F2",      "Shell: Cycle night light", hl.dsp.exec_cmd("ags request -i shell nightlight"))
bind(M .. "+F3",      "Shell: Caffeine (keep screen awake)", hl.dsp.exec_cmd("ags request -i shell caffeine"))
bind(M .. "+F4",      "Shell: Meeting mode (mute mic + DND)", hl.dsp.exec_cmd("ags request -i shell meeting-mode"))

-- Bar dropdowns without the pointer. `ags request menu <name>` opens
-- the panel anchored under its glyph (widget/bar/dropdown.ts), so these
-- land in exactly the same place a click would put them. SUPER+N is
-- already "next empty workspace", hence A for alerts.
--   note: the args must stay SEPARATE words — `ags request "menu x"`
--   arrives as one argv entry and the handler rejects it.
bind(M .. "+A", "Panels: Notifications", hl.dsp.exec_cmd("ags request -i shell menu notifications"))
bind(M .. "+X", "Panels: Session", hl.dsp.exec_cmd("ags request -i shell menu session"))

-- The rest of the bar's dropdowns, from the keyboard. SUPER+CTRL+H/J/K/L
-- is the resize block, so these use other letters; each is a mnemonic
-- (V olume, N etwork, B luetooth, P layer, C alendar, U sage = battery,
-- D ata = bandwidth, W eather, Y = sYstem, M obile = phone). Same call a
-- click makes — see widget/bar/dropdown.ts.
for key, name in pairs({
  V = "volume", N = "network", B = "bluetooth", P = "player",
  C = "calendar", U = "battery", D = "bandwidth", W = "weather", Y = "system",
  M = "phone",
}) do
  bind(M .. "+CTRL+" .. key, "Panels: " .. name:gsub("^%l", string.upper), hl.dsp.exec_cmd("ags request -i shell menu " .. name))
end

-- workspace overview (AUR hyprexpose-git, started in autostart.lua).
-- It's a standalone daemon toggled by signal, not a Hyprland plugin, so
-- there's no hyprpm entry for it — just `pkill -SIGUSR1`.
bind(M .. "+O", "Workspaces: Overview", hl.dsp.exec_cmd("pkill -SIGUSR1 hyprexpose"))

-- ── submaps ────────────────────────────────────────────────────────
--
-- Every submap ends with a `catchall` bind. Without one, a key that
-- isn't bound inside the submap does nothing *and* leaves you stuck
-- there: SUPER+Return, SUPER+Q and the workspace keys are all dead
-- until you happen to hit ESC. `hl.bind("catchall", fn)` registers a
-- bind that fires on anything no other bind in the submap claimed —
-- verified: it shows up as `"catch_all": true` in `hyprctl binds -j`,
-- whereas `hl.bind("", fn)` registers a dead bind with catch_all false.
--
-- Consequence, from KeybindManager.cpp: the catchall has modmask 0, and
-- a modifier keypress reaches the matcher *before* its own bit is added
-- to the modmask (`modmaskAtPressTime` "doesn't yet include the
-- currently pressed mod key"). So pressing SUPER or SHIFT inside a
-- submap trips the catchall and drops you back to default. That is what
-- makes SUPER+Return work again from inside a submap — but it also
-- means **a submap must not contain a modifier bind**, because the
-- SHIFT press would exit the submap before SHIFT+<key> could match.
-- Send-to-project therefore gets its own submap instead of SHIFT+<key>.

-- ── resize submap: SUPER+Alt+R, then hjkl, ESC (or any other key) ──
bind(M .. "+ALT+R", "Modes: Resize mode (hjkl, Esc to leave)", hl.dsp.submap("resize"))

-- Layouts (per workspace; defaults are set in conf/rules.lua).
-- Cycling rewrites the workspace's rule, which re-tiles the windows already on it.
local LAYOUT_ORDER = { "dwindle", "scrolling", "monocle" }
bind(M .. "+ALT+space", "Layout: Cycle this workspace (dwindle / scrolling / monocle)", function()
  local ws = hl.get_active_workspace()
  if not ws then return end
  local nxt = LAYOUT_ORDER[1]
  for i, name in ipairs(LAYOUT_ORDER) do
    if name == ws.tiled_layout then nxt = LAYOUT_ORDER[i % #LAYOUT_ORDER + 1] end
  end
  hl.workspace_rule({ workspace = tostring(ws.id), layout = nxt })
  hl.notification.create({ text = "Layout: " .. nxt, timeout = 1500 })
end)
-- Scrolling layout only (other layouts ignore these): resize the focused column, or make it fill the screen.
bind(M .. "+ALT+equal", "Layout: Widen column (scrolling)", hl.dsp.layout("colresize +0.1"))
bind(M .. "+ALT+minus", "Layout: Narrow column (scrolling)", hl.dsp.layout("colresize -0.1"))
bind(M .. "+ALT+0", "Layout: Fit column to screen (scrolling)", hl.dsp.layout("fit active"))

hl.define_submap("resize", function()
  for _, r in ipairs(resize) do
    bind(r.key,   "Resize: " .. r.arrow:gsub("^%l", string.upper), hl.dsp.window.resize({ x = r.x, y = r.y }), { repeating = true })
    bind(r.arrow, "Resize: " .. r.arrow:gsub("^%l", string.upper), hl.dsp.window.resize({ x = r.x, y = r.y }), { repeating = true })
  end
  bind("ESCAPE",   "Leave resize mode", hl.dsp.submap("reset"))
  bind("Return",   "Leave resize mode", hl.dsp.submap("reset"))
  bind("catchall", "Leave resize mode", hl.dsp.submap("reset"))
end)

-- ── workshops: SUPER+P then a letter ───────────────────────────────
--
-- The four work areas under ~/work. Opening one means a terminal in
-- that directory, ON THE WORKSPACE YOU ARE ALREADY ON.
--
-- These used to be Hyprland NAMED workspaces (`workspace = "name:web"`,
-- persistent, negative ids) and SUPER+P switched to them. Removed
-- 2026-09-01: nothing ever populated them, so selecting a workshop just
-- dumped you on a blank screen and the bar carried four permanently
-- empty chips. The workspace rules are gone from conf/rules.lua too.
--
-- A submap keeps single letters usable: h/r are already taken at the
-- top level (focus-left, rofi run) and could not be reused here.
--
-- NOTE: hl.define_submap is (name, fn). The `reset` second argument in
-- the CLAUDE.md notes does NOT exist — passing a boolean fails with
-- "bad argument #2 (function expected, got boolean)". Each key
-- therefore dispatches and then resets the submap itself.
--
-- NOTE: `hl.dsp.exec_cmd` only *builds* a dispatcher; inside a plain
-- Lua handler it is a silent no-op. Use `hl.exec_cmd`, which goes
-- through a shell (so $HOME expands).
--
local workshops = {
  { key = "W", name = "web"       },
  { key = "H", name = "hackathon" },
  { key = "R", name = "rice"      },
  { key = "S", name = "research"  },
}

-- Opening a workshop runs the picker at ~/.local/bin/claude-workspace
-- (written 2026-08-26, back when this lived on SUPER+CTRL+R/W/H and
-- only hackathon used it). It lists the workshop's immediate
-- subdirectories newest-first in fzf, offers "+ new project…" which
-- scaffolds from the workshop's templates, copies down
-- .claude/settings*.json, sources the workshop's .env then the
-- project's, and execs claude there. Workshops with one project (or
-- none) go through the same path — the menu just has fewer entries.
--
-- Absolute path on purpose: Hyprland's PATH does not necessarily carry
-- ~/.local/bin, and a bind that silently does nothing is exactly the
-- failure mode this config keeps hitting. hl.exec_cmd goes through a
-- shell, so $HOME expands before kitty sees it. No `-e`: kitty takes
-- the program to run as trailing arguments (`kitty [options]
-- [program-to-run ...]`), and -e is an undocumented compat alias.
local picker = "$HOME/.local/bin/claude-workspace"

-- `--class workshop-<name>` marks the terminal so
-- ags/widget/bar/activityState.ts can tell which workshop a freshly
-- opened window belongs to and auto-tag it — see that file for the
-- "activities" feature (KDE-Activities-style window hide/show,
-- 2026-09-23). kitty takes its own options before the trailing
-- program+args, same as the existing --directory flag.
local function open_workshop(name)
  local dir = "$HOME/work/" .. name
  return apps.terminal .. " --class workshop-" .. name .. " --directory " .. dir .. " " .. picker .. " " .. dir
end

bind(M .. "+P", "Modes: Project picker (then w / h / r / s)", hl.dsp.submap("project"))

hl.define_submap("project", function()
  for _, ws in ipairs(workshops) do
    bind(ws.key, "Open " .. ws.name .. " workshop", function()
      hl.exec_cmd(open_workshop(ws.name))
      hl.dispatch(hl.dsp.submap("reset"))
    end)
  end

  -- Activities: switch which workshop's windows are visible WITHOUT
  -- opening a new terminal (opening one via w/h/r/s above already
  -- switches, as a side effect of the new window auto-tagging itself).
  -- Digits are free inside this submap — SUPER+1..9 is a different
  -- context entirely. T/U hand-tag or release the FOCUSED window, for
  -- anything not spawned from the picker (a browser tab, etc.) that
  -- should still hide/show with the rest. All state and the actual
  -- window move/hide logic live in activityState.ts; these binds just
  -- forward to it, same pattern as meeting mode.
  for i, ws in ipairs(workshops) do
    bind(tostring(i), "Activity: Switch to " .. ws.name .. " (no new terminal)", function()
      hl.exec_cmd("ags request -i shell activity " .. ws.name)
      hl.dispatch(hl.dsp.submap("reset"))
    end)
  end
  bind("T", "Activity: Tag focused window to current activity", function()
    hl.exec_cmd("ags request -i shell activity-tag")
    hl.dispatch(hl.dsp.submap("reset"))
  end)
  bind("U", "Activity: Release focused window (visible in every activity)", function()
    hl.exec_cmd("ags request -i shell activity-untag")
    hl.dispatch(hl.dsp.submap("reset"))
  end)

  bind("ESCAPE",   "Cancel", hl.dsp.submap("reset"))
  bind("Return",   "Cancel", hl.dsp.submap("reset"))
  bind("catchall", "Cancel", hl.dsp.submap("reset"))
end)

-- ── workspace mini-map: SUPER+M, then a number, ESC/Return to leave ──
--
-- Keyboard equivalent for widget/bar/WorkspacePreview.tsx's hover-only
-- floorplan — 09-bar-interaction-research.md flagged mouse-only reveals
-- as the standard complaint on a keyboard-driven WM. Does not
-- reimplement the panel: reuses the exact same shared dropdown
-- (dropdown.ts's hoveredWorkspace/showDropdown) that hover already
-- drives, via ags/app.ts's "workspace-preview" request. `wsmap_current`
-- is an upvalue shared by every bind below and by future re-entries
-- into the submap (hl.define_submap's fn runs once, at load) — it is
-- how Return knows which workspace was last previewed.
local wsmap_current = 1

local function wsmap_preview(id)
  wsmap_current = id
  hl.exec_cmd("ags request -i shell workspace-preview " .. id)
end

local function wsmap_close()
  hl.exec_cmd("ags request -i shell menu") -- no name arg: closes
  hl.dispatch(hl.dsp.submap("reset"))
end

bind(M .. "+M", "Modes: Workspace mini-map (then 1-0)", function()
  local ws = hl.get_active_workspace()
  wsmap_preview((ws and ws.id) or 1)
  hl.dispatch(hl.dsp.submap("wsmap"))
end)

hl.define_submap("wsmap", function()
  for i = 1, 9 do
    bind(tostring(i), "Preview workspace #" .. i, function() wsmap_preview(i) end)
  end
  bind("0", "Preview workspace #10", function() wsmap_preview(10) end)

  -- jump to whatever is currently previewed, then leave
  bind("Return", "Jump to previewed workspace", function()
    hl.dispatch(hl.dsp.focus({ workspace = wsmap_current }))
    wsmap_close()
  end)
  bind("ESCAPE",   "Close preview", wsmap_close)
  bind("catchall", "Close preview", wsmap_close)
end)

-- ── session ────────────────────────────────────────────────────────
bind(M .. "+SHIFT+M", "Session: Exit Hyprland", hl.dsp.exit())
