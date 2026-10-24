// What happens when a person decides. Approving a proposal records the decision,
// carries out exactly the approved changes (a message, a requested change) as
// events with the person as actor, and wakes the agent to do its follow-up.
// Rejecting keeps the proposal in history and sends the agent back with the
// reason. Nothing here touches a real booking: changes are recorded, not bought.

import type { Rec } from "./data/dataset"
import { world } from "./data/world"
import { loadBundle } from "./present/load"
import { addRow, mutate, nextId, overlay, patchRow, type Overlay } from "./state/store"
import { isRunning, wake } from "./agent/run"
import { scheduleReply } from "./agent/sim"
import type { JourneyProposalPayload } from "./agent/types"
import { triageOne } from "./triage"
import { modelAvailable } from "./agent/model"

/** The person using the control room. The packet has desks, not named staff. */
export const OPERATOR_ID = "ops-shift"

export class ActionError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

function requireModel() {
  if (!modelAvailable()) throw new ActionError("The agent needs an Anthropic API key. Add ANTHROPIC_API_KEY or OPENROUTER_API_KEY to .env.local and restart.", 503)
}

function proposal(id: string): Rec {
  const found = world().get("agent_proposals", id)
  if (!found) throw new ActionError("Proposal not found", 404)
  return found
}

export type DecisionInput = {
  decision: "approve" | "reject"
  note?: string
  customerMessage?: string | null
  driverMessage?: string | null
}

