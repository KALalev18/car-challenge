// The Journey agent's tools. Three kinds, in the order the agent should use them:
//   read   - look at records (free, no one is disturbed)
//   ask    - message the driver or a site (allowed without a yes, never a customer)
//   decide - write a note, hand a person a decision, or finish
// The rules of the game are enforced here in code, not only in the prompt: there
// is no tool that messages a customer, changes a booking, a date or a cost.

import type Anthropic from "@anthropic-ai/sdk"
import type { Rec } from "../data/dataset"
import type { World } from "../data/world"
import { describeEvent } from "../present/events"
import type { Bundle } from "../present/bundle"
import { fmtDateTime, relativeTo } from "../present/time"
import { addRow, nextId, patchRow, type Overlay, type Permissions } from "../state/store"
import type { AgentStep, JourneyProposalPayload, RunStatus } from "./types"

export type ToolContext = {
  orderId: string
  w: World
  bundle: Bundle
  permissions: Permissions
  /** Applies a change to the overlay (persisted). */
  write: <T>(change: (state: Overlay) => T) => T
  /** Called after the agent messages a driver or site, to start the simulated reply. */
  onAsked: (party: "driver" | "site", conversationId: string, recipientId: string) => void
}

export type ToolOutcome = {
  content: string
  step: Omit<AgentStep, "id" | "at">
  isError?: boolean
  /** Set when the tool hands the case to someone and the run should stop after this turn. */
  status?: RunStatus
  statusText?: string
  briefing?: string
  proposalId?: string
}

type ToolDef = {
  definition: Anthropic.Beta.BetaTool
  run: (ctx: ToolContext, input: Record<string, unknown>) => ToolOutcome
}

// ---------------------------------------------------------------- formatting

/** Drops nulls, empty arrays and empty objects so records stay short for the model. */
function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((item) => item !== undefined)
    return items.length ? items : undefined
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, compact(item)] as const)
      .filter(([, item]) => item !== undefined)
    return entries.length ? Object.fromEntries(entries) : undefined
  }
  if (value === null || value === "") return undefined
  return value
}

function json(value: unknown): string {
  return JSON.stringify(compact(value) ?? {})
}

function lines(rows: unknown[], empty: string): string {
  return rows.length ? rows.map((row) => `- ${json(row)}`).join("\n") : empty
}

const s = (value: unknown) => (typeof value === "string" ? value : "")

function age(iso: string | null | undefined, now: string): string {
  const rel = relativeTo(iso ?? null, now)
  return rel ? rel.text : "unknown time"
}

function related(ctx: ToolContext, collection: string): Rec[] {
  return (ctx.bundle.related[collection] ?? []).map((row) => row.details as Rec)
}

function currentAssignment(ctx: ToolContext): Rec | null {
  const all = related(ctx, "work_assignments")
  return all.find((row) => row.status === "IN_PROGRESS") ?? all.find((row) => row.status === "ASSIGNED") ?? null
}

function speaker(ctx: ToolContext, id: unknown, type: unknown): string {
  const actor = ctx.bundle.dir.resolve(id, type)
  return actor.role && actor.kind !== "operator" ? `${actor.name} (${actor.role})` : actor.name
}

// ---------------------------------------------------------------- read tools

const readCase: ToolDef = {
  definition: {
    name: "read_case",
    description: "Read the order overview: car, customer, route, selected windows with their source, the current driver assignment, open alerts, incidents, owned work, existing agent proposals and the list of conversations. Start every investigation here.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  run(ctx) {
    const { bundle, w } = ctx
    const order = bundle.order.details
    const pickup = bundle.places.get(bundle.order.pickupAddressId)
    const delivery = bundle.places.get(bundle.order.deliveryAddressId)
    const assignment = currentAssignment(ctx)
    const driver = assignment ? w.get("drivers", s(assignment.driver_id)) : undefined
    const windows = related(ctx, "time_windows").map((row) => ({
      id: row.id, purpose: row.purpose, selected: row.is_selected, source: row.source,
      local: fmtDateTime(s(row.start_at), s(row.timezone)) + " – " + fmtDateTime(s(row.end_at), s(row.timezone)),
      start_at: row.start_at, end_at: row.end_at, commitment_deadline_at: row.commitment_deadline_at,
    }))
    const conversations = bundle.conversations.map((thread) => ({
      id: thread.id, category: thread.category, channel: thread.channel, status: thread.status,
      counterparty: thread.details.counterparty_id ? speaker(ctx, thread.details.counterparty_id, thread.details.counterparty_type) : null,
      waiting_on: thread.details.waiting_on, owner: thread.details.owner, next_check_at: thread.details.next_check_at,
      messages: bundle.messages.filter((message) => message.conversationId === thread.id).length,
      last_message_at: thread.updatedAt,
    }))
    const text = [
      `Now: ${w.now} (snapshot of the records: ${w.snapshotAt}).`,
      `Order ${bundle.order.reference} (${bundle.order.id}): status ${bundle.order.status}, stage "${bundle.order.lane}", route kind ${bundle.order.routeKind}, readiness ${s(order.readiness_status)}.`,
      `Customer (pays Bahn, never contact directly): ${bundle.customer.name} (${bundle.customer.id}). Customer reference ${s(order.customer_reference)}.`,
      `Cars: ${bundle.items.map((item) => `${item.role} ${item.vehicle.make} ${item.vehicle.model} ${item.vehicle.year ?? ""}, plate ${item.vehicle.registration ?? "not recorded"}, VIN ${item.vehicle.vin ?? "not recorded"}`).join("; ")}.`,
      `Pickup: ${pickup ? `${pickup.name}, ${s(pickup.details.address_line1)}, ${pickup.city} ${pickup.country}` : "unknown"}${bundle.order.pickupSiteId ? ` (managed site ${bundle.order.pickupSiteId})` : " (no managed site)"}.`,
      `Delivery: ${delivery ? `${delivery.name}, ${s(delivery.details.address_line1)}, ${delivery.city} ${delivery.country}` : "unknown"}${bundle.order.deliverySiteId ? ` (managed site ${bundle.order.deliverySiteId})` : " (no managed site)"}.`,
      `Time windows:\n${lines(windows, "none recorded")}`,
      `Current driver assignment: ${assignment ? json({ ...assignment, driver_name: driver?.display_name, driver_home: driver ? `${s(driver.home_city)}, ${s(driver.home_country)}` : null }) : "none"}`,
      `Alerts:\n${lines(bundle.alerts.map((alert) => alert.details), "none")}`,
      `Incidents:\n${lines(related(ctx, "incidents"), "none")}`,
      `Work items:\n${lines(related(ctx, "work_items"), "none")}`,
      `Agent proposals already on the order:\n${lines(related(ctx, "agent_proposals").map((row) => ({ id: row.id, by: row.proposed_by_agent_id, status: row.status, summary: row.summary, review: row.review, created_at: row.created_at })), "none")}`,
      `Conversations:\n${lines(conversations, "none")}`,
      `Order notes:\n${lines(related(ctx, "order_notes"), "none")}`,
    ].join("\n\n")
    return { content: text, step: { kind: "read", tool: "read_case", label: "Read the order, route, driver and open alerts", refs: [bundle.order.id] } }
  },
}

