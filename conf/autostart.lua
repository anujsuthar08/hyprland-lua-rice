--
-- Autostart. There is no `exec-once` in the Lua API — you subscribe to
-- the start event. `hyprland.start` fires once per session; config
-- reloads raise a different event, so this does not stack up duplicate
-- processes every time the file is saved.
--
-- ⚠️ USE `hl.exec_cmd`, NOT `hl.dsp.exec_cmd`.
--    `hl.dsp.exec_cmd(...)` only CONSTRUCTS a dispatcher object for a
--    keybind — calling it here runs nothing at all, silently. (The
--    example in CLAUDE.md gets this wrong.) The alternative is
--    `hl.dispatch(hl.dsp.exec_cmd(...))`.
--    Verified: hl.exec_cmd goes through a shell, so PATH lookup, $VAR
--    expansion, && and redirection all work.
--
-- The shell is launched by systemd/hypr-shell.service, whose ExecStart uses
-- ~/.config/hypr/ags. deploy.sh makes that a symlink to <repo>/ags, so it is the
-- same tree whether the config is run from the clone or from the deployed path. (This file used to derive the config dir from package.path
-- to launch `ags run` itself; nothing needs that any more.)

hl.on("hyprland.start", function()
  local once = {
    -- authentication prompts (polkit)
    "systemctl --user start hyprpolkitagent",

    -- clipboard history: text and images are separate watchers
    "wl-paste --type text  --watch cliphist store",
    "wl-paste --type image --watch cliphist store",

    -- Without this, what you copy vanishes when the app you copied from
    -- closes (Wayland clipboards belong to the source client). It keeps the
    -- selection alive, and cliphist above still records it.
    "wl-clip-persist --clipboard regular",

    -- night light: idles at "no colour change"; the shell (nightState.ts)
    -- decides when to warm the screen. Config: ~/.config/hypr/hyprsunset.conf
    "hyprsunset",

    -- Wallpaper: --restore re-applies the last pick and starts whichever
    -- daemon that pick needs (awww for stills, mpvpaper for animated).
    -- It also re-runs matugen, so the palette matches the wallpaper from
    -- the first frame of the session.
    "$HOME/.config/hypr/scripts/wallpaper.sh --restore; $HOME/.config/hypr/scripts/wallpaper.sh --slideshow resume",

    -- idle -> lock. Run as hypridle's own shipped user unit (Restart=on-failure):
    -- if the idle daemon dies the screen would silently never auto-lock, so it
    -- must come back by itself. Logs: journalctl --user -u hypridle
    "systemctl --user start hypridle",

    -- the shell: bar, notifications, OSD, control centre — run as a systemd
    -- user service (systemd/hypr-shell.service) so a crash brings it back in
    -- ~2s instead of leaving the desktop without a bar. `link` is idempotent
    -- and makes a fresh clone work with no manual step; a clean
    -- `ags quit -i shell` is NOT restarted. Logs: journalctl --user -u hypr-shell
    "systemctl --user link $HOME/.config/hypr/systemd/hypr-shell.service; systemctl --user start hypr-shell",

    -- workspace overview (AUR hyprexpose-git); toggled via SIGUSR1, see binds.lua
    "hyprexpose --allow-mouse",
  }

  for _, cmd in ipairs(once) do
    hl.exec_cmd(cmd)
  end
end)
