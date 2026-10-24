// Prints the control room's queue in the terminal: a quick check of the triage
// rules against the packet without starting the app.
import { buildQueue } from "../lib/triage"

const queue = buildQueue()
console.log(`now ${queue.now} · decide ${queue.counts.decide} · agent ${queue.counts.agent} · watch ${queue.counts.watch} · quiet ${queue.counts.quiet}`)
for (const item of queue.items.filter((entry) => entry.bucket !== "quiet")) {
  console.log(`\n[${item.bucket}/${item.tone}] ${item.reference} ${item.vehicle} ${item.from}→${item.to} · ${item.area} · ${item.laneLabel}`)
  console.log(`  why:  ${item.reason}`)
  if (item.next) console.log(`  next: ${item.next} (${item.nextBy ?? "?"})`)
  if (item.deadline) console.log(`  when: ${item.deadline.label} ${item.deadline.text}${item.deadline.past ? " (past)" : ""}`)
  if (item.owner) console.log(`  owner: ${item.owner}`)
}