const readMessages: ToolDef = {
  definition: {
    name: "read_messages",
    description: "Read the messages on this order, oldest first, with who said what, to whom, on which channel and when. Internal notes are operator-only. Optionally limit to one conversation id.",
    input_schema: {
      type: "object",
      properties: { conversation_id: { type: "string", description: "Only this conversation. Omit for all conversations on the order." } },
      additionalProperties: false,
    },
  },
  run(ctx, input) {
    const only = s(input.conversation_id)
    const messages = ctx.bundle.messages.filter((message) => !only || message.conversationId === only)
    const text = messages.length ? messages.map((message) => {
      const d = message.details
      const simulated = d.simulated ? " [simulated reply in this demo]" : ""
      return `[${message.id}] ${message.authoredAt} · ${message.conversationId} · ${s(d.channel)}${d.visibility === "INTERNAL" ? " · INTERNAL NOTE" : ""}\n  From ${speaker(ctx, d.author_id, d.author_type)} to ${speaker(ctx, d.recipient_id, d.recipient_type)}${simulated}: ${message.body}`
    }).join("\n") : "No messages."
    const threads = new Set(messages.map((message) => message.conversationId)).size
    return { content: text, step: { kind: "read", tool: "read_messages", label: `Read ${messages.length} message${messages.length === 1 ? "" : "s"} in ${threads} conversation${threads === 1 ? "" : "s"}`, refs: messages.slice(-6).map((message) => message.id) } }
  },
}

const readTracking: ToolDef = {
  definition: {
    name: "read_tracking",
    description: "Read the driver-app position signals for this order, newest first, with when each was observed and received and how old it is now. Positions are coarse (no coordinates); a driver report is not a location fix.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  run(ctx) {
    const rows = related(ctx, "tracking_observations").sort((a, b) => s(b.observed_at).localeCompare(s(a.observed_at)))
    const text = rows.length
      ? rows.map((row) => `- ${json(row)} (observed ${age(s(row.observed_at), ctx.w.now)})`).join("\n")
      : "No tracking observations on this order."
    const latest = rows[0]
    const label = latest ? `Checked tracking: last driver-app signal ${age(s(latest.observed_at), ctx.w.now)}${latest.location_quality === "STALE" ? ", marked stale" : ""}` : "Checked tracking: no driver-app signal"
    return { content: text, step: { kind: "read", tool: "read_tracking", label, refs: latest ? [latest.id] : [] } }
  },
}

