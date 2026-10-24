"use client"

import Link from "next/link"
import type { Activity } from "@/lib/activity"
import { label } from "@/lib/present/labels"
import { fmtClock, fmtDateTime } from "@/lib/present/time"
import { Icon } from "../components/icons"
import { useLive } from "../components/live"

const STATUS_TEXT: Record<string, string> = {
  working: "Working", waiting_driver: "Waiting for the driver", waiting_site: "Waiting for the site", needs_person: "Waiting for a decision", done: "Done", error: "Stopped",
}

export default function ActivityPage() {
  const { data } = useLive<Activity>("/api/activity", () => 4000)
  return <div className="page-scroll"><main className="page">
    <div className="page-head">
      <div>
        <h1 className="page-title">Shift log</h1>
        <p className="page-sub">What the Journey agent did, what drivers answered and what you decided. Newest first.</p>
      </div>
    </div>

    {data && <div className="stats" style={{ marginBottom: 22 }}>
      <div className="stat"><div className="v num">{data.runs.length}</div><div className="l">cases the agent worked</div></div>
      <div className="stat"><div className="v num">{data.trust.asked}</div><div className="l">questions to drivers and sites</div></div>
      <div className="stat"><div className="v num">{data.trust.proposed}</div><div className="l">decisions brought to a person</div></div>
      <div className="stat"><div className="v num">{data.trust.approved}<span className="subtle" style={{ fontSize: 15 }}> / {data.trust.approved + data.trust.rejected}</span></div><div className="l">approved{data.trust.edited ? `, ${data.trust.edited} with edits` : ""}</div></div>
    </div>}

    <div className="activity-cols">
      <section>
        <div className="block-head"><h2 className="block-title">This shift</h2></div>
        <div className="card" style={{ padding: 6 }}>
          {!data && <div style={{ padding: 12, display: "grid", gap: 8 }}>{[0, 1, 2, 3].map((index) => <div key={index} className="skeleton" style={{ height: 44 }} />)}</div>}
          {data && data.entries.length === 0 && <div style={{ padding: "28px 20px", textAlign: "center" }} className="muted">
            <p style={{ color: "var(--ink)", fontWeight: 500 }}>Nothing yet this shift.</p>
            <p style={{ marginTop: 4 }}>Open a road case and ask the agent to look into it, or let it go through all of them from the worklist.</p>
          </div>}
          {data && data.entries.length > 0 && <div className="log">{data.entries.map((entry) => <Link key={entry.id} className="log-item" href={`/?case=${entry.orderId}`}>
            <span className="t">{fmtClock(entry.at, "Europe/Helsinki")}</span>
            <span className={`avatar k-${entry.who.kind === "person" ? "ops" : entry.who.kind}`}>
              {entry.who.kind === "agent" ? <Icon name="spark" size={13} /> : entry.who.kind === "person" ? <Icon name="user" size={13} /> : entry.who.name.slice(0, 2).toUpperCase()}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="txt">
                <span className="ref">{entry.reference}</span>
                {entry.who.kind === "person" ? <b>You: </b> : entry.who.kind === "driver" ? <b>{entry.who.name}: </b> : null}
                <span className={entry.tone === "accent" ? "tone-accent" : entry.tone === "danger" ? "tone-danger" : undefined}>{entry.text}</span>
              </div>
              {entry.detail && <div className="detail">{entry.detail}</div>}
            </div>
          </Link>)}</div>}
        </div>
      </section>

      <aside style={{ display: "grid", gap: 22 }}>
        <section>
          <div className="block-head"><h2 className="block-title">Cases the agent has worked</h2></div>
          <div className="card" style={{ padding: "6px 0" }}>
            {data && data.runs.length === 0 && <p className="muted" style={{ padding: "12px 16px" }}>None yet.</p>}
            {data?.runs.map((run) => <Link key={run.orderId} href={`/?case=${run.orderId}`} className="quiet-row" style={{ gridTemplateColumns: "92px minmax(0,1fr)", padding: "8px 16px" }}>
              <span className="mono">{run.reference}</span>
              <span>
                <span className={`chip sm ${run.status === "needs_person" ? "tone-accent" : run.status === "error" ? "tone-danger" : run.status === "done" ? "tone-ok" : "tone-neutral"}`}>{STATUS_TEXT[run.status] ?? run.status}</span>
                <span className="subtle" style={{ fontSize: 12 }}> {run.statusText}</span>
              </span>
            </Link>)}
          </div>
        </section>
        <section>
          <div className="block-head"><h2 className="block-title">Earlier suggestions from Bahn&apos;s other agents</h2></div>
          <div className="card" style={{ padding: "6px 0" }}>
            {data?.bahnAgents.map((row) => <div key={row.id} style={{ padding: "8px 16px", borderTop: "1px solid var(--hair-soft)", fontSize: 13 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }} className="muted"><span className="mono">{row.reference}</span><span>{row.agent}</span><span style={{ marginLeft: "auto" }}>{fmtDateTime(row.at, null)}</span></div>
              <div style={{ marginTop: 2 }}>{row.summary}</div>
              <div style={{ marginTop: 4 }}>
                <span className={`chip sm ${row.status === "EXECUTED" ? "tone-ok" : row.status === "FAILED" ? "tone-danger" : row.status === "REJECTED" ? "tone-neutral" : "tone-accent"}`}>{label(row.status)}</span>
                {row.reviewNote && <span className="subtle" style={{ fontSize: 12 }}> “{row.reviewNote}”</span>}
              </div>
            </div>)}
          </div>
        </section>
      </aside>
    </div>
  </main></div>
}
