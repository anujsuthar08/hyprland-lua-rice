import { Accessor, createComputed, For } from "ags"
import { Gtk } from "ags/gtk4"
import Menu from "./Menu"
import {
  chooseProcSort, cpu, cpuGhz, cpuHistory, diskRead, diskTemp, diskTotal, diskUsed, diskWrite, fanRpm,
  fmtBytes, fmtRate, fmtUptime, gpu, gpuHistory, gpuTemp, gpuWatts, load, memHistory, memTotal, memUsed,
  perCore, Proc, procs, procSort, swapTotal, swapUsed, temp, uptime, vramTotal, vramUsed,
} from "./systemState"

// System monitor dropdown. Patterns taken from the references (TopHat, iStat Menus, Stats):
// each resource is a headline number over a live history graph (here the last 3 minutes),
// CPU adds per-core load, frequency, load average and uptime, then GPU, disk activity and
// fan speed, and finally the busiest processes with a CPU/Memory switch. Flat on the one
// glass surface, hairlines between sections, no nested cards. Sections whose sensor does
// not exist on this machine (no GPU counter, no fan) are simply absent.

// A filled history graph drawn with cairo. Colour comes from the widget's CSS `color`, so
// each resource is themed in the stylesheet (and follows the wallpaper palette) rather than
// hard-coded here. `max` fixes the scale (100 for percentages), so a quiet machine looks quiet.
function spark(history: Accessor<number[]>, max: number, klass: string): Gtk.DrawingArea {
  const area = new Gtk.DrawingArea({ hexpand: true, heightRequest: 34 })
  area.add_css_class("spark")
  area.add_css_class(klass)
  area.set_draw_func((self, cr, w, h) => {
    const c = self.get_color()
    const d = history.peek()
    const n = d.length
    if (n < 2) return
    const x = (i: number) => (i / (n - 1)) * w
    const y = (v: number) => h - 1 - Math.max(0, Math.min(1, v / max)) * (h - 3)

    cr.setSourceRGBA(c.red, c.green, c.blue, 0.16) // baseline hairline
    cr.setLineWidth(1)
    cr.moveTo(0, h - 0.5)
    cr.lineTo(w, h - 0.5)
    cr.stroke()

    cr.moveTo(0, h)
    for (let i = 0; i < n; i++) cr.lineTo(x(i), y(d[i]))
    cr.lineTo(w, h)
    cr.closePath()
    cr.setSourceRGBA(c.red, c.green, c.blue, 0.22)
    cr.fill()

    cr.setLineWidth(1.5)
    cr.setLineJoin(1)
    cr.setSourceRGBA(c.red, c.green, c.blue, 1)
    for (let i = 0; i < n; i++) (i ? cr.lineTo(x(i), y(d[i])) : cr.moveTo(x(i), y(d[i])))
    cr.stroke()
    ;(cr as any).$dispose?.()
  })
  history.subscribe(() => area.queue_draw())
  return area
}

// One thin bar per core — the iStat/Stats "cores" strip.
function coreStrip(cores: Accessor<number[]>): Gtk.DrawingArea {
  const area = new Gtk.DrawingArea({ hexpand: true, heightRequest: 20 })
  area.add_css_class("spark")
  area.add_css_class("spark-cores")
  area.set_draw_func((self, cr, w, h) => {
    const c = self.get_color()
    const d = cores.peek()
    const n = d.length
    if (!n) return
    const gap = 3
    const bw = (w - gap * (n - 1)) / n
    for (let i = 0; i < n; i++) {
      const bx = i * (bw + gap)
      cr.setSourceRGBA(c.red, c.green, c.blue, 0.16)
      cr.rectangle(bx, 0, bw, h)
      cr.fill()
      const bh = Math.max(1.5, (Math.min(100, d[i]) / 100) * h)
      cr.setSourceRGBA(c.red, c.green, c.blue, 0.95)
      cr.rectangle(bx, h - bh, bw, bh)
      cr.fill()
    }
    ;(cr as any).$dispose?.()
  })
  cores.subscribe(() => area.queue_draw())
  return area
}

const pct = (v: number) => `${Math.round(v)}%`
const deg = (t: number | null) => (t === null ? "" : `${Math.round(t)}°`)

// title on the left, headline on the right, optional dim detail line under the graph
function Section(props: { title: string; value: Accessor<string>; graph: Gtk.Widget; detail?: Accessor<string>; visible?: Accessor<boolean> }) {
  return (
    <box class="sys-sec" orientation={Gtk.Orientation.VERTICAL} spacing={5} visible={props.visible ?? true}>
      <box>
        <label class="sys-title" xalign={0} hexpand label={props.title} />
        <label class="sys-head" label={props.value} />
      </box>
      {props.graph}
      {props.detail ? <label class="dim" xalign={0} label={props.detail} visible={createComputed([props.detail], (d) => d !== "")} /> : <box />}
    </box>
  )
}

const join = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join("  ·  ")

