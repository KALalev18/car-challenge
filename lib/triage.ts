// Which orders need a person, why, and what the next decision is. Built on the
// starter's attention items, with one change of stance: an order goes to "Needs
// you" only when a person must decide something now. Everything that is owned,
// waiting on someone else, or being worked by the agent stays visible but out of
// the way, and the quiet majority collapses to a count.

import type { Rec } from "./data/dataset"
import { world } from "./data/world"
import { deriveAttention, deriveKeyDates, strongestTone } from "./present/attention"
import { type Bundle, rows, str } from "./present/bundle"
import { label, laneLabel } from "./present/labels"
import { loadAllBundles, loadBundle } from "./present/load"
import { slug } from "./present/record"
import { fmtDateTime, relativeTo } from "./present/time"
import type { AttentionItem, Tone } from "./present/types"
import { overlay } from "./state/store"
import type { AgentRun, JourneyProposalPayload } from "./agent/types"

export type Bucket = "decide" | "agent" | "watch" | "quiet"
export type Area = "On the road" | "Travel" | "Pickup" | "Driver" | "Delivery" | "After delivery" | "Intake" | "Order"

export type TriageItem = {
  id: string
  reference: string
  vehicle: string
  vehicleSlug: string | null
  plate: string | null
  customer: string
  from: string
  to: string
  lane: string
  laneLabel: string
  bucket: Bucket
  tone: Tone
  area: Area
  /** Why it is here, in one sentence. */
  reason: string
  /** The next decision or step, in one sentence. */
  next: string | null
  /** Who holds the next step. */
  nextBy: "person" | "agent" | "outside" | null
  owner: string | null
  deadline: { label: string; at: string; zone: string | null; text: string; past: boolean; tone: Tone } | null
  agent: { status: AgentRun["status"]; statusText: string; updatedAt: string } | null
  proposal: { id: string; title: string; urgency: JourneyProposalPayload["urgency"]; by: string } | null
  signals: { text: string; tone: Tone }[]
  /** Lower sorts first. */
  rank: number
  driver: string | null
  /** What the records were checked for, so a quiet order says why it is quiet. */
  checks: string[]
}

const ROAD_SIGNALS = new Set(["TRACKING_GAP", "SAFETY_STOP", "FERRY_CONNECTION_RISK", "DELIVERY_PROMISE_UNACHIEVABLE", "DELIVERY_ACCESS_RISK", "FERRY_TRACKING_GAP_CONTEXT"])
const TRAVEL_SIGNALS = new Set(["FERRY_SOLD_OUT", "FR_IMPORT_TRAVEL_DECISION"])
const DRIVER_SIGNALS = new Set(["POSITIONING_AT_RISK", "DRIVER_AVAILABILITY_RISK"])
const PICKUP_SIGNALS = new Set(["RELEASE_DOCUMENT_UNCLEAR", "SITE_ACCESS_UNCONFIRMED", "EMPTY_PICKUP", "SITE_ACCESS_CONFLICT", "PICKUP_PROOF_REJECTED"])
const DECIDING_INCIDENTS = new Set(["NEEDS_HUMAN", "AWAITING_DECISION"])
const TONE_RANK: Record<Tone, number> = { danger: 0, warn: 1, accent: 2, neutral: 3, ok: 4 }
const BUCKET_RANK: Record<Bucket, number> = { decide: 0, agent: 1, watch: 2, quiet: 3 }

