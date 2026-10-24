"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import type { CaseView as CaseData, DecisionCard, Evidence, FactRow, SourceKind, TimelineItem } from "@/lib/case"
import type { AgentStep } from "@/lib/agent/types"
import { dayKey, fmtClock, fmtDateTime, fmtDayHeading, relativeTo } from "@/lib/present/time"
import { Icon } from "./icons"
import { post, useLive, useQueue, useToast } from "./live"
import { SourceDrawer } from "./source-drawer"

const CHANGE_ICON: Record<string, string> = {
  delivery_promise: "clock", booking: "ferry", cost: "offer", customer_message: "message", driver_instruction: "driver", assignment: "people", other: "note",
}

const CERTAINTY: Record<FactRow["certainty"], string> = {
  confirmed: "Confirmed", reported: "Reported", estimate: "Estimate", stale: "Stale", missing: "Missing", booked: "Booked", quote: "Quote only",
}

function initials(name: string): string {
  const words = name.replace(/[()]/g, "").split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase()
}

export function CaseView({ orderId, onClose, full }: { orderId: string; onClose?: () => void; full?: boolean }) {
  const { reload: reloadQueue } = useQueue()
  const { data, error, reload } = useLive<CaseData>(`/api/orders/${encodeURIComponent(orderId)}`, (current) =>
    current && (current.agent.running || current.agent.status === "working" || current.agent.status === "waiting_driver" || current.agent.status === "waiting_site") ? 1500 : 6000)
  const [source, setSource] = useState<string | null>(null)
  const toast = useToast()
  const refresh = async () => { await Promise.all([reload(), reloadQueue()]) }

  useEffect(() => {
    if (data) document.title = `${data.header.reference} · ${data.header.vehicle?.title ?? "Order"} · Control room`
  }, [data])

  if (error && !data) return <div className="case-empty"><div><h2>{error === "Not found" ? "Order not found" : "Could not open this order"}</h2><p>Pick another order from the list.</p></div></div>
  if (!data) return <div className="case" aria-busy="true">
    <div className="skeleton" style={{ height: 70 }} />
    <div className="skeleton" style={{ height: 90 }} />
    <div className="skeleton" style={{ height: 260 }} />
    <div className="skeleton" style={{ height: 180 }} />
  </div>

  const { header, triage } = data
  return <div className="case">
    <header className="case-head">
      <div>
        <div className="case-kicker">
          <span className="mono">{header.reference}</span>
          <span>·</span>
          <span>{header.laneLabel}</span>
          <span>·</span>
          <span>{header.routeKind}</span>
          {header.customerReference && <><span>·</span><span>Customer ref <span className="mono">{header.customerReference}</span></span></>}
        </div>
        <h1 className="case-title">{header.vehicle?.title ?? "Vehicle not linked"}{header.vehicle?.year ? <span className="subtle" style={{ fontWeight: 400 }}> {header.vehicle.year}</span> : null}</h1>
        <div className="case-route">
          <span><Icon name="pin" size={14} /> {header.from.city}</span>
          <span className="arrow">→</span>
          <span>{header.to.city}</span>
          <span className="sep">|</span>
          <span><Icon name="building" size={14} /> {header.customer.name}</span>
          {header.driver && <><span className="sep">|</span><span><Icon name="driver" size={14} /> {header.driver.name}</span></>}
          {header.vehicle?.plate && <><span className="sep">|</span><span className="mono" style={{ fontSize: 12.5 }}>{header.vehicle.plate}</span></>}
        </div>
      </div>
      <div style={{ display: "grid", justifyItems: "end", gap: 8 }}>
        <div className="case-actions">
          {onClose && <button type="button" className="btn ghost sm mobile-only" onClick={onClose}><Icon name="arrow" size={14} style={{ transform: "rotate(180deg)" }} /> Back</button>}
          {!full && <Link className="btn ghost sm" href={`/orders/${orderId}`} title="Open as a full page"><Icon name="external" size={14} /> Full page</Link>}
        </div>
        {header.vehicle?.illustration && <img className="case-car" src={`/car-images/${header.vehicle.illustration}.webp`} alt="" onError={(event) => { (event.target as HTMLImageElement).style.display = "none" }} />}
      </div>
    </header>

    <Briefing data={data} />

    {data.decision && data.decision.status === "PENDING_REVIEW"
      ? <Decision key={data.decision.id} card={data.decision} customer={header.customer.name} driver={header.driver?.name ?? null} onSource={setSource} onDone={async (message) => { toast.show(message); await refresh() }} now={data.now} />
      : data.lastDecision ? <Decided card={data.lastDecision} agent={data.agent} now={data.now} /> : null}

    <div className="case-cols">
      <section className="area-facts" aria-label="Key facts">
        <div className="block-head"><h2 className="block-title">Key facts <span className="subtle" style={{ fontWeight: 400, fontSize: 12 }}>each with where it came from</span></h2></div>
        <Facts facts={data.facts} now={data.now} onSource={setSource} />
      </section>
      <div className="area-agent">
        <AgentPanel data={data} orderId={orderId} onChange={refresh} onSource={setSource} toast={toast.show} />
      </div>
      <div className="area-timeline"><Timeline items={data.timeline} onSource={setSource} /></div>
      <div className="area-more"><More data={data} onSource={setSource} /></div>
    </div>

    {source && <SourceDrawer orderId={orderId} recordId={source} onClose={() => setSource(null)} />}
    {toast.node}
    {triage && null}
  </div>
}

