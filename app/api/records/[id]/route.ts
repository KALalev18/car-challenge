import { NextResponse } from "next/server"
import { evidenceById } from "@/lib/case"
import { world } from "@/lib/data/world"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** One source record, raw and read out: what a fact or an agent claim rests on. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const orderId = new URL(request.url).searchParams.get("order") ?? ""
  const found = world().find(id)
  if (!found) return NextResponse.json({ error: "Record not found" }, { status: 404 })
  return NextResponse.json({ collection: found.collection, record: found.row, evidence: orderId ? evidenceById(orderId, id) : null })
}
