import { NextResponse } from "next/server"
import { ActionError, ask, investigate } from "@/lib/actions"

export const runtime = "nodejs"

/** Starts the agent on the order, or passes it the operator's message. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = await request.json().catch(() => ({})) as { message?: string }
  try {
    return NextResponse.json(body.message?.trim() ? ask(id, body.message) : investigate(id))
  } catch (error) {
    if (error instanceof ActionError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
