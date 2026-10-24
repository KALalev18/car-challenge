import { NextResponse } from "next/server"
import { ActionError, decide, type DecisionInput } from "@/lib/actions"

export const runtime = "nodejs"

/** A person approves or rejects a proposal, optionally editing the drafted messages. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = await request.json().catch(() => ({})) as Partial<DecisionInput>
  if (body.decision !== "approve" && body.decision !== "reject") return NextResponse.json({ error: "decision must be approve or reject" }, { status: 400 })
  try {
    return NextResponse.json(decide(id, body as DecisionInput))
  } catch (error) {
    if (error instanceof ActionError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
