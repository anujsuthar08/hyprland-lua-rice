--
-- Machine-local overrides — COPY THIS to conf/local.lua (which git ignores) and edit.
--
-- conf/local.lua      loads FIRST  — monitors and GPU/driver environment
-- conf/local_late.lua loads LAST   — anything that must override the shared config
--
-- Nothing in here is required: on a fresh checkout every output uses its preferred mode and
-- libva auto-detects the driver. Set these only to match your hardware.
--

-- A specific monitor rule. It MUST come before the generic catch-all in conf/looks.lua,
-- which is why this file loads first. Find your output name with `hyprctl monitors`.
-- hl.monitor({ output = "eDP-1", mode = "1920x1080@144", position = "0x0", scale = 1 })

-- HiDPI panel example:
-- hl.monitor({ output = "eDP-1", mode = "2560x1600@120", position = "0x0", scale = 1.6 })

-- GPU / driver. AMD (mesa):
-- hl.env("LIBVA_DRIVER_NAME", "radeonsi")
-- Intel:  hl.env("LIBVA_DRIVER_NAME", "iHD")
-- NVIDIA (proprietary driver) needs a longer list; see the Hyprland wiki "NVIDIA" page.
