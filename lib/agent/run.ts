// The Journey agent's loop. One conversation per order, kept append-only so the
// agent can be woken again by a driver's reply, an operator's message or a
// decision on its proposal, and pick up where it left off. Each step is saved as
// it happens, so the control room can show the agent working.

import type Anthropic from "@anthropic-ai/sdk"
import { world } from "../data/world"
import { loadBundle } from "../present/load"
import { mutate, overlay, type Permissions } from "../state/store"
import { AGENT_EFFORT, AGENT_MODEL, callModel } from "./model"
import { kickoff, SYSTEM_PROMPT } from "./prompt"
import { scheduleReply } from "./sim"
import { TOOLS, type ToolContext, type ToolOutcome } from "./tools"
import type { AgentRun, AgentStep, RunStatus } from "./types"

export type WakeInput = {
  trigger: AgentRun["trigger"]
  /** What the agent is told. */
  text: string
  /** How the wake-up shows in the agent trail, e.g. the operator's own words. */
  step?: Omit<AgentStep, "id" | "at">
}

/** Upper bound on model calls in one go, so a confused run cannot spin. */
const MAX_CALLS = 14

const holder = globalThis as unknown as {
  __bahnRunning?: Map<string, Promise<void>>
  __bahnQueue?: Map<string, WakeInput[]>
}
const running: Map<string, Promise<void>> = (holder.__bahnRunning ??= new Map())
const queue: Map<string, WakeInput[]> = (holder.__bahnQueue ??= new Map())

export function isRunning(orderId: string): boolean {
  return running.has(orderId)
}

/** Wakes the agent on an order. Inputs that arrive while it works are handled next. */
export function wake(orderId: string, input: WakeInput): Promise<void> {
  const pending = queue.get(orderId) ?? []
  pending.push(input)
  queue.set(orderId, pending)
  markWorking(orderId, input)
  const current = running.get(orderId)
  if (current) return current
  const job = drain(orderId).finally(() => running.delete(orderId))
  running.set(orderId, job)
  return job
}

function markWorking(orderId: string, input: WakeInput) {
  const now = world().now
  mutate((state) => {
    const run = (state.runs[orderId] ??= {
      orderId, status: "working", statusText: "Reading the case", startedAt: now, updatedAt: now, trigger: input.trigger,
      transcript: [], steps: [], briefing: null, proposalIds: [], usage: { inputTokens: 0, outputTokens: 0, calls: 0 }, lastModelAt: null, error: null,
    })
    run.status = "working"
    run.statusText = input.trigger === "reply" ? "Reading the reply" : input.trigger === "decision" ? "Acting on your decision" : input.trigger === "person" ? "Working on your request" : "Reading the case"
    run.updatedAt = now
    run.error = null
    run.pid = process.pid
    if (input.step) run.steps.push({ ...input.step, id: `step-${run.steps.length + 1}`, at: now })
  })
}

async function drain(orderId: string) {
  while ((queue.get(orderId) ?? []).length) {
    const inputs = queue.get(orderId)!.splice(0)
    const text = inputs.map((input) => input.text).join("\n\n")
    try {
      await segment(orderId, text, inputs[inputs.length - 1].trigger)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`agent run on ${orderId} failed:`, message)
      mutate((state) => {
        const run = state.runs[orderId]
        if (!run) return
        run.status = "error"
        run.statusText = "The agent stopped with an error"
        run.error = message
        run.updatedAt = world().now
        run.steps.push({ id: `step-${run.steps.length + 1}`, at: world().now, kind: "error", label: "Stopped with an error; a person should take over", detail: message })
      })
    }
  }
}

function permissionText(permissions: Permissions): string {
  return [
    permissions.askDriversAndSites ? "ask drivers and non-customer sites questions" : "NOT messaging drivers or sites (propose questions instead)",
    permissions.closeStaleTrackingAlerts ? "close a tracking-gap alert once the driver confirms their position in a newer message" : "NOT closing alerts (say when one could be closed)",
    permissions.holdTravel ? "hold a quoted ferry sailing for 2 hours (free, expires, not a booking) when a missed or sold-out crossing needs a later one" : "NOT holding sailings (name the sailing in your proposal)",
    "never: bookings, dates, promises, costs, driver changes, or contacting the customer (always propose)",
  ].join("; ")
}

