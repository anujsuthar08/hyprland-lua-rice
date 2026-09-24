import { createComputed, createState } from "ags"
import { execAsync } from "ags/process"
import { interval } from "ags/time"
import GLib from "gi://GLib"

// Weather from Open-Meteo (no key). The LOCATION is set once, by hand, with
//   scripts/weather-city.py "<city>"
// which geocodes the name and saves lat/lon to weather.json. Nothing here ever
// looks up your IP: each refresh sends only that saved latitude/longitude.
//
// Open-Meteo answers with an occasional transient 503 (seen live while
// building this), so a failed refresh must never blank the chip: the last good
// forecast stays on screen (and on disk, so it survives a shell restart),
// the panel says it is stale, and a retry happens after 2 minutes instead of
// waiting out the full 15.

export type Loc = { name: string; region: string; country: string; lat: number; lon: number }

type Raw = {
  timezone: string
  current: {
    time: string
    temperature_2m: number
    apparent_temperature: number
    relative_humidity_2m: number
    weather_code: number
    is_day: number
    wind_speed_10m: number
    wind_direction_10m: number
  }
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability: number[] }
  daily: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_probability_max: number[]
  }
}
export type Wx = { fetchedAt: number; raw: Raw }

const DIR = `${GLib.get_user_state_dir()}/hypr-shell`
const LOC_FILE = `${DIR}/weather.json`
const CACHE_FILE = `${DIR}/weather-cache.json`

const REFRESH_MS = 15 * 60_000
const RETRY_MS = 2 * 60_000

function readText(path: string): string {
  try {
    const [ok, bytes] = GLib.file_get_contents(path)
    return ok ? new TextDecoder().decode(bytes) : ""
  } catch {
    return ""
  }
}
function readJSON<T>(path: string): T | null {
  const t = readText(path)
  try {
    return t ? (JSON.parse(t) as T) : null
  } catch {
    return null
  }
}

let locText = readText(LOC_FILE)
export const [location, setLocation] = createState<Loc | null>(readJSON<Loc>(LOC_FILE))
export const [weather, setWeather] = createState<Wx | null>(readJSON<Wx>(CACHE_FILE))
export const [stale, setStale] = createState(false)
export const [now, setNow] = createState(Date.now())

let lastOk = weather.peek()?.fetchedAt ?? 0
let lastTry = 0
let failed = false
let busy = false

const url = (l: Loc) =>
  "https://api.open-meteo.com/v1/forecast" +
  `?latitude=${l.lat}&longitude=${l.lon}` +
  "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m,wind_direction_10m" +
  "&hourly=temperature_2m,weather_code,precipitation_probability" +
  "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
  "&timezone=auto&forecast_days=4"

async function refresh() {
  const loc = location.peek()
  if (!loc || busy) return
  busy = true
  lastTry = Date.now()
  try {
    const out = await execAsync([
      "curl", "-fsS", "--max-time", "15", "--retry", "2", "--retry-delay", "2", url(loc),
    ])
    const raw = JSON.parse(out) as Raw
    if (!raw?.current || !raw?.hourly || !raw?.daily) throw new Error("unexpected response shape")
    const wx: Wx = { fetchedAt: Date.now(), raw }
    setWeather(wx)
    try {
      GLib.mkdir_with_parents(DIR, 0o755)
      GLib.file_set_contents(CACHE_FILE, JSON.stringify(wx))
    } catch {}
    lastOk = wx.fetchedAt
    failed = false
    setStale(false)
  } catch (e) {
    failed = true
    setStale(weather.peek() !== null) // keep showing the last good data, marked stale
    console.error("weather: refresh failed", e)
  } finally {
    busy = false
  }
}

// One cheap tick: notice a new location (weather-city.py rewrote the file),
// keep "3m ago" honest, and refresh when due.
function tick() {
  setNow(Date.now())
  const t = readText(LOC_FILE)
  if (t !== locText) {
    locText = t
    let l: Loc | null = null
    try {
      l = t ? (JSON.parse(t) as Loc) : null
    } catch {}
    setLocation(l)
    setWeather(null)
    lastOk = 0
    failed = false
    setStale(false)
    if (l) refresh()
    return
  }
  const t0 = Date.now()
  if (location.peek() && (t0 - lastOk >= REFRESH_MS || (failed && t0 - lastTry >= RETRY_MS))) refresh()
}

tick()
interval(30_000, tick)

export function refreshWeather() {
  refresh()
}

