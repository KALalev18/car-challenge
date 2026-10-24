// One order, read for a person who has a few seconds: the situation, the decision
// waiting on them, the key facts each with where it came from, and what happened
// in order. Built on the starter's reading layer, plus the agent's work.

import type { Rec } from "./data/dataset"
import { world } from "./data/world"
import { chosenWindows, deriveKeyDates, latestTracking, milestones } from "./present/attention"
import { type Bundle, rows, str } from "./present/bundle"
import { describeEvent } from "./present/events"
import { label, labelIn, laneLabel } from "./present/labels"
import { loadBundle } from "./present/load"
import { buildRecordView, slug } from "./present/record"
import { fmtDateTime, fmtMoney, fmtRange, relativeTo } from "./present/time"
import type { Actor, RecordView, Tone } from "./present/types"
import { overlay } from "./state/store"
import { triageBundle, type TriageItem } from "./triage"
import { modelAvailable } from "./agent/model"
import { isRunning } from "./agent/run"
import type { AgentStep, JourneyProposalPayload, RunStatus } from "./agent/types"

export type SourceKind = "customer" | "driver" | "site" | "ops" | "agent" | "system" | "app" | "carrier"

export type Source = { kind: SourceKind; who: string; at: string | null; recordId: string | null; collection: string | null }

export type FactRow = {
  key: string
  label: string
  value: string
  note: string | null
  certainty: "confirmed" | "reported" | "estimate" | "stale" | "missing" | "booked" | "quote"
  tone: Tone
  source: Source | null
}

export type Evidence = { id: string; collection: string; label: string; at: string | null; excerpt: string | null; who: string | null }

export type DecisionCard = {
  id: string
  by: string
  byAgent: boolean
  ours: boolean
  status: string
  statusLabel: string
  tone: Tone
  createdAt: string
  title: string
  situation: string | null
  recommendation: string | null
  changes: { kind: string; kindLabel: string; summary: string; detail: string | null }[]
  customerMessage: string | null
  driverMessage: string | null
  alternatives: string[]
  openQuestions: string[]
  urgency: JourneyProposalPayload["urgency"] | null
  afterApproval: string | null
  evidence: Evidence[]
  review: { decision: string; note: string | null; by: string; at: string; edited: boolean } | null
  outcome: string[]
}

export type TimelineItem = {
  id: string
  at: string
  kind: "message" | "note" | "event" | "agent"
  actor: { kind: SourceKind; name: string }
  to: string | null
  channel: string | null
  title: string | null
  body: string
  internal: boolean
  simulated: boolean
  tone: Tone
  refs: string[]
}

export type CaseView = {
  now: string
  snapshotAt: string
  triage: TriageItem
  header: {
    reference: string
    customerReference: string | null
    vehicle: { title: string; year: number | null; plate: string | null; vin: string | null; fuel: string | null; illustration: string | null; logo: string | null } | null
    customer: { id: string; name: string }
    from: { name: string; city: string; country: string; kind: string | null }
    to: { name: string; city: string; country: string; kind: string | null }
    lane: string
    laneLabel: string
    routeKind: string
    driver: { id: string; name: string; home: string | null; status: string } | null
  }
  briefing: { text: string; by: "agent" | "records"; at: string | null }
  decision: DecisionCard | null
  /** The last decision a person made here, so it is clear what happened and what comes next. */
  lastDecision: DecisionCard | null
  history: DecisionCard[]
  facts: FactRow[]
  timeline: TimelineItem[]
  agent: {
    available: boolean
    running: boolean
    status: RunStatus | null
    statusText: string | null
    steps: AgentStep[]
    briefing: string | null
    error: string | null
    usage: { inputTokens: number; outputTokens: number; calls: number } | null
    updatedAt: string | null
  }
  record: Pick<RecordView, "journey" | "reservations" | "options" | "proofs" | "documents" | "expenses" | "offers" | "assignments" | "story">
}

function sourceKindOf(actor: Actor | null | undefined): SourceKind {
  switch (actor?.kind) {
    case "customer": return "customer"
    case "driver": return "driver"
    case "site_contact": case "handoff_contact": return "site"
    case "operator": return "ops"
    case "agent": return "agent"
    default: return "system"
  }
}

