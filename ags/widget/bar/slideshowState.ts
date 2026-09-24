import { createComputed, createState } from "ags"
import { interval } from "ags/time"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"

// Wallpaper slideshow status for the Control Center tile. The work is done by
// `wallpaper.sh --slideshow` (a transient systemd timer does the waiting); the remembered
// interval, in seconds, lives in a one-line state file, so this only reads that file.

const FILE = `${GLib.get_user_state_dir()}/hypr-shell/slideshow`
const SCRIPT = `${GLib.get_home_dir()}/.config/hypr/scripts/wallpaper.sh`

const read = (): number => {
  try {
    const [ok, b] = GLib.file_get_contents(FILE)
    const n = ok ? Number(new TextDecoder().decode(b).trim()) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export const [seconds, setSeconds] = createState(read())
export const slideshowOn = createComputed([seconds], (s) => s > 0)
export const slideshowStatus = createComputed([seconds], (s) =>
  s <= 0 ? "Off" : s >= 3600 ? `Every ${Math.round(s / 3600)} h` : s >= 60 ? `Every ${Math.round(s / 60)} min` : `Every ${s} s`)

export async function cycleSlideshow() {
  try {
    await execAsync([SCRIPT, "--slideshow", "cycle"])
  } catch (e) {
    console.error("slideshow: cycle failed", e)
  }
  setSeconds(read())
}

interval(5000, () => setSeconds(read())) // picks up a change made from a keybind or terminal
