// The control room's promise: only orders that need a person come first, each
// with a reason, and the quiet majority stays out of the way.

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { before, test } from "node:test"

process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bahn-triage-"))

let queue: import("../lib/triage").Queue
let buildCase: typeof import("../lib/case").buildCase

before(async () => {
  const { resetState } = await import("../lib/state/store")
  const { buildQueue } = await import("../lib/triage")
  buildCase = (await import("../lib/case")).buildCase
  resetState()
  queue = buildQueue()
})

test("every one of the 100 orders is triaged once", () => {
  assert.equal(queue.items.length, 100)
  assert.equal(new Set(queue.items.map((item) => item.id)).size, 100)
})

test("only a small share needs a person, and the quiet majority is out of the way", () => {
  assert.ok(queue.counts.decide > 0 && queue.counts.decide <= 15, `decide count ${queue.counts.decide}`)
  assert.ok(queue.counts.quiet >= 50, `quiet count ${queue.counts.quiet}`)
})

test("orders that need a decision sort first and each says why", () => {
  const firstNonDecide = queue.items.findIndex((item) => item.bucket !== "decide")
  assert.ok(queue.items.slice(0, firstNonDecide).every((item) => item.bucket === "decide"))
  for (const item of queue.items.filter((entry) => entry.bucket === "decide")) {
    assert.ok(item.reason.length > 10, `${item.reference} has a reason`)
    assert.ok(item.next, `${item.reference} says what to decide`)
  }
})

test("the stopped Bentley and the broken Espoo relay need a person", () => {
  const byRef = new Map(queue.items.map((item) => [item.reference, item]))
  assert.equal(byRef.get("CD-420322")?.bucket, "decide")
  assert.equal(byRef.get("CD-420702")?.bucket, "decide")
})

test("a delivered order with nothing open is quiet", () => {
  const delivered = queue.items.filter((item) => item.lane === "delivered" && item.bucket === "quiet")
  assert.ok(delivered.length > 5)
})

test("every fact on a case names its source record", () => {
  const view = buildCase("ord-00322")!
  assert.ok(view.facts.length >= 4)
  for (const fact of view.facts.filter((entry) => entry.certainty !== "missing")) {
    assert.ok(fact.source?.recordId, `${fact.label} has a source record`)
  }
  const position = view.facts.find((fact) => fact.key === "position")!
  assert.equal(position.certainty, "reported", "a driver's report is not shown as verified")
})

test("a quote is never shown as a booking", () => {
  const view = buildCase("ord-00299")!
  const quote = view.facts.find((fact) => fact.key === "quote")
  assert.ok(quote)
  assert.equal(quote!.certainty, "quote")
  assert.match(quote!.note ?? "", /not booked/)
})

test("every quiet order says what was checked", () => {
  for (const item of queue.items.filter((entry) => entry.bucket === "quiet")) {
    assert.ok(item.checks.includes("No open alerts"), `${item.reference} lists its checks`)
  }
})