const WINDOW_SOURCE: Record<string, SourceKind> = { CUSTOMER: "customer", OPS: "ops", SYSTEM: "system", SITE: "site" }
const WINDOW_WHO: Record<string, string> = { CUSTOMER: "Customer", OPS: "Bahn ops", SYSTEM: "System estimate", SITE: "Site" }

// ---------------------------------------------------------------- evidence

export function evidenceFor(bundle: Bundle, id: string, now: string): Evidence {
  const found = world().find(id)
  if (!found) return { id, collection: id.startsWith("sim-") ? "simulated" : "unknown", label: id.startsWith("sim-") ? "Simulated quote (demo)" : id, at: null, excerpt: null, who: null }
  const { collection, row } = found
  const d = row as Rec
  const at = (str(d.authored_at) ?? str(d.recorded_at) ?? str(d.triggered_at) ?? str(d.observed_at) ?? str(d.checked_at) ?? str(d.booked_at) ?? str(d.opened_at) ?? str(d.created_at) ?? str(d.updated_at)) || null
  const zoneHint = null
  switch (collection) {
    case "messages": {
      const actor = bundle.dir.resolve(d.author_id, d.author_type)
      return { id, collection, label: `${actor.name}${d.visibility === "INTERNAL" ? " (internal note)" : ""}`, at, excerpt: str(d.body), who: actor.role }
    }
    case "alerts": return { id, collection, label: `Alert: ${label(str(d.signal))} (${labelIn(str(d.status))})`, at, excerpt: str(d.summary), who: "Monitoring" }
    case "incidents": return { id, collection, label: `Incident: ${label(str(d.kind))}`, at, excerpt: [str(d.reported_symptom), str(d.reported_stop_text)].filter(Boolean).join(". ") || null, who: bundle.dir.title(d.owner) }
    case "tracking_observations": {
      const rel = relativeTo(str(d.observed_at), now)
      return { id, collection, label: `Driver-app signal ${rel ? rel.text : ""}${d.location_quality === "STALE" ? " (stale)" : ""}`, at, excerpt: `${d.distance_remaining_km ?? "?"} km to go · ETA ${fmtDateTime(str(d.estimated_delivery_at), zoneHint)}`, who: "Driver app" }
    }
    case "travel_reservations": return { id, collection, label: `${label(str(d.kind))} booked: ${str(d.booking_reference) ?? str(d.route_label) ?? ""}`, at, excerpt: `${str(d.route_label) ?? ""} · departs ${fmtDateTime(str(d.departure_at), null)} · check-in closes ${fmtDateTime(str(d.check_in_cutoff_at), null)}`, who: str(d.carrier) ?? "Carrier" }
    case "travel_options": return { id, collection, label: `${label(str(d.kind))} quote (${labelIn(str(d.status))})`, at, excerpt: `${str(d.provider) ?? ""} · departs ${fmtDateTime(str(d.departure_at), null)}${typeof d.quote_cents === "number" ? ` · ${fmtMoney(d.quote_cents, str(d.currency))}` : ""}`, who: str(d.provider) }
    case "operational_events": {
      const view = describeEvent({ id, orderId: String(d.order_id), command: String(d.command), targetType: String(d.target_type), targetId: String(d.target_id), recordedAt: String(d.recorded_at), details: d }, bundle)
      return { id, collection, label: view.text, at, excerpt: view.detail, who: view.actor }
    }
    case "work_items": return { id, collection, label: `Owned work: ${label(str(d.kind))}`, at, excerpt: str(d.summary), who: bundle.dir.title(d.owner) }
    case "agent_proposals": return { id, collection, label: `Agent proposal: ${str(d.summary) ?? ""}`, at, excerpt: str(d.rationale), who: bundle.dir.title(d.proposed_by_agent_id) }
    case "time_windows": return { id, collection, label: `${label(str(d.purpose))} (${WINDOW_WHO[String(d.source)] ?? "source not recorded"})`, at: str(d.start_at), excerpt: `${fmtDateTime(str(d.start_at), str(d.timezone))} – ${fmtDateTime(str(d.end_at), str(d.timezone))}`, who: WINDOW_WHO[String(d.source)] ?? null }
    case "order_notes": return { id, collection, label: "Note", at, excerpt: str(d.body), who: bundle.dir.resolve(d.author_id, d.author_type).name }
    case "work_assignments": return { id, collection, label: `Driver assignment (${labelIn(str(d.status))})`, at: str(d.accepted_at), excerpt: bundle.dir.driverName(d.driver_id), who: "Dispatch" }
    case "order_endpoint_details": return { id, collection, label: `${label(str(d.boundary))} contact and access`, at: str(d.stated_at), excerpt: `${str(d.contact_name) ?? "No contact"} · contact ${labelIn(str(d.contact_status))} · access ${labelIn(str(d.access_status))}`, who: labelIn(str(d.stated_by)) }
    default: return { id, collection, label: `${label(collection.replace(/s$/, ""))}`, at, excerpt: str(d.summary) ?? str(d.note) ?? null, who: null }
  }
}