// ---------------------------------------------------------------- briefing

function Briefing({ data }: { data: CaseData }) {
  const tone = data.triage.bucket === "decide" ? data.triage.tone : "neutral"
  const by = data.briefing.by
  return <section className={`briefing tone-${tone}`} aria-label="What is going on">
    <div className="briefing-who">
      {by === "agent"
        ? <><span className="agent-badge"><Icon name="spark" size={13} /> Journey agent</span><span>briefing{data.briefing.at ? `, ${relativeTo(data.briefing.at, data.now)?.text ?? ""}` : ""}</span></>
        : <><Icon name="book" size={13} /><span>From the records</span></>}
      <span style={{ marginLeft: "auto" }} className={`chip sm tone-${data.triage.bucket === "decide" ? data.triage.tone : data.triage.bucket === "agent" ? "accent" : data.triage.bucket === "quiet" ? "ok" : "neutral"}`}>
        {data.triage.bucket === "decide" ? "Needs you" : data.triage.bucket === "agent" ? "Agent is on it" : data.triage.bucket === "watch" ? "Waiting on others" : "On track"}
      </span>
    </div>
    <p>{data.briefing.text}</p>
    {data.triage.checks.length > 0 && (data.triage.bucket === "quiet" || data.triage.bucket === "watch") && <p className="briefing-checks"><Icon name="check" size={12} /> Checked: {data.triage.checks.join(" · ")}</p>}
  </section>
}

// ---------------------------------------------------------------- decision

