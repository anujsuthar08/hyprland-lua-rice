import { createBinding, createState } from "ags"
import { execAsync } from "ags/process"
import AstalHyprland from "gi://AstalHyprland?version=0.1"

// KDE-Activities-style window hide/show, layered on top of the existing
// workshop picker (SUPER+P, conf/binds.lua) rather than inventing a
// parallel concept. A virtual desktop is spatial ("where is this
// window"); an activity is contextual ("what am I doing right now") —
// switching one hides windows tagged to OTHER activities and shows this
// one's, regardless of which numbered workspace they're each sitting on.
//
// Named project WORKSPACES were tried and killed 2026-09-01 (see
// conf/rules.lua) because they started empty and stayed empty — four
// permanently dead chips. This avoids that trap by being opt-in and
// starting empty on purpose: nothing is ever hidden until a window is
// either spawned from the picker (auto-tagged via its `workshop-<name>`
// class, see conf/binds.lua's open_workshop) or explicitly tagged by
// hand (SUPER+P then T). Day one of using this feature is a no-op.

export const ACTIVITIES = ["web", "hackathon", "rice", "research"] as const
export type Activity = (typeof ACTIVITIES)[number]

function isActivity(s: string): s is Activity {
  return (ACTIVITIES as readonly string[]).includes(s)
}

export const [currentActivity, setCurrentActivity] = createState<Activity | null>(null)

// A dedicated named special workspace, NOT the bare "special" the
// scratchpad binds already use (SUPER+S / SUPER+SHIFT+S) — sharing one
// would mix a manually-scratchpadded window in with activity-hidden
// ones and surface it on the wrong switch.
const STASH = "special:activitystash"

// address -> activity it belongs to. Only entries in this map are ever
// touched by a switch; everything else stays visible always.
const tags = new Map<string, Activity>()
// address -> the numbered workspace it was on right before being
// stashed, so it comes back to the same spot rather than "wherever".
const homeWorkspace = new Map<string, number>()

type ClientRow = { address: string; cls: string; workspace: number; special: boolean }

// Snapshot via hyprctl, not the reactive AstalHyprland binding — this
// runs inside switchActivity's stash/restore loop, where a plain,
// point-in-time list is what's needed (same pattern as
// widget/switcherState.ts's `list()`).
async function listClients(): Promise<ClientRow[]> {
  const raw = JSON.parse(String(await execAsync(["hyprctl", "clients", "-j"]))) as any[]
  return raw
    .filter((c) => c.mapped)
    .map((c) => ({
      address: c.address as string,
      cls: (c.class as string) || (c.initialClass as string) || "",
      workspace: c.workspace?.id ?? 0,
      special: ((c.workspace?.name as string | undefined) ?? "").startsWith("special"),
    }))
}

async function activeWorkspaceId(): Promise<number> {
  const raw = JSON.parse(String(await execAsync(["hyprctl", "activeworkspace", "-j"]))) as any
  return (raw?.id as number) ?? 1
}

async function focusedAddress(): Promise<string | null> {
  const out = String(await execAsync(["hyprctl", "activewindow", "-j"])).trim()
  if (!out || out === "{}") return null
  const raw = JSON.parse(out) as any
  return (raw?.address as string) ?? null
}

// `follow = false`, not `silent` — `silent` is not a real field on
// window.move (CLAUDE.md's silently-dropped-fields table); passing it
// makes the VIEW follow the window instead of staying put.
async function moveWindow(address: string, workspace: string | number) {
  const ws = typeof workspace === "string" ? `"${workspace}"` : String(workspace)
  await execAsync([
    "hyprctl",
    "dispatch",
    `hl.dsp.window.move({ workspace = ${ws}, window = "address:${address}", follow = false })`,
  ]).catch((e) => console.error("activity: move failed", address, workspace, e))
}

let switching = false

