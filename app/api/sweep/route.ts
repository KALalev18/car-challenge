import { NextResponse } from "next/server"
import { startSweep } from "@/lib/sweep"

export const runtime = "nodejs"

export async function POST() {
  try {
    return NextResponse.json(startSweep())
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start" }, { status: 503 })
  }
}
