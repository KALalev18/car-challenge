"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { fmtClock, fmtWeekday } from "@/lib/present/time"
import { Icon } from "./icons"
import { useQueue } from "./live"

const LINKS = [
  { href: "/", label: "Needs you", icon: "alert", count: "decide" as const },
  { href: "/orders", label: "All orders", icon: "list", count: null },
  { href: "/activity", label: "Shift log", icon: "log", count: "agent" as const },
  { href: "/settings", label: "Agent settings", icon: "shield", count: null },
]

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { queue } = useQueue()
  const active = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/case") : pathname.startsWith(href))
  const working = queue ? queue.agent.working + (queue.sweep.running ? 1 : 0) : 0
  return <div className="shell">
    <nav className="nav" aria-label="Main">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">b</div>
        <div className="brand-text">
          <div className="brand-name">Bahn</div>
          <div className="brand-sub">Control room</div>
        </div>
      </div>
      <div>
        <div className="nav-section">Operations</div>
        <ul className="nav-list">
          {LINKS.map((link) => {
            const count = link.count === "decide" ? queue?.counts.decide : link.count === "agent" ? (working || null) : null
            return <li key={link.href}>
              <Link className="nav-link" href={link.href} aria-current={active(link.href) ? "page" : undefined} title={link.label}>
                <Icon name={link.icon} size={17} />
                <span className="label">{link.label}</span>
                {count ? <span className={`count ${link.count === "decide" ? "hot" : "agent"}`}>{count}</span> : null}
              </Link>
            </li>
          })}
        </ul>
      </div>
      <div className="nav-foot">
        {queue && <>
          <div className="clock"><span className="clock-time num">{fmtClock(queue.now, "Europe/Helsinki")}</span><span className="long">Helsinki</span></div>
          <div className="long">{fmtWeekday(queue.now, "Europe/Helsinki")} · {fmtClock(queue.now, "Europe/Berlin")} Berlin</div>
          <div className="long" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`agent-dot${!queue.agentAvailable ? " off" : working ? " live" : ""}`} />
            {queue.agentAvailable ? (working ? <span><b>Journey agent</b> is working</span> : <span><b>Journey agent</b> is ready</span>) : <span>Agent offline: no API key</span>}
          </div>
        </>}
      </div>
    </nav>
    <div className="main">{children}</div>
  </div>
}
