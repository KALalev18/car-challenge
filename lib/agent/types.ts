import type Anthropic from "@anthropic-ai/sdk"

/** Where the agent's work on one order stands, in words an operator reads. */
export type RunStatus =
  | "working"          // the model is reading, asking or writing
  | "waiting_driver"   // asked the driver; resumes when they reply
  | "waiting_site"     // asked a site; resumes when they reply
  | "needs_person"     // handed a decision to a person
  | "done"             // finished without needing a person
  | "error"

/** One thing the agent did, shown in the case's agent trail. */
export type AgentStep = {
  id: string
  at: string
  kind: "read" | "ask" | "reply" | "note" | "proposal" | "finish" | "person" | "error" | "action"
  tool?: string
  /** Short sentence: "Read 6 messages in the vehicle condition thread". */
  label: string
  /** Optional longer text: the question asked, the reply, the finding. */
  detail?: string
  /** Record ids this step looked at or produced. */
  refs?: string[]
  /** The model's summarised reasoning before this step, when it shared one. */
  reasoning?: string
}

export type AgentRun = {
  orderId: string
  status: RunStatus
  /** One line for the queue: "Asked the driver for the service-area name". */
  statusText: string
  startedAt: string
  updatedAt: string
  trigger: "sweep" | "person" | "reply" | "decision"
  /** The full model conversation, kept append-only so the run can resume. */
  transcript: Anthropic.Beta.BetaMessageParam[]
  steps: AgentStep[]
  /** The agent's latest one-paragraph read of the situation. */
  briefing: string | null
  proposalIds: string[]
  usage: { inputTokens: number; outputTokens: number; calls: number }
  /** Real wall-clock time of the last model call, for the activity log. */
  lastModelAt: string | null
  error: string | null
  /** The process doing the work, so another process starting up does not mistake it for an interrupted run. */
  pid?: number
}

/** A change the agent wants to make. Nothing here happens until a person approves. */
export type ProposedChange = {
  kind: "delivery_promise" | "booking" | "cost" | "customer_message" | "driver_instruction" | "assignment" | "other"
  /** "Move the delivery promise to Thu 23 Oct, 10:00–14:00 Hamburg time" */
  summary: string
  /** Optional details: amounts, references, times. */
  detail?: string
}

export type JourneyProposalPayload = {
  title: string
  situation: string
  recommendation: string
  changes: ProposedChange[]
  customer_message: string | null
  driver_message: string | null
  alternatives: string[]
  open_questions: string[]
  urgency: "now" | "today" | "can_wait"
  /** What the agent does next once the person decides. */
  after_approval: string
}