const readTravel: ToolDef = {
  definition: {
    name: "read_travel",
    description: "Read booked travel (ferries, trains, flights, hotels) separately from quotes, plus carrier notices, gate scans, driver travel reports and planning road times to ferry terminals. A quote is not a booking; a booking is not a boarding.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  run(ctx) {
    const reservations = related(ctx, "travel_reservations")
    const options = related(ctx, "travel_options").map((row) => ({ ...row, checked: age(s(row.checked_at), ctx.w.now) }))
    const gate = related(ctx, "ferry_terminal_events")
    const reports = related(ctx, "travel_confirmations")
    const terminalIds = new Set(reservations.flatMap((row) => [s(row.origin_terminal_id), s(row.destination_terminal_id)]).filter(Boolean))
    const terminals = ctx.w.table("ferry_terminals").filter((row) => terminalIds.has(row.id))
    const roadIds = new Set(reservations.map((row) => s(row.terminal_road_estimate_id)).filter(Boolean))
    const roads = ctx.w.table("terminal_road_estimates").filter((row) => roadIds.has(row.id))
    const text = [
      `Booked travel (reservations):\n${lines(reservations, "none")}`,
      `Quotes and capacity checks (not bookings):\n${lines(options, "none")}`,
      `Terminal gate observations:\n${lines(gate, "none")}`,
      `Driver travel reports (attributed claims):\n${lines(reports, "none")}`,
      `Terminals:\n${lines(terminals, "none")}`,
      `Planning road times to the terminal:\n${lines(roads, "none")}`,
    ].join("\n\n")
    return {
      content: text,
      step: { kind: "read", tool: "read_travel", label: `Checked travel: ${reservations.length} booked, ${options.length} quoted`, refs: [...reservations, ...options].map((row) => row.id).slice(0, 6) },
    }
  },
}

const readPlace: ToolDef = {
  definition: {
    name: "read_place",
    description: "Read the pickup or delivery place: address, opening hours, the managed site's access and release rules, and the order-specific contact and access details with who stated them.",
    input_schema: {
      type: "object",
      properties: { boundary: { type: "string", enum: ["pickup", "delivery"] } },
      required: ["boundary"],
      additionalProperties: false,
    },
  },
  run(ctx, input) {
    const boundary = input.boundary === "delivery" ? "delivery" : "pickup"
    const addressId = boundary === "pickup" ? ctx.bundle.order.pickupAddressId : ctx.bundle.order.deliveryAddressId
    const siteId = boundary === "pickup" ? ctx.bundle.order.pickupSiteId : ctx.bundle.order.deliverySiteId
    const address = ctx.w.get("addresses", addressId)
    const site = siteId ? ctx.w.get("sites", siteId) : undefined
    const details = related(ctx, "order_endpoint_details").filter((row) => s(row.boundary).toLowerCase() === boundary)
    const claims = related(ctx, "endpoint_claims")
    const ownedByCustomer = site && site.customer_id === ctx.bundle.order.details.customer_id
    const text = [
      `Address: ${json(address)}`,
      `Managed site profile: ${site ? json(site) : "none (one-off address)"}`,
      ownedByCustomer ? "NOTE: this site belongs to the paying customer. Do not message it; draft any message for a person to send." : "",
      `Order-specific contact and access:\n${lines(details, "none")}`,
      `Attributed claims about these details:\n${lines(claims, "none")}`,
    ].filter(Boolean).join("\n\n")
    return { content: text, step: { kind: "read", tool: "read_place", label: `Read the ${boundary} place and its rules`, refs: [addressId, ...(siteId ? [siteId] : []), ...details.map((row) => row.id)] } }
  },
}

const readHistory: ToolDef = {
  definition: {
    name: "read_history",
    description: "Read the order's event history, newest first: lifecycle changes, bookings, alerts raised and acknowledged, decisions. Not a complete audit log.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", description: "How many events, newest first. Default 25." } },
      additionalProperties: false,
    },
  },
  run(ctx, input) {
    const limit = typeof input.limit === "number" ? Math.max(1, Math.min(80, input.limit)) : 25
    const events = ctx.bundle.events.slice(0, limit)
    const text = events.length ? events.map((event) => {
      const view = describeEvent(event, ctx.bundle)
      return `[${event.id}] ${event.recordedAt} ${event.command} by ${s(event.details.actor_type)}:${s(event.details.actor_id)} · ${view.text}${view.detail ? ` (${view.detail})` : ""}`
    }).join("\n") : "No events."
    return { content: text, step: { kind: "read", tool: "read_history", label: `Read the last ${events.length} events in the history`, refs: events.slice(0, 4).map((event) => event.id) } }
  },
}

const findDrivers: ToolDef = {
  definition: {
    name: "find_drivers",
    description: "Look up drivers in the network who live in or near a city and whether their booked work overlaps a time. This shows booked work only; nobody has been asked, and a home city is not a current location.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City to search, e.g. Leipzig." },
        country: { type: "string", description: "Two-letter country code to widen the search, e.g. DE." },
        needed_from: { type: "string", description: "ISO time the driver would need to start." },
      },
      required: ["city"],
      additionalProperties: false,
    },
  },
  run(ctx, input) {
    const city = s(input.city).toLowerCase()
    const country = s(input.country).toUpperCase()
    const neededFrom = s(input.needed_from) || ctx.w.now
    const assignments = ctx.w.table("work_assignments").filter((row) => row.status === "ASSIGNED" || row.status === "IN_PROGRESS")
    const drivers = ctx.w.table("drivers").filter((row) => row.active !== false)
      .filter((row) => s(row.home_city).toLowerCase() === city || (country && s(row.home_country) === country))
      .slice(0, 12)
      .map((row) => {
        const booked = assignments.filter((assignment) => assignment.driver_id === row.id)
        return {
          driver_id: row.id, name: row.display_name, home: `${s(row.home_city)}, ${s(row.home_country)}`,
          booked_work: booked.map((assignment) => ({ assignment_id: assignment.id, order_id: assignment.order_id, status: assignment.status })),
          note: booked.length ? "Has booked work; check timing before asking." : `No booked work in the records around ${neededFrom}. Availability not asked.`,
        }
      })
    const text = drivers.length ? lines(drivers, "") : `No drivers recorded in ${input.city}${country ? ` or ${country}` : ""}.`
    return { content: text, step: { kind: "read", tool: "find_drivers", label: `Looked up drivers near ${s(input.city)}: ${drivers.length} found`, refs: drivers.map((row) => row.driver_id).slice(0, 5) } }
  },
}