// ── WMO weather code -> label + icon ────────────────────────────────────
export function condition(code: number, isDay: boolean): { label: string; icon: string } {
  if (code === 0) return { label: "Clear sky", icon: isDay ? "bar-sun" : "bar-moon" }
  if (code === 1) return { label: "Mainly clear", icon: isDay ? "bar-sun" : "bar-moon" }
  if (code === 2) return { label: "Partly cloudy", icon: isDay ? "bar-cloud-sun" : "bar-cloud-moon" }
  if (code === 3) return { label: "Overcast", icon: "bar-cloud" }
  if (code === 45 || code === 48) return { label: "Fog", icon: "bar-cloud-fog" }
  if (code >= 51 && code <= 55) return { label: code === 51 ? "Light drizzle" : code === 53 ? "Drizzle" : "Heavy drizzle", icon: "bar-cloud-drizzle" }
  if (code === 56 || code === 57) return { label: "Freezing drizzle", icon: "bar-cloud-drizzle" }
  if (code === 61) return { label: "Light rain", icon: "bar-cloud-rain" }
  if (code === 63) return { label: "Rain", icon: "bar-cloud-rain" }
  if (code === 65) return { label: "Heavy rain", icon: "bar-cloud-rain" }
  if (code === 66 || code === 67) return { label: "Freezing rain", icon: "bar-cloud-rain" }
  if (code >= 71 && code <= 77) return { label: code === 77 ? "Snow grains" : code === 71 ? "Light snow" : code === 73 ? "Snow" : "Heavy snow", icon: "bar-cloud-snow" }
  if (code >= 80 && code <= 82) return { label: code === 80 ? "Light showers" : code === 81 ? "Showers" : "Violent showers", icon: "bar-cloud-rain" }
  if (code === 85 || code === 86) return { label: "Snow showers", icon: "bar-cloud-snow" }
  if (code === 95) return { label: "Thunderstorm", icon: "bar-cloud-lightning" }
  if (code === 96 || code === 99) return { label: "Thunderstorm with hail", icon: "bar-cloud-lightning" }
  return { label: "Unknown", icon: "bar-cloud" }
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
const compass = (deg: number) => COMPASS[Math.round((deg % 360) / 22.5) % 16]
const deg = (v: number) => `${Math.round(v)}°`

function hourLabel(iso: string): string {
  const h = Number(iso.slice(11, 13))
  return `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`
}

function dayLabel(iso: string, i: number): string {
  if (i === 0) return "Today"
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en", { weekday: "short" })
}

// ── derived values the bar and the panel read ───────────────────────────
export const hasLocation = createComputed([location], (l) => l !== null)
export const hasData = createComputed([weather], (w) => w !== null)

export const chipTemp = createComputed([weather], (w) => (w ? deg(w.raw.current.temperature_2m) : ""))
export const chipIcon = createComputed([weather], (w) =>
  w ? condition(w.raw.current.weather_code, w.raw.current.is_day === 1).icon : "bar-cloud",
)

export const nowInfo = createComputed([weather], (w) => {
  if (!w) return null
  const c = w.raw.current
  const cond = condition(c.weather_code, c.is_day === 1)
  return {
    temp: deg(c.temperature_2m),
    feels: deg(c.apparent_temperature),
    humidity: `${Math.round(c.relative_humidity_2m)}%`,
    wind: `${Math.round(c.wind_speed_10m)} km/h ${compass(c.wind_direction_10m)}`,
    label: cond.label,
    icon: cond.icon,
    hi: deg(w.raw.daily.temperature_2m_max[0]),
    lo: deg(w.raw.daily.temperature_2m_min[0]),
  }
})

export const hourly = createComputed([weather], (w) => {
  if (!w) return []
  const h = w.raw.hourly
  const from = w.raw.current.time.slice(0, 13) // "2026-09-21T18"
  let i = h.time.findIndex((t) => t.slice(0, 13) >= from)
  if (i < 0) i = 0
  return h.time.slice(i + 1, i + 7).map((t, k) => ({
    label: hourLabel(t),
    icon: condition(h.weather_code[i + 1 + k], Number(t.slice(11, 13)) >= 6 && Number(t.slice(11, 13)) < 19).icon,
    temp: deg(h.temperature_2m[i + 1 + k]),
  }))
})

export const daily = createComputed([weather], (w) => {
  if (!w) return []
  const d = w.raw.daily
  return d.time.slice(0, 4).map((t, i) => ({
    day: dayLabel(t, i),
    icon: condition(d.weather_code[i], true).icon,
    hi: deg(d.temperature_2m_max[i]),
    lo: deg(d.temperature_2m_min[i]),
    rain: d.precipitation_probability_max[i] > 0 ? `${d.precipitation_probability_max[i]}%` : "",
  }))
})

export const updatedText = createComputed([weather, stale, now], (w, s, n) => {
  if (!w) return ""
  const mins = Math.max(0, Math.floor((n - w.fetchedAt) / 60_000))
  const ago = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`
  return s ? `offline · updated ${ago}` : `updated ${ago}`
})

export const placeName = createComputed([location], (l) => (l ? l.name : ""))
