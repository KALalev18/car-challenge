// One place that talks to Claude. Tests swap in a scripted model with
// setModelForTests, so the loop, tools and approvals are checked without a key.
//
// Two ways in: an Anthropic key (ANTHROPIC_API_KEY) goes straight to Anthropic;
// an OpenRouter key (OPENROUTER_API_KEY) goes through OpenRouter's
// Anthropic-compatible endpoint with the same SDK and the same requests.

import Anthropic from "@anthropic-ai/sdk"

export type ModelRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming
export type ModelCall = (request: ModelRequest) => Promise<Anthropic.Beta.BetaMessage>

// An OpenRouter key pasted into ANTHROPIC_API_KEY is an easy mistake; route it to OpenRouter anyway.
if (process.env.ANTHROPIC_API_KEY?.startsWith("sk-or-")) {
  process.env.OPENROUTER_API_KEY ??= process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
}
const viaOpenRouter = !process.env.ANTHROPIC_API_KEY && !!process.env.OPENROUTER_API_KEY

export const PROVIDER = viaOpenRouter ? "OpenRouter" : "Anthropic"
export const AGENT_MODEL = process.env.AGENT_MODEL ?? (viaOpenRouter ? "anthropic/claude-opus-5.5" : "claude-opus-5-5")
export const AGENT_EFFORT = (process.env.AGENT_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max"
/** The simulated driver and site contacts. Short, in-character replies. */
export const SIM_MODEL = process.env.SIM_MODEL ?? AGENT_MODEL

const holder = globalThis as unknown as { __bahnModel?: ModelCall | null; __bahnClient?: Anthropic }

export function setModelForTests(call: ModelCall | null) {
  holder.__bahnModel = call
}

export function modelAvailable(): boolean {
  return !!holder.__bahnModel || !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN || !!process.env.OPENROUTER_API_KEY
}

function client(): Anthropic {
  holder.__bahnClient ??= viaOpenRouter
    // OpenRouter takes its key as a Bearer token; an empty API key keeps the SDK
    // from sending an Anthropic x-api-key header.
    ? new Anthropic({ baseURL: "https://openrouter.ai/api", apiKey: null, authToken: process.env.OPENROUTER_API_KEY })
    : new Anthropic()
  return holder.__bahnClient
}

export async function callModel(request: ModelRequest): Promise<Anthropic.Beta.BetaMessage> {
  if (holder.__bahnModel) return holder.__bahnModel(request)
  if (viaOpenRouter) return client().beta.messages.create(request)
  return client().beta.messages.create({
    ...request,
    // If a request is declined for policy reasons, the API retries it on the
    // model's default fallback inside the same call.
    betas: [...(request.betas ?? []), "server-side-fallback-2026-07-01"],
    fallbacks: "default",
  })
}

export { Anthropic }
