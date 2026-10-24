// Builds the reading layer's bundles from the in-memory world instead of the
// starter's Postgres tables. The bundle shape is unchanged, so attention, dates,
// events and the record view work exactly as Bahn's starter wrote them.

import type { Rec } from "@/lib/data/dataset"
import { world, type World } from "@/lib/data/world"
import { Directory, snapshotNames } from "./actors"
import type { Bundle, ConversationRow, EventRow, MessageRow, PlaceRow, RelatedRow, SiteRow } from "./bundle"
import type { Row } from "./types"

const s = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value))
const strs = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])

// Collections the reading layer reads through `related`, like the starter's
// related_records table: every order-linked collection that is not a core table.
const ORDER_COLLECTIONS = [
  "time_windows", "tracking_observations", "work_assignments", "market_offers", "work_items", "agent_proposals",
  "order_endpoint_details", "transport_plans", "transport_points", "transport_segments", "incidents", "endpoint_claims",
  "custody_assets", "custody_asset_events", "custody_reports", "market_offer_exposures", "market_offer_reach_checks",
  "market_offer_demand_signals", "market_offer_demand_windows", "assignment_steps", "travel_confirmations",
  "travel_reservations", "travel_options", "proofs", "documents", "order_notes", "expenses", "site_visits",
  "internal_notifications", "ferry_terminal_events",
] as const

type Shared = {
  w: World
  places: Map<string, PlaceRow>
  sites: Map<string, SiteRow>
  inbox: RelatedRow[]
  refs: Map<string, string>
  /** Threads filed on another order that name this order as related. */
  linkedThreads: Map<string, Rec[]>
  messagesByThread: Map<string, Rec[]>
  /** Bundle offers filed on another order that cover this one. */
  memberOffers: Map<string, Rec[]>
  eventsByTarget: Map<string, Rec[]>
}

