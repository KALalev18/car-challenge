"use client"

import Link from "next/link"
import { use } from "react"
import { CaseView } from "../../components/case-view"
import { Icon } from "../../components/icons"

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <div className="page-scroll">
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "16px 32px 0" }}>
      <Link href={`/?case=${encodeURIComponent(id)}`} className="btn ghost sm"><Icon name="arrow" size={14} style={{ transform: "rotate(180deg)" }} /> Back to the worklist</Link>
    </div>
    <div style={{ maxWidth: 1180, margin: "0 auto" }}><CaseView orderId={id} full /></div>
  </div>
}
