// TEMPORARY dev harness — mounts only the wallpaper switcher, under its
// own instance name so it can run beside the live "shell" instance in a
// nested Hyprland. `ags run` has no --instance flag; the name comes from
// app.start(), which is why this needs a separate entry file.
import app from "ags/gtk4/app"
import style from "./style/main.scss"
import WallpaperSwitcher from "./widget/WallpaperSwitcher"

app.start({
  css: style,
  instanceName: "shell-test",
  main() {
    WallpaperSwitcher()
    app.toggle_window("wallpaper-switcher")
  },
  requestHandler(argv, res) {
    if (argv[0] === "toggle-wallpapers") {
      app.toggle_window("wallpaper-switcher")
      return res("ok")
    }
    return res(`unknown request: ${argv[0]}`)
  },
})