// ---------------------------------------------------------------- decisions

const CHANGE_LABEL: Record<string, string> = {
  delivery_promise: "Delivery promise", booking: "Booking", cost: "Cost", customer_message: "Message to customer",
  driver_instruction: "Driver instruction", assignment: "Driver", other: "Other",
}

const PROPOSAL_TONE: Record<string, Tone> = { PENDING_REVIEW: "accent", APPROVED_AWAITING_EXECUTION: "accent", EXECUTED: "ok", REJECTED: "neutral", FAILED: "danger", SUPERSEDED: "neutral", WITHDRAWN: "neutral" }

function decisionCard(bundle: Bundle, row: Rec, now: string): DecisionCard {
  const ours = row.proposed_by_agent_id === "journey-agent"
  const payload = ours ? row.proposed_payload as JourneyProposalPayload : null
  const review = row.review as Rec | null
  const execution = row.execution as Rec | null
  const evidence = (Array.isArray(row.evidence_refs) ? row.evidence_refs : []).map((ref) => evidenceFor(bundle, String((ref as Rec).id), now))
  const otherPayload = !ours && row.proposed_payload && typeof row.proposed_payload === "object" ? row.proposed_payload as Record<string, unknown> : null
  const changes = payload
    ? payload.changes.map((change) => ({ kind: change.kind, kindLabel: CHANGE_LABEL[change.kind] ?? "Change", summary: change.summary, detail: change.detail ?? null }))
    : Object.entries(otherPayload ?? {}).filter(([, value]) => typeof value !== "object" || value === null).map(([key, value]) => ({
      kind: "other", kindLabel: label(key), summary: typeof value === "boolean" ? (value ? "Yes" : "No") : String(value), detail: null,
    }))
  const outcome: string[] = []
  if (row.status === "EXECUTED" && execution) {
    const effects = Array.isArray(execution.effect_event_ids) ? execution.effect_event_ids.map(String) : []
    for (const id of effects) {
      const ev = world().get("operational_events", id)
      if (!ev || ev.command === "agent.proposal_approved") continue
      outcome.push(eventSentence(bundle, ev))
    }
  }
  if (row.status === "FAILED" && execution?.error) outcome.push(String(execution.error))
  const status = String(row.status)
  return {
    id: row.id,
    by: bundle.dir.title(row.proposed_by_agent_id) ?? "Agent",
    byAgent: true,
    ours,
    status,
    statusLabel: STATUS_LABEL[status] ?? label(status),
    tone: PROPOSAL_TONE[status] ?? "neutral",
    createdAt: String(row.created_at),
    title: payload?.title ?? String(row.summary ?? ""),
    situation: payload?.situation ?? null,
    recommendation: payload?.recommendation ?? str(row.rationale),
    changes,
    customerMessage: payload?.customer_message ?? null,
    driverMessage: payload?.driver_message ?? null,
    alternatives: payload?.alternatives ?? [],
    openQuestions: payload?.open_questions ?? [],
    urgency: payload?.urgency ?? null,
    afterApproval: payload?.after_approval ?? null,
    evidence,
    review: review ? {
      decision: String(review.decision ?? ""), note: str(review.note), by: bundle.dir.title(review.reviewer_id) ?? "Operator",
      at: String(review.reviewed_at ?? ""), edited: review.edited === true,
    } : null,
    outcome,
  }
}