export async function switchActivity(target: Activity): Promise<string> {
  if (switching) return "busy"
  switching = true
  try {
    if (currentActivity.peek() === target) return `already ${target}`

    const clients = await listClients()
    const byAddress = new Map(clients.map((c) => [c.address, c]))

    // Prune tags for windows that no longer exist at all (closed since
    // the last switch) — cheap tidiness, done here rather than on a
    // window.close hook so this file only has one place that touches
    // Hyprland state.
    for (const addr of Array.from(tags.keys())) {
      if (!byAddress.has(addr)) {
        tags.delete(addr)
        homeWorkspace.delete(addr)
      }
    }

    // Stash anything tagged to a DIFFERENT activity that's currently
    // visible (not already stashed).
    for (const [addr, tag] of tags) {
      if (tag === target) continue
      const c = byAddress.get(addr)
      if (!c || c.special) continue
      homeWorkspace.set(addr, c.workspace)
      await moveWindow(addr, STASH)
    }

    // Restore this activity's own stashed windows to where they were.
    const fallback = await activeWorkspaceId()
    for (const [addr, tag] of tags) {
      if (tag !== target) continue
      const c = byAddress.get(addr)
      if (!c || !c.special) continue
      const home = homeWorkspace.get(addr) ?? fallback
      await moveWindow(addr, home)
      homeWorkspace.delete(addr)
    }

    setCurrentActivity(target)
    return `switched to ${target}`
  } finally {
    switching = false
  }
}

export async function tagFocusedToCurrent(): Promise<string> {
  const target = currentActivity.peek()
  if (!target) return "no active activity to tag into"
  const addr = await focusedAddress()
  if (!addr) return "no focused window"
  tags.set(addr, target)
  return `tagged ${addr} -> ${target}`
}

export async function untagFocused(): Promise<string> {
  const addr = await focusedAddress()
  if (!addr) return "no focused window"
  const had = tags.delete(addr)
  homeWorkspace.delete(addr)
  return had ? `released ${addr}` : "was not tagged"
}

// ── auto-tag on open ──
//
// A window whose class is `workshop-<name>` (set by conf/binds.lua's
// open_workshop via kitty's --class) was spawned by the picker for that
// exact workshop — tag it and switch into that activity as a side
// effect, no separate confirmation needed. Everything else (a browser,
// Spotify, a plain terminal) is left alone: untagged means visible in
// every activity, forever, unless hand-tagged with SUPER+P then T.
const hypr = AstalHyprland.get_default()
const clientsBinding = createBinding(hypr, "clients")

// AstalHyprland.Client.address omits the "0x" that `hyprctl clients -j`
// (used everywhere else in this file, e.g. listClients()) always
// includes — two representations of the same address that don't
// compare equal. Found live: tags set here with the bare form were
// invisible to switchActivity's hyprctl-sourced lookups, so its OWN
// stale-tag pruning (comparing against a hyprctl snapshot) deleted a
// just-set tag on the very next call, before it ever got used. Normalize
// once, at the only place a bare-form address enters this file.
function normalizeAddress(a: string): string {
  return a.startsWith("0x") ? a : `0x${a}`
}

// Seeded once, synchronously, before subscribing — so windows that
// already existed when the shell started are never mistaken for
// "just opened".
let knownAddresses = new Set(clientsBinding.get().map((c) => normalizeAddress(c.address)))

clientsBinding.subscribe(() => {
  const list = clientsBinding.get()
  const seen = new Set<string>()
  for (const c of list) {
    const address = normalizeAddress(c.address)
    seen.add(address)
    if (knownAddresses.has(address)) continue
    const cls = c.class || c.initialClass || ""
    const m = /^workshop-(.+)$/.exec(cls)
    if (m && isActivity(m[1])) {
      const name = m[1]
      tags.set(address, name)
      switchActivity(name)
    }
  }
  for (const addr of Array.from(tags.keys())) {
    if (!seen.has(addr)) {
      tags.delete(addr)
      homeWorkspace.delete(addr)
    }
  }
  knownAddresses = seen
})
