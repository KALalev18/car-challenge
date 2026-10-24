// The fictional packet, read straight from the JSONL files into memory. No
// database: a fresh clone runs with `npm install && npm run dev`. The files are
// never written; everything people and agents do lives in the overlay
// (lib/state/store.ts) and is merged on top when the world is read.

import fs from "node:fs"
import path from "node:path"

export type Rec = Record<string, unknown> & { id: string }

export type Base = {
  snapshotAt: string
  tables: Map<string, Rec[]>
}

export const DATASET_DIR = process.env.DATASET_DIR ?? path.join(process.cwd(), "dataset", "data")
export const ATTACHMENTS_DIR = process.env.ATTACHMENTS_DIR ?? path.join(process.cwd(), "attachments")

const cache = globalThis as unknown as { __bahnBase?: Base }

function readJsonl(file: string): Rec[] {
  const text = fs.readFileSync(file, "utf8")
  const rows: Rec[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const row = JSON.parse(trimmed) as Rec
    // A few collections (agents, operators) are keyed by id like the rest.
    if (typeof row.id !== "string") throw new Error(`${path.basename(file)}: row without id`)
    rows.push(row)
  }
  return rows
}

/** Loads every collection named in the manifest and checks its row count. */
export function loadBase(): Base {
  if (cache.__bahnBase) return cache.__bahnBase
  const manifest = JSON.parse(fs.readFileSync(path.join(DATASET_DIR, "manifest.json"), "utf8")) as {
    snapshot_at: string
    tables: Record<string, number>
  }
  const tables = new Map<string, Rec[]>()
  for (const [collection, expected] of Object.entries(manifest.tables)) {
    const rows = readJsonl(path.join(DATASET_DIR, `${collection}.jsonl`))
    if (rows.length !== expected) throw new Error(`${collection}: manifest expects ${expected} rows, found ${rows.length}`)
    tables.set(collection, rows)
  }
  const base = { snapshotAt: manifest.snapshot_at, tables }
  cache.__bahnBase = base
  return base
}
