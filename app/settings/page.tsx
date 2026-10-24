"use client"

import { useEffect, useState } from "react"
import type { Activity } from "@/lib/activity"
import type { Lesson, Permissions } from "@/lib/state/store"
import { Icon } from "../components/icons"
import { post, useLive, useQueue, useToast } from "../components/live"

type Rung = { key: keyof Permissions | null; title: string; body: string; always?: "on" | "off" }

// The trust ladder: what the agent may do on its own. Lower rungs are on from the
// start; higher ones are earned by a record of accepted suggestions.
const LADDER: Rung[] = [
  { key: null, always: "on", title: "Read every record on an order", body: "Messages, tracking, bookings, quotes, history. Reading disturbs nobody." },
  { key: "askDriversAndSites", title: "Ask drivers and sites questions", body: "One short message for facts only they have: safety, location, ETA, keys. Never a customer." },
  { key: "closeStaleTrackingAlerts", title: "Close a tracking alert once the driver confirms where they are", body: "Only when a driver message newer than the alert confirms the position. It changes no booking, date or cost." },
  { key: "holdTravel", title: "Hold a quoted ferry for up to 2 hours", body: "Keeps a sailing from selling out while you decide. A hold is free and expires on its own; booking it still needs your yes. Holds here are simulated." },
  { key: null, always: "off", title: "Change a booking, a date, a cost or a driver", body: "Always a proposal you approve, edit or reject." },
  { key: null, always: "off", title: "Message the customer", body: "The agent drafts; a person sends. A customer is whoever pays Bahn." },
]

export default function SettingsPage() {
  const [permissions, setPermissions] = useState<Permissions | null>(null)
  const [lessons, setLessons] = useState<Lesson[]>([])
  const { data: activity } = useLive<Activity>("/api/activity", () => 10000)
  const { queue, reload } = useQueue()
  const toast = useToast()
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    fetch("/api/settings").then((response) => response.json()).then((json: { permissions: Permissions; lessons: Lesson[] }) => { setPermissions(json.permissions); setLessons(json.lessons) }).catch(() => {})
  }, [])

  const toggle = async (key: keyof Permissions) => {
    if (!permissions) return
    const next = !permissions[key]
    setPermissions({ ...permissions, [key]: next })
    const saved = await post<{ permissions: Permissions }>("/api/settings", { [key]: next })
    setPermissions(saved.permissions)
    toast.show(saved.permissions[key] ? "Granted. The agent uses it from its next step." : "Taken back. The agent will ask you instead.")
  }

  const reset = async (clean: boolean) => {
    await post("/api/reset", { clean })
    setConfirmReset(false)
    await reload()
    const json = await fetch("/api/settings").then((response) => response.json()) as { permissions: Permissions; lessons: Lesson[] }
    setPermissions(json.permissions)
    setLessons(json.lessons)
    toast.show(clean ? "Cleared. The packet is as Bahn sent it, with no agent work." : "Demo reset, with the recorded agent work.")
  }

  const trust = activity?.trust
  const decided = trust ? trust.approved + trust.rejected : 0
  return <div className="page-scroll"><main className="page" style={{ maxWidth: 860 }}>
    <div className="page-head">
      <div>
        <h1 className="page-title">What the agent may do alone</h1>
        <p className="page-sub">Start with approvals. Give the Journey agent more room as it earns trust, one step at a time.</p>
      </div>
    </div>

    <div className="banner info" style={{ marginBottom: 18 }}>
      <Icon name="shield" size={16} />
      <div>{trust && decided > 0
        ? <>So far you approved <b>{trust.approved}</b> of {decided} suggestions{trust.edited ? <> ({trust.edited} after editing)</> : null} and rejected <b>{trust.rejected}</b>. A steady record of approvals without edits is the signal to move a step up.</>
        : <>No suggestions decided yet. Every approval, edit and rejection is counted here, and that record is the evidence for granting the next step.</>}</div>
    </div>

    <div className="card" style={{ marginBottom: 26 }}>
      {LADDER.map((rung, index) => {
        const on = rung.always === "on" ? true : rung.always === "off" ? false : rung.key && permissions ? permissions[rung.key] : false
        return <div className="perm" key={index}>
          <div>
            <h3>{rung.title}</h3>
            <p>{rung.body}</p>
          </div>
          {rung.key
            ? <button type="button" role="switch" className="switch" aria-checked={!!on} aria-label={rung.title} onClick={() => toggle(rung.key!)} disabled={!permissions} />
            : <span className="locked"><Icon name={rung.always === "on" ? "check" : "shield"} size={14} />{rung.always === "on" ? "Always" : "Needs your yes"}</span>}
        </div>
      })}
    </div>

    <div className="block-head"><h2 className="block-title">What the agent learned from your corrections</h2></div>
    <div className="card" style={{ marginBottom: 26 }}>
      {lessons.length === 0
        ? <p className="muted" style={{ padding: "16px 18px" }}>Nothing yet. When you choose another step and say why, the agent keeps your words and reads them on every new case.</p>
        : lessons.slice().reverse().map((lesson, index) => <div className="perm" key={index} style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <h3>“{lesson.correction}”</h3>
            <p>On <span className="mono">{lesson.reference}</span> it suggested: {lesson.suggestion}</p>
          </div>
        </div>)}
    </div>

    <div className="block-head"><h2 className="block-title">Demo</h2></div>
    <div className="card card-pad" style={{ display: "grid", gap: 12 }}>
      <p className="muted">Everything here is fictional. The 100 orders come from Bahn&apos;s challenge packet. The drivers and sites who answer the agent are simulated, and nothing is booked or sent outside this app.</p>
      <p className="muted">Agent: {queue?.agentAvailable
        ? <b style={{ color: "var(--green-ink)" }}>connected to Claude</b>
        : <b style={{ color: "var(--red-ink)" }}>offline. Add ANTHROPIC_API_KEY or OPENROUTER_API_KEY to .env.local and restart</b>}.</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {confirmReset
          ? <><span>Remove every decision and message made in this demo?</span><button type="button" className="btn primary sm" onClick={() => reset(false)}>Keep recorded agent work</button><button type="button" className="btn sm" onClick={() => reset(true)}>Start with no agent work</button><button type="button" className="btn ghost sm" onClick={() => setConfirmReset(false)}>Cancel</button></>
          : <button type="button" className="btn" onClick={() => setConfirmReset(true)}><Icon name="refresh" size={14} /> Reset demo</button>}
      </div>
    </div>
    {toast.node}
  </main></div>
}
