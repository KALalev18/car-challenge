// The packet with the overlay applied: what the control room currently knows.
// Rebuilt only when the overlay revision moves.

import { loadBase, type Rec } from "./dataset"
import { overlay, simNow } from "../state/store"

export type World = {
  snapshotAt: string
  /** Simulated "now": the snapshot time plus time spent in the demo. */
  now: string
  revision: number
  table(collection: string): Rec[]
  get(collection: string, id: string): Rec | undefined
  forOrder(collection: string, orderId: string): Rec[]
  /** Finds a record by id in any collection; used to resolve evidence references. */
  find(id: string): { collection: string; row: Rec } | undefined
}

/** Our own agent, added beside Bahn's four so names resolve everywhere. */
export const JOURNEY_AGENT: Rec = {
  id: "journey-agent", kind: "AUTOMATED_ACTOR", scope: "on_the_road_research_and_proposals", title: "Journey agent",
}

const cache = globalThis as unknown as { __bahnWorld?: { key: string; world: Omit<World, "now"> } }

export function world(): World {
  const base = loadBase()
  const state = overlay()
  // A reset starts a new overlay at revision 0, so the start time is part of the key.
  const key = `${state.startedAt}:${state.revision}`
  if (cache.__bahnWorld?.key !== key || !cache.__bahnWorld) {
    cache.__bahnWorld = { key, world: build(base.snapshotAt, base.tables, state.revision) }
  }
  const built = cache.__bahnWorld.world
  return { ...built, now: simNow(base.snapshotAt) }
}

function build(snapshotAt: string, baseTables: Map<string, Rec[]>, revision: number): Omit<World, "now"> {
  const state = overlay()
  const tables = new Map<string, Rec[]>()
  const names = new Set([...baseTables.keys(), ...Object.keys(state.added)])
  for (const name of names) {
    const patches = state.patched[name] ?? {}
    const rows = (baseTables.get(name) ?? []).map((row) => (patches[row.id] ? { ...row, ...patches[row.id] } as Rec : row))
    for (const row of state.added[name] ?? []) rows.push(patches[row.id] ? { ...row, ...patches[row.id] } as Rec : row)
    tables.set(name, rows)
  }
  tables.set("agents", [...(tables.get("agents") ?? []), JOURNEY_AGENT])

  const byId = new Map<string, Map<string, Rec>>()
  const anyId = new Map<string, { collection: string; row: Rec }>()
  const byOrder = new Map<string, Map<string, Rec[]>>()
  const planOrder = new Map((tables.get("transport_plans") ?? []).map((plan) => [plan.id, plan.order_id as string]))
  for (const [name, rows] of tables) {
    const ids = new Map<string, Rec>()
    const orders = new Map<string, Rec[]>()
    for (const row of rows) {
      ids.set(row.id, row)
      if (!anyId.has(row.id)) anyId.set(row.id, { collection: name, row })
      const orderId = typeof row.order_id === "string" ? row.order_id
        : typeof row.plan_id === "string" ? planOrder.get(row.plan_id) : undefined
      if (orderId) {
        const list = orders.get(orderId) ?? []
        list.push(row)
        orders.set(orderId, list)
      }
    }
    byId.set(name, ids)
    byOrder.set(name, orders)
  }

  return {
    snapshotAt,
    revision,
    table: (collection) => tables.get(collection) ?? [],
    get: (collection, id) => byId.get(collection)?.get(id),
    forOrder: (collection, orderId) => byOrder.get(collection)?.get(orderId) ?? [],
    find: (id) => anyId.get(id),
  }
}
