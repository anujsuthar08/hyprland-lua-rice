--
-- Layout, borders, decoration, animations.
-- Every option name below was verified by round-trip against 0.56.2
-- (hl.config accepts unknown keys SILENTLY, so this matters).
--
local theme = require("conf.theme")

hl.config({
  general = {
    gaps_in          = 5,
    gaps_out         = 12,
    border_size      = 2,
    layout           = "dwindle",
    resize_on_border = true,
    allow_tearing    = false,

    -- Dotted keys need bracket syntax in Lua.
    -- A gradient is a TABLE: { colors = {...}, angle = N }. The
    -- hyprlang string form ("rgba(..) rgba(..) 45deg") is rejected as
    -- "invalid color" — it only shows up in `hyprctl configerrors`,
    -- never as a Lua error.
    ["col.active_border"] = {
      colors = { theme.rgba(theme.accent), theme.rgba(theme.accent_2) },
      angle  = 45,
    },
    ["col.inactive_border"] = theme.rgba(theme.surface),
  },

  decoration = {
    rounding       = 12,
    active_opacity   = 1.0,
    inactive_opacity = 0.94,

    -- Glass, on purpose (2026-09-02) — reverses the "restrained" pass.
    -- That one was tuned blind: with the capsule at 0.85 alpha NOTHING
    -- of the blur ever reached the screen, so halving it changed a
    -- picture nobody could see. Alpha does the work (see .Capsule in
    -- ags/style/main.scss); these numbers decide what shows through.
    --
    -- passes widens the blur radius — that is what makes it read as
    -- depth rather than as a smudge — and vibrancy keeps the
    -- wallpaper's colour alive instead of greying out under the glass.
    -- His pre-rebuild rice ran size 4 / passes 4 / vibrancy 1; this is
    -- the same idea with the saturation pulled back off the ceiling.
    blur = {
      enabled     = true,
      -- Low alpha + HIGH blur. The pairing matters more than either
      -- number: a ~0.4 fill over a small blur is the one combination
      -- that reads as dated — you can see through it but not what is
      -- behind it, so it lands as dirty grey. Either commit to thin
      -- glass over a wide blur (this), or to a near-opaque fill over a
      -- token blur. Nothing in between. size 8/passes 3 sits between
      -- caelestia (8/2, 0.85 fill) and end-4 (10/3, ~0.7 fill).
      size        = 8,
      passes      = 3,
      new_optimizations = true,
      xray        = false,
      -- blur what is behind a translucent SURFACE, not just behind
      -- fully transparent pixels — without this a 0.4-alpha capsule
      -- gets no blur at all, which was half the old problem.
      ignore_opacity = true,
      popups             = true,
      popups_ignorealpha = 0.2,
      -- Grain is load-bearing, not decoration: it is what stops a wide
      -- blur reading as a flat gaussian smear. 0.04 is ~3.5x the
      -- Hyprland default; end-4 runs 0.05.
      noise       = 0.04,
      contrast    = 1.0,
      brightness  = 1.0,
      -- Blur desaturates. Vibrancy pushes the colour back in, darkness
      -- does the same for the dark regions — without it a wide blur
      -- goes grey, which is exactly the 2014 frosted look.
      vibrancy          = 0.4,
      vibrancy_darkness = 0.4,
    },

    shadow = {
      enabled = true,
      range   = 20,
      render_power = 3,
      ["color"] = theme.rgba("000000", "55"),
    },
  },

  dwindle = {
    preserve_split      = true,
    smart_split         = false,
    smart_resizing      = true,
    default_split_ratio = 1.0,
    -- NOTE: dwindle:pseudotile no longer exists in 0.56 (removed from
    -- the binary entirely). Pseudo is dispatcher-only now:
    -- hl.dsp.window.pseudo()
  },

  master = {
    new_status = "master",
  },

  misc = {
    disable_hyprland_logo     = true,
    disable_splash_rendering  = true,
    force_default_wallpaper   = 0,
    focus_on_activate         = true,
    vrr                       = 1,
    -- NOTE: misc:vfr moved to debug:vfr in 0.56
  },

  debug = {
    vfr = true,
  },
})

--
-- Animations. Short and snappy on purpose — the survey found the
-- ecosystem differentiator has shifted from blur amount to motion
-- restraint; long "morphing" transitions (Caelestia's own description
-- of its style) read as slower/older than a quick, purposeful one.
--
-- API note: this is NOT part of hl.config({animations=...}) — that
-- table form is accepted SILENTLY and never applies (verified:
-- `hyprctl animations -j` showed overridden=false on every leaf).
-- The real call is hl.animation({ leaf=, enabled=, speed=, bezier= }),
-- one leaf per call, confirmed by round-trip (overridden=true, speed
-- and bezier both read back correctly).
--
hl.curve("snappy", { type = "bezier", points = { {0.16, 1}, {0.3, 1} } })

hl.config({ animations = { enabled = true } })

for _, a in ipairs({
  { leaf = "windows",    speed = 1.8 },
  { leaf = "windowsIn",  speed = 1.8 },
  { leaf = "windowsOut", speed = 1.4 },
  { leaf = "border",     speed = 1.8 },
  { leaf = "fade",       speed = 1.8 },
  { leaf = "workspaces", speed = 1.2 },
  { leaf = "layers",     speed = 1.6 },
}) do
  hl.animation({ leaf = a.leaf, enabled = true, speed = a.speed, bezier = "snappy" })
end

-- Per-monitor rules (resolution, refresh rate, scale, position) are hardware-specific,
-- so they live in the untracked conf/local.lua, which loads BEFORE this file (a specific
-- rule has to come before the catch-all below). See conf/local.example.lua.
--
-- Generic fallback: any output at its preferred mode, placed automatically — so a fresh
-- checkout works on any machine and an external display just works when plugged in.
hl.monitor({
  output   = "",
  mode     = "preferred",
  position = "auto",
  scale    = 1,
})
