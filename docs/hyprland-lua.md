# Hyprland Lua config: what the docs don't tell you

Hyprland 0.55+ is configured in **Lua** (`hyprland.lua`); the old hyprlang `.conf` is
deprecated. Almost everything online is still hyprlang: use it for *intent* (which options
exist, what people pick) and translate, never copy. `hyprlock`, `hypridle`, `hyprsunset` and
`rofi` are separate apps and keep their own formats.

| hyprlang | Lua |
|---|---|
| `bind = SUPER, Return, exec, kitty` | `hl.bind("SUPER+Return", hl.dsp.exec_cmd("kitty"))` |
| `general { gaps_in = 5 }` | `hl.config({ general = { gaps_in = 5 } })` |
| `exec-once = waybar` | `hl.on("hyprland.start", function() hl.exec_cmd("waybar") end)` |
| `monitor = DP-1,2560x1440@144,0x0,1` | `hl.monitor({ output = "DP-1", mode = "2560x1440@144", position = "0x0", scale = 1 })` |
| `windowrulev2 = float,class:^(x)$` | `hl.window_rule({ match = { class = "^(x)$" }, float = true })` |
| `source = file.conf` | `require("file")` |

## Silent failures (verify the effect, "no error" proves nothing)

Wrong fields and argument shapes in `hl.dsp.*` / `hl.window_rule` tables are **dropped without
an error**; the dispatcher just does its default.

- `hl.dsp.exec_cmd` only *builds* a dispatcher. Inside an event handler it does nothing; use
  `hl.exec_cmd(...)` there.
- `hl.dsp.dpms("on")` **toggles** (a string is not a valid action table). Use
  `hl.dsp.dpms({ action = "on" })`; it is idempotent. A display that is off makes `grim` and
  `wf-recorder` hang forever.
- `window.move({ workspace = N, silent = true })`: `silent` is not a field and the view follows
  the window. Use `follow = false`.
- Mouse drag/resize: `hl.bind(mod .. " + mouse:272", hl.dsp.window.drag(), { mouse = true })` and
  `mouse:273` with `hl.dsp.window.resize()`; they take no arguments.
- Window-rule `class`/`title` are **RE2 regexes**, not Lua patterns: `"^(blueman-manager)$"`, and
  a literal dot is `[.]`. `%-` matches a literal `%-`, so the rule never fires.
- Rule `move`/`size`: hyprlang's `100%-500` is ignored. Use numbers (`"1420 780"`) or
  parenthesised expressions (`"(monitor_w-500) (monitor_h-300)"`).
- Gradients are tables: `["col.active_border"] = { colors = { "rgba(ffffffcc)", "rgba(111111cc)" }, angle = 45 }`.
  The hyprlang string form is rejected only in `hyprctl configerrors`, not as a Lua error.
  `col.active_border` lives under `general`, not `decoration`.
- Named workspaces must be written `"name:<x>"`. They get **negative ids**, like special
  workspaces, so a bar widget filtering on `id > 0` drops them.
- `hl.dsp.focus({ workspace = N })` on the *current* workspace goes back to the previous one.
- A `workspace_rule` naming a monitor that is not connected is inert, and `hl.get_monitors()`
  is empty while the config body runs.

## Release binds (Alt-Tab) need `transparent = true`

A `release` bind on a modifier (`"ALT+Alt_L"`, used to commit an Alt-Tab switcher) fires when
the modifier is pressed and released alone, but **not** once another key was pressed in between.
Add `transparent = true` (the hyprlang `t` flag); `non_consuming = true` alone does not help.
Also: key names are case-insensitive, so `"Tab"` and `"TAB"` are the same key, and two binds
spelled differently both fire on one press (`scripts/check.sh` compares lower-cased for this).

## Runtime commands take Lua too

```sh
hyprctl dispatch "hl.dsp.focus({ workspace = 3 })"                 # not: hyprctl dispatch workspace 3
hyprctl eval "hl.config({ input = { accel_profile = 'flat' } })"   # not: hyprctl keyword ...
```

Library wrappers that emit the old verb form (for example AstalHyprland's `dispatch(verb, args)`)
silently do nothing; send `dispatch hl.dsp.focus({workspace=3})` over the raw socket instead.

## Keybinds

Add binds through the `bind(keys, "Group: action", dispatcher, opts?)` wrapper in
`conf/binds.lua`, never bare `hl.bind`: the description feeds the `SUPER+F1` cheat sheet
(generated from `hyprctl binds -j`). `scripts/check.sh` reports undescribed and duplicate binds.

## Testing without harming the session

- `scripts/check.sh` loads the config in a **nested** Hyprland and reports Lua errors,
  `hyprctl configerrors`, duplicate and undescribed binds.
- `scripts/audit-options.py` checks that every `hl.config` option exists and matches the live value.
- Test dispatchers against a window by `address:0x...`, never "the active window": when a test
  window leaves the workspace, focus falls to yours and the dispatch acts on it.
- `scripts/locktest.sh` renders hyprlock in a nested Hyprland. Never type wrong passwords into a
  lock screen: PAM counts them against the real account.
- The session auto-locks (hypridle); do not type into a locked session.
