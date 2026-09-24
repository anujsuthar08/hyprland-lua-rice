--
-- Input: keyboard, mouse, touchpad, gestures.
--
-- ⚠️ Option names use UNDERSCORES in the Lua API. The dashed hyprlang
-- spellings (tap-to-click, tap-and-drag) are accepted silently and then
-- IGNORED. Verified by round-trip.
--
hl.config({
  input = {
    kb_layout    = "us",
    follow_mouse = 1,
    sensitivity  = 0,
    numlock_by_default = true,
    repeat_rate  = 40,
    repeat_delay = 400,

    touchpad = {
      natural_scroll        = true,
      tap_to_click          = true,   -- NOT "tap-to-click"
      tap_and_drag          = true,   -- NOT "tap-and-drag"
      disable_while_typing  = true,
      drag_lock             = true,
      scroll_factor         = 0.8,
      clickfinger_behavior  = true,
    },
  },

  gestures = {
    workspace_swipe_distance          = 300,
    workspace_swipe_cancel_ratio      = 0.5,
    workspace_swipe_create_new        = false,
    workspace_swipe_direction_lock    = true,
    workspace_swipe_forever           = true,
  },

  binds = {
    workspace_back_and_forth   = true,
    allow_workspace_cycles     = true,
    movefocus_cycles_fullscreen = false,
  },
})

--
-- Gestures are their own call in 0.56 — the old bare
-- `gestures:workspace_swipe = true` boolean no longer exists.
-- Signature (from the binary's own error text):
--   hl.gesture{ fingers = N, direction = "...", action = "..." }
--
hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })
hl.gesture({ fingers = 4, direction = "horizontal", action = "workspace" })
