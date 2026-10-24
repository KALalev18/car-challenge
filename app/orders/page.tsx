"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { LANES } from "@/lib/present/labels"
import type { Bucket } from "@/lib/triage"
import { Icon } from "../components/icons"
import { useQueue } from "../components/live"
import { when } from "../components/worklist"

const BUCKETS: { key: Bucket | "all"; label: string }[] = [
  { key: "all", label: "All" }, { key: "decide", label: "Needs you" }, { key: "agent", label: "With the agent" },
  { key: "watch", label: "Waiting on others" }, { key: "quiet", label: "On track" },
]
const BUCKET_TEXT: Record<Bucket, string> = { decide: "Needs you", agent: "With the agent", watch: "Waiting", quiet: "On track" }

export default function OrdersPage() {
  const router = useRouter()
  const { queue } = useQueue()
  const [bucket, setBucket] = useState<Bucket | "all">("all")
  const [lane, setLane] = useState<string>("all")
  const [query, setQuery] = useState("")
  const rows = useMemo(() => (queue?.items ?? []).filter((item) =>
    (bucket === "all" || item.bucket === bucket) && (lane === "all" || item.lane === lane)
    && (!query || `${item.reference} ${item.vehicle} ${item.customer} ${item.from} ${item.to} ${item.plate ?? ""} ${item.driver ?? ""}`.toLowerCase().includes(query.toLowerCase()))), [queue, bucket, lane, query])
  return <div className="page-scroll"><main className="page">
    <div className="page-head">
      <div>
        <h1 className="page-title">All orders</h1>
        <p className="page-sub">{queue ? `${queue.items.length} orders in the snapshot. Sorted by who needs to act, then by the next deadline.` : "Loading the snapshot"}</p>
      </div>
      <label className="search" style={{ width: 320, flex: "none" }}>
        <Icon name="search" size={15} /><span className="sr-only">Search</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Reference, car, customer, city, driver" />
      </label>
    </div>
    <div className="toolbar">
      <div className="seg" role="group" aria-label="Who acts">
        {BUCKETS.map((entry) => <button type="button" key={entry.key} aria-pressed={bucket === entry.key} onClick={() => setBucket(entry.key)}>
          {entry.label}<b>{entry.key === "all" ? queue?.items.length ?? "" : queue?.counts[entry.key] ?? ""}</b></button>)}
      </div>
      <div className="seg" role="group" aria-label="Stage">
        <button type="button" aria-pressed={lane === "all"} onClick={() => setLane("all")}>Every stage</button>
        {LANES.map(([key, label]) => <button type="button" key={key} aria-pressed={lane === key} onClick={() => setLane(key)}>{label}<b>{queue?.lanes.find((entry) => entry.lane === key)?.total ?? ""}</b></button>)}
      </div>
    </div>
    <div className="table-card">
      <table className="table">
        <thead><tr><th>Order</th><th>Route</th><th>Stage</th><th>Situation</th><th>Next deadline</th></tr></thead>
        <tbody>
          {!queue && [0, 1, 2, 3, 4].map((index) => <tr key={index}><td colSpan={5}><div className="skeleton" style={{ height: 34 }} /></td></tr>)}
          {queue && rows.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 28, textAlign: "center" }}>No orders match these filters.</td></tr>}
          {queue && rows.map((item) => {
            const due = when(item, queue.now)
            return <tr key={item.id} className="click" onClick={() => router.push(`/?case=${encodeURIComponent(item.id)}`)}>
              <td><div style={{ fontWeight: 600 }}>{item.vehicle}</div><div className="mono subtle" style={{ fontSize: 11.5 }}>{item.reference}{item.plate ? ` · ${item.plate}` : ""}</div></td>
              <td><div>{item.from} → {item.to}</div><div className="subtle" style={{ fontSize: 12 }}>{item.customer}</div></td>
              <td><div>{item.laneLabel}</div>{item.driver && <div className="subtle" style={{ fontSize: 12 }}>{item.driver}</div>}</td>
              <td><div style={{ display: "flex", alignItems: "baseline" }}><span className={`status-dot ${item.bucket}`} /><span style={{ fontSize: 12, fontWeight: 600 }}>{BUCKET_TEXT[item.bucket]}</span></div>{item.bucket !== "quiet" && <div className="why">{item.reason}</div>}</td>
              <td>{due ? <span className={`tone-${due.tone}`} style={{ fontSize: 12.5 }}>{due.text}</span> : <span className="subtle">—</span>}</td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
  </main></div>
}