export function decide(proposalId: string, input: DecisionInput) {
  const row = proposal(proposalId)
  // Re-check the current state before writing: the proposal may have been
  // decided in another tab or replaced by a newer one.
  if (row.status !== "PENDING_REVIEW") throw new ActionError(`This proposal is already ${String(row.status).toLowerCase().replace(/_/g, " ")}.`, 409)
  const orderId = String(row.order_id)
  const payload = row.proposed_payload as JourneyProposalPayload | undefined
  const isOurs = row.proposed_by_agent_id === "journey-agent"
  const now = world().now
  const note = input.note?.trim() || null

  if (input.decision === "reject") {
    mutate((state) => {
      patchRow(state, "agent_proposals", proposalId, {
        status: "REJECTED", review: { decision: "REJECTED", reviewer_id: OPERATOR_ID, reviewed_at: now, note },
      })
      addRow(state, "operational_events", event(state, orderId, "agent.proposal_rejected", "agent_proposal", proposalId, now, { title: String(row.summary), note }))
      // Every correction becomes a lesson the agent reads on its next cases.
      if (isOurs && note) {
        const reference = String(world().get("orders", orderId)?.reference ?? orderId)
        state.lessons = [...(state.lessons ?? []), { at: now, reference, suggestion: String(row.summary), correction: note }].slice(-20)
      }
    })
    if (isOurs && modelAvailable()) {
      void wake(orderId, {
        trigger: "decision",
        text: `[Decision at ${now}] The operator REJECTED your proposal ${proposalId} ("${String(row.summary)}").${note ? ` Their reason: ${note}` : " They gave no reason."}\nDo not repeat it. Take their reason into account: gather what is missing, propose a different option, or finish if they are handling it.`,
        step: { kind: "person", label: "You rejected the suggestion", detail: note ?? undefined, refs: [proposalId] },
      })
    }
    return { ok: true, status: "REJECTED", next: isOurs ? "The agent is reconsidering with your reason." : "Recorded. The proposal stays in the history." }
  }

  const customerMessage = (input.customerMessage ?? payload?.customer_message ?? "").trim() || null
  const driverMessage = (input.driverMessage ?? payload?.driver_message ?? "").trim() || null
  const edited = !!payload && ((customerMessage ?? null) !== (payload.customer_message ?? null) || (driverMessage ?? null) !== (payload.driver_message ?? null))
  const done: string[] = []

  const result = mutate((state) => {
    const effects: string[] = []
    const bundle = loadBundle(orderId)!

    if (customerMessage) {
      const thread = bundle.conversations.find((conversation) => conversation.status === "OPEN" && conversation.details.counterparty_id === bundle.customer.id)
        ?? bundle.conversations.find((conversation) => conversation.status === "OPEN" && bundle.messages.some((message) => message.conversationId === conversation.id && message.authorType === "customer"))
      let threadId = thread?.id
      if (!threadId) {
        threadId = nextId(state, "conv")
        addRow(state, "conversations", {
          id: threadId, order_id: orderId, category: "schedule_and_eta", channel: "customer_email", counterparty_id: bundle.customer.id,
          counterparty_type: "customer", started_at: now, updated_at: now, status: "OPEN",
        })
      } else {
        patchRow(state, "conversations", threadId, { updated_at: now })
      }
      const messageId = nextId(state, "msg")
      addRow(state, "messages", {
        id: messageId, order_id: orderId, conversation_id: threadId, author_id: OPERATOR_ID, author_type: "operator",
        recipient_id: bundle.customer.id, recipient_type: "customer", channel: "customer_email", visibility: "PUBLIC", language: "en",
        body: customerMessage, authored_at: now, approved_proposal_id: proposalId, drafted_by: isOurs ? "journey-agent" : null,
      })
      const ev = event(state, orderId, "message.sent", "message", messageId, now, { recipient_type: "customer", drafted_by_agent: isOurs })
      addRow(state, "operational_events", ev)
      effects.push(ev.id)
      done.push(`Sent your message to ${bundle.customer.name}.`)
    }

    for (const change of payload?.changes ?? []) {
      if (change.kind === "customer_message" || change.kind === "driver_instruction") continue
      const command = change.kind === "delivery_promise" ? "promise.revision_requested"
        : change.kind === "booking" ? "travel.booking_approved"
        : change.kind === "cost" ? "cost.approved"
        : change.kind === "assignment" ? "assignment.change_approved"
        : "change.approved"
      const ev = event(state, orderId, command, "order", orderId, now, { summary: change.summary, detail: change.detail ?? null, proposal_id: proposalId })
      addRow(state, "operational_events", ev)
      effects.push(ev.id)
      done.push(CHANGE_DONE[change.kind] ?? `Recorded: ${change.summary}`)
    }

    let driverConversation: { conversationId: string; driverId: string } | null = null
    if (driverMessage) {
      const assignment = (bundle.related.work_assignments ?? []).map((item) => item.details)
        .find((item) => item.status === "IN_PROGRESS" || item.status === "ASSIGNED")
      const driverId = assignment ? String(assignment.driver_id) : null
      if (driverId) {
        const existing = bundle.conversations.find((conversation) => conversation.status === "OPEN" && (conversation.details.counterparty_id === driverId
          || bundle.messages.some((message) => message.conversationId === conversation.id && (message.details.author_id === driverId || message.details.recipient_id === driverId))))
        let conversationId = existing?.id
        if (!conversationId) {
          conversationId = nextId(state, "conv")
          addRow(state, "conversations", { id: conversationId, order_id: orderId, category: "on_the_road", channel: "driver_chat", counterparty_id: driverId, counterparty_type: "driver", started_at: now, updated_at: now, status: "OPEN" })
        }
        const messageId = nextId(state, "msg")
        addRow(state, "messages", {
          id: messageId, order_id: orderId, conversation_id: conversationId, author_id: "journey-agent", author_type: "agent",
          recipient_id: driverId, recipient_type: "driver", channel: "driver_chat", visibility: "PUBLIC", language: "en",
          body: driverMessage, authored_at: now, approved_proposal_id: proposalId,
        })
        driverConversation = { conversationId, driverId }
        const sent = event(state, orderId, "message.sent", "message", messageId, now, { recipient_type: "driver", sent_by: "journey-agent" })
        addRow(state, "operational_events", sent)
        effects.push(sent.id)
        done.push(`The agent sent the approved instruction to ${bundle.dir.driverName(driverId) ?? "the driver"}.`)
      }
    }

    const approved = event(state, orderId, "agent.proposal_approved", "agent_proposal", proposalId, now, { title: String(row.summary), edited, note })
    addRow(state, "operational_events", approved)
    patchRow(state, "agent_proposals", proposalId, {
      status: "EXECUTED",
      review: { decision: "APPROVED", reviewer_id: OPERATOR_ID, reviewed_at: now, note, edited },
      execution: { status: "SUCCEEDED", attempted_at: now, effect_event_ids: [approved.id, ...effects], error: null },
      approved_customer_message: customerMessage, approved_driver_message: driverMessage,
    })
    return { driverConversation }
  })

  if (result.driverConversation && modelAvailable()) {
    const { conversationId, driverId } = result.driverConversation
    scheduleReply({
      orderId, party: "driver", conversationId, personId: driverId,
      onReply: (messageId, body) => {
        const name = loadBundle(orderId)?.dir.driverName(driverId) ?? "The driver"
        void wake(orderId, { trigger: "reply", text: `[New message ${messageId} from ${name} (driver) at ${world().now}]\n${body}`, step: { kind: "reply", label: `${name} replied`, detail: body, refs: [messageId] } })
      },
    })
  }

  if (isOurs && modelAvailable()) {
    void wake(orderId, {
      trigger: "decision",
      text: [
        `[Decision at ${now}] The operator APPROVED your proposal ${proposalId} ("${String(row.summary)}")${edited ? " with edits" : ""}.${note ? ` Their note: ${note}` : ""}`,
        `Already done by the control room: ${done.length ? done.join(" ") : "decision recorded."}`,
        customerMessage ? `Customer message sent by the operator:\n${customerMessage}` : "",
        driverMessage ? `Driver message sent:\n${driverMessage}` : "",
        `You said you would: ${payload?.after_approval ?? "follow up"}. Do the follow-up that needs no approval, or end your turn while you wait for replies. Then finish.`,
      ].filter(Boolean).join("\n"),
      step: { kind: "person", label: edited ? "You approved the suggestion with edits" : "You approved the suggestion", detail: note ?? undefined, refs: [proposalId] },
    })
  }

  return {
    ok: true,
    status: "EXECUTED",
    done,
    next: isOurs ? payload?.after_approval ?? "The agent follows up." : "Recorded.",
  }
}

