// What the agents did and what people decided, across all orders: the shift log.
// It also counts how often people accepted the Journey agent's suggestions, which
// is the evidence for giving it more freedom later.

import { world } from "./data/world"
import { makeDirectory } from "./present/load"
import { overlay } from "./state/store"
import type { AgentStep, RunStatus } from "./agent/types"

export type ActivityEntry = {
  id: string
  at: string
  orderId: string
  reference: string
  who: { kind: "agent" | "person" | "driver" | "site"; name: string }
  text: string
  detail: string | null
  tone: "neutral" | "accent" | "ok" | "warn" | "danger"
}

export type Activity = {
  now: string
  entries: ActivityEntry[]
  runs: { orderId: string; reference: string; status: RunStatus; statusText: string; updatedAt: string; calls: number; tokens: number }[]
  trust: { proposed: number; approved: number; edited: number; rejected: number; pending: number; asked: number; replies: number }
  bahnAgents: { id: string; reference: string; agent: string; summary: string; status: string; at: string; reviewNote: string | null }[]
}

const SHOWN: AgentStep["kind"][] = ["ask", "reply", "proposal", "note", "finish", "action", "person", "error"]

export function buildActivity(): Activity {
  const w = world()
  const state = overlay()
  const dir = makeDirectory(w)
  const refs = new Map(w.table("orders").map((row) => [row.id, String(row.reference)]))
  const entries: ActivityEntry[] = []
  let asked = 0
  let replies = 0
  for (const run of Object.values(state.runs)) {
    const reference = refs.get(run.orderId) ?? run.orderId
    for (const step of run.steps) {
      if (step.kind === "ask") asked += 1
      if (step.kind === "reply") replies += 1
      if (!SHOWN.includes(step.kind)) continue
      const who: ActivityEntry["who"] = step.kind === "person" ? { kind: "person", name: "You" }
        : step.kind === "reply" ? { kind: "driver", name: step.label.replace(/ replied$/, "") }
        : { kind: "agent", name: "Journey agent" }
      entries.push({
        id: `${run.orderId}:${step.id}`, at: step.at, orderId: run.orderId, reference, who,
        text: step.kind === "person" ? (step.detail && step.label === "You" ? step.detail : step.label) : step.label,
        detail: step.kind === "person" && step.label === "You" ? null : step.detail ?? null,
        tone: step.kind === "proposal" ? "accent" : step.kind === "error" ? "danger" : step.kind === "action" ? "ok" : "neutral",
      })
    }
  }
  const ours = w.table("agent_proposals").filter((row) => row.proposed_by_agent_id === "journey-agent")
  const trust = {
    proposed: ours.length,
    approved: ours.filter((row) => row.status === "EXECUTED").length,
    edited: ours.filter((row) => row.status === "EXECUTED" && (row.review as Record<string, unknown> | null)?.edited === true).length,
    rejected: ours.filter((row) => row.status === "REJECTED").length,
    pending: ours.filter((row) => row.status === "PENDING_REVIEW").length,
    asked, replies,
  }
  const bahnAgents = w.table("agent_proposals").filter((row) => row.proposed_by_agent_id !== "journey-agent").map((row) => ({
    id: row.id, reference: refs.get(String(row.order_id)) ?? String(row.order_id), agent: dir.title(row.proposed_by_agent_id) ?? "Agent",
    summary: String(row.summary), status: String(row.status), at: String(row.created_at),
    reviewNote: ((row.review as Record<string, unknown> | null)?.note as string | undefined) ?? null,
  })).sort((a, b) => b.at.localeCompare(a.at))
  return {
    now: w.now,
    entries: entries.sort((a, b) => b.at.localeCompare(a.at)),
    runs: Object.values(state.runs).map((run) => ({
      orderId: run.orderId, reference: refs.get(run.orderId) ?? run.orderId, status: run.status, statusText: run.statusText,
      updatedAt: run.updatedAt, calls: run.usage.calls, tokens: run.usage.inputTokens + run.usage.outputTokens,
    })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    trust,
    bahnAgents,
  }
}
