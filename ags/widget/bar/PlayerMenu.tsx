import { Accessor, createBinding, createComputed, createState, With } from "ags"
import { createPoll } from "ags/time"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { Gdk, Gtk } from "ags/gtk4"
import AstalMpris from "gi://AstalMpris?version=0.1"
import GdkPixbuf from "gi://GdkPixbuf?version=2.0"
import Pango from "gi://Pango"
import Menu from "./Menu"
import { playIcon } from "./icons"

// Matches `.hairline`'s CSS min-width in main.scss — the panel's own
// min-width is pinned there too, so this is a known constant, not a
// measured one (same tradeoff already accepted for the EQ bars' fixed
// `.eq-bars` min-width).
const HAIRLINE_WIDTH = 248
const ART_SIZE = 108

// Gtk.Picture's natural size follows the source's intrinsic pixels, not
// width/heightRequest (a floor, not a ceiling) — pre-scale the pixel data
// to the EXACT display size. Scale so the SHORT side is `size`, then
// centre-crop to a square (16:9 browser thumbnails must not be squashed).
// Also returns an accent sampled from the cover.
type Cover = { texture: Gdk.Texture; tint: string | null }

function coverInfo(path: string, size: number): Cover | null {
  try {
    const [, w, h] = GdkPixbuf.Pixbuf.get_file_info(path)
    if (!w || !h) return null
    const k = size / Math.min(w, h)
    const sw = Math.max(size, Math.round(w * k))
    const sh = Math.max(size, Math.round(h * k))
    const full = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, sw, sh, false)
    const square = full.new_subpixbuf(
      Math.floor((sw - size) / 2),
      Math.floor((sh - size) / 2),
      size,
      size,
    )
    return { texture: Gdk.Texture.new_for_pixbuf(square), tint: accentFrom(square) }
  } catch {
    return null
  }
}

// Saturation-weighted average colour of the cover, then pushed into a
// lightness/saturation band that reads on the dark glass — a near-black
// or near-white cover must not produce an invisible accent.
function accentFrom(pb: GdkPixbuf.Pixbuf): string | null {
  const px = pb.get_pixels()
  const n = pb.get_n_channels()
  const rs = pb.get_rowstride()
  let R = 0, G = 0, B = 0, W = 0
  for (let y = 0; y < pb.get_height(); y += 3) {
    for (let x = 0; x < pb.get_width(); x += 3) {
      const i = y * rs + x * n
      const r = px[i], g = px[i + 1], b = px[i + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      const sat = mx === 0 ? 0 : (mx - mn) / mx
      const lum = (mx + mn) / 510
      const wgt = sat * sat * (lum > 0.12 && lum < 0.94 ? 1 : 0.15) + 0.004
      R += r * wgt; G += g * wgt; B += b * wgt; W += wgt
    }
  }
  if (W === 0) return null
  const [h, sat0, l0] = rgbToHsl(R / W, G / W, B / W)
  const [r, g, b] = hslToRgb(h, Math.min(0.85, Math.max(0.5, sat0)), Math.min(0.74, Math.max(0.62, l0)))
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0")
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  if (mx === mn) return [0, 0, l]
  const d = mx - mn
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255]
}

// The cover's accent is applied through a display-wide provider above the
// app stylesheet, so the play button, wave and knob all follow it with no
// per-widget plumbing; the colour transitions live in main.scss.
const tintProvider = new Gtk.CssProvider()
let tintInstalled = false
function applyTint(hex: string | null) {
  if (!tintInstalled) {
    const display = Gdk.Display.get_default()
    if (display) Gtk.StyleContext.add_provider_for_display(display, tintProvider, 850)
    tintInstalled = true
  }
  if (!hex) {
    tintProvider.load_from_string("")
    return
  }
  tintProvider.load_from_string(`
    .PlayerPanel .transport .glyph.primary { background-color: ${hex}; color: rgba(8, 10, 16, 0.88); }
    .PlayerPanel .transport .glyph.primary:hover { background-color: shade(${hex}, 1.12); }
    .PlayerPanel .transport .glyph.mini.on { color: ${hex}; }
    .PlayerPanel .wave { color: ${hex}; }
  `)
}

// Same VERTICAL|DISCRETE reasoning as WorkspaceRail.tsx's scroll — a
// track skip is a whole-step action, so a touchpad's stream of small
// deltas has to coalesce into single notches, not fire once per pixel.
const SCROLL_FLAGS =
  Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE

