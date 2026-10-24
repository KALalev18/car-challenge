import { NextResponse } from "next/server"
import { buildActivity } from "@/lib/activity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(buildActivity())
}
