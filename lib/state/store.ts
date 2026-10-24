// Everything people and agents do in the control room: new messages, events,
// agent proposals, decisions, agent runs and settings. It sits on top of the
// read-only packet and is saved to `.state/overlay.json` so a demo survives a
// restart. `npm run reset` (or Settings → Reset demo) restores the seed.

import fs from "node:fs"
import path from "node:path"
import { loadBase, type Rec } from "../data/dataset"
import type { AgentRun } from "../agent/types"

export type Permissions = {
  /** Ask drivers and pickup or delivery sites questions without a person's yes. */
  askDriversAndSites: boolean
  /** Close a tracking-gap alert after the driver confirms where they are. */
  closeStaleTrackingAlerts: boolean
  /** Hold a quoted ferry or hotel without paying. Purchases always need a person. */
  holdTravel: boolean
}

export type Overlay = {
  version: 1
  /** Real time the demo started; drives the simulated clock. */
  startedAt: string
  revision: number
  added: Record<string, Rec[]>
  patched: Record<string, Record<string, Record<string, unknown>>>
  runs: Record<string, AgentRun>
  permissions: Permissions
  counter: number
  /** What operators said when they turned a suggestion down. The agent reads these on every new case. */
  lessons?: Lesson[]
}

export type Lesson = { at: string; reference: string; suggestion: string; correction: string }

export const DEFAULT_PERMISSIONS: Permissions = {
  askDriversAndSites: true,
  closeStaleTrackingAlerts: false,
  holdTravel: false,
}

const STATE_DIR = process.env.STATE_DIR ?? path.join(process.cwd(), ".state")
const STATE_FILE = path.join(STATE_DIR, "overlay.json")
const SEED_FILE = path.join(process.cwd(), "state", "seed.json")

const holder = globalThis as unknown as { __bahnOverlay?: Overlay; __bahnListeners?: Set<() => void>; __bahnStateMtime?: number }

function fileTime(): number {
  try { return fs.statSync(STATE_FILE).mtimeMs } catch { return 0 }
}

function empty(): Overlay {
  return {
    version: 1, startedAt: new Date().toISOString(), revision: 0, added: {}, patched: {}, runs: {},
    permissions: { ...DEFAULT_PERMISSIONS }, counter: 0,
  }
}

function fromSeed(): Overlay {
  if (!fs.existsSync(SEED_FILE)) return empty()
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) as Overlay
  // A seed keeps its recorded runs. Its clock resumes just after the last recorded
  // moment, so recorded steps read as "a few minutes ago", not as the future.
  const snapshot = new Date(loadBase().snapshotAt).getTime()
  const latest = Math.max(snapshot, ...Object.values(seed.runs ?? {}).map((run) => new Date(run.updatedAt).getTime()).filter(Number.isFinite))
  const startedAt = new Date(Date.now() - (latest - snapshot) - 60_000).toISOString()
  return { ...empty(), ...seed, startedAt, revision: 0 }
}

/** A run that was working when the server stopped cannot finish; say so instead of spinning forever. */
function alive(pid: number | undefined): boolean {
  if (!pid || pid === process.pid) return false
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM" }
}

function settleInterrupted(state: Overlay) {
  for (const run of Object.values(state.runs)) {
    // Another process that is still running (the dev server, a terminal agent run) owns this one.
    if (run.status !== "working" || alive(run.pid)) continue
    run.status = "error"
    run.statusText = "Stopped by a restart"
    run.error = "The app restarted while the agent was working. Ask it to continue."
  }
}

export function overlay(): Overlay {
  // Another process (a command-line agent run, `npm run reset`) may have written
  // the file since we last read or wrote it; pick that up instead of overwriting it.
  if (holder.__bahnOverlay && fileTime() <= (holder.__bahnStateMtime ?? 0)) return holder.__bahnOverlay
  let state: Overlay
  try {
    state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Overlay : fromSeed()
  } catch {
    state = fromSeed()
  }
  state.permissions = { ...DEFAULT_PERMISSIONS, ...state.permissions }
  // Only on a cold start: within one process, a run still in memory is genuinely working.
  if (!holder.__bahnOverlay) settleInterrupted(state)
  holder.__bahnOverlay = state
  holder.__bahnStateMtime = fileTime()
  return state
}

function save(state: Overlay) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  // One temp file per process: the dev server and a terminal agent run can save at once.
  const temp = `${STATE_FILE}.${process.pid}.tmp`
  const text = JSON.stringify(state)
  fs.writeFileSync(temp, text)
  // On Windows a rename fails with EPERM while another process (the dev server,
  // OneDrive sync, an antivirus scan) has the file open. Retry briefly, then write in place.
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(temp, STATE_FILE)
      break
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw error
      if (attempt >= 5) {
        fs.writeFileSync(STATE_FILE, text)
        fs.rmSync(temp, { force: true })
        break
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1))
    }
  }
  holder.__bahnStateMtime = fileTime()
}

/** Every write goes through here so the revision moves and the file stays current. */
export function mutate<T>(change: (state: Overlay) => T): T {
  const state = overlay()
  const result = change(state)
  state.revision += 1
  save(state)
  for (const listener of holder.__bahnListeners ?? []) listener()
  return result
}

export function onChange(listener: () => void): () => void {
  holder.__bahnListeners ??= new Set()
  holder.__bahnListeners.add(listener)
  return () => holder.__bahnListeners?.delete(listener)
}

/** Back to the seed, or with `clean` to the bare packet with no agent work at all. */
export function resetState(options: { clean?: boolean } = {}): Overlay {
  const state = options.clean ? empty() : fromSeed()
  holder.__bahnOverlay = state
  save(state)
  for (const listener of holder.__bahnListeners ?? []) listener()
  return state
}

/** A readable, unique id in the dataset's style: `msg-cr0001`, `evt-cr0002`. */
export function nextId(state: Overlay, prefix: string): string {
  state.counter += 1
  return `${prefix}-cr${String(state.counter).padStart(4, "0")}`
}

export function addRow(state: Overlay, collection: string, row: Rec) {
  ;(state.added[collection] ??= []).push(row)
}

export function patchRow(state: Overlay, collection: string, id: string, fields: Record<string, unknown>) {
  const table = (state.patched[collection] ??= {})
  table[id] = { ...(table[id] ?? {}), ...fields }
}

// The packet is a snapshot at 09:00 UTC on 21 October. The control room's clock
// starts there and moves with real time, so new messages and decisions land after
// the recorded ones. It stops after eight hours to keep a long-running demo sane.
const MAX_ELAPSED_MS = 8 * 60 * 60 * 1000

export function simNow(snapshotAt: string): string {
  const state = overlay()
  const elapsed = Math.min(Math.max(Date.now() - new Date(state.startedAt).getTime(), 0), MAX_ELAPSED_MS)
  return new Date(new Date(snapshotAt).getTime() + elapsed).toISOString()
}