function Decision({ card, customer, driver, onSource, onDone, now }: { card: DecisionCard; customer: string; driver: string | null; onSource: (id: string) => void; onDone: (message: string) => Promise<void>; now: string }) {
  const [customerMessage, setCustomerMessage] = useState(card.customerMessage ?? "")
  const [driverMessage, setDriverMessage] = useState(card.driverMessage ?? "")
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState<null | "approve" | "reject">(null)
  const [error, setError] = useState<string | null>(null)
  const urgent = card.urgency === "now"
  const editedCustomer = !!card.customerMessage && customerMessage.trim() !== card.customerMessage.trim()
  const editedDriver = !!card.driverMessage && driverMessage.trim() !== card.driverMessage.trim()

  const submit = async (decision: "approve" | "reject") => {
    setBusy(decision)
    setError(null)
    try {
      const result = await post<{ done?: string[]; next?: string }>(`/api/proposals/${card.id}`, decision === "approve"
        ? { decision, customerMessage: card.customerMessage !== null ? customerMessage : undefined, driverMessage: card.driverMessage !== null ? driverMessage : undefined }
        : { decision, note: reason })
      await onDone(decision === "approve" ? `Approved. ${result.done?.[0] ?? ""}` : "Rejected. The agent will take your reason into account.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the decision")
      setBusy(null)
    }
  }

  const otherChanges = card.changes.filter((change) => change.kind !== "customer_message" && change.kind !== "driver_instruction")
  return <section className={`decision${urgent ? " urgent" : ""}`} aria-label="Decision waiting for you">
    <div className="decision-head">
      <div className="decision-by">
        <Icon name="spark" size={14} />
        <span>{card.ours ? "The Journey agent suggests" : `${card.by} suggests`}</span>
        <span className="when">· {relativeTo(card.createdAt, now)?.text}</span>
        {urgent && <span className="chip sm tone-danger" style={{ marginLeft: "auto" }}>Decide now</span>}
        {card.urgency === "today" && <span className="chip sm tone-warn" style={{ marginLeft: "auto" }}>Today</span>}
      </div>
      <h2 className="decision-title">{card.title}</h2>
    </div>
    <div className="decision-body">
      {card.situation && <p className="decision-situation">{card.situation}</p>}
      {card.recommendation && <div className="decision-rec">
        <div className="k">{card.ours ? "Recommendation" : "Rationale"}</div>
        <p>{card.recommendation}</p>
      </div>}

      {otherChanges.length > 0 && <div>
        <div className="section-label" style={{ marginBottom: 6 }}>If you approve<span className="line" /></div>
        <ul className="changes">
          {otherChanges.map((change, index) => <li key={index} className="change">
            <span className="ci"><Icon name={CHANGE_ICON[change.kind] ?? "note"} size={15} /></span>
            <div><div className="ck">{change.kindLabel}</div><div className="cs">{change.summary}</div>{change.detail && <div className="cd">{change.detail}</div>}</div>
          </li>)}
        </ul>
      </div>}

      {card.customerMessage !== null && <div className="draft">
        <label className="draft-label" htmlFor={`cm-${card.id}`}><Icon name="message" size={14} /> Message to {customer} <span className="who">· you send it, from Bahn</span>{editedCustomer && <span className="edited">· edited</span>}</label>
        <Grow id={`cm-${card.id}`} value={customerMessage} onChange={(event) => setCustomerMessage(event.target.value)} />
      </div>}
      {card.driverMessage !== null && <div className="draft">
        <label className="draft-label" htmlFor={`dm-${card.id}`}><Icon name="driver" size={14} /> Message to {driver ?? "the driver"} <span className="who">· the agent sends it once you approve</span>{editedDriver && <span className="edited">· edited</span>}</label>
        <Grow id={`dm-${card.id}`} value={driverMessage} onChange={(event) => setDriverMessage(event.target.value)} style={{ minHeight: 64 }} />
      </div>}

      {(card.alternatives.length > 0 || card.openQuestions.length > 0) && <div className="decision-extra">
        {card.alternatives.length > 0 && <div><h4>Other options</h4><ul>{card.alternatives.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
        {card.openQuestions.length > 0 && <div><h4>Still unknown</h4><ul>{card.openQuestions.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      </div>}

      {card.evidence.length > 0 && <div>
        <div className="section-label" style={{ marginBottom: 6 }}>Based on<span className="line" /></div>
        <div className="evidence">{card.evidence.map((item) => <EvidenceChip key={item.id} item={item} onSource={onSource} now={now} />)}</div>
      </div>}
      {error && <div className="banner danger" role="alert">{error}</div>}
    </div>
    {rejecting ? <div className="reject-box">
      <div className="draft">
        <label className="draft-label" htmlFor={`rj-${card.id}`}>What should happen instead? <span className="who">The agent reads this, tries again or stands down, and remembers it for next time.</span></label>
        <textarea id={`rj-${card.id}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. I'll call the dealer myself. Find Kasper a train home for tonight instead." autoFocus />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn primary" onClick={() => submit("reject")} disabled={busy !== null}>{busy === "reject" ? "Sending…" : "Send to the agent"}</button>
        <button type="button" className="btn ghost" onClick={() => setRejecting(false)} disabled={busy !== null}>Cancel</button>
      </div>
    </div> : <div className="decision-foot">
      <button type="button" className="btn primary lg" onClick={() => submit("approve")} disabled={busy !== null}>
        <Icon name="check" size={15} />{busy === "approve" ? "Approving…" : card.customerMessage !== null ? (editedCustomer || editedDriver ? "Approve with my edits" : "Approve and send") : "Approve"}
      </button>
      <button type="button" className="btn lg" onClick={() => setRejecting(true)} disabled={busy !== null}>Choose another step…</button>
      {card.afterApproval && <p className="after"><Icon name="spark" size={13} /><span>Then: {card.afterApproval}</span></p>}
    </div>}
  </section>
}

/** A textarea that grows with its text, so a drafted message is read in full. */
function Grow(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight + 2}px`
  }, [props.value])
  return <textarea ref={ref} {...props} />
}

function Decided({ card, agent, now }: { card: DecisionCard; agent: CaseData["agent"]; now: string }) {
  const approved = card.review?.decision === "APPROVED"
  const agentNext = agent.status === "working" ? "The agent is acting on it now."
    : agent.status === "waiting_driver" || agent.status === "waiting_site" ? `The agent is waiting: ${agent.statusText?.replace(/^Asked /, "it asked ") ?? "for a reply"}.`
    : null
  return <section className={`decided ${approved ? "ok" : "neutral"}`} aria-label="Your last decision">
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <Icon name={approved ? "check" : "x"} size={15} />
      <b>{approved ? (card.review?.edited ? "You approved it with edits" : "You approved it") : "You rejected it"}</b>
      <span style={{ opacity: 0.75 }}>· {relativeTo(card.review?.at ?? null, now)?.text}</span>
    </div>
    <div style={{ color: "var(--ink)" }}>{card.title}</div>
    {card.review?.note && <div style={{ fontSize: 13 }}>Your note: “{card.review.note}”</div>}
    {approved && card.outcome.length > 0 && <ul>{card.outcome.map((line, index) => <li key={index}>{line}</li>)}</ul>}
    {(card.afterApproval && approved) || agentNext ? <div style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "flex-start" }}>
      <Icon name="spark" size={13} style={{ marginTop: 3 }} />
      <span><b>Next:</b> {[approved ? card.afterApproval : null, agentNext].filter(Boolean).join(" ")}</span>
    </div> : null}
  </section>
}

function EvidenceChip({ item, onSource, now }: { item: Evidence; onSource: (id: string) => void; now: string }) {
  const icon = item.collection === "messages" ? "message" : item.collection === "alerts" ? "alert" : item.collection === "tracking_observations" ? "pin"
    : item.collection.startsWith("travel") ? "ferry" : item.collection === "incidents" ? "incident" : item.collection === "simulated" ? "spark" : "file"
  return <button type="button" className="evidence-chip" onClick={() => onSource(item.id)} title={item.excerpt ?? item.label} disabled={item.collection === "simulated" || item.collection === "unknown"}>
    <Icon name={icon} size={13} />
    <span>{item.label}{item.at ? ` · ${relativeTo(item.at, now)?.text ?? ""}` : ""}</span>
  </button>
}

// ---------------------------------------------------------------- facts

function Facts({ facts, now, onSource }: { facts: FactRow[]; now: string; onSource: (id: string) => void }) {
  if (!facts.length) return <div className="card card-pad muted">No key facts recorded for this order.</div>
  return <dl className="facts">
    {facts.map((fact) => <div className="fact" key={fact.key}>
      <dt className="fact-label">{fact.label}<span className={`certainty ${fact.certainty}`}>{CERTAINTY[fact.certainty]}</span></dt>
      <dd className={`fact-value tone-${fact.tone}`}>{fact.value}</dd>
      {fact.note && <dd className="fact-note">{fact.note}</dd>}
      {fact.source && <dd>
        <button type="button" className="fact-source" onClick={() => fact.source?.recordId && onSource(fact.source.recordId)} disabled={!fact.source.recordId}>
          <span className={`src-dot k-${fact.source.kind}`} />
          {fact.source.who}{fact.source.at ? ` · ${relativeTo(fact.source.at, now)?.text ?? fmtDateTime(fact.source.at, null)}` : ""}
          <Icon name="eye" size={12} />
        </button>
      </dd>}
    </div>)}
  </dl>
}

// ---------------------------------------------------------------- agent

const STEP_ICON: Record<AgentStep["kind"], string> = {
  read: "book", ask: "send", reply: "message", note: "note", proposal: "spark", finish: "check", person: "user", error: "alert", action: "check",
}

const SUGGESTIONS = [
  "What do we know for certain, and what is only reported?",
  "Ask the driver for their current ETA.",
  "Draft a short update for the customer.",
]

function AgentPanel({ data, orderId, onChange, onSource, toast }: { data: CaseData; orderId: string; onChange: () => Promise<void>; onSource: (id: string) => void; toast: (text: string) => void }) {
  const { agent } = data
  const [text, setText] = useState("")
  const [sending, setSending] = useState(false)
  const [showReads, setShowReads] = useState(false)
  const trailRef = useRef<HTMLDivElement>(null)
  const working = agent.running || agent.status === "working"

  useEffect(() => {
    trailRef.current?.scrollTo({ top: trailRef.current.scrollHeight, behavior: "smooth" })
  }, [agent.steps.length])

  const send = async (message?: string) => {
    const body = (message ?? text).trim()
    setSending(true)
    try {
      await post(`/api/orders/${orderId}/agent`, body ? { message: body } : {})
      setText("")
      await onChange()
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Could not reach the agent")
    } finally {
      setSending(false)
    }
  }
  const takeOver = async () => {
    await post(`/api/orders/${orderId}/takeover`)
    toast("You have this case. The agent will stay out of it unless you ask.")
    await onChange()
  }

  // Reading steps are many and dull; fold runs of them into one line.
  const groups = useMemo(() => {
    const out: (AgentStep | { kind: "reads"; id: string; steps: AgentStep[] })[] = []
    for (const step of agent.steps) {
      const last = out[out.length - 1]
      if (step.kind === "read" && !showReads) {
        if (last && last.kind === "reads") last.steps.push(step)
        else out.push({ kind: "reads", id: `reads-${step.id}`, steps: [step] })
      } else out.push(step)
    }
    return out
  }, [agent.steps, showReads])

  const statusLine = !agent.available ? "Offline: no API key"
    : working ? (agent.statusText ?? "Working")
    : agent.status === "waiting_driver" || agent.status === "waiting_site" ? agent.statusText ?? "Waiting for a reply"
    : agent.status === "needs_person" ? "Waiting for your decision"
    : agent.status === "error" ? "Stopped with an error"
    : agent.status === "done" ? (agent.statusText ?? "Done")
    : "Not started on this case"

  return <section className="agent-panel" aria-label="Journey agent">
    <div className="agent-head">
      <span className="ico"><Icon name="spark" /></span>
      <div style={{ minWidth: 0 }}>
        <div className="agent-name">Journey agent</div>
        <div className={`agent-status ${working ? "working" : agent.status ?? ""}`}>
          {working && <span className="dots" aria-hidden="true"><i /><i /><i /></span>}
          {(agent.status === "waiting_driver" || agent.status === "waiting_site") && !working && <Icon name="clock" size={13} />}
          <span>{statusLine}</span>
        </div>
      </div>
      {agent.steps.length > 0 && agent.status !== "done" && <button type="button" className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={takeOver} title="Stop the agent working on this case">I'll take it</button>}
      {agent.status === "done" && agent.statusText === "A person took this over" && agent.available && <button type="button" className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => send("I'm handing this case back to you. Check what changed since I took it over, then carry on.")} disabled={sending}>Hand back to the agent</button>}
    </div>

    {agent.steps.length === 0 ? <div className="agent-empty">
      <p>The agent reads the records first, asks the driver or site only what the records cannot answer, and brings you one clear decision. It never contacts the customer or changes a booking, date or cost without your yes.</p>
      <div><button type="button" className="btn agent" onClick={() => send()} disabled={!agent.available || sending}><Icon name="play" size={13} />{sending ? "Starting…" : "Look into this case"}</button></div>
    </div> : <div className="trail" ref={trailRef}>
      {groups.map((entry) => entry.kind === "reads"
        ? <div className="step k-read" key={entry.id}>
          <span className="si"><Icon name="book" size={12} /></span>
          <div className="reads">Read {entry.steps.length} {entry.steps.length === 1 ? "record set" : "record sets"}: {entry.steps.map((step) => step.label.replace(/^Read |^Checked |^Looked up /, "")).join("; ")}. <button type="button" onClick={() => setShowReads(true)}>details</button></div>
        </div>
        : <Step key={entry.id} step={entry} now={data.now} />)}
      {working && <div className="step k-read"><span className="si"><span className="dots" aria-hidden="true"><i /><i /><i /></span></span><div className="step-label muted">{agent.statusText ?? "Working"}</div></div>}
      {agent.error && <div className="banner danger" style={{ marginTop: 8 }}>{agent.error}</div>}
    </div>}

    {agent.available && agent.steps.length > 0 && <>
      <div className="composer">
        <textarea rows={1} value={text} onChange={(event) => setText(event.target.value)} placeholder="Ask the agent, or tell it what to do" aria-label="Message the agent"
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (text.trim()) void send() } }} />
        <button type="button" className="btn agent" onClick={() => send()} disabled={sending || !text.trim()} aria-label="Send"><Icon name="send" size={14} /></button>
      </div>
      {!working && <div className="suggestions">{SUGGESTIONS.map((item) => <button type="button" key={item} className="suggestion" onClick={() => send(item)} disabled={sending}>{item}</button>)}</div>}
    </>}
    {agent.usage && agent.usage.calls > 0 && <div className="usage">{agent.usage.calls} model calls · {Math.round((agent.usage.inputTokens + agent.usage.outputTokens) / 1000)}k tokens on this case</div>}
  </section>
}