// Simulated provider lookups. The packet has no live ferry or recovery systems, so
// these return made-up but stable quotes, clearly labelled. They never book.

function seeded(text: string): () => number {
  let hash = 2166136261
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return () => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507)
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
    return ((hash ^= hash >>> 16) >>> 0) / 4294967296
  }
}

const checkSailings: ToolDef = {
  definition: {
    name: "check_sailings",
    description: "Check vehicle space on later ferry sailings for this order's crossing. Returns recorded quotes plus simulated live checks from the carrier desk. Quotes only: nothing is held or booked.",
    input_schema: {
      type: "object",
      properties: {
        earliest_departure: { type: "string", description: "ISO time; sailings at or after this." },
        route: { type: "string", description: "Optional route label, e.g. 'DE to FI vehicle crossing'." },
      },
      required: ["earliest_departure"],
      additionalProperties: false,
    },
  },
  run(ctx, input) {
    const from = s(input.earliest_departure) || ctx.w.now
    const booked = related(ctx, "travel_reservations").find((row) => row.kind === "FERRY")
    const recorded = related(ctx, "travel_options").filter((row) => row.kind === "FERRY" && s(row.departure_at) >= from)
    const random = seeded(`${ctx.orderId}:${from.slice(0, 13)}`)
    const base = new Date(from).getTime()
    const route = s(input.route) || s(booked?.route_label) || "vehicle crossing"
    const simulated = [0, 1, 2].map((index) => {
      const departure = new Date(Math.ceil((base + (index * 10 + 4 + Math.floor(random() * 4)) * 3600_000) / 1800_000) * 1800_000)
      const full = random() < 0.3
      return {
        id: `sim-sailing-${ctx.orderId}-${index}`, kind: "FERRY", provider: s(booked?.carrier) || "Vela Coast Lines", route,
        departure_at: departure.toISOString(),
        check_in_cutoff_at: new Date(departure.getTime() - 90 * 60_000).toISOString(),
        arrival_at: new Date(departure.getTime() + (17 + Math.floor(random() * 6)) * 3600_000).toISOString(),
        vehicle_space: full ? "FULL" : "AVAILABLE_TO_QUOTE",
        quote_eur: full ? null : 300 + Math.round(random() * 18) * 10,
        cabin_for_driver: full ? null : random() < 0.6 ? "available" : "seat only",
        source: "SIMULATED carrier desk check (demo). Not a booking.",
        checked_at: ctx.w.now,
      }
    })
    const text = [`Currently booked crossing: ${booked ? json(booked) : "none"}`, `Recorded quotes after ${from}:\n${lines(recorded, "none")}`, `Live checks now:\n${lines(simulated, "none")}`].join("\n\n")
    const open = simulated.filter((row) => row.vehicle_space !== "FULL").length
    return { content: text, step: { kind: "read", tool: "check_sailings", label: `Checked later sailings: ${open} of ${simulated.length} with vehicle space (quotes only)`, refs: recorded.map((row) => row.id) } }
  },
}

const findRecovery: ToolDef = {
  definition: {
    name: "find_recovery_options",
    description: "Look up roadside assistance and recovery options near a reported stop. Simulated partner directory: prices and arrival times are estimates, nothing is ordered. The car owner decides on recovery for their car.",
    input_schema: {
      type: "object",
      properties: { location: { type: "string", description: "Where the car is, as reported, e.g. 'A9 service area north of Nuremberg'." } },
      required: ["location"],
      additionalProperties: false,
    },
  },
  run(ctx, input) {
    const random = seeded(`${ctx.orderId}:${s(input.location)}`)
    const options = [
      { id: "sim-recovery-mobile", kind: "MOBILE_DIAGNOSIS", provider: "Kestrel Roadside (fictional partner)", eta_minutes: 45 + Math.round(random() * 30), estimate_eur: 140 + Math.round(random() * 6) * 10, note: "Technician reads the fault at the roadside. Cannot fix most drivetrain faults on site." },
      { id: "sim-recovery-tow-local", kind: "TOW_TO_NEAREST_DEALER", provider: "Hollerbach Recovery (fictional partner)", eta_minutes: 70 + Math.round(random() * 40), estimate_eur: 290 + Math.round(random() * 12) * 10, note: "Covered transporter to the nearest brand workshop; car stays there for diagnosis." },
      { id: "sim-recovery-transporter", kind: "TRANSPORTER_TO_DESTINATION", provider: "Nordwerk Transporte (fictional partner)", eta_minutes: 180 + Math.round(random() * 90), estimate_eur: 900 + Math.round(random() * 30) * 10, note: "Enclosed transporter all the way to the delivery address. Usually next-day arrival." },
    ]
    const text = `Location as reported (unverified): ${s(input.location)}\nOptions (SIMULATED estimates, nothing ordered; the owner's own roadside cover may apply instead):\n${lines(options, "none")}`
    return { content: text, step: { kind: "read", tool: "find_recovery_options", label: "Looked up recovery options near the stop (estimates only)", refs: [] } }
  },
}

