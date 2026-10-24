// Simulated drivers and site contacts. The brief allows mocking everyone around
// the agent; these replies are written by a model playing the person, with a
// short private note on what is true on the ground. Every simulated message is
// marked `simulated: true` and labelled as such in the interface.

import { world } from "../data/world"
import { loadBundle } from "../present/load"
import { addRow, mutate, nextId, patchRow } from "../state/store"
import { callModel, SIM_MODEL } from "./model"

/** What the person on the ground knows that the records do not. All fictional. */
const GROUND_TRUTH: Record<string, string> = {
  "ord-00322": "You stopped at the 'Hollerbach Ost' service area on the A9 northbound, about 35 km north of Nuremberg, in the car section near the fuel station, hazard lights off, engine off. The red warning says 'Drive system fault. Stop safely' with a yellow engine symbol; acceleration felt weak before you stopped. You are safe, have water, phone at 60%. You have taken a photo of the dashboard and can say you sent it. You will not drive it again unless Bahn tells you it is cleared. You can wait until about 18:00 local; after that you would need a hotel nearby or a train home.",
  "ord-00603": "You are in the vehicle queue outside the ferry terminal, roughly 25 cars from the check-in gate. A terminal worker said check-in for your sailing closes on time and the queue is slow because one lane is closed. You think you will reach the gate about 20 minutes after the cutoff. You have not left the queue. If moved to a later sailing you would need somewhere to wait; you are fine with a later sailing tonight if Bahn arranges it.",
  "ord-00702": "You were booked for the second leg from the Espoo transfer yard but your train from Tampere was cancelled this morning, so you never reached the yard. You can be at the yard tomorrow, 22 October, at 09:00 local, and deliver the same day by early afternoon if Bahn confirms.",
  "ord-00439": "You are driving the Ferrari north through Germany toward the ferry. Heavy roadworks near Hannover cost you about 90 minutes. You are fine and the car is fine. Your app lost signal for a while. You still expect to make your booked crossing but delivery in Lahti will be about 45 minutes after the promised window.",
  "ord-00399": "You are still on another job heading to Hamburg. You must take your legal rest after that handover. The earliest you can travel is after 12:00 tomorrow; you could reach Leipzig around 16:00 tomorrow by train, which is after the selected slot. You would prefer the job be given to someone else rather than arrive late.",
  "ord-00299": "You have the job but no ferry booking yet. The later sailing works for you if Bahn books a hotel near the terminal for the night before and your return trip. You have not changed your pickup time.",
  "ord-00437": "You are on the motorway toward Munich with the Bentley Flying Spur, about 2.5 hours away. You will arrive around 15:30 local. You will not hand over the car or keys until Bahn gives you the name of the authorized receiver. If no one is there, you can wait up to an hour.",
  "ord-00449": "You are still feeling unwell, with a fever this morning. Honestly you do not think you can drive tomorrow. You would rather Bahn gives the job to someone else, and you will cancel if Bahn asks you to.",
  "ord-00735": "You are driving the Porsche Taycan south from Düsseldorf toward Frankfurt. Your phone was on low power mode, which stopped the app sending positions. You are near Limburg, about 70 km from Frankfurt, and expect to arrive around 14:15 local. All fine with the car.",
  "ord-01013": "You are driving the Ferrari from Espoo to Turku. The app crashed and you only noticed now. You are near Salo, about 50 km from Turku, and expect to arrive around 15:00 local. All fine.",
  "ord-00154": "You live near Bordeaux. You can travel to Marseille tomorrow morning by train if Bahn books it; you need the booking confirmed by tonight. You have not bought anything yourself.",
  "ord-00326": "You are driving the Polestar to Hamburg, on time. You have a question about your train home but nothing is wrong with the car.",
}

const holder = globalThis as unknown as { __bahnSimTimers?: Map<string, ReturnType<typeof setTimeout>> }

const REPLY_DELAY_MS = Number(process.env.SIM_REPLY_DELAY_MS ?? 6000)

/**
 * Schedules the simulated person's reply. `onReply` wakes the agent with it.
 */
export function scheduleReply(input: {
  orderId: string
  party: "driver" | "site"
  conversationId: string
  personId: string
  onReply: (messageId: string, body: string) => void
}) {
  holder.__bahnSimTimers ??= new Map()
  const key = `${input.orderId}:${input.party}`
  const existing = holder.__bahnSimTimers.get(key)
  if (existing) clearTimeout(existing)
  holder.__bahnSimTimers.set(key, setTimeout(() => {
    holder.__bahnSimTimers?.delete(key)
    void reply(input).catch((error) => console.error("simulated reply failed", error))
  }, REPLY_DELAY_MS))
}

async function reply(input: Parameters<typeof scheduleReply>[0]) {
  const bundle = loadBundle(input.orderId)
  if (!bundle) return
  const w = world()
  const person = bundle.dir.resolve(input.personId, input.party === "driver" ? "driver" : undefined)
  const thread = bundle.messages.filter((message) => message.conversationId === input.conversationId && message.details.visibility !== "INTERNAL")
  const vehicle = bundle.items.find((item) => item.role === "PRIMARY")?.vehicle
  const transcript = thread.slice(-8).map((message) => {
    const mine = message.details.author_id === input.personId
    return `${mine ? "You" : "Bahn"} (${message.authoredAt}): ${message.body}`
  }).join("\n")
  const truth = input.party === "driver" ? GROUND_TRUTH[input.orderId] ?? null : null
  const role = input.party === "driver"
    ? `You are ${person.name}, a freelance car delivery driver working through Bahn. You are delivering a ${vehicle ? `${vehicle.make} ${vehicle.model}` : "car"} on order ${bundle.order.reference}.`
    : `You are the contact at ${person.name} for order ${bundle.order.reference}, a ${vehicle ? `${vehicle.make} ${vehicle.model}` : "car"}. You answer emails from Bahn about pickup, keys and receiving.`
  const system = [
    role,
    "Reply to Bahn's latest message in the app, like a real person texting: 1 to 3 short sentences, friendly, no greeting fluff, no sign-off.",
    "Stay consistent with what you have already said. Answer only what you are asked. If you do not know something, say so.",
    truth ? `What is true for you right now (private; reveal only what is asked or natural): ${truth}` : "If asked something you have no information about, give a plausible, modest answer that does not create a new emergency.",
    `The current local date and time is around ${w.now} UTC.`,
  ].join("\n")
  const response = await callModel({
    model: SIM_MODEL,
    max_tokens: 2000,
    system,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: `Conversation so far:\n${transcript}\n\nWrite your reply to Bahn's latest message.` }],
  })
  const body = response.content.map((block) => (block.type === "text" ? block.text : "")).join("").trim()
  if (!body) return
  const messageId = mutate((state) => {
    const id = nextId(state, "msg")
    const now = world().now
    addRow(state, "messages", {
      id, order_id: input.orderId, conversation_id: input.conversationId, author_id: input.personId,
      author_type: input.party === "driver" ? "driver" : "site_contact", recipient_id: "journey-agent", recipient_type: "agent",
      channel: input.party === "driver" ? "driver_chat" : "site_email", visibility: "PUBLIC", language: "en", body, authored_at: now, simulated: true,
    })
    patchRow(state, "conversations", input.conversationId, { updated_at: now })
    return id
  })
  input.onReply(messageId, body)
}