const STATUS_LABEL: Record<string, string> = {
  PENDING_REVIEW: "Waiting for your decision", APPROVED_AWAITING_EXECUTION: "Approved, not yet carried out", EXECUTED: "Approved and done",
  REJECTED: "Rejected", FAILED: "Failed", SUPERSEDED: "Replaced by a newer suggestion", WITHDRAWN: "Withdrawn",
}

// ---------------------------------------------------------------- facts

function windowFact(key: string, labelText: string, window: ReturnType<typeof chosenWindows>["promise"], id: string | null, extra?: Partial<FactRow>): FactRow | null {
  if (!window) return null
  const source = window.source ?? ""
  return {
    key, label: labelText,
    value: window.end ? fmtRange(window.start, window.end, window.zone) : fmtDateTime(window.start, window.zone),
    note: window.deadline ? `Outer limit ${fmtDateTime(window.deadline, window.zone)}` : null,
    certainty: source === "CUSTOMER" ? "confirmed" : "estimate",
    tone: "neutral",
    source: { kind: WINDOW_SOURCE[source] ?? "system", who: WINDOW_WHO[source] ?? "Source not recorded", at: null, recordId: id, collection: "time_windows" },
    ...extra,
  }
}

function windowId(bundle: Bundle, purpose: string): string | null {
  return rows(bundle, "time_windows").find((row) => row.details.purpose === purpose && row.details.is_selected)?.id ?? null
}