// Brief CSS class on a transport button so a skip reads as a skip: the
// glyph slides out and back in from the far side (see nudge-* keyframes).
function nudge(btn: Gtk.Button, cls: string) {
  btn.remove_css_class(cls)
  btn.add_css_class(cls)
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 320, () => {
    btn.remove_css_class(cls)
    return GLib.SOURCE_REMOVE
  })
}

function fmtTime(sec: number): string {
  const t = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const ss = String(t % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

const mpris = AstalMpris.get_default()

// WHICH player the panel and chip follow. `players[0]` is just whoever
// registered on D-Bus first, so a paused Spotube kept winning over a
// video actually playing in the browser. Preference order: a player that
// is PLAYING right now, else the one that most recently played (so
// pausing doesn't make the panel jump to another app), else the first.
//
// `active` is a real reactive value (the panel's <With> follows it);
// `wired` mirrors it for the chip's synchronous reads. Status changes on
// ANY player re-run the pick, so every player's signals are wired, not
// just the chosen one's.
const [active, setActive] = createState<AstalMpris.Player | null>(null)
const [tick, setTick] = createState(0)
let wired: AstalMpris.Player | null = null
let lastPlayed: AstalMpris.Player | null = null
const statusIds = new Map<AstalMpris.Player, number>()
let metaIds: number[] = []

function pick(): AstalMpris.Player | null {
  const list = mpris.players
  const playing = list.find((p) => p.playbackStatus === AstalMpris.PlaybackStatus.PLAYING)
  if (playing) return playing
  if (lastPlayed && list.includes(lastPlayed)) return lastPlayed
  return list[0] ?? null
}

function reselect() {
  const p = pick()
  if (p === wired) return

  for (const id of metaIds) wired?.disconnect(id)
  metaIds = []
  wired = p
  if (p) {
    for (const sig of ["notify::playback-status", "notify::title", "notify::artist"]) {
      metaIds.push(p.connect(sig, () => setTick((t) => t + 1)))
    }
  }
  setActive(p)
  setTick((t) => t + 1)
}

function rewire() {
  const list = mpris.players
  for (const [pl, id] of statusIds) {
    if (!list.includes(pl)) {
      pl.disconnect(id)
      statusIds.delete(pl)
    }
  }
  for (const pl of list) {
    if (statusIds.has(pl)) continue
    statusIds.set(
      pl,
      pl.connect("notify::playback-status", () => {
        if (pl.playbackStatus === AstalMpris.PlaybackStatus.PLAYING) lastPlayed = pl
        reselect()
      }),
    )
    if (pl.playbackStatus === AstalMpris.PlaybackStatus.PLAYING) lastPlayed = pl
  }
  reselect()
}

rewire()
mpris.connect("notify::players", rewire)

// Progress as a line that ripples while playing and settles flat when
// paused. Drawn, not CSS: GTK CSS has no way to make a wave. The frame
// loop runs ONLY while something is moving (playing, or easing between
// paused/playing or hover states) and stops itself when the panel is not
// mapped, so a closed dropdown costs nothing.
const WAVE_H = 20
const WAVE_AMP = 2.6
const WAVE_LEN = 20

function buildWave(
  p: AstalMpris.Player,
  progress: Accessor<number>,
  status: Accessor<AstalMpris.PlaybackStatus>,
  length: Accessor<number>,
): Gtk.DrawingArea {
  const area = new Gtk.DrawingArea({
    widthRequest: HAIRLINE_WIDTH,
    heightRequest: WAVE_H,
    halign: Gtk.Align.CENTER,
  })
  area.add_css_class("wave")

  let phase = 0
  let amp = 0
  let hover = 0
  let hoverTarget = 0
  let timer = 0
  const playing = () => p.playbackStatus === AstalMpris.PlaybackStatus.PLAYING

  area.set_draw_func((self, cr, w, h) => {
    const c = self.get_color()
    const mid = h / 2
    const lw = 3 + hover * 1.5
    const playedW = Math.max(0, Math.min(1, progress.peek())) * w
    cr.setLineCap(1)
    cr.setLineWidth(lw)

    cr.setSourceRGBA(1, 1, 1, 0.2)
    cr.moveTo(Math.max(playedW, lw / 2), mid)
    cr.lineTo(w - lw / 2, mid)
    cr.stroke()

    if (playedW > lw / 2) {
      cr.setSourceRGBA(c.red, c.green, c.blue, 1)
      const x0 = lw / 2
      cr.moveTo(x0, mid)
      for (let x = x0; x <= playedW; x += 2) {
        // taper to a flat line at the playhead so the wave meets the
        // remaining track cleanly instead of ending mid-crest
        const taper = Math.min(1, (playedW - x) / 14, (x - x0) / 10)
        const y = mid + amp * taper * Math.sin((x / WAVE_LEN) * Math.PI * 2 - phase)
        cr.lineTo(x, y)
      }
      cr.lineTo(playedW, mid)
      cr.stroke()
    }

    if (hover > 0.02) {
      cr.setSourceRGBA(c.red, c.green, c.blue, hover)
      cr.arc(playedW, mid, 4 + hover * 3, 0, Math.PI * 2)
      cr.fill()
    }
    ;(cr as any).$dispose?.()
  })

  const tickFn = () => {
    if (!area.get_mapped()) {
      timer = 0
      return GLib.SOURCE_REMOVE
    }
    amp += ((playing() ? WAVE_AMP : 0) - amp) * 0.14
    if (playing()) phase += 0.13
    hover += (hoverTarget - hover) * 0.24
    area.queue_draw()
    const busy =
      playing() || Math.abs(amp) > 0.04 || Math.abs(hover - hoverTarget) > 0.02
    if (!busy) {
      timer = 0
      return GLib.SOURCE_REMOVE
    }
    return GLib.SOURCE_CONTINUE
  }
  const kick = () => {
    if (!timer && area.get_mapped()) timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, tickFn)
    area.queue_draw()
  }

  const unsubs = [progress.subscribe(kick), status.subscribe(kick), length.subscribe(kick)]
  area.connect("map", kick)
  area.connect("destroy", () => {
    for (const u of unsubs) u()
    if (timer) GLib.source_remove(timer)
    timer = 0
  })

  const motion = new Gtk.EventControllerMotion()
  motion.connect("enter", () => {
    hoverTarget = 1
    kick()
  })
  motion.connect("leave", () => {
    hoverTarget = 0
    kick()
  })
  area.add_controller(motion)

  // Astal's `position` setter calls SetPosition, which MPRIS defines
  // against a track id — and some players (Spotube) publish none, so the
  // write is rejected ("invalid trackid ''"). Spotube also ignores the
  // relative Seek call, but DOES honour SetPosition with a placeholder
  // track path (verified live over busctl), so send that directly.
  const seekTo = (x: number) => {
    const len = length.peek()
    const width = area.get_width()
    if (!(p.canSeek && len > 0 && width > 0)) return
    const target = Math.max(0, Math.min(1, x / width)) * len
    if (p.trackid) {
      p.position = target
      return
    }
    Gio.DBus.session.call(
      p.busName,
      "/org/mpris/MediaPlayer2",
      "org.mpris.MediaPlayer2.Player",
      "SetPosition",
      new GLib.Variant("(ox)", [
        "/org/mpris/MediaPlayer2/TrackList/NoTrack",
        Math.round(target * 1_000_000),
      ]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      null,
    )
  }
  const drag = new Gtk.GestureDrag()
  let startX = 0
  drag.connect("drag-begin", (_g, x) => {
    startX = x
    seekTo(x)
  })
  drag.connect("drag-update", (_g, dx) => seekTo(startX + dx))
  area.add_controller(drag)
  if (p.canSeek) area.set_cursor_from_name("pointer")

  return area
}

export function PlayerPanel() {
  return (
    <box class="Panel PlayerPanel" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <With value={active}>
        {(p: AstalMpris.Player | null) => {
          if (!p) return <label class="status" label="Nothing playing" xalign={0} />

          const title = createBinding(p, "title")
          const artist = createBinding(p, "artist")
          const status = createBinding(p, "playbackStatus")
          const coverArt = createBinding(p, "coverArt")
          const length = createBinding(p, "length")
          const canPrev = createBinding(p, "canGoPrevious")
          const canNext = createBinding(p, "canGoNext")
          const canPlay = createBinding(p, "canPlay")
          const canPause = createBinding(p, "canPause")
          const shuffle = createBinding(p, "shuffleStatus")
          const loop = createBinding(p, "loopStatus")
          const hasModes = createComputed([shuffle, loop], (sh, lp) =>
            sh !== AstalMpris.Shuffle.UNSUPPORTED || lp !== AstalMpris.Loop.UNSUPPORTED,
          )

          // MPRIS position rarely emits property-change signals reliably
          // (this is why the old rice polled too, not a binding) — poll
          // once a second. Seeking below writes straight through to
          // player.position, same as VolumePanel's volume slider, so the
          // next poll tick reads back the real post-seek value rather
          // than needing a separate "is the user dragging" guard.
          const position = createPoll(p.position ?? 0, 250, () => p.position ?? 0)

          const progress = createComputed([position, length], (pos, len) =>
            len > 0 ? Math.max(0, Math.min(1, pos / len)) : 0,
          )

          // No card. Both prior attempts (a rounded elevated card, then
          // a live EQ) got called "too ai" — the actual common thread,
          // per design research 2026-09-07 (05-visual-direction.md),
          // is a decorative surface/effect nested inside the panel, not
          // any one effect specifically. Real references (Marvis Pro,
          // NotchNook) never nest a card — content sits flat on the one
          // surface that's already there.
          //
          // Layout is deliberately ASYMMETRIC, reusing the edge bar's
          // own grammar (hard-left/hard-right, nothing centred) instead
          // of the centred-template look: art+text anchored bottom-left,
          // transport right-aligned and bottom-aligned against it.
          return (
            <box class="PlayerBody" orientation={Gtk.Orientation.VERTICAL} spacing={0}>
              {/* One centred column: every row shares the panel's centre
                  axis and the same PLAYER_WIDTH, so nothing is left-hung
                  against a centred control row. */}
              <box
                halign={Gtk.Align.CENTER}
                class={createComputed([status], (st) =>
                  st === AstalMpris.PlaybackStatus.PLAYING ? "art-wrap" : "art-wrap paused",
                )}
              >
                <With value={coverArt}>
                  {(art: string) => {
                    const cover = art ? coverInfo(art, ART_SIZE) : null
                    const texture = cover?.texture ?? null
                    applyTint(cover?.tint ?? null)
                    return texture ? (
                      <Gtk.Picture
                        class="art"
                        hexpand={false}
                        vexpand={false}
                        halign={Gtk.Align.CENTER}
                        widthRequest={ART_SIZE}
                        heightRequest={ART_SIZE}
                        paintable={texture}
                        contentFit={Gtk.ContentFit.COVER}
                      />
                    ) : (
                      <box
                        class="art placeholder"
                        halign={Gtk.Align.CENTER}
                        widthRequest={ART_SIZE}
                        heightRequest={ART_SIZE}
                      >
                        <label class="art-glyph" label="󰎆" hexpand vexpand />
                      </box>
                    )
                  }}
                </With>
              </box>

              <box
                orientation={Gtk.Orientation.VERTICAL}
                halign={Gtk.Align.CENTER}
                widthRequest={HAIRLINE_WIDTH}
                class="meta"
              >
                <With value={title}>
                  {(t: string) => (
                    <label
                      class="track"
                      xalign={0.5}
                      justify={Gtk.Justification.CENTER}
                      ellipsize={Pango.EllipsizeMode.END}
                      maxWidthChars={22}
                      label={t || p.identity || ""}
                    />
                  )}
                </With>
                <With value={artist}>
                  {(a: string) => (
                    <label
                      class="artist"
                      xalign={0.5}
                      justify={Gtk.Justification.CENTER}
                      ellipsize={Pango.EllipsizeMode.END}
                      maxWidthChars={28}
                      label={a}
                    />
                  )}
                </With>
              </box>

              <box class="transport" halign={Gtk.Align.CENTER} spacing={10}>
                {/* Shuffle / repeat: shown only when the player exposes them
                    (mpv single files and many browser tabs don't); dim when
                    off, accent when on. One is hidden-together-with-the-other
                    so the trio never drifts off-centre. */}
                <button
                  class={createComputed([shuffle], (sh) =>
                    `glyph mini ${sh === AstalMpris.Shuffle.ON ? "on" : "off"}`,
                  )}
                  widthRequest={30}
                  heightRequest={30}
                  visible={hasModes}
                  sensitive={createComputed([shuffle], (sh) => sh !== AstalMpris.Shuffle.UNSUPPORTED)}
                  tooltipMarkup="Shuffle"
                  onClicked={() => p.shuffle()}
                >
                  <label class="sym" label="󰒝" />
                </button>
                {/* Nerd Font glyphs, not icon-theme SVGs: the theme's skip icons
                    are outlines with heavy padding while its pause is tiny, so
                    the three never matched. One filled family, one size. */}
                <button
                  class="glyph"
                  widthRequest={38}
                  heightRequest={38}
                  sensitive={canPrev}
                  onClicked={(self: Gtk.Button) => {
                    p.previous()
                    nudge(self, "nudge-prev")
                  }}
                >
                  <label class="sym" label="󰒮" />
                </button>
                <button
                  class="glyph primary"
                  widthRequest={46}
                  heightRequest={46}
                  sensitive={createComputed([status, canPlay, canPause], (st, cp, cz) =>
                    st === AstalMpris.PlaybackStatus.PLAYING ? cz : cp,
                  )}
                  onClicked={() => p.play_pause()}
                >
                  <With value={status}>
                    {(st: AstalMpris.PlaybackStatus) => (
                      <label
                        class="sym swap"
                        label={st === AstalMpris.PlaybackStatus.PLAYING ? "󰏤" : "󰐊"}
                      />
                    )}
                  </With>
                </button>
                <button
                  class="glyph"
                  widthRequest={38}
                  heightRequest={38}
                  sensitive={canNext}
                  onClicked={(self: Gtk.Button) => {
                    p.next()
                    nudge(self, "nudge-next")
                  }}
                >
                  <label class="sym" label="󰒭" />
                </button>
                <button
                  class={createComputed([loop], (lp) =>
                    `glyph mini ${lp === AstalMpris.Loop.NONE || lp === AstalMpris.Loop.UNSUPPORTED ? "off" : "on"}`,
                  )}
                  widthRequest={30}
                  heightRequest={30}
                  visible={hasModes}
                  sensitive={createComputed([loop], (lp) => lp !== AstalMpris.Loop.UNSUPPORTED)}
                  tooltipMarkup="Repeat"
                  onClicked={() => p.loop()}
                >
                  <label
                    class="sym"
                    label={createComputed([loop], (lp) => (lp === AstalMpris.Loop.TRACK ? "󰑘" : "󰑖"))}
                  />
                </button>
              </box>

              <box
                class="wave-hit"
                halign={Gtk.Align.CENTER}
                visible={createComputed([length], (len) => len > 0)}
                $={(self: Gtk.Box) => {
                  const wave = buildWave(p, progress, status, length)
                  self.append(wave)
                }}
              />

              <box class="times" halign={Gtk.Align.CENTER} widthRequest={HAIRLINE_WIDTH} visible={createComputed([length], (len) => len > 0)}>
                <label class="time" xalign={0} hexpand label={createComputed([position, length], (pos, len) =>
                  fmtTime(len > 0 ? Math.min(pos, len) : pos),
                )} />
                <label class="time" xalign={1} label={createComputed([position, length], (pos, len) =>
                  `\u2212${fmtTime(Math.max(0, len - Math.min(pos, len)))}`,
                )} />
              </box>
            </box>
          )
        }}
      </With>
    </box>
  )
}

export default function PlayerMenu(props: { reveal: Accessor<boolean> }) {
  const icon = createComputed([tick], () => {
    if (!wired) return "audio-x-generic-symbolic"
    return playIcon(wired.playbackStatus === AstalMpris.PlaybackStatus.PLAYING)
  })

  const value = createComputed([tick], () => {
    if (!wired) return ""
    const s = wired.artist ? `${wired.artist} — ${wired.title}` : (wired.title ?? "")
    return s.length > 26 ? `${s.slice(0, 25)}…` : s
  })

  // The whole glyph disappears when nothing is playing. A permanently
  // present, permanently dead music icon is the clutter the GNOME HIG
  // calls out (notes/09) — appear only when relevant.
  return (
    <revealer
      transitionType={Gtk.RevealerTransitionType.SLIDE_LEFT}
      transitionDuration={220}
      revealChild={createComputed([tick], () => wired !== null)}
    >
      <Menu
        name="player"
        icon={icon}
        value={value}
        animateValue
        reveal={props.reveal}
        tooltip="Scroll to skip · middle-click to play/pause · click for player"
        setup={(self) => {
          const scroll = new Gtk.EventControllerScroll({ flags: SCROLL_FLAGS })
          scroll.connect("scroll", (_c, _dx, dy) => {
            if (dy > 0) wired?.next()
            else wired?.previous()
            return Gdk.EVENT_STOP
          })
          self.add_controller(scroll)

          // Middle-click play/pause — the common action without opening
          // the dropdown (09-bar-interaction-research.md, item 5).
          // ⚠️ Same synthetic-click unreliability as VolumeMenu.tsx's
          // right-click gesture — see the note there (04-build-state.md,
          // 2026-09-07). Left as plain BUBBLE phase.
          const middleClick = new Gtk.GestureClick({ button: 2 })
          middleClick.connect("pressed", () => wired?.play_pause())
          self.add_controller(middleClick)
        }}
      />
    </revealer>
  )
}
