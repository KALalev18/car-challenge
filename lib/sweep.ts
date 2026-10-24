// The background pass: the agent looks at every open on-the-road case nobody has
// asked it about yet, a few at a time, so a person arrives to briefings and
// decisions instead of raw alerts.

import { investigate } from "./actions"
import { modelAvailable } from "./agent/model"
import { overlay } from "./state/store"
import { buildQueue, isJourneyCase } from "./triage"

const CONCURRENCY = 3

type SweepState = { running: boolean; total: number; done: number; startedAt: string | null }
const holder = globalThis as unknown as { __bahnSweep?: SweepState }
const sweepState: SweepState = (holder.__bahnSweep ??= { running: false, total: 0, done: 0, startedAt: null })

export function sweepStatus(): SweepState {
  return { ...sweepState }
}

/** Orders the sweep would pick up now. */
export function sweepTargets(): string[] {
  const runs = overlay().runs
  // Only road cases that need a decision or carry a risk: the agent's time (and
  // tokens) go where a person would otherwise have to dig.
  return buildQueue().items
    .filter((item) => isJourneyCase(item) && !runs[item.id] && (item.bucket === "decide" || item.tone === "warn" || item.tone === "danger"))
    .map((item) => item.id)
}

export function startSweep(): SweepState {
  if (!modelAvailable()) throw new Error("The agent needs an Anthropic API key. Add ANTHROPIC_API_KEY or OPENROUTER_API_KEY to .env.local and restart.")
  if (sweepState.running) return sweepStatus()
  const targets = sweepTargets()
  Object.assign(sweepState, { running: true, total: targets.length, done: 0, startedAt: new Date().toISOString() })
  const pending = [...targets]
  const worker = async () => {
    while (pending.length) {
      const orderId = pending.shift()!
      try {
        investigate(orderId)
        // investigate starts the run in the background; wait for its first segment.
        await waitForIdle(orderId)
      } catch (error) {
        console.error(`sweep: ${orderId}`, error)
      }
      sweepState.done += 1
    }
  }
  void Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker)).finally(() => { sweepState.running = false })
  return sweepStatus()
}

async function waitForIdle(orderId: string) {
  const { isRunning } = await import("./agent/run")
  while (isRunning(orderId)) await new Promise((resolve) => setTimeout(resolve, 500))
}
