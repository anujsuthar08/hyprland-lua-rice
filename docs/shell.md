# The AGS shell (bar, dropdowns, Control Center, notifications, OSD)

TypeScript/JSX on [AGS](https://github.com/Aylur/ags) v3 + Astal (`ags/`). It runs as a
supervised user service, `systemd/hypr-shell.service` (`Restart=on-failure`, so a crash is
back in ~2 s), started from `conf/autostart.lua`.

```sh
systemctl --user restart hypr-shell      # after editing ags/**/*.tsx, *.ts, *.scss
journalctl --user -u hypr-shell -f       # logs
ags request -i shell <message>           # talk to the running shell (see ags/app.ts)
ags run ...                              # never by hand while the unit is active: it fights for the app id
systemctl --user restart hypridle        # hypridle does not reload its config itself
```

## Things that bit us

- **GTK user CSS applies to the shell too.** The shell is a GTK 4 app and reads
  `~/.config/gtk-4.0/gtk.css`, which outranks its own stylesheet. The matugen GTK 4 template
  is therefore scoped with `window:not(.hypr-shell)`; every shell window must keep the
  `hypr-shell` class. Screenshot the shell after touching any global theme file.
- **Sliders emit twice.** `onChangeValue` fires twice per change, the first with a stale
  `self.value`. Use `onSlide()` from `ags/widget/bar/slide.ts` (it passes the new value).
- **Filenames that differ only by case** (`Recording.tsx` / `recording.ts`) break the esbuild
  bundle; state modules are named `recordState.ts`, `nightState.ts`, `weatherState.ts`...
- **Hover:** use compositor truth (`hyprctl cursorpos`), not GTK crossing events, and never
  `destroy()` a window of an unplugged monitor (segfault).
- **Notifications:** the popup treats `n.image` as a file path; do not pass icon names.
  `notify-send -A` blocks until an action is chosen; never use it in automation.
- **Astal Wireplumber:** a stream's `name` can be a file path; the app name is the pipewire
  property `application.name`.
- `ags bundle` output is a shell script with base64 JS; decode between `<<EOF`/`EOF` to grep it.

## Testing the UI

`scripts/uitest.sh` drives real pointer/keyboard input through ydotool (its absolute
coordinates are 2x, handled for you) and takes screenshots with `grim`.
`ags request -i shell menu <name>` opens a bar dropdown without a pointer; `menu` alone closes it.
Wrap `grim` in `timeout`; a hung `grim` means a display that is off. Back up the clipboard before
a test that touches it, and compare afterwards.

Every bind, panel and script above is safe to run repeatedly; `scripts/smoke-test.sh` is the
one-command health check.