// ---------------------------------------------------------------- ask tools

function driverThread(ctx: ToolContext, driverId: string): { id: string; created: boolean } {
  const threads = ctx.bundle.conversations.filter((thread) => thread.status === "OPEN")
  const withDriver = threads.find((thread) => thread.details.counterparty_id === driverId)
    ?? threads.find((thread) => ctx.bundle.messages.some((message) => message.conversationId === thread.id && (message.details.author_id === driverId || message.details.recipient_id === driverId)))
  if (withDriver) return { id: withDriver.id, created: false }
  return { id: "", created: true }
}

const messageDriver: ToolDef = {
  definition: {
    name: "message_driver",
    description: "Send the assigned driver a message in the driver app. Use it for facts only the driver has: safety, exact location, what they see, their ETA, whether they can take a change. Put all your questions in one short message. Their reply comes back to you later; end your turn after asking.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The message, in plain friendly English, at most 4 sentences." },
        why: { type: "string", description: "One line for the operator: what you need to learn." },
      },
      required: ["text", "why"],
      additionalProperties: false,
    },
  },
  run(ctx, input) {
    if (!ctx.permissions.askDriversAndSites) {
      return { content: "Not allowed: operations has turned off messaging drivers without approval. Put the question in a proposal instead.", isError: true, step: { kind: "error", tool: "message_driver", label: "Wanted to message the driver, but that needs approval right now" } }
    }
    const assignment = currentAssignment(ctx)
    const driverId = assignment ? s(assignment.driver_id) : ""
    if (!driverId) return { content: "There is no driver assigned to this order.", isError: true, step: { kind: "error", tool: "message_driver", label: "No driver assigned to message" } }
    const text = s(input.text).trim()
    const { messageId, conversationId } = ctx.write((state) => {
      let { id: conversationId, created } = driverThread(ctx, driverId)
      if (created) {
        conversationId = nextId(state, "conv")
        addRow(state, "conversations", {
          id: conversationId, order_id: ctx.orderId, assignment_id: assignment?.id ?? null, category: "on_the_road", channel: "driver_chat",
          counterparty_id: driverId, counterparty_type: "driver", started_at: ctx.w.now, updated_at: ctx.w.now, status: "OPEN",
        })
      } else {
        patchRow(state, "conversations", conversationId, { updated_at: ctx.w.now })
      }
      const messageId = nextId(state, "msg")
      addRow(state, "messages", {
        id: messageId, order_id: ctx.orderId, conversation_id: conversationId, author_id: "journey-agent", author_type: "agent",
        recipient_id: driverId, recipient_type: "driver", channel: "driver_chat", visibility: "PUBLIC", language: "en",
        body: text, authored_at: ctx.w.now,
      })
      return { messageId, conversationId }
    })
    ctx.onAsked("driver", conversationId, driverId)
    const name = ctx.bundle.dir.driverName(driverId) ?? "the driver"
    return {
      content: `Sent to ${name} as ${messageId} at ${ctx.w.now}. Their reply will arrive as a new message. End your turn now unless there is other reading to do first.`,
      step: { kind: "ask", tool: "message_driver", label: `Asked ${name}: ${s(input.why)}`, detail: text, refs: [messageId] },
      status: "waiting_driver",
      statusText: `Asked ${name} ${lowerFirst(s(input.why))}`,
    }
  },
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text
}