function buildFacts(bundle: Bundle, now: string): FactRow[] {
  const facts: FactRow[] = []
  const windows = chosenWindows(bundle)
  const { keyDates } = deriveKeyDates(bundle)
  const { pickedUpAt, deliveredAt } = milestones(bundle)
  const lane = bundle.order.lane
  const promiseDate = keyDates.find((date) => date.key === "promise")

  if (deliveredAt) {
    facts.push({ key: "delivered", label: "Delivered", value: fmtDateTime(deliveredAt, windows.promise?.zone ?? null), note: promiseDate?.note ?? null, certainty: "confirmed", tone: "ok", source: { kind: "app", who: "Driver app", at: deliveredAt, recordId: bundle.events.find((event) => event.command === "vehicle.delivered")?.id ?? null, collection: "operational_events" } })
  } else {
    const promise = windowFact("promise", "Delivery promise", windows.promise, windowId(bundle, "CUSTOMER_DELIVERY_PROMISE"), { tone: promiseDate?.tone ?? "neutral", note: promiseDate?.note ?? null })
    if (promise) facts.push(promise)
  }

  if (pickedUpAt) {
    if (!deliveredAt) facts.push({ key: "picked", label: "Picked up", value: fmtDateTime(pickedUpAt, windows.pickupSlot?.zone ?? null), note: null, certainty: "confirmed", tone: "ok", source: { kind: "app", who: "Driver app", at: pickedUpAt, recordId: bundle.events.find((event) => event.command === "vehicle.picked_up")?.id ?? null, collection: "operational_events" } })
  } else if (lane !== "delivered" && lane !== "cancelled") {
    const slot = windowFact("slot", "Pickup slot", windows.pickupSlot, windowId(bundle, "SELECTED_PICKUP_SLOT"), { tone: keyDates.find((date) => date.key === "pickup_slot")?.tone ?? "neutral", note: keyDates.find((date) => date.key === "pickup_slot")?.note ?? null })
    if (slot) facts.push(slot)
  }

  // Where the car is: the newest signal, how old it is, and anything the driver reported since.
  if (lane === "moving") {
    const observations = rows(bundle, "tracking_observations").map((row) => row.details).sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at)))
    const latest = observations[0]
    const incident = rows(bundle, "incidents").map((row) => row.details).find((row) => !row.resolved_at && str(row.reported_stop_text))
    if (incident) {
      facts.push({
        key: "position", label: "Where the car is", value: String(incident.reported_stop_text), note: incident.location_verified ? "Verified" : "Reported by the driver, not verified",
        certainty: "reported", tone: "warn", source: { kind: "driver", who: "Driver", at: str(incident.opened_at), recordId: String(incident.id), collection: "incidents" },
      })
    } else if (latest) {
      const rel = relativeTo(str(latest.observed_at), now)
      const stale = latest.location_quality === "STALE" || (rel ? rel.past && rel.minutes > 180 : false)
      facts.push({
        key: "position", label: "Last position", value: `${latest.distance_remaining_km ?? "?"} km to go${typeof latest.progress_fraction === "number" ? ` · ${Math.round(latest.progress_fraction * 100)}% of the route` : ""}`,
        note: `Driver-app signal ${rel?.text ?? ""}${stale ? ", stale" : ""}. No map position in the records.`,
        certainty: stale ? "stale" : "estimate", tone: stale ? "warn" : "neutral",
        source: { kind: "app", who: "Driver app", at: str(latest.observed_at), recordId: String(latest.id), collection: "tracking_observations" },
      })
    } else {
      facts.push({ key: "position", label: "Last position", value: "No driver-app signal", note: "The records cannot say where the car is.", certainty: "missing", tone: "warn", source: null })
    }
    const direct = latestTracking(bundle).direct
    if (direct?.eta && !incident) {
      const late = windows.promise?.end ? direct.eta > windows.promise.end : false
      facts.push({
        key: "eta", label: "ETA", value: fmtDateTime(direct.eta, windows.promise?.zone ?? null), note: late ? "After the delivery promise" : "Within the promise",
        certainty: "estimate", tone: late ? "danger" : "neutral",
        source: { kind: "app", who: "Driver app estimate", at: direct.observedAt, recordId: rows(bundle, "tracking_observations").find((row) => row.details.observed_at === direct.observedAt)?.id ?? null, collection: "tracking_observations" },
      })
    }
  }

  const assignment = rows(bundle, "work_assignments").find((row) => row.details.status === "IN_PROGRESS") ?? rows(bundle, "work_assignments").find((row) => row.details.status === "ASSIGNED")

  // What the driver said last, while the job is live: often newer than any record.
  if (assignment && lane !== "delivered" && lane !== "cancelled") {
    const driverId = assignment.details.driver_id
    const said = [...bundle.messages].reverse().find((message) => message.authorType === "driver" && message.details.author_id === driverId)
    const rel = said ? relativeTo(said.authoredAt, now) : null
    if (said && rel && rel.past && rel.minutes > -24 * 60) {
      facts.push({
        key: "driver_said", label: "Latest from the driver", value: `“${said.body.length > 160 ? `${said.body.slice(0, 157)}…` : said.body}”`, note: null,
        certainty: "reported", tone: "neutral",
        source: { kind: "driver", who: bundle.dir.driverName(driverId) ?? "Driver", at: said.authoredAt, recordId: said.id, collection: "messages" },
      })
    }
  }

  if (assignment && lane !== "delivered") {
    const name = bundle.dir.driverName(assignment.details.driver_id) ?? "Driver"
    const started = str(assignment.details.started_at)
    facts.push({
      key: "driver", label: "Driver", value: name, note: started ? `Driving since ${fmtDateTime(started, null)}` : `Booked ${relativeTo(str(assignment.details.accepted_at), now)?.text ?? ""}, not started`,
      certainty: "booked", tone: "neutral", source: { kind: "driver", who: "Driver app", at: str(assignment.details.accepted_at), recordId: assignment.id, collection: "work_assignments" },
    })
  } else if (!assignment && (lane === "ready" || lane === "market")) {
    facts.push({ key: "driver", label: "Driver", value: "Not booked yet", note: null, certainty: "missing", tone: lane === "market" ? "neutral" : "neutral", source: null })
  }

  // Travel: booked separately from quoted.
  for (const reservation of rows(bundle, "travel_reservations").map((row) => row.details).filter((row) => row.status !== "CANCELLED" && row.kind === "FERRY").slice(0, 1)) {
    const amendment = reservation.amendment_request as Rec | undefined
    // Ferry times read in the departure terminal's zone, like the timetable a driver sees.
    const zone = str(world().get("ferry_terminals", String(reservation.origin_terminal_id ?? ""))?.timezone)
    const cutoff = str(reservation.check_in_cutoff_at)
    const cutoffRel = relativeTo(cutoff, now)
    facts.push({
      key: `ferry-${reservation.id}`, label: "Ferry", value: `${str(reservation.route_label) ?? "Vehicle crossing"}, ${fmtDateTime(str(reservation.departure_at), zone)}`,
      note: [`Check-in closes ${fmtDateTime(cutoff, zone)}${cutoffRel ? ` (${cutoffRel.past ? "closed " : ""}${cutoffRel.text})` : ""}`, `boarding ${labelIn(str(reservation.boarding_confirmation))}`, amendment ? `later crossing ${labelIn(str(amendment.status))}` : null].filter(Boolean).join(" · "),
      certainty: "booked", tone: reservation.status === "MISSED_CHECK_IN" ? "danger" : "neutral",
      source: { kind: "carrier", who: `Booking ${str(reservation.booking_reference) ?? ""}`.trim(), at: str(reservation.booked_at), recordId: String(reservation.id), collection: "travel_reservations" },
    })
  }
  // A live hold the agent placed wins over a plain quote; an expired hold is just a quote again.
  const options = rows(bundle, "travel_options").map((row) => row.details).sort((a, b) => String(b.checked_at).localeCompare(String(a.checked_at)))
  const quote = options.find((row) => row.status === "HELD" && String(row.hold_expires_at) > now) ?? options.find((row) => row.status === "AVAILABLE_QUOTE")
  if (quote) {
    const held = quote.status === "HELD"
    facts.push({
      key: "quote", label: `${label(str(quote.kind))} option`, value: `${str(quote.provider) ?? ""}, ${fmtDateTime(str(quote.departure_at), null)}${typeof quote.quote_cents === "number" ? ` · ${fmtMoney(quote.quote_cents, str(quote.currency))}` : ""}`,
      note: held ? `Held by the agent until ${fmtDateTime(str(quote.hold_expires_at), null)}, not booked (simulated)` : `Quote only, not booked. Checked ${relativeTo(str(quote.checked_at), now)?.text ?? ""}`, certainty: "quote", tone: "neutral",
      source: { kind: "carrier", who: str(quote.provider) ?? "Carrier", at: str(quote.checked_at), recordId: String(quote.id), collection: "travel_options" },
    })
  }

  // Who receives the car, and whether anyone confirmed it for this order.
  const boundary = pickedUpAt ? "DELIVERY" : lane === "delivered" || lane === "cancelled" ? null : "PICKUP"
  const detail = boundary ? rows(bundle, "order_endpoint_details").find((row) => row.details.boundary === boundary) : null
  if (detail) {
    const d = detail.details
    const confirmed = d.contact_status === "CONFIRMED"
    facts.push({
      key: "contact", label: boundary === "DELIVERY" ? "Receiver" : "Handover contact",
      value: `${str(d.contact_name) ?? "No named contact"}${str(d.contact_role) ? ` (${str(d.contact_role)})` : ""}`,
      note: [`Contact ${labelIn(str(d.contact_status))}`, `access ${labelIn(str(d.access_status))}`].join(", "),
      certainty: confirmed ? "confirmed" : str(d.contact_name) ? "reported" : "missing", tone: confirmed ? "neutral" : "warn",
      source: { kind: d.last_confirmed_source === "MANAGED_SITE_PROFILE" ? "site" : d.stated_by === "CUSTOMER_ORDER_INPUT" ? "customer" : "site", who: label(str(d.last_confirmed_source) ?? str(d.stated_by)), at: str(d.last_confirmed_at) ?? str(d.stated_at), recordId: detail.id, collection: "order_endpoint_details" },
    })
  }
  return facts
}

