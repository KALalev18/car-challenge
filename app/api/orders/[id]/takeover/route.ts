import { NextResponse } from "next/server"
import { takeOver } from "@/lib/actions"

export const runtime = "nodejs"

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  return NextResponse.json(takeOver(id))
}