const messageSite: ToolDef = {
  definition: {
    name: "message_site",
    description: "Message the pickup or delivery site contact (a dealer desk, yard or private handoff contact) about access, keys, release or receiving. Refused when the site belongs to the paying customer: then draft the message in a proposal instead.",
    input_schema: {
      type: "object",
      properties: {
        boundary: { type: "string", enum: ["pickup", "delivery"] },
        text: { type: "string", description: "The message, plain and polite, at most 4 sentences." },
        why: { type: "string", description: "One line for the operator: what you need to learn." },
      },
      required: ["boundary", "text", "why"],
      additionalProperties: false,
    },
  },
  run(ctx, input) {
    if (!ctx.permissions.askDriversAndSites) {
      return { content: "Not allowed: messaging sites needs approval right now. Put the question in a proposal.", isError: true, step: { kind: "error", tool: "message_site", label: "Wanted to message the site, but that needs approval right now" } }
    }
    const boundary = input.boundary === "delivery" ? "delivery" : "pickup"
    const siteId = boundary === "pickup" ? ctx.bundle.order.pickupSiteId : ctx.bundle.order.deliverySiteId
    const site = siteId ? ctx.w.get("sites", siteId) : undefined
    if (site && site.customer_id === ctx.bundle.order.details.customer_id) {
      return {
        content: `Refused: ${s(site.name)} belongs to the paying customer (${s(site.customer_id)}). The agent never contacts a customer. Draft this message in propose_decision as customer_message so a person can send it.`,
        isError: true,
        step: { kind: "error", tool: "message_site", label: `Did not message ${s(site.name)}: it is the customer's own site` },
      }
    }
    const detail = related(ctx, "order_endpoint_details").find((row) => s(row.boundary).toLowerCase() === boundary)
    const recipientId = siteId ?? detail?.id ?? ""
    const recipientType = siteId ? "site_contact" : "handoff_contact"
    if (!recipientId) return { content: "No contact is recorded for that place.", isError: true, step: { kind: "error", tool: "message_site", label: "No site contact recorded" } }
    const text = s(input.text).trim()
    const { messageId, conversationId } = ctx.write((state) => {
      const existing = ctx.bundle.conversations.find((thread) => thread.status === "OPEN" && thread.details.counterparty_id === recipientId)
      let conversationId = existing?.id ?? ""
      if (!existing) {
        conversationId = nextId(state, "conv")
        addRow(state, "conversations", {
          id: conversationId, order_id: ctx.orderId, assignment_id: null, category: boundary === "pickup" ? "pickup_and_release" : "delivery_access", channel: "site_email",
          counterparty_id: recipientId, counterparty_type: recipientType, started_at: ctx.w.now, updated_at: ctx.w.now, status: "OPEN",
        })
      } else {
        patchRow(state, "conversations", conversationId, { updated_at: ctx.w.now })
      }
      const messageId = nextId(state, "msg")
      addRow(state, "messages", {
        id: messageId, order_id: ctx.orderId, conversation_id: conversationId, author_id: "journey-agent", author_type: "agent",
        recipient_id: recipientId, recipient_type: recipientType, channel: "site_email", visibility: "PUBLIC", language: "en",
        body: text, authored_at: ctx.w.now,
      })
      return { messageId, conversationId }
    })
    ctx.onAsked("site", conversationId, recipientId)
    const name = ctx.bundle.dir.resolve(recipientId, recipientType).name
    return {
      content: `Sent to ${name} as ${messageId}. Their reply will arrive as a new message. End your turn now unless there is other reading to do first.`,
      step: { kind: "ask", tool: "message_site", label: `Asked ${name}: ${s(input.why)}`, detail: text, refs: [messageId] },
      status: "waiting_site",
      statusText: `Asked ${name} ${lowerFirst(s(input.why))}`,
    }
  },
}

// ---------------------------------------------------------------- decide tools

const addNote: ToolDef = {
  definition: {
    name: "add_note",
    description: "Write an internal note on the case for operations: a finding worth keeping, with the records it rests on. Operators only; nobody outside Bahn sees it.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        evidence: { type: "array", items: { type: "string" }, description: "Record ids the note rests on." },
      },
      required: ["text", "evidence"],
      additionalProperties: false,
    },
  },
  run(ctx, input) {
    const text = s(input.text).trim()
    const evidence = Array.isArray(input.evidence) ? input.evidence.map(String) : []
    const id = ctx.write((state) => {
      const id = nextId(state, "note")
      addRow(state, "order_notes", { id, order_id: ctx.orderId, author_id: "journey-agent", author_type: "agent", body: text, created_at: ctx.w.now, visibility: "INTERNAL", evidence_refs: evidence })
      return id
    })
    return { content: `Noted as ${id}.`, step: { kind: "note", tool: "add_note", label: "Wrote a note for operations", detail: text, refs: [id, ...evidence] } }
  },
}

const CHANGE_KINDS = ["delivery_promise", "booking", "cost", "customer_message", "driver_instruction", "assignment", "other"]

