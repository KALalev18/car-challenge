import { NextResponse } from "next/server"
import { modelAvailable } from "@/lib/agent/model"
import { sweepStatus, sweepTargets } from "@/lib/sweep"
import { buildQueue } from "@/lib/triage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ ...buildQueue(), sweep: { ...sweepStatus(), available: sweepTargets().length }, agentAvailable: modelAvailable() })
}
