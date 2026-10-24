import { NextResponse } from "next/server"
import { resetState } from "@/lib/state/store"

export const runtime = "nodejs"

/** Puts the demo back to the seed (the packet plus recorded agent runs), or to the bare packet with `{ clean: true }`. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { clean?: boolean }
  resetState({ clean: body.clean === true })
  return NextResponse.json({ ok: true })
}