const proposeDecision: ToolDef = {
  definition: {
    name: "propose_decision",
    description: "Hand a person one clear decision. Use when the next step needs a yes: changing a booking, a date or promise, a cost, a driver assignment, or messaging the customer. Write for a busy operator who has not read the case. Nothing in the proposal happens until they approve; they can edit or reject it.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What is wrong and what needs deciding, at most 12 words. E.g. 'Bentley stopped with a red warning: owner must choose tow or roadside help'." },
        situation: { type: "string", description: "2 to 4 short sentences of facts, each with who said it and when (local time). Separate verified facts from claims." },
        recommendation: { type: "string", description: "What you recommend and why, 1 to 3 sentences." },
        changes: {
          type: "array",
          description: "Exactly what would change if the person approves. Empty when the decision is only to make a call.",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: CHANGE_KINDS },
              summary: { type: "string", description: "One line: what changes, from what to what." },
              detail: { type: "string", description: "Amounts, references, times; empty string if none." },
            },
            required: ["kind", "summary", "detail"],
            additionalProperties: false,
          },
        },
        customer_message: { type: "string", description: "Draft message for a person to send to the customer, or empty string if none is needed." },
        driver_message: { type: "string", description: "Message you will send the driver once approved, or empty string." },
        alternatives: { type: "array", items: { type: "string" }, description: "Other options the person could choose, one line each." },
        open_questions: { type: "array", items: { type: "string" }, description: "What is still unknown and matters." },
        urgency: { type: "string", enum: ["now", "today", "can_wait"] },
        after_approval: { type: "string", description: "What you will do next once the person approves, one sentence." },
        evidence: { type: "array", items: { type: "string" }, description: "Record ids that support the proposal: messages, alerts, tracking, bookings, quotes." },
      },
      required: ["title", "situation", "recommendation", "changes", "customer_message", "driver_message", "alternatives", "open_questions", "urgency", "after_approval", "evidence"],
      additionalProperties: false,
    },
  },
  run(ctx, input) {
    const payload: JourneyProposalPayload = {
      title: s(input.title).trim(),
      situation: s(input.situation).trim(),
      recommendation: s(input.recommendation).trim(),
      changes: (Array.isArray(input.changes) ? input.changes : []).map((change) => {
        const row = change as Record<string, unknown>
        const kind = CHANGE_KINDS.includes(s(row.kind)) ? s(row.kind) : "other"
        return { kind: kind as JourneyProposalPayload["changes"][number]["kind"], summary: s(row.summary), detail: s(row.detail) || undefined }
      }),
      customer_message: s(input.customer_message).trim() || null,
      driver_message: s(input.driver_message).trim() || null,
      alternatives: (Array.isArray(input.alternatives) ? input.alternatives : []).map(String).filter(Boolean),
      open_questions: (Array.isArray(input.open_questions) ? input.open_questions : []).map(String).filter(Boolean),
      urgency: (["now", "today", "can_wait"].includes(s(input.urgency)) ? s(input.urgency) : "today") as JourneyProposalPayload["urgency"],
      after_approval: s(input.after_approval).trim(),
    }
    const evidence = (Array.isArray(input.evidence) ? input.evidence.map(String) : []).filter((id) => !!ctx.w.find(id) || id.startsWith("sim-"))
    const id = ctx.write((state) => {
      const id = nextId(state, "agent")
      // A newer proposal replaces an older pending one; the older stays in history.
      for (const row of related(ctx, "agent_proposals")) {
        if (row.proposed_by_agent_id === "journey-agent" && row.status === "PENDING_REVIEW") {
          patchRow(state, "agent_proposals", row.id, { status: "SUPERSEDED", superseded_at: ctx.w.now, superseded_by_proposal_id: id })
        }
      }
      addRow(state, "agent_proposals", {
        id, order_id: ctx.orderId, alert_id: ctx.bundle.alerts.find((alert) => alert.status !== "RESOLVED")?.id ?? null,
        command: "journey.decision", created_at: ctx.w.now, proposed_by_agent_id: "journey-agent", status: "PENDING_REVIEW",
        summary: payload.title, rationale: payload.recommendation, proposed_payload: payload,
        evidence_refs: evidence.map((ref) => ({ id: ref, table: ctx.w.find(ref)?.collection ?? "simulated" })),
        dependency: { checked_at: ctx.w.now, execution_policy: "RECHECK_CURRENT_STATE_BEFORE_WRITE" },
        target_id: ctx.orderId, target_type: "order", review: null, execution: null, superseded_at: null, superseded_by_proposal_id: null,
      })
      addRow(state, "operational_events", {
        id: nextId(state, "evt"), order_id: ctx.orderId, command: "agent.proposal_created", target_type: "agent_proposal", target_id: id,
        recorded_at: ctx.w.now, actor_type: "agent", actor_id: "journey-agent", source: "CONTROL_ROOM", changes: { title: payload.title, urgency: payload.urgency },
      })
      return id
    })
    return {
      content: `Proposal ${id} is with a person. Now call finish with outcome needs_person and a short briefing.`,
      step: { kind: "proposal", tool: "propose_decision", label: `Brought a decision to a person: ${payload.title}`, detail: payload.recommendation, refs: [id, ...evidence] },
      status: "needs_person",
      statusText: "Waiting for your decision",
      proposalId: id,
    }
  },
}

const closeTrackingAlert: ToolDef = {
  definition: {
    name: "close_tracking_alert",
    description: "Close an open tracking-gap alert after the driver has confirmed, in a message newer than the alert, where they are and that the car is moving to plan. Only for TRACKING_GAP alerts, and only when the case message says operations granted this permission. It changes no booking, date or cost.",
    input_schema: {
      type: "object",
      properties: {
        alert_id: { type: "string" },
        driver_message_id: { type: "string", description: "The driver's confirming message, newer than the alert." },
        reason: { type: "string" },
      },
      required: ["alert_id", "driver_message_id", "reason"],
      additionalProperties: false,
    },
  },
  run(ctx, input) {
    if (!ctx.permissions.closeStaleTrackingAlerts) {
      return { content: "Not permitted: operations has not given the agent this permission. Say in your briefing that the alert can be closed, with the driver message as evidence.", isError: true, step: { kind: "error", tool: "close_tracking_alert", label: "Could close the tracking alert, but that still needs a person" } }
    }
    const alert = ctx.bundle.alerts.find((row) => row.id === s(input.alert_id))
    const message = ctx.bundle.messages.find((row) => row.id === s(input.driver_message_id))
    if (!alert || alert.signal !== "TRACKING_GAP" || alert.status === "RESOLVED") return { content: "That is not an open tracking-gap alert on this order.", isError: true, step: { kind: "error", tool: "close_tracking_alert", label: "Tried to close an alert it may not close" } }
    if (!message || message.authorType !== "driver" || message.authoredAt <= alert.triggeredAt) return { content: "Needs a driver message newer than the alert.", isError: true, step: { kind: "error", tool: "close_tracking_alert", label: "Could not close the tracking alert: no newer driver confirmation" } }
    ctx.write((state) => {
      patchRow(state, "alerts", alert.id, { status: "RESOLVED", resolved_at: ctx.w.now, resolution_reason: s(input.reason), resolved_by: "journey-agent", resolution_evidence: [message.id] })
      addRow(state, "operational_events", {
        id: nextId(state, "evt"), order_id: ctx.orderId, command: "alert.resolved", target_type: "alert", target_id: alert.id,
        recorded_at: ctx.w.now, actor_type: "agent", actor_id: "journey-agent", source: "CONTROL_ROOM", changes: { basis_message_id: message.id, permission: "closeStaleTrackingAlerts" },
      })
    })
    return { content: `Closed ${alert.id}.`, step: { kind: "action", tool: "close_tracking_alert", label: "Closed the tracking alert after the driver confirmed their position", detail: s(input.reason), refs: [alert.id, message.id] } }
  },
}

