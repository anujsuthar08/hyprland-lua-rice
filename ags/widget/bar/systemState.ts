import { createState } from "ags"
import { interval } from "ags/time"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import { openDropdown } from "./dropdown"

// System monitor data. Cheap by design: everything comes straight from /proc and /sys every
// 3 s (a couple of dozen tiny file reads), disk usage every minute, and the process list —
// the one thing that needs a subprocess — is fetched ONLY while the panel is open.
//
// What is collected follows the reference monitors (TopHat, iStat Menus, Stats): per resource
// a headline number and a history to draw, CPU adds per-core load / frequency / load average /
// uptime, plus GPU, disk activity and fan speed. Every source is optional: a machine without
// a GPU counter or a fan simply gets no such line (`null`), never a zero pretending to be data.

export type Proc = { name: string; cpu: number; mem: number } // cpu %, mem bytes
export type ProcSort = "cpu" | "mem"

export const HISTORY = 60 // samples; at 3 s each that is the last 3 minutes
const blank = () => Array<number>(HISTORY).fill(0)
const push = (h: number[], v: number) => [...h.slice(1), v]

const read = (p: string): string => {
  try {
    const [ok, b] = GLib.file_get_contents(p)
    return ok ? new TextDecoder().decode(b) : ""
  } catch {
    return ""
  }
}
const readNum = (p: string): number | null => {
  const t = read(p).trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// ── CPU ─────────────────────────────────────────────────────────────────
export const [cpu, setCpu] = createState(0) // 0..100, all cores
export const [cpuHistory, setCpuHistory] = createState<number[]>(blank())
export const [perCore, setPerCore] = createState<number[]>([]) // 0..100 each
export const [cpuGhz, setCpuGhz] = createState<number | null>(null)
export const [load, setLoad] = createState<[number, number, number] | null>(null)
export const [uptime, setUptime] = createState(0) // seconds
export const [temp, setTemp] = createState<number | null>(null) // CPU package, °C

let prev: Record<string, [number, number]> = {} // "cpu" | "cpu0".. -> [total, idle]
function sampleCpu() {
  const lines = read("/proc/stat").split("\n").filter((l) => l.startsWith("cpu"))
  const cores: number[] = []
  let all = 0
  const next: Record<string, [number, number]> = {}
  for (const l of lines) {
    const f = l.trim().split(/\s+/)
    const n = f.slice(1).map(Number)
    if (n.length < 5) continue
    const idle = n[3] + (n[4] || 0) // idle + iowait
    const total = n.reduce((a, b) => a + b, 0)
    next[f[0]] = [total, idle]
    const p = prev[f[0]]
    if (!p) continue
    const dt = total - p[0]
    const pct = dt > 0 ? Math.max(0, Math.min(100, (100 * (dt - (idle - p[1]))) / dt)) : 0
    if (f[0] === "cpu") all = pct
    else cores.push(pct)
  }
  if (prev["cpu"]) {
    setCpu(all)
    setCpuHistory((h) => push(h, all))
    setPerCore(cores)
  }
  prev = next

  // average current frequency across cores, in GHz: 16 sysfs reads, shown only in the open panel
  if (openDropdown.peek() === "system" || cpuGhz.peek() === null) {
    let sum = 0, cnt = 0
    for (let i = 0; i < 128; i++) {
      const v = readNum(`/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`)
      if (v === null) { if (i > 0) break; else continue }
      sum += v; cnt++
    }
    setCpuGhz(cnt ? sum / cnt / 1e6 : null)
  }

  const la = read("/proc/loadavg").split(" ").slice(0, 3).map(Number)
  setLoad(la.length === 3 && la.every(Number.isFinite) ? [la[0], la[1], la[2]] : null)
  setUptime(Number(read("/proc/uptime").split(" ")[0]) || 0)
}

// ── memory ──────────────────────────────────────────────────────────────
export const [memUsed, setMemUsed] = createState(0)
export const [memTotal, setMemTotal] = createState(0)
export const [memHistory, setMemHistory] = createState<number[]>(blank()) // 0..100
export const [swapUsed, setSwapUsed] = createState(0)
export const [swapTotal, setSwapTotal] = createState(0)

function sampleMem() {
  const m: Record<string, number> = {}
  for (const l of read("/proc/meminfo").split("\n")) {
    const x = l.match(/^(\w+):\s+(\d+)/)
    if (x) m[x[1]] = Number(x[2]) * 1024
  }
  if (!m.MemTotal) return
  const used = m.MemTotal - (m.MemAvailable ?? m.MemFree)
  setMemTotal(m.MemTotal)
  setMemUsed(used)
  setMemHistory((h) => push(h, (100 * used) / m.MemTotal))
  setSwapTotal(m.SwapTotal ?? 0)
  setSwapUsed((m.SwapTotal ?? 0) - (m.SwapFree ?? 0))
}

// ── hwmon sensors, found once by chip name ────────────────────────────────
const hwmonCache: Record<string, string | null> = {}
function hwmon(name: string): string | null {
  if (name in hwmonCache) return hwmonCache[name]
  let found: string | null = null
  for (let i = 0; i < 32 && !found; i++) {
    const d = `/sys/class/hwmon/hwmon${i}`
    if (read(`${d}/name`).trim() === name) found = d
  }
  hwmonCache[name] = found
  return found
}
const tempOf = (chip: string, file = "temp1_input"): number | null => {
  const d = hwmon(chip)
  const v = d ? readNum(`${d}/${file}`) : null
  return v !== null && v > 0 ? v / 1000 : null
}

const CPU_CHIPS = ["k10temp", "coretemp", "zenpower", "acpitz"]

// ── GPU (amdgpu exposes busy % and VRAM in sysfs; other vendors -> no GPU section) ──
export const [gpu, setGpu] = createState<number | null>(null) // busy %
export const [gpuHistory, setGpuHistory] = createState<number[]>(blank())
export const [gpuTemp, setGpuTemp] = createState<number | null>(null)
export const [gpuWatts, setGpuWatts] = createState<number | null>(null)
export const [vramUsed, setVramUsed] = createState<number | null>(null)
export const [vramTotal, setVramTotal] = createState<number | null>(null)

let gpuDev: string | null | undefined
function findGpu(): string | null {
  for (let i = 0; i < 8; i++) {
    const d = `/sys/class/drm/card${i}/device`
    if (readNum(`${d}/gpu_busy_percent`) !== null) return d
  }
  return null
}
function sampleGpu() {
  if (gpuDev === undefined) gpuDev = findGpu()
  if (!gpuDev) return
  const b = readNum(`${gpuDev}/gpu_busy_percent`)
  if (b !== null) { setGpu(b); setGpuHistory((h) => push(h, b)) }
  setVramUsed(readNum(`${gpuDev}/mem_info_vram_used`))
  setVramTotal(readNum(`${gpuDev}/mem_info_vram_total`))
  setGpuTemp(tempOf("amdgpu"))
  const d = hwmon("amdgpu")
  const uw = d ? readNum(`${d}/power1_average`) ?? readNum(`${d}/power1_input`) : null
  setGpuWatts(uw !== null ? uw / 1e6 : null)
}

// ── disk: usage (df, every minute) and activity (/proc/diskstats deltas) ──────────
export const [diskUsed, setDiskUsed] = createState(0)
export const [diskTotal, setDiskTotal] = createState(0)
export const [diskRead, setDiskRead] = createState<number | null>(null) // bytes/s
export const [diskWrite, setDiskWrite] = createState<number | null>(null)
export const [diskTemp, setDiskTemp] = createState<number | null>(null)

async function sampleDiskUsage() {
  try {
    const out = String(await execAsync(["df", "-B1", "--output=used,size", "/"]))
    const [u, s] = out.trim().split("\n")[1].trim().split(/\s+/).map(Number)
    if (s > 0) { setDiskUsed(u); setDiskTotal(s) }
  } catch {}
}

// whole disks only (nvme0n1, sda, vda) — partitions would double count
const WHOLE_DISK = /^(nvme\d+n\d+|sd[a-z]+|vd[a-z]+|mmcblk\d+)$/
let prevIo: { r: number; w: number; t: number } | null = null
function sampleDiskIo() {
  let r = 0, w = 0
  for (const l of read("/proc/diskstats").split("\n")) {
    const f = l.trim().split(/\s+/)
    if (f.length > 9 && WHOLE_DISK.test(f[2])) { r += Number(f[5]) * 512; w += Number(f[9]) * 512 }
  }
  const t = GLib.get_monotonic_time() / 1e6
  if (prevIo && t > prevIo.t) {
    setDiskRead(Math.max(0, (r - prevIo.r) / (t - prevIo.t)))
    setDiskWrite(Math.max(0, (w - prevIo.w) / (t - prevIo.t)))
  }
  prevIo = { r, w, t }
  setDiskTemp(tempOf("nvme"))
}

// ── fans ────────────────────────────────────────────────────────────────
export const [fanRpm, setFanRpm] = createState<number | null>(null)
function sampleFan() {
  let best: number | null = null
  for (const chip of ["asus", "acpi_fan", "thinkpad", "dell_smm"]) {
    const d = hwmon(chip)
    if (!d) continue
    for (let n = 1; n <= 4; n++) {
      const v = readNum(`${d}/fan${n}_input`)
      if (v !== null) best = Math.max(best ?? 0, v)
    }
    if (best !== null) break
  }
  setFanRpm(best)
}

// ── top processes, only while the panel is open ──────────────────────────
export const [procSort, setProcSort] = createState<ProcSort>("cpu")
export const [procs, setProcs] = createState<Proc[]>([])

let procBusy = false
async function sampleProcs() {
  if (procBusy) return
  procBusy = true
  try {
    const sort = procSort.peek()
    // CPU: top's FIRST iteration is an average since each process started, so take the second
    // (0.6 s later), the live figure. Memory has no such delta, one iteration is right.
    const cmd = sort === "cpu"
      ? "top -b -n 2 -d 0.6 -w 200 -o %CPU | awk '/^ *PID/{n++;c=0;next} n==2 && c<10 {print;c++}' | grep -v ' top$'"
      : "top -b -n 1 -w 200 -o %MEM | awk '/^ *PID/{n++;c=0;next} n==1 && c<10 {print;c++}' | grep -v ' top$'"
    const out = String(await execAsync(["bash", "-c", cmd]))
    const rows: Proc[] = []
    for (const l of out.split("\n")) {
      // PID USER PR NI VIRT RES SHR S %CPU %MEM TIME+ COMMAND
      const f = l.trim().split(/\s+/)
      if (f.length < 12) continue
      const res = f[5]
      const mult = res.endsWith("g") ? 1024 ** 3 : res.endsWith("m") ? 1024 ** 2 : res.endsWith("t") ? 1024 ** 4 : 1024
      const num = parseFloat(res)
      rows.push({ name: f.slice(11).join(" "), cpu: Number(f[8].replace(",", ".")), mem: (Number.isFinite(num) ? num : 0) * mult })
    }
    setProcs(rows.slice(0, 5))
  } catch {}
  procBusy = false
}
export function chooseProcSort(s: ProcSort) {
  setProcSort(s)
  sampleProcs()
}

// ── wiring ────────────────────────────────────────────────────────────────
function sampleFast() {
  sampleCpu(); sampleMem(); sampleGpu(); sampleDiskIo(); sampleFan()
  setTemp(CPU_CHIPS.map((c) => tempOf(c)).find((t) => t !== null) ?? null)
}
sampleFast(); sampleDiskUsage()
interval(3000, () => { sampleFast(); if (openDropdown.peek() === "system") sampleProcs() })
interval(60_000, sampleDiskUsage)
openDropdown.subscribe(() => { if (openDropdown.get() === "system") { sampleCpu(); sampleProcs() } })

// ── formatting ────────────────────────────────────────────────────────────
export const fmtBytes = (b: number) =>
  b >= 1024 ** 4 ? `${(b / 1024 ** 4).toFixed(1)} TB`
  : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB`
  : `${Math.round(b / 1024 ** 2)} MB`
export const fmtRate = (b: number) =>
  b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB/s` : b >= 1024 ? `${Math.round(b / 1024)} KB/s` : "0 KB/s"
export const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}
