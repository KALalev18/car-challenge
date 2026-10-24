"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect } from "react"
import { CaseView } from "./components/case-view"
import { useQueue } from "./components/live"
import { Worklist } from "./components/worklist"

function ControlRoom() {
  const router = useRouter()
  const params = useSearchParams()
  const { queue } = useQueue()
  const selected = params.get("case")

  const select = useCallback((id: string | null) => {
    router.replace(id ? `/?case=${encodeURIComponent(id)}` : "/", { scroll: false })
  }, [router])

  // On a wide screen, open the most urgent order so the first glance shows a decision.
  useEffect(() => {
    if (!selected && queue && window.matchMedia("(min-width: 861px)").matches) {
      const first = queue.items.find((item) => item.bucket === "decide") ?? queue.items.find((item) => item.bucket === "agent")
      if (first) select(first.id)
    }
  }, [selected, queue, select])

  return <div className={`split${selected ? " has-case" : ""}`}>
    <Worklist selected={selected} onSelect={select} />
    <div className="case-pane">
      {selected
        ? <CaseView key={selected} orderId={selected} onClose={() => select(null)} />
        : <div className="case-empty"><div><h2>Pick an order</h2><p>Its situation, the decision waiting and the evidence open here.</p><p className="subtle" style={{ marginTop: 10, fontSize: 12.5 }}>Move with <span className="kbd">j</span> <span className="kbd">k</span> · search with <span className="kbd">/</span></p></div></div>}
    </div>
  </div>
}

export default function Page() {
  return <Suspense fallback={null}><ControlRoom /></Suspense>
}