function groupBy(rows: Rec[], keys: (row: Rec) => string[]): Map<string, Rec[]> {
  const map = new Map<string, Rec[]>()
  for (const row of rows) for (const key of keys(row)) {
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  return map
}

const sharedCache = globalThis as unknown as { __bahnShared?: { key: string; shared: Omit<Shared, "w"> } }

function shared(): Shared {
  const w = world()
  // Bump the version when the cached shape changes, so a hot reload does not reuse an old one.
  const key = `v2:${w.snapshotAt}:${w.revision}:${w.table("orders").length}`
  if (sharedCache.__bahnShared?.key !== key || !sharedCache.__bahnShared) {
    const places = new Map<string, PlaceRow>(w.table("addresses").map((row) => [row.id, {
      id: row.id, name: s(row.name), city: s(row.city), country: s(row.country),
      managedSiteId: typeof row.managed_site_id === "string" ? row.managed_site_id : null, details: row,
    }]))
    const sites = new Map<string, SiteRow>(w.table("sites").map((row) => [row.id, {
      id: row.id, name: s(row.name), city: s(row.city), country: s(row.country), kind: s(row.kind), details: row,
    }]))
    const inbox = w.table("support_inbox_threads").map((row) => ({ id: row.id, details: row as Row }))
    const refs = new Map(w.table("orders").map((row) => [row.id, s(row.reference)]))
    const linkedThreads = groupBy(w.table("conversations"), (row) => strs(row.related_order_ids).filter((id) => id !== row.order_id))
    const messagesByThread = groupBy(w.table("messages"), (row) => [s(row.conversation_id)])
    for (const list of messagesByThread.values()) list.sort((a, b) => s(a.authored_at).localeCompare(s(b.authored_at)))
    const memberOffers = groupBy(w.table("market_offers"), (row) => strs(row.order_ids).filter((id) => id !== row.order_id))
    const eventsByTarget = groupBy(w.table("operational_events"), (row) => [s(row.target_id)])
    sharedCache.__bahnShared = { key, shared: { places, sites, inbox, refs, linkedThreads, messagesByThread, memberOffers, eventsByTarget } }
  }
  return { w, ...sharedCache.__bahnShared.shared }
}

export function makeDirectory(w: World, snapshots?: Map<string, string>): Directory {
  return new Directory({
    drivers: w.table("drivers").map((row) => ({ id: row.id, displayName: s(row.display_name), homeCity: s(row.home_city), homeCountry: s(row.home_country) })),
    operators: w.table("operators") as Row[],
    agents: w.table("agents") as Row[],
    customers: w.table("customers").map((row) => ({ id: row.id, name: s(row.name) })),
    sites: w.table("sites").map((row) => ({ id: row.id, name: s(row.name) })),
    endpointDetails: w.table("order_endpoint_details") as Row[],
    snapshots,
  })
}

function threadsFor(sh: Shared, orderId: string): Rec[] {
  const filed = sh.w.forOrder("conversations", orderId)
  const linked = sh.linkedThreads.get(orderId) ?? []
  return [...filed, ...linked].sort((a, b) => s(b.updated_at).localeCompare(s(a.updated_at)))
}

function inboxFor(sh: Shared, orderId: string): RelatedRow[] {
  return sh.inbox.filter((thread) => strs(thread.details.candidate_order_ids).includes(orderId) || strs(thread.details.linked_order_ids).includes(orderId))
}

/** Every record linked to one order, in the bundle shape the reading layer expects. */
export function loadBundle(orderId: string): Bundle | null {
  const sh = shared()
  const { w } = sh
  const order = w.get("orders", orderId)
  if (!order) return null
  const customer = w.get("customers", s(order.customer_id))

  const related: Record<string, RelatedRow[]> = {}
  for (const collection of ORDER_COLLECTIONS) {
    const rows = w.forOrder(collection, orderId)
    if (rows.length) related[collection] = rows.map((row) => ({ id: row.id, details: row as Row }))
  }
  // A bundle offer covers several orders but is filed on one. Show it on each member.
  const memberBundles = sh.memberOffers.get(orderId) ?? []
  if (memberBundles.length) related.market_offers = [...(related.market_offers ?? []), ...memberBundles.map((row) => ({ id: row.id, details: row as Row }))]

  const threads = threadsFor(sh, orderId)
  const messages = threads.flatMap((thread) => sh.messagesByThread.get(thread.id) ?? [])
    .sort((a, b) => s(a.authored_at).localeCompare(s(b.authored_at)))
  const sharedEvents = memberBundles.flatMap((offer) => (sh.eventsByTarget.get(offer.id) ?? []).filter((row) => row.order_id !== orderId))
  const events = [...w.forOrder("operational_events", orderId), ...sharedEvents]
    .sort((a, b) => s(b.recorded_at).localeCompare(s(a.recorded_at)))

  const linked = new Set<string>()
  for (const row of related.market_offers ?? []) for (const id of strs(row.details.order_ids)) linked.add(id)
  for (const row of related.work_assignments ?? []) {
    const positioning = row.details.positioning as Row | undefined
    if (positioning && typeof positioning.previous_order_id === "string") linked.add(positioning.previous_order_id)
  }
  for (const row of related.custody_assets ?? []) if (typeof row.details.related_order_id === "string") linked.add(row.details.related_order_id)
  for (const thread of threads) {
    for (const id of strs(thread.related_order_ids)) linked.add(id)
    if (thread.order_id !== orderId) linked.add(s(thread.order_id))
  }
  const inboxThreads = inboxFor(sh, orderId)
  for (const thread of inboxThreads) for (const key of ["candidate_order_ids", "linked_order_ids"]) for (const id of strs(thread.details[key])) linked.add(id)
  const bundleOrderRefs = Object.fromEntries([...linked].filter((id) => sh.refs.has(id)).map((id) => [id, sh.refs.get(id)!]))

  return {
    snapshotAt: w.snapshotAt,
    order: {
      id: order.id, reference: s(order.reference), lane: s(order.display_lane), status: s(order.status), routeKind: s(order.route_kind),
      createdAt: s(order.created_at), updatedAt: s(order.updated_at), details: order as Row,
      pickupAddressId: s(order.pickup_address_id), deliveryAddressId: s(order.delivery_address_id),
      pickupSiteId: typeof order.pickup_site_id === "string" ? order.pickup_site_id : null,
      deliverySiteId: typeof order.delivery_site_id === "string" ? order.delivery_site_id : null,
    },
    customer: {
      id: customer?.id ?? s(order.customer_id), name: customer ? s(customer.name) : "Unknown customer",
      tier: customer ? s(customer.account_tier) || null : null, country: customer ? s(customer.country) || null : null,
    },
    items: w.forOrder("order_items", orderId).map((item) => {
      const vehicle = w.get("vehicles", s(item.vehicle_id))
      return {
        id: item.id, role: s(item.role), details: item as Row,
        vehicle: {
          id: vehicle?.id ?? s(item.vehicle_id), make: s(vehicle?.make), model: s(vehicle?.model),
          year: typeof vehicle?.model_year === "number" ? vehicle.model_year : null, fuel: vehicle ? s(vehicle.fuel) || null : null,
          registration: typeof vehicle?.registration === "string" ? vehicle.registration : null,
          vin: typeof vehicle?.synthetic_vin === "string" ? vehicle.synthetic_vin : null,
        },
      }
    }),
    alerts: w.forOrder("alerts", orderId).map((row) => ({
      id: row.id, status: s(row.status), severity: s(row.severity), signal: s(row.signal), summary: s(row.summary), triggeredAt: s(row.triggered_at), details: row as Row,
    })).sort((a, b) => b.triggeredAt.localeCompare(a.triggeredAt)),
    conversations: threads.map((row): ConversationRow => ({
      id: row.id, orderId: s(row.order_id), status: s(row.status), category: s(row.category), channel: s(row.channel), updatedAt: s(row.updated_at), details: row as Row,
    })),
    messages: messages.map((row): MessageRow => ({
      id: row.id, orderId: s(row.order_id), conversationId: s(row.conversation_id), authorType: s(row.author_type), body: s(row.body), authoredAt: s(row.authored_at), details: row as Row,
    })),
    events: events.map((row): EventRow => ({
      id: row.id, orderId: s(row.order_id), command: s(row.command), targetType: s(row.target_type), targetId: s(row.target_id), recordedAt: s(row.recorded_at), details: row as Row,
    })),
    related,
    places: sh.places,
    sites: sh.sites,
    dir: makeDirectory(w, snapshotNames(messages.map((row) => ({ details: row as Row })))),
    inboxThreads,
    bundleOrderRefs,
  }
}

export function loadAllBundles(): Bundle[] {
  const w = world()
  return w.table("orders").map((order) => loadBundle(order.id)).filter((bundle): bundle is Bundle => !!bundle)
}

export function orderRefs(ids: Iterable<string>): Record<string, string> {
  const sh = shared()
  return Object.fromEntries([...new Set(ids)].filter((id) => sh.refs.has(id)).map((id) => [id, sh.refs.get(id)!]))
}