/** Is this order the Journey agent's kind of work? Moving cars, booked drivers and their travel. */
export function areaOf(bundle: Bundle): Area {
  const signals = bundle.alerts.filter((alert) => alert.status !== "RESOLVED" && alert.status !== "DISMISSED").map((alert) => alert.signal)
  const incidents = rows(bundle, "incidents").map((row) => str(row.details.kind))
  if (signals.some((signal) => ROAD_SIGNALS.has(signal)) || incidents.includes("VEHICLE_WARNING")) return "On the road"
  if (signals.some((signal) => TRAVEL_SIGNALS.has(signal)) || incidents.includes("TRAVEL_CAPACITY")) return "Travel"
  if (signals.some((signal) => DRIVER_SIGNALS.has(signal))) return "Driver"
  if (signals.some((signal) => PICKUP_SIGNALS.has(signal)) || incidents.includes("EMPTY_PICKUP")) return "Pickup"
  const lane = bundle.order.lane
  if (lane === "moving") return "On the road"
  if (lane === "delivered") return "After delivery"
  if (lane === "booked") return "Driver"
  if (lane === "intake") return "Intake"
  if (lane === "ready" || lane === "market") return "Pickup"
  return "Order"
}

export function isJourneyCase(item: Pick<TriageItem, "area" | "bucket" | "lane">): boolean {
  return item.bucket !== "quiet" && (item.area === "On the road" || item.area === "Travel" || item.area === "Driver")
}

function ourProposals(bundle: Bundle): Rec[] {
  return rows(bundle, "agent_proposals")
    .map((row) => row.details as Rec)
    .filter((row) => row.proposed_by_agent_id === "journey-agent")
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}

function openWork(bundle: Bundle) {
  return rows(bundle, "work_items").map((row) => row.details).find((row) => row.status === "OPEN" || row.status === "NEEDS_EXTERNAL_INPUT") ?? null
}

function firstSentence(text: string | null): string | null {
  if (!text) return null
  const trimmed = text.trim()
  const match = trimmed.match(/^(.+?[.!?])(\s|$)/)
  return match ? match[1] : trimmed
}

