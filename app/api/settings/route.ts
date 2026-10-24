import { NextResponse } from "next/server"
import { mutate, overlay, type Permissions } from "@/lib/state/store"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json({ permissions: overlay().permissions, lessons: overlay().lessons ?? [] })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Partial<Permissions>
  const permissions = mutate((state) => {
    for (const key of Object.keys(state.permissions) as (keyof Permissions)[]) {
      if (typeof body[key] === "boolean") state.permissions[key] = body[key]
    }
    return state.permissions
  })
  return NextResponse.json({ permissions })
}
