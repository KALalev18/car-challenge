"use client"

// The record behind a fact. Opens from any source chip or evidence link, so a
// person can check who said it, when, and exactly what the record holds.

import { useEffect, useState } from "react"
import type { Evidence } from "@/lib/case"
import { humanize } from "@/lib/present/labels"
import { fmtDateTime } from "@/lib/present/time"
import { Icon } from "./icons"

type Loaded = { collection: string; record: Record<string, unknown>; evidence: Evidence | null }

const COLLECTION: Record<string, string> = {
  messages: "Message", alerts: "Alert", incidents: "Incident", tracking_observations: "Driver-app signal", travel_reservations: "Booking",
  travel_options: "Quote", operational_events: "Event", work_items: "Owned work", agent_proposals: "Agent proposal", time_windows: "Time window",
  order_notes: "Note", work_assignments: "Driver assignment", order_endpoint_details: "Contact and access", conversations: "Conversation",
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return `${fmtDateTime(value, null)} (${value})`
    // Codes such as PENDING_CUSTOMER read as words; the raw code stays in the tooltip.
    if (/^[A-Z][A-Z0-9_]+$/.test(value)) return humanize(value)
    return value
  }
  if (typeof value === "number") return String(value)
  return JSON.stringify(value, null, 1)
}

export function SourceDrawer({ orderId, recordId, onClose }: { orderId: string; recordId: string; onClose: () => void }) {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    fetch(`/api/records/${encodeURIComponent(recordId)}?order=${encodeURIComponent(orderId)}`)
      .then((response) => { if (!response.ok) throw new Error("This record is not in the packet."); return response.json() as Promise<Loaded> })
      .then((loaded) => { if (alive) setData(loaded) })
      .catch((cause: unknown) => { if (alive) setError(cause instanceof Error ? cause.message : "Could not load") })
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => { alive = false; window.removeEventListener("keydown", onKey) }
  }, [orderId, recordId, onClose])

  const entries = data ? Object.entries(data.record).filter(([key]) => key !== "id") : []
  return <>
    <div className="scrim" onClick={onClose} />
    <aside className="drawer" role="dialog" aria-label="Source record">
      <div className="drawer-head">
        <div className="row1">
          <span className="chip sm">{data ? COLLECTION[data.collection] ?? humanize(data.collection) : "Source"}</span>
          <span className="mono subtle" style={{ fontSize: 11.5 }}>{recordId}</span>
          <button type="button" className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button>
        </div>
        {data?.evidence && <div className="drawer-title">{data.evidence.label}</div>}
        {data?.evidence && (data.evidence.who || data.evidence.at) && <div className="muted" style={{ fontSize: 12.5 }}>{[data.evidence.who, data.evidence.at ? fmtDateTime(data.evidence.at, null) : null].filter(Boolean).join(" · ")}</div>}
      </div>
      <div className="drawer-body">
        {error && <p className="muted">{error}</p>}
        {!data && !error && <><div className="skeleton" style={{ height: 70 }} /><div className="skeleton" style={{ height: 200 }} /></>}
        {data?.evidence?.excerpt && <blockquote className="drawer-quote">{data.evidence.excerpt}</blockquote>}
        {data && data.record.simulated === true && <div className="banner warn">Written by the demo&apos;s simulated person. Treat it like any reported claim.</div>}
        {data && <div>
          <div className="section-label" style={{ marginBottom: 8 }}>The record as stored<span className="line" /></div>
          <dl className="kv">
            {entries.map(([key, value]) => <div key={key} style={{ display: "contents" }}><dt>{humanize(key)}</dt><dd title={typeof value === "string" ? value : undefined} className={typeof value === "object" && value !== null ? "mono" : undefined} style={typeof value === "object" && value !== null ? { fontSize: 11.5, whiteSpace: "pre-wrap" } : undefined}>{show(value)}</dd></div>)}
          </dl>
        </div>}
      </div>
    </aside>
  </>
}