export function triageBundle(bundle: Bundle, run: AgentRun | null, now: string): TriageItem {
  const attention = deriveAttention(bundle)
  const { decisive } = deriveKeyDates(bundle)
  const primary = bundle.items.find((item) => item.role === "PRIMARY") ?? bundle.items[0] ?? null
  const pickup = bundle.places.get(bundle.order.pickupAddressId)
  const delivery = bundle.places.get(bundle.order.deliveryAddressId)
  const area = areaOf(bundle)
  const work = openWork(bundle)
  const proposals = ourProposals(bundle)
  const pendingOurs = proposals.find((row) => row.status === "PENDING_REVIEW") ?? null
  const datasetPending = rows(bundle, "agent_proposals").map((row) => row.details)
    .filter((row) => row.proposed_by_agent_id !== "journey-agent" && (row.status === "PENDING_REVIEW" || row.status === "FAILED"))
  const deciding = rows(bundle, "incidents").map((row) => row.details).find((row) => !row.resolved_at && DECIDING_INCIDENTS.has(String(row.status))) ?? null
  const severeOpen = bundle.alerts.find((alert) => alert.status === "OPEN" && (alert.severity === "high" || alert.severity === "critical")) ?? null
  const severeOwned = bundle.alerts.find((alert) => alert.status === "ACKNOWLEDGED" && (alert.severity === "high" || alert.severity === "critical")) ?? null
  const dangerDate = decisive?.tone === "danger" ? decisive : null
  const highWork = work && (work.priority === "high" || (typeof work.due_at === "string" && work.due_at < now)) ? work : null

  const assignment = rows(bundle, "work_assignments").map((row) => row.details)
    .find((row) => row.status === "IN_PROGRESS") ?? rows(bundle, "work_assignments").map((row) => row.details).find((row) => row.status === "ASSIGNED")
  const driver = assignment ? bundle.dir.driverName(assignment.driver_id) : null

  // Who holds it.
  const agentBusy = run && (run.status === "working" || run.status === "waiting_driver" || run.status === "waiting_site")
  const needsDecision = !!(pendingOurs || datasetPending.length || deciding || severeOpen || dangerDate || (highWork && severeOwned))
  let bucket: Bucket
  if (pendingOurs) bucket = "decide"
  else if (agentBusy) bucket = "agent"
  else if (needsDecision) bucket = "decide"
  else if (attention.length) bucket = "watch"
  else bucket = "quiet"
  // When the agent finished and said nothing needs a person, trust it only if the
  // records agree: no open decision left behind.
  if (run?.status === "done" && bucket === "decide" && !pendingOurs && !deciding && !dangerDate && !datasetPending.length) bucket = "watch"
  // Once a person has decided on the agent's suggestion (or taken the case over),
  // the order steps back until something new happens: a newer alert, message or
  // proposal brings it forward again.
  const decided = proposals.find((row) => row.status === "EXECUTED" || row.status === "REJECTED" || row.status === "WITHDRAWN")
  const decidedAt = decided ? String((decided.review as Record<string, unknown> | null)?.reviewed_at ?? "") : ""
  const newerSignal = decidedAt && (bundle.alerts.some((alert) => alert.triggeredAt > decidedAt)
    || bundle.messages.some((message) => message.authoredAt > decidedAt && (message.authorType === "customer" || message.authorType === "site_contact")))
  const handled = !!decided && !pendingOurs && !newerSignal && bucket === "decide"
  if (handled) bucket = "watch"

  // An order nobody can vouch for is not fine: a moving car whose last position is
  // hours old, with no alert covering it, comes out of "On track".
  const silence = silentForHours(bundle, now)
  const silent = bucket === "quiet" && silence !== null && silence >= SILENT_HOURS
  if (silent) bucket = "watch"
  // When the agent fails, a person sees it straight away.
  const agentFailed = run?.status === "error"
  if (agentFailed && bucket !== "decide") bucket = "decide"

  // Why it is here.
  const payload = pendingOurs?.proposed_payload as JourneyProposalPayload | undefined
  let reason: string
  let next: string | null = null
  let nextBy: TriageItem["nextBy"] = null
  const alertFirst = severeOpen ?? severeOwned ?? bundle.alerts.find((alert) => alert.status === "OPEN") ?? bundle.alerts.find((alert) => alert.status === "ACKNOWLEDGED") ?? null
  const decidedPayload = decided?.proposed_payload as JourneyProposalPayload | undefined
  if (agentFailed) {
    reason = `The Journey agent stopped before finishing: ${run?.error ?? "unknown error"}`
    next = "Take the case over, or ask the agent to continue."
    nextBy = "person"
  } else if (silent) {
    reason = `No driver-app position for ${Math.round(silence!)} h, and nobody has confirmed where the car is since.`
    next = "Ask the driver for their position and ETA."
    nextBy = "outside"
  } else if (handled && decided) {
    const review = decided.review as Record<string, unknown> | null
    reason = decided.status === "EXECUTED" ? `You approved: ${decidedPayload?.title ?? String(decided.summary)}.`
      : decided.status === "REJECTED" ? `You rejected the agent's suggestion${review?.note ? `: “${String(review.note)}”` : "."}`
      : "You took this case over."
    next = decided.status === "EXECUTED" ? decidedPayload?.after_approval ?? null : null
    nextBy = "outside"
  } else if (payload) {
    reason = payload.title
    next = `Agent suggests: ${firstSentence(payload.recommendation)}`
    nextBy = "person"
  } else if (work && (deciding || severeOpen || severeOwned)) {
    reason = String(work.summary ?? alertFirst?.summary ?? "")
    next = firstSentence(str(work.next_action))
    nextBy = "person"
  } else if (alertFirst) {
    reason = voiceOf(bundle, alertFirst) ?? alertFirst.summary
    next = firstSentence(str(work?.next_action) ?? str(alertFirst.details.next_action)) ?? (datasetPending[0] ? `Review: ${datasetPending[0].summary}` : null)
    nextBy = alertFirst.status === "ACKNOWLEDGED" ? "outside" : "person"
  } else if (datasetPending.length) {
    reason = datasetPending[0].status === "FAILED" ? `An agent action failed: ${String(datasetPending[0].summary)}` : String(datasetPending[0].rationale ?? datasetPending[0].summary)
    next = `Review: ${String(datasetPending[0].summary)}`
    nextBy = "person"
  } else if (work) {
    reason = String(work.summary)
    next = firstSentence(str(work.next_action))
    nextBy = "person"
  } else if (attention.length) {
    reason = attention[0].detail ? `${attention[0].title}. ${attention[0].detail}` : attention[0].title
    nextBy = attention[0].kind === "waiting" ? "outside" : null
  } else if (dangerDate) {
    reason = `Delivery at risk: ${dangerDate.note ?? "the promise is in danger"}.`
  } else {
    reason = quietReason(bundle, driver)
  }
  if (!next && bucket === "decide") next = SIGNAL_NEXT[alertFirst?.signal ?? ""] ?? (dangerDate ? "Confirm the real ETA with the driver, then agree a new delivery target with the customer." : null)
  if (bucket === "decide") nextBy = "person"
  if (bucket === "agent" && run && !agentFailed) {
    next = run.statusText
    nextBy = "agent"
  }
  if (bucket === "watch" && nextBy === null) nextBy = "outside"

  const tones = attention.map((item) => item.tone)
  if (pendingOurs) tones.push(payload?.urgency === "now" ? "danger" : "accent")
  let tone: Tone = bucket === "quiet" ? "ok" : tones.length ? strongestTone(tones) : "neutral"
  if (bucket === "decide" && tone !== "danger" && (severeOpen || deciding || dangerDate || agentFailed)) tone = "danger"
  if (silent) tone = "warn"
  if (bucket === "watch" && tone === "danger") tone = "warn"

  const deadline = deadlineOf(bundle, decisive, work, now)
  const owner = bundle.dir.title(work?.owner ?? alertFirst?.details.owner ?? null)

  const signals = signalChips(bundle, attention)

  const rank = BUCKET_RANK[bucket] * 1e7 + TONE_RANK[tone] * 1e6 + deadlineRank(deadline, now)

  return {
    id: bundle.order.id,
    reference: bundle.order.reference,
    vehicle: primary ? `${primary.vehicle.make} ${primary.vehicle.model}` : "Vehicle not linked",
    vehicleSlug: primary ? slug(`${primary.vehicle.make}-${primary.vehicle.model}`) : null,
    plate: primary?.vehicle.registration ?? null,
    customer: bundle.customer.name,
    from: pickup?.city ?? "Unknown",
    to: delivery?.city ?? "Unknown",
    lane: bundle.order.lane,
    laneLabel: laneLabel(bundle.order.lane),
    bucket, tone, area, reason, next, nextBy, owner, deadline,
    agent: run ? { status: run.status, statusText: run.statusText, updatedAt: run.updatedAt } : null,
    proposal: pendingOurs && payload ? { id: pendingOurs.id, title: payload.title, urgency: payload.urgency, by: "Journey agent" } : null,
    signals,
    rank,
    driver,
    checks: checksFor(bundle, now),
  }
}

