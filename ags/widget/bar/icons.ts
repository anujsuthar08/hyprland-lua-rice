// Custom icons, not the system theme's — not nerd-font glyphs either.
//
// The bar used to use private-use-area characters from JetBrainsMono
// Nerd Font for every status symbol. Two problems, and they were the
// same problem: a glyph is TEXT, so it sits on the text baseline and
// takes whatever optical size the font gave it — nothing lined up
// because nothing was ever aligned, they were just letters. Symbolic
// SVGs from the system icon theme (WhiteSur-dark) fixed THAT, but
// introduced a subtler version of the same complaint: a themed
// "symbolic" icon set is contributed by many hands over years, and its
// members don't share a canvas discipline. Measured directly (render
// each at a fixed size, bounding-box the ink): the bell fills ~94% of
// its box, the wifi glyph ~69%, at the identical nominal pixel size —
// so even perfectly CSS-aligned and identically sized boxes read as
// visibly different icons.
//
// `../icons/bar-*.svg` (repo-relative: ags/icons/) replaces the ones
// that showed this worst — bell, wifi, bluetooth, volume, power, mic —
// with hand-picked paths from Lucide (ISC-licensed, MIT-compatible;
// path data pulled from the `lucide-react` package already on this
// machine, one shared 24x24 grid / 2px stroke for the whole family, so
// weight is consistent by construction rather than by luck). Battery
// stays on the system theme: its ten-step icon set is internally
// consistent with itself (same source, same hand) and Lucide has no
// equivalent granularity.
//
// These are loaded from a search path (see app.ts), not through a
// registered icon THEME, so — unlike the still-symbolic battery icon —
// GTK does not dynamically recolour them via CSS `color`; the stroke
// colour is baked into each file, chosen to match the theme icons'
// resting colour (`rgba($fg, 0.82)` over `$bg`) so the two sets sit at
// the same visual weight. State feedback (hover, `.open`) still comes
// through — it was always the GLYPH BUTTON'S background/shadow that
// changes, not the icon tinting on top of it.
export function volumeIcon(volume: number, muted: boolean): string {
  if (muted || volume < 0.01) return "bar-volume-x"
  if (volume < 0.34) return "bar-volume"
  if (volume < 0.67) return "bar-volume-1"
  return "bar-volume-2"
}

export function wifiIcon(strength: number): string {
  if (strength < 0) return "bar-wifi-off"
  if (strength < 40) return "bar-wifi-low"
  if (strength < 70) return "bar-wifi-medium"
  return "bar-wifi"
}

export const WIRED = "network-wired-symbolic"
export const WIFI_OFF = "bar-wifi-off"

export function bluetoothIcon(powered: boolean, connected: boolean): string {
  if (!powered) return "bar-bluetooth-off"
  return connected ? "bar-bluetooth-connected" : "bar-bluetooth"
}

// Adwaita's battery icons come in ten-percent steps, plus separate
// charging variants. Rounding to the step is what makes the icon
// change at the same moment the number does.
export function batteryIcon(percent: number, charging: boolean): string {
  const step = Math.max(0, Math.min(100, Math.round((percent * 100) / 10) * 10))
  if (charging) {
    return step >= 100
      ? "battery-level-100-charged-symbolic"
      : `battery-level-${step}-charging-symbolic`
  }
  return `battery-level-${step}-symbolic`
}

export const BANDWIDTH = "bar-bandwidth"
export const VPN = "bar-vpn"

export const MIC_MUTED = "bar-mic-off"

export function notificationIcon(dnd: boolean): string {
  return dnd ? "bar-bell-off" : "bar-bell"
}

// One icon for every level. WhiteSur's low/medium/high variants split the
// sun into a rays group and a half-disc, and GTK recolours only the disc
// (a lone dot at 16px). The bundled stroke sun matches the rest of the bar
// and the slider already says how bright it is.
export const BRIGHTNESS = "bar-sun"
export function brightnessIcon(_level?: number): string {
  return BRIGHTNESS
}

export const MIC = "bar-mic"

export function playIcon(playing: boolean): string {
  return playing ? "media-playback-pause-symbolic" : "media-playback-start-symbolic"
}

export const SESSION = "bar-power"
export const LOCK = "system-lock-screen-symbolic"
// WhiteSur's `system-suspend-symbolic` is a circle with a bar through
// it, which reads as "forbidden" rather than "sleep". The moon is
// unambiguous and is what every other OS uses for the same action.
export const SLEEP = "weather-clear-night-symbolic"
export const LOGOUT = "system-log-out-symbolic"
export const REBOOT = "system-reboot-symbolic"
export const POWEROFF = "system-shutdown-symbolic"
export const CAFFEINE = "my-caffeine-on-symbolic"
export const CAFFEINE_OFF = "preferences-desktop-screensaver-symbolic"

export const CLOSE = "window-close-symbolic"
export const CLEAR_ALL = "edit-clear-all-symbolic"
export const REFRESH = "view-refresh-symbolic"
export const SELECTED = "emblem-ok-symbolic"
export const SECURED = "changes-prevent-symbolic"
export const ADD_NETWORK = "list-add-symbolic"
export const SKIP_NEXT = "media-skip-forward-symbolic"
export const SKIP_PREV = "media-skip-backward-symbolic"