// ---------------------------------------------------------------- timeline

const OUR_EVENTS: Record<string, (ev: Rec, bundle: Bundle) => string> = {
  "agent.proposal_created": (ev) => `Journey agent brought a decision: ${String((ev.changes as Rec)?.title ?? "")}`,
  "agent.proposal_approved": (ev) => `Approved: ${String((ev.changes as Rec)?.title ?? "")}${(ev.changes as Rec)?.edited ? " (edited)" : ""}`,
  "agent.proposal_rejected": (ev) => `Rejected: ${String((ev.changes as Rec)?.title ?? "")}`,
  "promise.revision_requested": (ev) => `New delivery promise requested: ${String((ev.changes as Rec)?.summary ?? "")}`,
  "travel.booking_approved": (ev) => `Booking approved: ${String((ev.changes as Rec)?.summary ?? "")}`,
  "cost.approved": (ev) => `Cost approved: ${String((ev.changes as Rec)?.summary ?? "")}`,
  "assignment.change_approved": (ev) => `Driver change approved: ${String((ev.changes as Rec)?.summary ?? "")}`,
  "change.approved": (ev) => `Approved: ${String((ev.changes as Rec)?.summary ?? "")}`,
}

function eventSentence(bundle: Bundle, ev: Rec): string {
  const ours = OUR_EVENTS[String(ev.command)]
  if (ours) return ours(ev, bundle)
  if (ev.command === "message.sent" && (ev.changes as Rec)?.recipient_type === "customer") return "Your message was sent to the customer"
  if (ev.command === "message.sent" && (ev.changes as Rec)?.recipient_type === "driver") return "The agent sent the approved message to the driver"
  return describeEvent({ id: ev.id, orderId: String(ev.order_id), command: String(ev.command), targetType: String(ev.target_type), targetId: String(ev.target_id), recordedAt: String(ev.recorded_at), details: ev }, bundle).text
}