async function segment(orderId: string, incoming: string, trigger: AgentRun["trigger"]) {
  const state = overlay()
  const run = state.runs[orderId]
  if (!run) return
  const first = run.transcript.length === 0
  const bundle = loadBundle(orderId)
  if (!bundle) throw new Error(`Order ${orderId} not found`)
  const content = first
    ? kickoff({ reference: bundle.order.reference, orderId, now: world().now, trigger: incoming, permissions: permissionText(state.permissions), lessons: state.lessons })
    : `${incoming}\n(Current time ${world().now}. Permissions: ${permissionText(state.permissions)}.)`
  mutate(() => {
    run.trigger = trigger
    run.transcript.push({ role: "user", content })
  })

  let asked: "driver" | "site" | null = null
  let proposed = false
  let finished: ToolOutcome | null = null
  let lastAskText: string | null = null
  const tools = TOOLS.map((tool) => tool.definition)

  for (let call = 0; call < MAX_CALLS && !finished; call += 1) {
    const response = await callModel({
      model: AGENT_MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM_PROMPT }],
      tools,
      messages: run.transcript,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: AGENT_EFFORT },
      cache_control: { type: "ephemeral" },
    })
    const reasoning = response.content.filter((block): block is Anthropic.Beta.BetaThinkingBlock => block.type === "thinking").map((block) => block.thinking).join("\n").trim()
    mutate(() => {
      run.transcript.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] })
      run.usage.inputTokens += (response.usage.input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0)
      run.usage.outputTokens += response.usage.output_tokens ?? 0
      run.usage.calls += 1
      run.lastModelAt = new Date().toISOString()
    })

    if (response.stop_reason === "refusal") throw new Error("The model declined this request.")
    if (response.stop_reason === "pause_turn") continue

    const uses = response.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use")
    if (!uses.length) {
      // A plain answer: keep it as the briefing when the operator asked something.
      const said = response.content.map((block) => (block.type === "text" ? block.text : "")).join("").trim()
      if (said) {
        mutate(() => {
          run.steps.push({ id: `step-${run.steps.length + 1}`, at: world().now, kind: "note", label: "Answered", detail: said })
          run.briefing = said
        })
      }
      break
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const [index, use] of uses.entries()) {
      const tool = TOOLS.find((candidate) => candidate.definition.name === use.name)
      const outcome = tool ? execute(orderId, tool.run, use.input) : { content: `Unknown tool ${use.name}.`, isError: true, step: { kind: "error" as const, label: `Tried an unknown tool: ${use.name}` } }
      results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) })
      mutate(() => {
        const now = world().now
        run.steps.push({ ...outcome.step, id: `step-${run.steps.length + 1}`, at: now, ...(index === 0 && reasoning ? { reasoning } : {}) })
        run.updatedAt = now
        if (outcome.status === "waiting_driver" || outcome.status === "waiting_site") {
          asked = outcome.status === "waiting_driver" ? "driver" : "site"
          lastAskText = outcome.statusText ?? null
          run.statusText = outcome.statusText ?? run.statusText
        } else if (outcome.proposalId) {
          proposed = true
          run.proposalIds.push(outcome.proposalId)
          run.statusText = "Bringing you a decision"
        } else if (outcome.step.tool !== "finish" && !outcome.isError) {
          run.statusText = progressText(outcome.step)
        }
        if (outcome.step.tool === "finish") {
          finished = outcome
          if (outcome.briefing) run.briefing = outcome.briefing
        }
      })
    }
    mutate(() => { run.transcript.push({ role: "user", content: results }) })
  }

  const done = finished as ToolOutcome | null
  mutate(() => {
    const status: RunStatus = done?.status === "waiting_driver"
      ? (asked === "site" ? "waiting_site" : "waiting_driver")
      : done?.status ?? (asked ? (asked === "driver" ? "waiting_driver" : "waiting_site") : proposed ? "needs_person" : "done")
    run.status = status
    run.statusText = done?.statusText || (status === "waiting_driver" || status === "waiting_site" ? lastAskText ?? "Waiting for a reply" : status === "needs_person" ? "Waiting for your decision" : "Nothing needs a person right now")
    run.updatedAt = world().now
  })
}

function progressText(step: Omit<AgentStep, "id" | "at">): string {
  if (step.kind === "read") return "Reading the records"
  if (step.kind === "note") return "Writing up what it found"
  return step.label
}

function execute(orderId: string, runTool: (ctx: ToolContext, input: Record<string, unknown>) => ToolOutcome, input: unknown): ToolOutcome {
  // Every tool sees the records as they are now, including the agent's own writes.
  const bundle = loadBundle(orderId)
  if (!bundle) return { content: "Order not found.", isError: true, step: { kind: "error", label: "Order not found" } }
  const ctx: ToolContext = {
    orderId,
    w: world(),
    bundle,
    permissions: overlay().permissions,
    write: (change) => mutate(change),
    onAsked: (party, conversationId, personId) => scheduleReply({
      orderId, party, conversationId, personId,
      onReply: (messageId, body) => {
        const name = loadBundle(orderId)?.dir.resolve(personId, party === "driver" ? "driver" : undefined).name ?? (party === "driver" ? "The driver" : "The site")
        void wake(orderId, {
          trigger: "reply",
          text: `[New message ${messageId} from ${name} (${party}) at ${world().now}]\n${body}`,
          step: { kind: "reply", label: `${name} replied`, detail: body, refs: [messageId] },
        })
      },
    }),
  }
  try {
    const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {}
    return runTool(ctx, value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { content: `Tool failed: ${message}`, isError: true, step: { kind: "error", label: "A lookup failed", detail: message } }
  }
}