const SILENT_HOURS = 4

/** Hours since the last driver-app position of a car on the road, or null when not on the road. */
function silentForHours(bundle: Bundle, now: string): number | null {
  if (bundle.order.lane !== "moving") return null
  const latest = rows(bundle, "tracking_observations").map((row) => str(row.details.observed_at)).filter((at): at is string => !!at).sort().pop()
  const driverSaid = bundle.messages.filter((message) => message.authorType === "driver").map((message) => message.authoredAt).sort().pop()
  const last = [latest, driverSaid].filter((at): at is string => !!at).sort().pop()
  if (!last) return null
  return (new Date(now).getTime() - new Date(last).getTime()) / 3_600_000
}

/** What was looked at, in words, for the "why is this quiet" line. */
function checksFor(bundle: Bundle, now: string): string[] {
  const checks: string[] = []
  const openAlerts = bundle.alerts.filter((alert) => alert.status === "OPEN" || alert.status === "ACKNOWLEDGED").length
  checks.push(openAlerts ? `${openAlerts} open alert${openAlerts > 1 ? "s" : ""}` : "No open alerts")
  const openThreads = bundle.conversations.filter((thread) => thread.status === "OPEN").length
  checks.push(openThreads ? `${openThreads} open conversation${openThreads > 1 ? "s" : ""}` : "No open conversations")
  if (!rows(bundle, "incidents").some((row) => !row.details.resolved_at) && !openWork(bundle)) checks.push("No incidents or open work")
  const lane = bundle.order.lane
  const assignment = rows(bundle, "work_assignments").map((row) => row.details).find((row) => row.status === "IN_PROGRESS" || row.status === "ASSIGNED")
  if (lane === "booked" || lane === "moving") checks.push(assignment ? `Driver ${bundle.dir.driverName(assignment.driver_id) ?? ""} booked`.replace("  ", " ") : "No driver booked")
  if (lane === "moving") {
    const hours = silentForHours(bundle, now)
    if (hours !== null) checks.push(hours < 1 ? "Position under an hour old" : `Last position ${Math.round(hours)} h ago`)
    const { decisive } = deriveKeyDates(bundle)
    if (decisive?.key === "promise") checks.push(decisive.tone === "danger" ? "Promise at risk" : "ETA within the promise")
  }
  if (lane === "delivered") {
    const proofs = rows(bundle, "proofs").map((row) => String(row.details.status))
    checks.push(proofs.some((status) => status === "REQUIRED" || status === "REJECTED") ? "Proof still missing" : "Handover proof in")
  }
  return checks
}