// Events that only restate a message or are housekeeping clutter the timeline.
const QUIET_EVENTS = new Set(["message.sent", "order.status_changed", "expense.submitted", "expense.reviewed"])

function buildTimeline(bundle: Bundle): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const message of bundle.messages) {
    const d = message.details
    const author = bundle.dir.resolve(d.author_id, d.author_type)
    const recipient = bundle.dir.resolve(d.recipient_id, d.recipient_type)
    const internal = d.visibility === "INTERNAL"
    items.push({
      id: message.id, at: message.authoredAt, kind: internal ? "note" : "message",
      actor: { kind: sourceKindOf(author), name: author.name },
      to: internal ? null : recipient.name, channel: label(str(d.channel)), title: null, body: message.body,
      internal, simulated: d.simulated === true, tone: "neutral", refs: d.approved_proposal_id ? [String(d.approved_proposal_id)] : [],
    })
  }
  for (const note of rows(bundle, "order_notes")) {
    const d = note.details
    const author = bundle.dir.resolve(d.author_id ?? d.created_by, d.author_type)
    items.push({
      id: note.id, at: String(d.created_at ?? d.recorded_at ?? ""), kind: "note", actor: { kind: sourceKindOf(author), name: author.name },
      to: null, channel: "Note", title: null, body: String(d.body ?? d.note ?? ""), internal: true, simulated: false, tone: "neutral",
      refs: Array.isArray(d.evidence_refs) ? d.evidence_refs.map(String) : [],
    })
  }
  for (const event of bundle.events) {
    if (event.orderId !== bundle.order.id || QUIET_EVENTS.has(event.command)) continue
    const d = event.details
    const actor = bundle.dir.resolve(d.actor_id, d.actor_type)
    const tone: Tone = event.command.startsWith("alert.raised") || event.command.startsWith("incident.opened") ? "warn"
      : event.command === "agent.proposal_approved" ? "ok" : event.command.startsWith("agent.") ? "accent" : "neutral"
    const view = OUR_EVENTS[event.command] ? null : describeEvent(event, bundle)
    items.push({
      id: event.id, at: event.recordedAt, kind: "event", actor: { kind: sourceKindOf(actor), name: actor.name },
      to: null, channel: null, title: null, body: view ? view.text : eventSentence(bundle, d as Rec), internal: false, simulated: false, tone,
      refs: [event.targetId],
    })
  }
  return items.filter((item) => item.at).sort((a, b) => a.at.localeCompare(b.at))
}

// ---------------------------------------------------------------- briefing

