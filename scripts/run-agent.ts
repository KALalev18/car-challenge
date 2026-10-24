// Runs the Journey agent on one order from the command line and writes the full
// trace (every step, the model conversation, token use) to traces/<ref>.json.
// The simulated driver answers as in the app.
//
//   npm run agent:run -- CD-420322
//   npm run agent:run -- CD-420322 "Ask the driver for their ETA"
import "./env"
import fs from "node:fs"
import path from "node:path"
import { ask, investigate } from "../lib/actions"
import { modelAvailable } from "../lib/agent/model"
import { isRunning } from "../lib/agent/run"
import { world } from "../lib/data/world"
import { overlay } from "../lib/state/store"

async function main() {
  const [ref, note] = process.argv.slice(2)
  if (!ref) throw new Error("Usage: npm run agent:run -- <order reference, e.g. CD-420322> [message to the agent]")
  if (!modelAvailable()) throw new Error("Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY in .env.local first.")
  const order = world().table("orders").find((row) => row.reference === ref || row.id === ref)
  if (!order) throw new Error(`No order ${ref}`)
  const started = Date.now()
  if (note && overlay().runs[order.id]) ask(order.id, note)
  else investigate(order.id, note ?? null)

  // Follow the run, including the simulated driver's replies, until it settles.
  let printed = 0
  let quiet = 0
  while (quiet < 20) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const run = overlay().runs[order.id]
    if (!run) continue
    for (const step of run.steps.slice(printed)) {
      console.log(`[${step.kind}] ${step.label}${step.detail ? `\n    ${step.detail.replace(/\n/g, "\n    ")}` : ""}`)
    }
    printed = run.steps.length
    const settled = !isRunning(order.id) && run.status !== "working" && run.status !== "waiting_driver" && run.status !== "waiting_site"
    quiet = settled ? quiet + 1 : 0
    if (Date.now() - started > 5 * 60_000) break
  }
  const run = overlay().runs[order.id]
  const file = path.join("traces", `${String(order.reference)}.json`)
  fs.mkdirSync("traces", { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ order: order.reference, recordedAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), status: run?.status, briefing: run?.briefing, usage: run?.usage, steps: run?.steps, transcript: run?.transcript }, null, 2))
  console.log(`\n${run?.status}: ${run?.statusText}\nTrace written to ${file}`)
  process.exit(0)
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