/** What the next decision usually is for a signal that has no owned work item yet. */
const SIGNAL_NEXT: Record<string, string> = {
  DELIVERY_PROMISE_UNACHIEVABLE: "Agree a new delivery target with the customer before anyone promises one.",
  FERRY_CONNECTION_RISK: "Decide whether to keep the booked crossing or move the car to a later one.",
  TRACKING_GAP: "Confirm where the car is with the driver before changing any promise.",
  DELIVERY_ACCESS_RISK: "Get a named, authorized receiver before the driver arrives.",
  CONDITION_CLAIM_REVIEW: "Compare pickup, delivery and customer photos before answering the customer.",
}

/**
 * Some alerts are written as reminders ("Review X; source is a conversation").
 * The person who raised it says it better, so quote them with who and when.
 */
function voiceOf(bundle: Bundle, alert: Bundle["alerts"][number]): string | null {
  if (!/source is a conversation/i.test(alert.summary)) return null
  const threadId = str(alert.details.conversation_id)
  const said = bundle.messages
    .filter((message) => (!threadId || message.conversationId === threadId) && message.details.visibility !== "INTERNAL" && ["driver", "customer", "site_contact", "handoff_contact"].includes(message.authorType))
    .filter((message) => message.authoredAt <= alert.triggeredAt || !threadId)
    .pop()
  if (!said) return null
  const who = said.authorType === "driver" ? "Driver" : said.authorType === "customer" ? "Customer" : "Site"
  return `${who}: “${firstSentence(said.body) ?? said.body}”`
}

function quietReason(bundle: Bundle, driver: string | null): string {
  const lane = bundle.order.lane
  if (lane === "moving") return driver ? `${driver} is driving. Nothing in the records is waiting on a person.` : "Moving. Nothing in the records is waiting on a person."
  if (lane === "booked") return driver ? `${driver} is booked. Nothing is waiting on a person.` : "A driver is booked."
  if (lane === "market") return "On the driver market."
  if (lane === "ready") return "Ready to offer to drivers."
  if (lane === "intake") return "Being prepared."
  if (lane === "delivered") return "Delivered."
  if (lane === "cancelled") return "Cancelled."
  return "Nothing waiting."
}

