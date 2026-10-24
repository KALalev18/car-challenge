// Freezes the current demo state (agent runs, proposals, decisions) as the seed
// that a fresh clone starts from, so recorded agent work is visible without a key.
//
//   npm run seed:save                   everything
//   npm run seed:save -- ord-00593      leave out the runs (and their rows) for these orders
import fs from "node:fs"
import path from "node:path"
import { DEFAULT_PERMISSIONS, overlay } from "../lib/state/store"

const skip = new Set(process.argv.slice(2))
const state = structuredClone(overlay())
for (const orderId of skip) delete state.runs[orderId]
for (const collection of Object.keys(state.added)) state.added[collection] = state.added[collection].filter((row) => !skip.has(String(row.order_id)))
for (const run of Object.values(state.runs)) {
  if (run.status === "working") throw new Error(`The agent is still working on ${run.orderId}; wait for it to finish.`)
  delete run.pid
}
// A fresh clone starts at the first rung of the trust ladder, with nothing learned yet.
state.permissions = { ...DEFAULT_PERMISSIONS }
state.lessons = []
fs.mkdirSync("state", { recursive: true })
fs.writeFileSync(path.join("state", "seed.json"), JSON.stringify({ ...state, revision: 0 }, null, 1))
console.log(`Saved ${Object.keys(state.runs).length} agent runs to state/seed.json: ${Object.keys(state.runs).join(", ")}`)
