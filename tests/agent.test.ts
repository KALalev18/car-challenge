// End-to-end check of the agent loop, tools, simulated driver and approvals with
// a scripted model in place of Claude. Runs without an API key and never touches
// the real `.state` folder.

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, before, test } from "node:test"
import type Anthropic from "@anthropic-ai/sdk"

process.env.STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bahn-state-"))
process.env.SIM_REPLY_DELAY_MS = "5"

const ORDER = "ord-00322" // the Bentley with a red warning light

type Block = Anthropic.Beta.BetaContentBlock
let calls: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = []

function message(content: Block[], stop: Anthropic.Beta.BetaMessage["stop_reason"] = "tool_use"): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_${calls.length}`, type: "message", role: "assistant", model: "scripted", content, stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage
}

function use(name: string, input: Record<string, unknown>): Block {
  return { type: "tool_use", id: `toolu_${calls.length}_${name}`, name, input } as unknown as Block
}

/** Plays the agent: reads, asks the driver, then proposes once the reply is in. */
function scriptedAgent(request: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Anthropic.Beta.BetaMessage {
  const history = JSON.stringify(request.messages)
  const toolResults = request.messages.filter((entry) => entry.role === "user" && Array.isArray(entry.content) && entry.content.some((block) => block.type === "tool_result")).length
  const last = request.messages[request.messages.length - 1]
  const lastText = typeof last.content === "string" ? last.content : JSON.stringify(last.content)
  if (lastText.includes("APPROVED")) return message([use("finish", { outcome: "no_action_needed", briefing: "Approved and sent. Waiting for the owner's choice.", status_line: "Owner asked to choose recovery" })])
  if (lastText.includes("REJECTED")) return message([use("finish", { outcome: "no_action_needed", briefing: "Rejected; the operator is calling the owner.", status_line: "Operator handling" })])
  if (toolResults === 0) return message([use("read_case", {}), use("read_messages", {})])
  if (!history.includes("message_driver")) return message([use("message_driver", { text: "Are you safe? Which service area are you at, and can you send the dashboard photo?", why: "where exactly they are" })])
  if (!history.includes("New message")) return message([use("finish", { outcome: "waiting_on_reply", briefing: "Asked the driver for the exact location.", status_line: "Asked the driver where they are" })])
  if (!history.includes("propose_decision")) {
    return message([use("propose_decision", {
      title: "Bentley stopped with a red warning: owner must choose recovery",
      situation: "The driver reports a red drive-system warning and is stopped at Hollerbach Ost on the A9 (reported 09:10 Berlin time).",
      recommendation: "Call Marvellin Motorhandel and ask whether they send their own roadside service or want a tow.",
      changes: [
        { kind: "customer_message", summary: "Ask the owner how to recover the car", detail: "" },
        { kind: "delivery_promise", summary: "Delivery today 16:00 will be late; agree a new time with the owner", detail: "" },
      ],
      customer_message: "Your Bentley is stopped safely at Hollerbach Ost on the A9. Shall we arrange a tow, or will your service contact attend?",
      driver_message: "Thanks. Please stay with the car; we are asking the owner how they want it recovered.",
      alternatives: ["Book the Hollerbach tow to the nearest dealer"],
      open_questions: ["Whether the owner has roadside cover"],
      urgency: "now",
      after_approval: "Tell the driver who will collect the car once the owner answers.",
      evidence: ["incident-x589908b2ed24936a", "msg-xc6eef673bb0bd1f0", "not-a-real-id"],
    })])
  }
  return message([use("finish", { outcome: "needs_person", briefing: "Driver safe at Hollerbach Ost; owner must choose recovery.", status_line: "Owner must choose recovery" })])
}

let mod: {
  store: typeof import("../lib/state/store")
  model: typeof import("../lib/agent/model")
  run: typeof import("../lib/agent/run")
  actions: typeof import("../lib/actions")
  world: typeof import("../lib/data/world")
  triage: typeof import("../lib/triage")
  tools: typeof import("../lib/agent/tools")
  present: typeof import("../lib/present/load")
}

before(async () => {
  mod = {
    store: await import("../lib/state/store"),
    model: await import("../lib/agent/model"),
    run: await import("../lib/agent/run"),
    actions: await import("../lib/actions"),
    world: await import("../lib/data/world"),
    triage: await import("../lib/triage"),
    tools: await import("../lib/agent/tools"),
    present: await import("../lib/present/load"),
  }
  mod.store.resetState({ clean: true })
  mod.model.setModelForTests(async (request) => {
    calls.push(request)
    if (!request.tools) {
      return message([{ type: "text", text: "I'm safe at Hollerbach Ost on the A9, engine off. Photo sent.", citations: null } as unknown as Block], "end_turn")
    }
    return scriptedAgent(request)
  })
})

after(() => {
  mod.model.setModelForTests(null)
  fs.rmSync(process.env.STATE_DIR!, { recursive: true, force: true })
})

async function settle() {
  // Wait for the run, the simulated reply and the resumed run to finish.
  for (let i = 0; i < 200; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    const run = mod.store.overlay().runs[ORDER]
    if (run && !mod.run.isRunning(ORDER) && run.status !== "working" && run.status !== "waiting_driver") return
  }
}

test("the agent reads first, asks the driver, then brings one decision", async () => {
  mod.actions.investigate(ORDER)
  await settle()
  const run = mod.store.overlay().runs[ORDER]
  assert.equal(run.status, "needs_person")
  const kinds = run.steps.map((step) => step.kind)
  assert.ok(kinds.indexOf("read") < kinds.indexOf("ask"), "reads before asking")
  assert.ok(kinds.indexOf("ask") < kinds.indexOf("reply"), "the driver's reply comes after the question")
  assert.ok(kinds.indexOf("reply") < kinds.indexOf("proposal"), "proposes only after the reply")

  const w = mod.world.world()
  const agentMessage = w.forOrder("messages", ORDER).find((row) => row.author_id === "journey-agent" && row.recipient_type === "driver")
  assert.ok(agentMessage, "the question went to the driver")
  const reply = w.forOrder("messages", ORDER).find((row) => row.simulated === true)
  assert.ok(reply, "the simulated driver replied")
  assert.equal(reply!.author_type, "driver")

  const proposal = w.forOrder("agent_proposals", ORDER).find((row) => row.proposed_by_agent_id === "journey-agent")
  assert.equal(proposal?.status, "PENDING_REVIEW")
  const refs = (proposal!.evidence_refs as { id: string }[]).map((ref) => ref.id)
  assert.ok(refs.includes("incident-x589908b2ed24936a"))
  assert.ok(!refs.includes("not-a-real-id"), "evidence that does not exist is dropped")

  const item = mod.triage.triageOne(ORDER)!
  assert.equal(item.bucket, "decide")
  assert.equal(item.proposal?.title, "Bentley stopped with a red warning: owner must choose recovery")
})

test("approving sends the edited customer message as the person and records each change", async () => {
  const proposal = mod.world.world().forOrder("agent_proposals", ORDER).find((row) => row.proposed_by_agent_id === "journey-agent" && row.status === "PENDING_REVIEW")!
  const result = mod.actions.decide(proposal.id, { decision: "approve", customerMessage: "Edited: shall we tow it to your Hamburg workshop?" })
  assert.equal(result.status, "EXECUTED")
  await settle()
  const w = mod.world.world()
  const updated = w.get("agent_proposals", proposal.id)!
  assert.equal(updated.status, "EXECUTED")
  assert.equal((updated.review as { edited: boolean }).edited, true)
  const sent = w.forOrder("messages", ORDER).find((row) => row.approved_proposal_id === proposal.id && row.recipient_type === "customer")
  assert.equal(sent?.author_type, "operator", "a person, not the agent, messages the customer")
  assert.equal(sent?.body, "Edited: shall we tow it to your Hamburg workshop?")
  const commands = w.forOrder("operational_events", ORDER).map((row) => row.command)
  assert.ok(commands.includes("promise.revision_requested"))
  assert.ok(commands.includes("agent.proposal_approved"))
  assert.throws(() => mod.actions.decide(proposal.id, { decision: "approve" }), /already/, "a decided proposal cannot be decided twice")
})

test("the agent cannot message a site that belongs to the paying customer", () => {
  const bundle = mod.present.loadBundle(ORDER)!
  const tool = mod.tools.TOOLS.find((candidate) => candidate.definition.name === "message_site")!
  const outcome = tool.run({
    orderId: ORDER, w: mod.world.world(), bundle, permissions: mod.store.overlay().permissions,
    write: (change) => mod.store.mutate(change), onAsked: () => assert.fail("must not ask"),
  }, { boundary: "delivery", text: "Hello", why: "test" })
  assert.equal(outcome.isError, true)
  assert.match(outcome.content, /paying customer/)
})

test("no tool can contact a customer, book, or change a date", () => {
  const names = mod.tools.TOOLS.map((tool) => tool.definition.name)
  for (const name of names) assert.doesNotMatch(name, /customer|book|cancel|promise|pay/)
})

test("closing a tracking alert needs the permission", () => {
  const bundle = mod.present.loadBundle(ORDER)!
  const tool = mod.tools.TOOLS.find((candidate) => candidate.definition.name === "close_tracking_alert")!
  const outcome = tool.run({
    orderId: ORDER, w: mod.world.world(), bundle, permissions: { ...mod.store.overlay().permissions, closeStaleTrackingAlerts: false },
    write: (change) => mod.store.mutate(change), onAsked: () => {},
  }, { alert_id: "alert-x105238e92e7f3ba6", driver_message_id: "msg-x552e941e4df20498", reason: "test" })
  assert.equal(outcome.isError, true)
})

test("holding a sailing needs the permission and is never a booking", () => {
  const bundle = mod.present.loadBundle(ORDER)!
  const tool = mod.tools.TOOLS.find((candidate) => candidate.definition.name === "hold_sailing")!
  const input = { departure_at: "2026-10-23T12:00:00Z", provider: "Vela Coast Lines", quote_eur: 390, reason: "test" }
  const context = (holdTravel: boolean) => ({
    orderId: ORDER, w: mod.world.world(), bundle, permissions: { ...mod.store.overlay().permissions, holdTravel },
    write: <T,>(change: (state: import("../lib/state/store").Overlay) => T) => mod.store.mutate(change), onAsked: () => {},
  })
  assert.equal(tool.run(context(false), input).isError, true)
  const reservations = mod.world.world().forOrder("travel_reservations", ORDER).length
  const outcome = tool.run(context(true), input)
  assert.equal(outcome.isError, undefined)
  const w = mod.world.world()
  const held = w.forOrder("travel_options", ORDER).find((row) => row.status === "HELD")
  assert.ok(held?.hold_expires_at, "the hold expires on its own")
  assert.equal(w.forOrder("travel_reservations", ORDER).length, reservations, "no booking was made")
})

test("rejecting keeps the history and sends the agent back with the reason", async () => {
  mod.store.resetState({ clean: true })
  calls = []
  mod.actions.investigate(ORDER)
  await settle()
  const proposal = mod.world.world().forOrder("agent_proposals", ORDER).find((row) => row.status === "PENDING_REVIEW" && row.proposed_by_agent_id === "journey-agent")!
  mod.actions.decide(proposal.id, { decision: "reject", note: "I will call the owner myself." })
  await settle()
  assert.equal(mod.world.world().get("agent_proposals", proposal.id)!.status, "REJECTED")
  assert.equal(mod.store.overlay().lessons?.at(-1)?.correction, "I will call the owner myself.", "the correction is kept as a lesson")
  const lastAgentCall = calls.filter((call) => call.tools).pop()!
  assert.match(JSON.stringify(lastAgentCall.messages), /I will call the owner myself/)
})