const holdSailing: ToolDef = {
  definition: {
    name: "hold_sailing",
    description: "Hold vehicle space on one quoted ferry sailing for 2 hours so it does not sell out while a person decides. A hold is free, expires on its own and is not a booking: nothing is paid and the booked crossing stays as it is. Only when the case message says operations granted this permission; otherwise mention the sailing in your proposal.",
    input_schema: {
      type: "object",
      properties: {
        departure_at: { type: "string", description: "ISO departure time of the sailing, from check_sailings or read_travel." },
        provider: { type: "string" },
        quote_eur: { type: "number", description: "The quoted price, if known." },
        reason: { type: "string" },
      },
      required: ["departure_at", "provider", "reason"],
      additionalProperties: false,
    },
  },
  run(ctx, input) {
    if (!ctx.permissions.holdTravel) {
      return { content: "Not permitted: operations has not given the agent this permission. Name the sailing in your proposal instead.", isError: true, step: { kind: "error", tool: "hold_sailing", label: "Could hold a sailing, but that still needs a person" } }
    }
    const departure = s(input.departure_at)
    if (!departure || Number.isNaN(new Date(departure).getTime()) || departure <= ctx.w.now) return { content: "Give the departure time of a sailing that has not left yet.", isError: true, step: { kind: "error", tool: "hold_sailing", label: "Tried to hold a sailing without a valid departure" } }
    const expires = new Date(new Date(ctx.w.now).getTime() + 2 * 3600_000).toISOString()
    const quote = typeof input.quote_eur === "number" ? Math.round(input.quote_eur * 100) : null
    const id = ctx.write((state) => {
      const holdId = nextId(state, "travel")
      addRow(state, "travel_options", {
        id: holdId, order_id: ctx.orderId, kind: "FERRY", provider: s(input.provider), departure_at: departure, checked_at: ctx.w.now,
        status: "HELD", hold_expires_at: expires, quote_cents: quote, currency: "EUR", capacity_note: "Vehicle slot held for 2 hours, not booked (simulated)", simulated: true,
      })
      addRow(state, "operational_events", {
        id: nextId(state, "evt"), order_id: ctx.orderId, command: "travel.hold_placed", target_type: "travel_option", target_id: holdId,
        recorded_at: ctx.w.now, actor_type: "agent", actor_id: "journey-agent", source: "CONTROL_ROOM", changes: { expires_at: expires, permission: "holdTravel", reason: s(input.reason) },
      })
      return holdId
    })
    return { content: `Held ${id} until ${expires}. It is not a booking; a person still decides.`, step: { kind: "action", tool: "hold_sailing", label: `Held the ${fmtDateTime(departure, null)} sailing for 2 hours (not booked)`, detail: s(input.reason), refs: [id] } }
  },
}

const finish: ToolDef = {
  definition: {
    name: "finish",
    description: "End this piece of work with a short briefing for the operator who opens the case. Call it last, every time.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["needs_person", "waiting_on_reply", "no_action_needed"], description: "needs_person: a proposal or call is waiting on a person. waiting_on_reply: you asked the driver or a site. no_action_needed: the records show nothing for a person to do now." },
        briefing: { type: "string", description: "2 to 4 sentences: what is going on, what you checked, what happens next. Plain words, local times." },
        status_line: { type: "string", description: "At most 10 words for the queue, e.g. 'Driver safe; owner must choose recovery'." },
      },
      required: ["outcome", "briefing", "status_line"],
      additionalProperties: false,
    },
  },
  run(_ctx, input) {
    const outcome = s(input.outcome)
    const status: RunStatus = outcome === "needs_person" ? "needs_person" : outcome === "waiting_on_reply" ? "waiting_driver" : "done"
    return {
      content: "Done.",
      step: { kind: "finish", tool: "finish", label: s(input.status_line) || "Finished", detail: s(input.briefing) },
      status, statusText: s(input.status_line), briefing: s(input.briefing),
    }
  },
}

// One fixed list, in a fixed order: the prompt cache and a resumed conversation
// both depend on the tools staying the same. Permissions are checked inside each
// tool, so turning one off takes effect on the next call without a new list.
export const TOOLS: ToolDef[] = [readCase, readMessages, readTracking, readTravel, readPlace, readHistory, findDrivers, checkSailings, findRecovery, messageDriver, messageSite, addNote, proposeDecision, closeTrackingAlert, holdSailing, finish]

export type { ToolDef }