function deadlineOf(bundle: Bundle, decisive: ReturnType<typeof deriveKeyDates>["decisive"], work: Record<string, unknown> | null, now: string): TriageItem["deadline"] {
  const lane = bundle.order.lane
  if (decisive && (lane === "moving" || lane === "booked" || lane === "market" || lane === "ready" || lane === "intake") && decisive.key !== "created") {
    const at = decisive.key === "promise" || decisive.key === "eta" ? decisive.end ?? decisive.start : decisive.start
    const rel = relativeTo(at, now)
    const verb = decisive.key === "promise" ? (rel?.past ? "Promise ended" : "Promise ends")
      : decisive.key === "pickup_slot" ? (rel?.past ? "Pickup slot started" : "Pickup slot")
      : decisive.label
    return {
      label: verb, at, zone: decisive.zone,
      text: `${fmtDateTime(at, decisive.zone)}`,
      past: !!rel?.past,
      tone: decisive.tone === "danger" ? "danger" : rel?.past ? "warn" : rel && rel.minutes < 24 * 60 ? "warn" : "neutral",
    }
  }
  const due = work && typeof work.due_at === "string" ? work.due_at : null
  if (due) {
    const rel = relativeTo(due, now)
    return { label: rel?.past ? "Follow-up was due" : "Follow-up due", at: due, zone: null, text: fmtDateTime(due, null), past: !!rel?.past, tone: rel?.past ? "warn" : "neutral" }
  }
  return null
}

function deadlineRank(deadline: TriageItem["deadline"], now: string): number {
  if (!deadline) return 999_999
  const minutes = (new Date(deadline.at).getTime() - new Date(now).getTime()) / 60000
  return Math.max(0, Math.min(999_998, Math.round(minutes + 100_000)))
}

function signalChips(bundle: Bundle, attention: AttentionItem[]): TriageItem["signals"] {
  const chips: TriageItem["signals"] = []
  for (const alert of bundle.alerts) {
    if (alert.status !== "OPEN" && alert.status !== "ACKNOWLEDGED") continue
    chips.push({ text: label(alert.signal), tone: alert.status === "OPEN" ? (alert.severity === "high" || alert.severity === "critical" ? "danger" : "warn") : "neutral" })
  }
  for (const item of attention) {
    if (item.kind === "waiting") chips.push({ text: item.title, tone: "neutral" })
  }
  return chips.slice(0, 3)
}

export type Queue = {
  now: string
  snapshotAt: string
  items: TriageItem[]
  counts: Record<Bucket, number>
  lanes: { lane: string; label: string; total: number; quiet: number }[]
  agent: { working: number; waiting: number; proposals: number }
}

export function buildQueue(): Queue {
  const w = world()
  const runs = overlay().runs
  const items = loadAllBundles().map((bundle) => triageBundle(bundle, runs[bundle.order.id] ?? null, w.now)).sort((a, b) => a.rank - b.rank)
  const counts: Record<Bucket, number> = { decide: 0, agent: 0, watch: 0, quiet: 0 }
  for (const item of items) counts[item.bucket] += 1
  const laneKeys = ["intake", "ready", "market", "booked", "moving", "delivered", "cancelled"]
  const lanes = laneKeys.map((lane) => ({
    lane, label: laneLabel(lane),
    total: items.filter((item) => item.lane === lane).length,
    quiet: items.filter((item) => item.lane === lane && item.bucket === "quiet").length,
  }))
  const allRuns = Object.values(runs)
  return {
    now: w.now, snapshotAt: w.snapshotAt, items, counts, lanes,
    agent: {
      working: allRuns.filter((run) => run.status === "working").length,
      waiting: allRuns.filter((run) => run.status === "waiting_driver" || run.status === "waiting_site").length,
      proposals: items.filter((item) => item.proposal).length,
    },
  }
}

export function triageOne(orderId: string): TriageItem | null {
  const bundle = loadBundle(orderId)
  if (!bundle) return null
  return triageBundle(bundle, overlay().runs[orderId] ?? null, world().now)
}
