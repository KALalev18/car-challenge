"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { relativeTo } from "@/lib/present/time"
import type { Bucket, TriageItem } from "@/lib/triage"
import { Icon } from "./icons"
import { post, useQueue, type QueueData } from "./live"

const GROUPS: { bucket: Bucket; title: string; hint: string }[] = [
  { bucket: "decide", title: "Needs you", hint: "A decision is waiting" },
  { bucket: "agent", title: "Agent is on it", hint: "Comes back when it needs a yes" },
  { bucket: "watch", title: "Waiting on others", hint: "Owned, or waiting on a reply" },
]

const WATCH_PREVIEW = 6

function matches(item: TriageItem, query: string): boolean {
  if (!query) return true
  const hay = `${item.reference} ${item.vehicle} ${item.plate ?? ""} ${item.customer} ${item.from} ${item.to} ${item.driver ?? ""} ${item.reason}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).every((word) => hay.includes(word))
}

export function when(item: TriageItem, now: string): { text: string; tone: string } | null {
  if (!item.deadline) return null
  const rel = relativeTo(item.deadline.at, now)
  const label = item.deadline.label
  if (!rel) return { text: `${label} ${item.deadline.text}`, tone: item.deadline.tone }
  return { text: `${label} ${rel.text}`, tone: item.deadline.tone }
}

export function Worklist({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const { queue, error, reload } = useQueue()
  const [query, setQuery] = useState("")
  const [showAllWatch, setShowAllWatch] = useState(false)
  const [showQuiet, setShowQuiet] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const items = useMemo(() => (queue?.items ?? []).filter((item) => matches(item, query)), [queue, query])
  const visibleOrder = useMemo(() => {
    const groups = GROUPS.flatMap((group) => {
      const list = items.filter((item) => item.bucket === group.bucket)
      return group.bucket === "watch" && !showAllWatch && !query ? list.slice(0, WATCH_PREVIEW) : list
    })
    return showQuiet || query ? [...groups, ...items.filter((item) => item.bucket === "quiet")] : groups
  }, [items, showAllWatch, showQuiet, query])

  // j / k (or arrows) move through the list; / jumps to search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest("input, textarea, [contenteditable]")) {
        if (event.key === "Escape") (target as HTMLInputElement).blur()
        return
      }
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); return }
      if (!["j", "k", "ArrowDown", "ArrowUp"].includes(event.key) || event.metaKey || event.ctrlKey) return
      event.preventDefault()
      const index = visibleOrder.findIndex((item) => item.id === selected)
      const step = event.key === "j" || event.key === "ArrowDown" ? 1 : -1
      const next = visibleOrder[Math.max(0, Math.min(visibleOrder.length - 1, index + step))]
      if (next) {
        onSelect(next.id)
        document.getElementById(`row-${next.id}`)?.scrollIntoView({ block: "nearest" })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [visibleOrder, selected, onSelect])

  const decide = queue?.counts.decide ?? 0
  return <section className="list-pane" aria-label="Orders that need attention">
    <header className="list-head">
      {queue ? <h1 className={`list-title${decide === 0 ? " calm" : ""}`}>
        {decide === 0 ? <>Nothing needs you <span className="n">right now</span></> : <><span className="n num">{decide}</span> {decide === 1 ? "order needs" : "orders need"} you</>}
      </h1> : <div className="skeleton" style={{ height: 26, width: 220 }} />}
      {queue && <p className="list-sub">
        <span><b className="num">{queue.counts.agent}</b> with the agent</span>
        <span><b className="num">{queue.counts.watch}</b> waiting on others</span>
        <span><b className="num">{queue.counts.quiet}</b> on track</span>
      </p>}
      <div className="list-tools">
        <label className="search">
          <Icon name="search" size={15} />
          <span className="sr-only">Search orders</span>
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reference, car, customer, city" />
          {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><Icon name="x" size={14} /></button> : <span className="kbd">/</span>}
        </label>
      </div>
    </header>
    <div className="list-scroll">
      {error && !queue && <p className="group-empty" role="alert">Could not load the orders. Is the app still running?</p>}
      {!queue && !error && <div className="rows" style={{ paddingTop: 14 }} aria-busy="true">{[0, 1, 2, 3].map((index) => <div key={index} className="skeleton" style={{ height: 112, borderRadius: 12 }} />)}</div>}
      {queue && <AgentStrip queue={queue} reload={reload} />}
      {queue && GROUPS.map((group) => {
        const all = items.filter((item) => item.bucket === group.bucket)
        if (!all.length && group.bucket !== "decide") return null
        const shown = group.bucket === "watch" && !showAllWatch && !query ? all.slice(0, WATCH_PREVIEW) : all
        return <div className="group" key={group.bucket}>
          <div className="group-head"><span>{group.title}</span><span className="gcount">{all.length}</span><span className="ghint">{group.hint}</span></div>
          {all.length === 0 && <p className="group-empty">{query ? "No matches here." : "Nothing is waiting on a decision. New alerts and agent suggestions land here."}</p>}
          <ul className="rows">
            {shown.map((item) => <li key={item.id}><Row item={item} now={queue.now} selected={item.id === selected} onSelect={onSelect} compact={group.bucket === "watch"} /></li>)}
          </ul>
          {group.bucket === "watch" && all.length > WATCH_PREVIEW && !query && <div style={{ padding: "8px 20px" }}>
            <button type="button" className="btn ghost sm" onClick={() => setShowAllWatch((value) => !value)}>
              {showAllWatch ? "Show fewer" : `Show all ${all.length}`}
            </button>
          </div>}
        </div>
      })}
      {queue && <Quiet queue={queue} items={items.filter((item) => item.bucket === "quiet")} open={showQuiet || !!query} onToggle={() => setShowQuiet((value) => !value)} selected={selected} onSelect={onSelect} />}
    </div>
  </section>
}

function Row({ item, now, selected, onSelect, compact }: { item: TriageItem; now: string; selected: boolean; onSelect: (id: string) => void; compact?: boolean }) {
  const due = when(item, now)
  const nextClass = item.nextBy === "agent" ? "by-agent" : item.next?.startsWith("Agent suggests") ? "by-agent" : item.nextBy === "person" ? "by-person" : ""
  return <button type="button" id={`row-${item.id}`} className={`row tone-${item.tone}`} aria-current={selected ? "true" : undefined} onClick={() => onSelect(item.id)}>
    <div className="row-top">
      <span className="row-car">{item.vehicle}</span>
      <span className="row-ref">{item.reference}</span>
      {due && <span className={`row-when tone-${due.tone}`}>{due.text}</span>}
    </div>
    <div className="row-route">{item.from} → {item.to} · {item.customer}</div>
    <p className="row-why">{item.reason}</p>
    {item.next && !compact && <p className={`row-next ${nextClass}`}>
      <Icon name={item.nextBy === "agent" || nextClass === "by-agent" ? "spark" : item.nextBy === "outside" ? "clock" : "arrow"} size={13} />
      <span>{item.bucket === "agent" ? <>{item.next}{item.agent?.status === "working" && <> <span className="dots" aria-hidden="true"><i /><i /><i /></span></>}</> : item.next}</span>
    </p>}
    {(item.owner || item.proposal || item.area) && !compact && <div className="row-foot">
      {item.proposal && <span className={`chip sm ${item.proposal.urgency === "now" ? "tone-danger" : "tone-accent"}`}><Icon name="spark" size={12} />Decision ready</span>}
      <span className="chip sm outline">{item.area}</span>
      {item.owner && <span className="chip sm outline">{item.owner}</span>}
    </div>}
  </button>
}

function AgentStrip({ queue, reload }: { queue: QueueData; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!queue.agentAvailable) {
    return <div className="agent-strip" style={{ boxShadow: "inset 0 0 0 1px var(--hair)" }}>
      <span className="ico" style={{ background: "var(--hair-soft)", color: "var(--muted)" }}><Icon name="spark" /></span>
      <p>The Journey agent is offline. Add <span className="mono">ANTHROPIC_API_KEY</span> or <span className="mono">OPENROUTER_API_KEY</span> to <span className="mono">.env.local</span> and restart to let it work.</p>
    </div>
  }
  const { sweep } = queue
  const start = async () => {
    setBusy(true)
    setError(null)
    try { await post("/api/sweep"); await reload() } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start") } finally { setBusy(false) }
  }
  if (sweep.running) {
    return <div className="agent-strip">
      <span className="ico"><Icon name="spark" /></span>
      <p><b>Journey agent</b> is going through the road cases: {sweep.done} of {sweep.total} done <span className="dots" aria-hidden="true"><i /><i /><i /></span></p>
    </div>
  }
  if (sweep.available > 0) {
    return <div className="agent-strip">
      <span className="ico"><Icon name="spark" /></span>
      <p><b>{sweep.available} road {sweep.available === 1 ? "case" : "cases"}</b> the agent has not looked at yet.{error && <span className="tone-danger"> {error}</span>}</p>
      <button type="button" className="btn agent sm" onClick={start} disabled={busy}>{busy ? "Starting…" : "Let it look"}</button>
    </div>
  }
  const ready = queue.agent.proposals
  return <div className="agent-strip">
    <span className="ico"><Icon name="check" /></span>
    <p><b>Journey agent</b> has looked at every open road case.{ready ? <> {ready} {ready === 1 ? "decision is" : "decisions are"} ready for you.</> : " Nothing is waiting on you from it."}</p>
  </div>
}

function Quiet({ queue, items, open, onToggle, selected, onSelect }: { queue: QueueData; items: TriageItem[]; open: boolean; onToggle: () => void; selected: string | null; onSelect: (id: string) => void }) {
  return <div className="group">
    <div className="group-head">
      <span>On track</span><span className="gcount">{items.length}</span>
      <span className="ghint"><button type="button" onClick={onToggle}>{open ? "Hide" : "Show"} <Icon name="chevron" size={12} style={{ transform: open ? "rotate(-90deg)" : "rotate(90deg)" }} /></button></span>
    </div>
    <div className="quiet-box">
      <p className="muted" style={{ fontSize: 13 }}>Nothing is waiting on a person for these. Each one was checked for open alerts, conversations, incidents and owned work, and, if it is moving, a recent position and an ETA within the promise. A car with no recent position does not count as on track.</p>
      <div className="quiet-lanes">
        {queue.lanes.filter((lane) => lane.quiet > 0).map((lane) => <div className="quiet-lane" key={lane.lane}><span>{lane.label}</span><b>{lane.quiet}</b></div>)}
      </div>
      {open && <div className="quiet-rows">
        {items.map((item) => <button type="button" key={item.id} id={`row-${item.id}`} className="quiet-row" onClick={() => onSelect(item.id)} aria-current={item.id === selected ? "true" : undefined} style={item.id === selected ? { background: "var(--hair-soft)" } : undefined}>
          <span className="mono">{item.reference}</span>
          <span>{item.vehicle} · {item.from} → {item.to}<span className="quiet-checks">{item.checks.join(" · ")}</span></span>
          <span className="subtle">{item.laneLabel}</span>
        </button>)}
      </div>}
    </div>
  </div>
}
