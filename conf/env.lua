--
-- Environment variables (replaces hyprlang `env = `).
-- Signature verified: hl.env("NAME", "value") — positional strings.
--
-- HARDWARE NOTE (this machine): hybrid GPU laptop.
--   card0 = NVIDIA RTX 3050 Mobile  -> nouveau (open driver)
--   card1 = AMD Radeon 680M         -> amdgpu, and it drives eDP-1
-- The proprietary nvidia driver is NOT installed. So the usual
-- LIBVA_DRIVER_NAME=nvidia / __GLX_VENDOR_LIBRARY_NAME=nvidia /
-- NVD_BACKEND block that every hybrid-laptop dotfiles repo ships is
-- WRONG here and is deliberately omitted.
--

-- Toolkit / session identity
hl.env("XDG_CURRENT_DESKTOP", "Hyprland")
hl.env("XDG_SESSION_TYPE", "wayland")
hl.env("XDG_SESSION_DESKTOP", "Hyprland")

-- Force Wayland backends where the toolkit supports it
hl.env("QT_QPA_PLATFORM", "wayland;xcb")
hl.env("QT_WAYLAND_DISABLE_WINDOWDECORATION", "1")
hl.env("QT_AUTO_SCREEN_SCALE_FACTOR", "1")
hl.env("GDK_BACKEND", "wayland,x11")
hl.env("SDL_VIDEODRIVER", "wayland")
hl.env("CLUTTER_BACKEND", "wayland")
hl.env("MOZ_ENABLE_WAYLAND", "1")

-- Qt theming goes through qt5ct/qt6ct (both installed)
hl.env("QT_QPA_PLATFORMTHEME", "qt6ct")

-- GPU/driver variables (e.g. LIBVA_DRIVER_NAME for VA-API) are hardware-specific: set them
-- in the untracked conf/local.lua (see conf/local.example.lua). libva auto-detects when unset.

-- Cursor (kept in sync with hyprcursor/gtk in conf/autostart.lua)
hl.env("XCURSOR_SIZE", "24")
hl.env("HYPRCURSOR_SIZE", "24")

--
-- NOT set here, on purpose:
--   AQ_DRM_DEVICES — device selection happens before the config is
--   parsed, so setting it here is too late to influence which GPU
--   Hyprland renders on. If we ever need to pin it to the AMD card it
--   must go in the launcher/session environment instead:
--       AQ_DRM_DEVICES=/dev/dri/by-path/pci-0000:05:00.0-card
--   (by-path, because cardN numbering is not stable across boots).
--   Currently unnecessary — the default selection already picks AMD.
--