function Step({ step, now }: { step: AgentStep; now: string }) {
  // The proposal and the closing briefing are shown in full above the trail.
  const showDetail = step.detail && step.kind !== "proposal" && step.kind !== "finish"
  return <div className={`step k-${step.kind}`}>
    <span className="si"><Icon name={STEP_ICON[step.kind] ?? "dot"} size={12} /></span>
    <div style={{ minWidth: 0 }}>
      <div className="step-label">{step.kind === "person" && step.label === "You" ? <b>You</b> : step.label}<span className="step-time">{relativeTo(step.at, now)?.text}</span></div>
      {showDetail && <div className="step-detail">{step.detail}</div>}
      {step.reasoning && <details className="step-why"><summary><Icon name="chevron" size={11} /> Why</summary><p>{step.reasoning}</p></details>}
    </div>
  </div>
}

// ---------------------------------------------------------------- timeline

const KIND_LABEL: Record<SourceKind, string> = { customer: "Customer", driver: "Driver", site: "Site", ops: "Bahn", agent: "Agent", system: "System", app: "App", carrier: "Carrier" }

function Timeline({ items, onSource }: { items: TimelineItem[]; onSource: (id: string) => void }) {
  const [mode, setMode] = useState<"talk" | "all">("talk")
  const shown = mode === "all" ? items : items.filter((item) => item.kind !== "event" || item.tone === "warn" || item.tone === "ok" || item.tone === "accent")
  const days: { key: string; label: string; items: TimelineItem[] }[] = []
  for (const item of shown) {
    const key = dayKey(item.at, "Europe/Helsinki")
    const last = days[days.length - 1]
    if (last && last.key === key) last.items.push(item)
    else days.push({ key, label: fmtDayHeading(item.at, "Europe/Helsinki"), items: [item] })
  }
  const recentDays = mode === "talk" ? days.slice(-3) : days
  return <section aria-label="What happened">
    <div className="block-head">
      <h2 className="block-title">What happened</h2>
      <div className="tl-filter" role="group" aria-label="Show">
        <button type="button" aria-pressed={mode === "talk"} onClick={() => setMode("talk")}>Conversation</button>
        <button type="button" aria-pressed={mode === "all"} onClick={() => setMode("all")}>Everything</button>
      </div>
    </div>
    {shown.length === 0 && <p className="muted">Nothing recorded yet.</p>}
    {mode === "talk" && days.length > 3 && <p className="subtle" style={{ fontSize: 12, marginBottom: 4 }}>Showing the last 3 days. <button type="button" className="subtle" style={{ textDecoration: "underline" }} onClick={() => setMode("all")}>Show everything</button></p>}
    <div className="timeline">
      {recentDays.map((day) => <div key={day.key}>
        <div className="tl-day">{day.label} <span className="subtle" style={{ fontWeight: 400 }}>· Helsinki time</span></div>
        {day.items.map((item) => item.kind === "event"
          ? <div key={item.id} className={`tl-event tone-${item.tone}`}><span className="edot" /><div><span className="t">{fmtClock(item.at, "Europe/Helsinki")}</span>{item.body}{item.actor.kind !== "system" && <span className="subtle"> · {item.actor.name}</span>}</div></div>
          : <div key={item.id} className={`tl-item k-${item.actor.kind}${item.internal ? " internal" : ""}`}>
            <span className={`avatar k-${item.actor.kind}`} title={KIND_LABEL[item.actor.kind]}>{item.actor.kind === "agent" ? <Icon name="spark" size={13} /> : initials(item.actor.name)}</span>
            <div style={{ minWidth: 0 }}>
              <div className="tl-meta">
                <b>{item.actor.name}</b>
                <span>{KIND_LABEL[item.actor.kind]}</span>
                {item.to && <span>→ {item.to}</span>}
                {item.channel && <span>· {item.internal ? "Internal note" : item.channel}</span>}
                <span>· {fmtClock(item.at, "Europe/Helsinki")}</span>
                {item.simulated && <span className="chip sm outline" title="Written by the demo's simulated driver or site">Simulated reply</span>}
                {item.refs.length > 0 && item.refs[0].startsWith("agent-") && <button type="button" className="chip sm tone-accent" onClick={() => onSource(item.refs[0])}>Approved by you</button>}
              </div>
              <div className="tl-body">{item.body}</div>
            </div>
          </div>)}
      </div>)}
    </div>
  </section>
}