export function SystemPanel() {
  const cpuDetail = createComputed([cpuGhz, load, temp], (g, l, t) =>
    join(g !== null && `${g.toFixed(1)} GHz`, l && `load ${l[0].toFixed(2)}`, t !== null && `${Math.round(t)}°C`))
  const memDetail = createComputed([memUsed, memTotal, swapUsed, swapTotal], (u, t, su, st) =>
    join(`${fmtBytes(u)} of ${fmtBytes(t)}`, st > 0 && `swap ${fmtBytes(su)} of ${fmtBytes(st)}`))
  const hasGpu = createComputed([gpu], (g) => g !== null)
  const gpuDetail = createComputed([vramUsed, vramTotal, gpuTemp, gpuWatts], (vu, vt, t, w) =>
    join(vu !== null && vt ? `VRAM ${fmtBytes(vu)} of ${fmtBytes(vt)}` : "", t !== null && `${Math.round(t)}°C`, w !== null && w > 0 && `${w.toFixed(1)} W`))
  const diskFrac = createComputed([diskUsed, diskTotal], (u, t) => (t ? u / t : 0))
  const hasFan = createComputed([fanRpm], (f) => f !== null)

  return (
    <box class="Panel SystemPanel" orientation={Gtk.Orientation.VERTICAL} spacing={12}>
      <box class="panel-head">
        <label class="panel-title" label="System" xalign={0} hexpand />
        <label class="dim" label={createComputed([uptime], (u) => `up ${fmtUptime(u)}`)} />
      </box>

      <Section title="Processor" value={createComputed([cpu], pct)} graph={spark(cpuHistory, 100, "spark-cpu")} detail={cpuDetail} />
      {coreStrip(perCore)}

      <Section title="Memory" value={createComputed([memUsed, memTotal], (u, t) => pct(t ? (100 * u) / t : 0))}
        graph={spark(memHistory, 100, "spark-mem")} detail={memDetail} />

      <Section title="Graphics" visible={hasGpu} value={createComputed([gpu], (g) => pct(g ?? 0))}
        graph={spark(gpuHistory, 100, "spark-gpu")} detail={gpuDetail} />

      <box class="sys-sec" orientation={Gtk.Orientation.VERTICAL} spacing={5}>
        <box>
          <label class="sys-title" xalign={0} hexpand label="Disk" />
          <label class="sys-head" label={createComputed([diskUsed, diskTotal], (u, t) => `${fmtBytes(u)} of ${fmtBytes(t)}`)} />
        </box>
        <levelbar class={createComputed([diskFrac], (f) => (f > 0.9 ? "gauge warn" : "gauge"))}
          value={createComputed([diskFrac], (f) => Math.max(0, Math.min(1, f)))} />
        <label class="dim" xalign={0}
          label={createComputed([diskRead, diskWrite, diskTemp], (r, w, t) =>
            join(r !== null && `↓ ${fmtRate(r)}`, w !== null && `↑ ${fmtRate(w)}`, t !== null && `${Math.round(t)}°C`))} />
      </box>

      <box class="sys-sec" visible={hasFan}>
        <label class="sys-title" xalign={0} hexpand label="Fan" />
        <label class="sys-head" label={createComputed([fanRpm], (f) => (f === null ? "" : f === 0 ? "idle" : `${f} rpm`))} />
      </box>

      <box class="sys-procs" orientation={Gtk.Orientation.VERTICAL} spacing={4}>
        <box spacing={6}>
          <label class="sys-title" xalign={0} hexpand label="Busiest now" />
          <button class={createComputed([procSort], (s) => `sys-seg ${s === "cpu" ? "active" : ""}`)} onClicked={() => chooseProcSort("cpu")}>
            <label label="CPU" />
          </button>
          <button class={createComputed([procSort], (s) => `sys-seg ${s === "mem" ? "active" : ""}`)} onClicked={() => chooseProcSort("mem")}>
            <label label="Memory" />
          </button>
        </box>
        <For each={procs}>
          {(p: Proc) => (
            <box spacing={8}>
              <label class="sys-pname" xalign={0} hexpand ellipsize={3} maxWidthChars={26} label={p.name} />
              <label class="dim sys-pmem" label={fmtBytes(p.mem)} />
              <label class="value sys-pcpu" label={pct(p.cpu)} />
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

// A chip that is always there (a monitor you must hover to read is not a monitor):
// the CPU icon, warming to the error colour when the machine is struggling. The
// numbers show when the bar expands.
export default function SystemMenu(props: { reveal: Accessor<boolean> }) {
  return (
    <Menu
      name="system"
      icon="bar-cpu"
      value={createComputed([cpu, memUsed, memTotal], (c, u, t) => `${pct(c)} · ${t ? Math.round((100 * u) / t) : 0}% RAM`)}
      extra={createComputed([cpu, memUsed, memTotal, temp], (c, u, t, tp) =>
        c > 90 || (t > 0 && u / t > 0.92) || (tp !== null && tp > 90) ? "hot" : "")}
      reveal={props.reveal}
      tooltip="System"
    />
  )
}
