// Prints one order's case view: briefing, decision, facts with sources and the
// latest timeline entries. Usage: npm run case -- CD-420322
import { world } from "../lib/data/world"
import { buildCase } from "../lib/case"

const ref = process.argv[2] ?? "CD-420322"
const order = world().table("orders").find((row) => row.reference === ref || row.id === ref)
if (!order) throw new Error(`No order ${ref}`)
const view = buildCase(order.id)!
console.log(`${view.header.reference} · ${view.header.vehicle?.title} · ${view.header.from.city} → ${view.header.to.city} · ${view.triage.bucket}`)
console.log(`\nBriefing (${view.briefing.by}): ${view.briefing.text}`)
if (view.decision) console.log(`\nDecision: ${view.decision.title} [${view.decision.statusLabel}] by ${view.decision.by}\n  ${view.decision.recommendation}\n  evidence: ${view.decision.evidence.map((e) => e.label).join(" | ")}`)
console.log("\nFacts:")
for (const fact of view.facts) console.log(`  ${fact.label}: ${fact.value} — ${fact.note ?? ""} [${fact.certainty}; ${fact.source ? `${fact.source.who} ${fact.source.recordId}` : "no source"}]`)
console.log("\nTimeline (last 12):")
for (const item of view.timeline.slice(-12)) console.log(`  ${item.at.slice(5, 16)} ${item.kind}${item.internal ? "/internal" : ""} ${item.actor.kind}:${item.actor.name}${item.to ? ` → ${item.to}` : ""}: ${item.body.slice(0, 110)}`)
console.log(`\nHistory decisions: ${view.history.map((d) => `${d.title} (${d.statusLabel})`).join("; ")}`)