// ---------------------------------------------------------------- everything else

function More({ data, onSource }: { data: CaseData; onSource: (id: string) => void }) {
  const { record, history } = data
  const legs = record.journey.groups.flatMap((group) => group.legs.map((leg) => {
    const from = group.steps.find((step) => step.id === leg.fromStepId)
    const to = group.steps.find((step) => step.id === leg.toStepId)
    return { ...leg, fromLabel: from ? `${from.place.name}, ${from.place.city}` : "?", toLabel: to ? `${to.place.name}, ${to.place.city}` : "?" }
  }))
  return <details className="more">
    <summary><Icon name="chevron" size={13} /> Everything else on this order <span className="subtle" style={{ fontWeight: 400 }}>route, travel, proofs, costs, earlier decisions</span></summary>
    <div className="more-body">
      {history.length > 0 && <div>
        <div className="section-label" style={{ marginBottom: 8 }}>Earlier suggestions and decisions<span className="line" /></div>
        <div className="past-decisions">{history.map((card) => <div className="past" key={card.id}>
          <div className="past-top"><span className={`chip sm tone-${card.tone}`}>{card.statusLabel}</span><span>{card.by}</span><span>· {fmtDateTime(card.createdAt, null)}</span>
            <button type="button" className="subtle" style={{ marginLeft: "auto", textDecoration: "underline" }} onClick={() => onSource(card.id)}>record</button></div>
          <div style={{ fontWeight: 500 }}>{card.title}</div>
          {card.review && <div className="muted" style={{ fontSize: 12.5 }}>{card.review.decision === "APPROVED" ? "Approved" : card.review.decision === "REJECTED" ? "Rejected" : card.review.decision} by {card.review.by}{card.review.note ? `: “${card.review.note}”` : ""}</div>}
          {card.outcome.length > 0 && <ul className="muted" style={{ fontSize: 12.5 }}>{card.outcome.map((line, index) => <li key={index}>· {line}</li>)}</ul>}
        </div>)}</div>
      </div>}
      {legs.length > 0 && <div>
        <div className="section-label" style={{ marginBottom: 6 }}>Route<span className="line" /></div>
        <table className="mini-table"><thead><tr><th>Leg</th><th>Driver</th><th>Status</th></tr></thead><tbody>
          {legs.map((leg) => <tr key={leg.id}><td>{leg.fromLabel} → {leg.toLabel}{leg.distanceKm ? <span className="subtle"> · {leg.distanceKm} km</span> : null}</td><td>{leg.assignment?.driver.name ?? "Not booked"}</td><td>{leg.statusLabel}</td></tr>)}
        </tbody></table>
      </div>}
      {(record.reservations.length > 0 || record.options.length > 0) && <div>
        <div className="section-label" style={{ marginBottom: 6 }}>Travel: booked and quoted<span className="line" /></div>
        <table className="mini-table"><thead><tr><th>What</th><th>When</th><th>State</th></tr></thead><tbody>
          {record.reservations.map((row) => <tr key={row.id}><td>{row.kindLabel}: {row.route ?? ""} {row.reference ? <span className="mono subtle">{row.reference}</span> : null}</td><td>{fmtDateTime(row.departureAt, null)}</td><td><span className="chip sm tone-ok">Booked</span> {row.stateNote ? <span className="subtle">{row.stateNote}</span> : null}</td></tr>)}
          {record.options.map((row) => <tr key={row.id}><td>{row.kindLabel}: {row.provider ?? ""} {row.route ?? ""}</td><td>{fmtDateTime(row.departureAt, null)}</td><td><span className={`chip sm tone-${row.tone}`}>{row.statusLabel}</span> {row.quote ? <span className="subtle">{row.quote}</span> : null}</td></tr>)}
        </tbody></table>
      </div>}
      {(record.proofs.length > 0 || record.documents.length > 0) && <div>
        <div className="section-label" style={{ marginBottom: 6 }}>Proofs and documents<span className="line" /></div>
        <div className="evidence">
          {record.proofs.map((proof) => <span key={proof.id} className={`chip tone-${proof.tone}`}>{proof.kindLabel}: {proof.statusLabel}</span>)}
          {record.documents.map((doc) => <span key={doc.id} className={`chip tone-${doc.tone}`}>{doc.kindLabel}: {doc.statusLabel}</span>)}
        </div>
      </div>}
      {record.expenses.length > 0 && <div>
        <div className="section-label" style={{ marginBottom: 6 }}>Driver costs<span className="line" /></div>
        <table className="mini-table"><thead><tr><th>Cost</th><th>Amount</th><th>Review</th></tr></thead><tbody>
          {record.expenses.map((row) => <tr key={row.id}><td>{row.kindLabel}</td><td className="num">{row.amount}</td><td><span className={`chip sm tone-${row.tone}`}>{row.statusLabel}</span> {row.note ? <span className="subtle">{row.note}</span> : null}</td></tr>)}
        </tbody></table>
      </div>}
    </div>
  </details>
}