const CHANGE_DONE: Record<string, string> = {
  delivery_promise: "Asked for the new delivery promise. It changes only once the customer agrees.",
  booking: "Travel desk asked to book it. No purchase is made in this demo.",
  cost: "The cost is approved and recorded.",
  assignment: "The driver change is approved and recorded for dispatch.",
}

function event(state: Overlay, orderId: string, command: string, targetType: string, targetId: string, at: string, changes: Record<string, unknown>): Rec {
  const isAgent = command.startsWith("agent.proposal_created")
  return {
    id: nextId(state, "evt"), order_id: orderId, command, target_type: targetType, target_id: targetId, recorded_at: at,
    actor_type: isAgent ? "agent" : "operator", actor_id: isAgent ? "journey-agent" : OPERATOR_ID, source: "CONTROL_ROOM", changes,
  }
}

/** The operator asks the agent something or tells it what to do. */
export function ask(orderId: string, text: string) {
  requireModel()
  const message = text.trim()
  if (!message) throw new ActionError("Write a message for the agent.")
  if (!world().get("orders", orderId)) throw new ActionError("Order not found", 404)
  void wake(orderId, {
    trigger: "person",
    text: `[Message from the operator at ${world().now}]\n${message}`,
    step: { kind: "person", label: "You", detail: message },
  })
  return { ok: true }
}

/** Starts the agent on an order, telling it why the control room flagged it. */
export function investigate(orderId: string, note?: string | null) {
  requireModel()
  const item = triageOne(orderId)
  if (!item) throw new ActionError("Order not found", 404)
  if (isRunning(orderId)) return { ok: true, already: true }
  const reason = `${item.reason}${item.next ? ` Suggested next step on record: ${item.next}` : ""}`
  const hasRun = !!overlay().runs[orderId]?.transcript.length
  void wake(orderId, {
    trigger: note ? "person" : "sweep",
    text: hasRun
      ? `[The operator asked you to look at this case again at ${world().now}]${note ? `\n${note}` : ""}\nWhy it is flagged now: ${reason}`
      : `${reason}${note ? `\nThe operator adds: ${note}` : ""}`,
    step: note ? { kind: "person", label: "You", detail: note } : { kind: "read", label: "Started looking into the case" },
  })
  return { ok: true }
}

/** An operator takes the case over; the agent stops proposing on it. */
export function takeOver(orderId: string) {
  const run = overlay().runs[orderId]
  if (!run) return { ok: true }
  mutate((state) => {
    const current = state.runs[orderId]
    current.status = "done"
    current.statusText = "A person took this over"
    current.updatedAt = world().now
    current.steps.push({ id: `step-${current.steps.length + 1}`, at: world().now, kind: "person", label: "You took this case over. The agent will not act on it unless asked." })
    for (const row of world().forOrder("agent_proposals", orderId)) {
      if (row.proposed_by_agent_id === "journey-agent" && row.status === "PENDING_REVIEW") {
        patchRow(state, "agent_proposals", row.id, { status: "WITHDRAWN", review: { decision: "WITHDRAWN", reviewer_id: OPERATOR_ID, reviewed_at: world().now, note: "Operator took the case over." } })
      }
    }
  })
  return { ok: true }
}
