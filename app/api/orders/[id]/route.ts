import { NextResponse } from "next/server"
import { buildCase } from "@/lib/case"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const view = buildCase(id)
  if (!view) return NextResponse.json({ error: "Order not found" }, { status: 404 })
  return NextResponse.json(view)
}