function recordsBriefing(story: RecordView["story"], triage: TriageItem, hasDecision: boolean): string {
  if (triage.bucket === "quiet") return `${story.headline} ${story.intro}`.trim()
  const reason = /[.!?”"]$/.test(triage.reason) ? triage.reason : `${triage.reason}.`
  // The lane headline ("driving it to Hamburg") can contradict an open problem, so
  // an order with something open leads with the problem itself.
  const parts = [reason]
  if (triage.next && !hasDecision && !triage.next.startsWith("Agent suggests") && !triage.next.startsWith("Review:")) parts.push(`Next step on record: ${triage.next}`)
  return parts.join(" ")
}

export function buildCase(orderId: string): CaseView | null {
  const bundle = loadBundle(orderId)
  if (!bundle) return null
  const w = world()
  const state = overlay()
  const run = state.runs[orderId] ?? null
  const triage = triageBundle(bundle, run, w.now)
  const record = buildRecordView(bundle)
  const primary = bundle.items.find((item) => item.role === "PRIMARY") ?? bundle.items[0] ?? null
  const pickup = bundle.places.get(bundle.order.pickupAddressId)
  const delivery = bundle.places.get(bundle.order.deliveryAddressId)
  const assignment = rows(bundle, "work_assignments").find((row) => row.details.status === "IN_PROGRESS")
    ?? rows(bundle, "work_assignments").find((row) => row.details.status === "ASSIGNED")
    ?? rows(bundle, "work_assignments").find((row) => row.details.status === "COMPLETED")

  const proposals = rows(bundle, "agent_proposals").map((row) => row.details as Rec).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  const pending = proposals.find((row) => row.proposed_by_agent_id === "journey-agent" && row.status === "PENDING_REVIEW")
    ?? proposals.find((row) => row.status === "PENDING_REVIEW")
    ?? null
  const decision = pending ? decisionCard(bundle, pending, w.now) : null
  const history = proposals.filter((row) => row !== pending).map((row) => decisionCard(bundle, row, w.now))
  const lastDecision = pending ? null : history.find((card) => card.review && (card.review.decision === "APPROVED" || card.review.decision === "REJECTED")
    && card.review.at >= w.snapshotAt) ?? null

  const briefing = run?.briefing
    ? { text: run.briefing, by: "agent" as const, at: run.updatedAt }
    : { text: recordsBriefing(record.story, triage, !!decision && decision.status === "PENDING_REVIEW"), by: "records" as const, at: null }

  return {
    now: w.now,
    snapshotAt: w.snapshotAt,
    triage,
    header: {
      reference: bundle.order.reference,
      customerReference: str(bundle.order.details.customer_reference),
      vehicle: primary ? {
        title: `${primary.vehicle.make} ${primary.vehicle.model}`, year: primary.vehicle.year, plate: primary.vehicle.registration, vin: primary.vehicle.vin, fuel: primary.vehicle.fuel,
        illustration: slug(`${primary.vehicle.make}-${primary.vehicle.model}`), logo: slug(primary.vehicle.make),
      } : null,
      customer: { id: bundle.customer.id, name: bundle.customer.name },
      from: { name: pickup?.name ?? "Unknown", city: pickup?.city ?? "Unknown", country: pickup?.country ?? "", kind: pickup ? str(pickup.details.kind) : null },
      to: { name: delivery?.name ?? "Unknown", city: delivery?.city ?? "Unknown", country: delivery?.country ?? "", kind: delivery ? str(delivery.details.kind) : null },
      lane: bundle.order.lane,
      laneLabel: laneLabel(bundle.order.lane),
      routeKind: label(bundle.order.routeKind),
      driver: assignment ? {
        id: String(assignment.details.driver_id), name: bundle.dir.driverName(assignment.details.driver_id) ?? "Driver",
        home: bundle.dir.driverHome(assignment.details.driver_id), status: labelIn(str(assignment.details.status)),
      } : null,
    },
    briefing,
    decision,
    lastDecision,
    history,
    facts: buildFacts(bundle, w.now),
    timeline: buildTimeline(bundle),
    agent: {
      available: modelAvailable(),
      running: isRunning(orderId),
      status: run?.status ?? null,
      statusText: run?.statusText ?? null,
      steps: run?.steps ?? [],
      briefing: run?.briefing ?? null,
      error: run?.error ?? null,
      usage: run?.usage ?? null,
      updatedAt: run?.updatedAt ?? null,
    },
    record: {
      journey: record.journey, reservations: record.reservations, options: record.options, proofs: record.proofs,
      documents: record.documents, expenses: record.expenses, offers: record.offers, assignments: record.assignments, story: record.story,
    },
  }
}

export function evidenceById(orderId: string, id: string): Evidence | null {
  const bundle = loadBundle(orderId)
  if (!bundle) return null
  return evidenceFor(bundle, id, world().now)
}
