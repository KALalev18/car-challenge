# Bahn Control Room

**A worklist that brings a person only the orders that need them, with the decision, the evidence and a way to say yes on one screen, plus the Journey agent, a real Claude agent that does the legwork on problems on the road.**

- Repository: https://github.com/KALalev18/car-challenge
- Demo video: `<link>` ← replace
- Run it: `npm install && cp .env.example .env.local && npm run dev` (Node 24; add an Anthropic key for the live agent). No database or Docker.

![The worklist and an open case](screenshots/worklist.png)

## The problem we designed for

Something changes every hour, and each problem starts a chain: a missed ship becomes a new booking, a hotel question, an email and a cost decision. Today a person holds that chain in their head while scanning lanes of 100 cards. We wanted a screen where that person sees **only the orders that need them**, understands each one **in a few seconds**, and where the legwork (reading, asking, looking up) is already done.

## 1. The control room

**One question instead of seven lanes: who has to act next?** All 100 orders sort into four groups:

| Group | In the packet | What it means |
| --- | --- | --- |
| **Needs you** | 10 | A decision is waiting. The row says what is wrong, the next decision, the owner and the deadline that matters ("Promise ends in 2 h"). |
| **Agent is on it** | live | The Journey agent is investigating or waiting for the driver. It comes back when it needs a yes. |
| **Waiting on others** | ~34 | Owned, or waiting on a customer, site or carrier. |
| **On track** | ~55 | Collapsed to a count per stage. Each one says what was checked. A moving car with no position for 4 hours does not count as on track. |

Rules decide the groups, and you can read them in `lib/triage.ts`. Examples:
- An acknowledged alert is owned, not solved.
- A robotic alert quotes the person who raised it instead: *Driver: "The queue before the terminal has barely moved."*
- An order you have just decided on steps back until something new happens.

**A case answers four questions, top to bottom:**

1. **What is going on?** A two-to-four sentence briefing, from the agent once it has worked the case, otherwise from the records.
2. **What do I decide?** The agent's suggestion: the situation with who said what and when, the recommendation, *exactly what changes if you approve*, the drafted customer message (you edit and send it), the driver message (the agent sends it after your yes), other options, what is still unknown, and the records it rests on. Approve, edit, or reject with a reason. Afterwards the case says what was done and **what happens next**.
3. **Can I trust the facts?** Each key fact (promise, position, ETA, driver, ferry, receiver) carries a certainty and a source: *confirmed*, *reported*, *estimate*, *stale*, *booked* or *quote only*. Click any source to open the record behind it. A ferry quote never looks like a booking, and a driver's report never looks like a verified location.
4. **What happened?** Messages, notes and events in one timeline: who spoke to whom, on which channel, when. Internal notes look different from messages, and simulated replies are labelled.

**People and agents, side by side.** The **Shift log** lists what the agent did, what drivers answered and what people decided. **Agent settings** is a trust ladder of what the agent may do alone. Reading is always on and asking drivers and sites is on. Closing a stale tracking alert and holding a quoted ferry for 2 hours are off until granted. A hold is free, expires on its own and is never a booking. Bookings, dates, costs and customer messages always need a yes. Next to the ladder is the approval record that would justify the next step.

## 2. The Journey agent (on the road)

A real agent: `claude-opus-5-5` in a tool loop, with one resumable conversation per order.

- **Cheap work first.** Nine read tools cover the case, messages, tracking, travel (booked kept apart from quoted), the pickup or delivery place, history, drivers nearby, later sailings and recovery options. It weighs claims the way Bahn's guide asks: a quote is not a booking, an alert is not a diagnosis, a driver message is a report, and newer wins.
- **Asks only what the records cannot answer.** One message to the driver or a site, then it ends its turn. A simulated driver replies a few seconds later and the reply wakes the agent.
- **Knows when to stop.** It hands a person one decision through `propose_decision`, with evidence ids, alternatives and open questions. Or it finishes with "nothing for a person to do" and says why.
- **Rules held in code.** No tool can message a customer, book, cancel or change a date, promise, cost or driver. `message_site` refuses sites that belong to the paying customer: the Bentley's delivery site does. Approval is what carries out a change, and the person is recorded as the actor.
- **Works in the background.** "Let it look" sends it through every open road case, three at a time, so people arrive to briefings and decisions instead of raw alerts.

Example: a real run on CD-420322, the Bentley from the brief. The agent:
1. Read the order, all 8 messages, the tracking and the history.
2. Noticed a contradiction. The incident says the car stopped "after leaving Munich", but the last app position (stale, from 05:00) put it 233 km from Hamburg. It wrote that down as a note instead of guessing.
3. Asked the driver, once, for the photo, the exact service area and whether he is safe.
4. When the (simulated) driver answered "Hollerbach Ost, A9, 35 km north of Nuremberg", it corrected its own note: the newer report wins, so the car is about 600 km from Hamburg and today's delivery cannot be made.
5. Brought one decision: call Marvellin Motorhandel and let them choose their own roadside cover, a tow (about €360) or a transporter (about €1,170), with the message drafted. It said the booking, the cost and the new date come afterwards as separate decisions.
6. Left the tracking alert open, because the car is stopped and not moving to plan.

The full run, every tool call and reply included, is in `traces/CD-420322.json`. Four more real runs ship with the repo, and a fresh clone opens with them waiting in *Needs you*:

| Case | What the agent did |
| --- | --- |
| CD-420603, ferry queue | Asked the driver where she is in the queue. She expects to reach check-in 20 minutes after the cutoff, so it replaced its first proposal with "call the carrier now, or move her to tonight's 21:00 sailing, which still meets the promise". It had no permission to hold the sailing, so it asked a person to. |
| CD-420299, sold-out ferry | With *hold a ferry* granted, it held the only sailing with space for 2 hours (not a booking), then asked a person to first find out what happened to this morning's timed-out booking attempt before booking anything. |
| CD-420702, missed relay | Read that the car and keys are safe at the transfer yard, and proposed a concrete new target for the dealer to agree to, firm only once a driver accepts. |
| CD-420399, driver cannot reach the pickup | Looked up ten Leipzig drivers with no booked work and proposed offering them the slot, so neither the slot nor the promise moves. Its first attempt hit a file-save error; the case went to a person, and the agent picked up where it left off on the next try. |

**When it goes wrong, and handing over.** These answer the three questions on Bahn's slide:
- If the agent fails, the order goes straight to *Needs you* with the reason.
- "I'll take it" stops the agent on a case. "Hand back to the agent" returns it, and the agent checks what changed first.
- *Choose another step* replaces a bare reject: you say what should happen instead, and that correction becomes a lesson the agent reads on every new case. This is Bahn's "every mistake becomes a test", in a small form.

## 3. How we worked with AI

We built it with Claude Code. The short version (full story in [HOW-WE-BUILT-IT.md](HOW-WE-BUILT-IT.md)):

- **We had the agent read the world before writing code.** It read the brief, the operations guide, the schema, and the raw records of every open case. That reading picked the agent area: "On the road" has the most live cases.
- **We said no to first answers:**
  - We dropped Postgres and Docker for a zero-setup clone, but kept Bahn's reading layer instead of rewriting it.
  - We gave no guarded `message_customer` tool, just no such tool.
  - We fixed the tool list instead of adding tools as permissions grow, to protect caching and resumed conversations.
- **We checked everything against data and pixels.** Triage was printed against all 100 orders, which caught a wrong reason, robotic alert text and missing next steps. Every page was screenshotted at desktop and phone width, which caught a CSS class clash, cut-off drafts, mixed time zones, developer-looking id chips, and a decision that vanished without saying what happens next. A 350 ms worklist API was profiled down to 47 ms.
- **15 tests**, including the agent loop end to end with a scripted model: it reads before asking, proposes only after the reply, drops fake evidence, sends the approved customer message as the person, cannot decide twice, and cannot hold a ferry without the permission or turn a hold into a booking.

## 4. Taste

- Bahn's own palette and fonts.
- One tone system: red is danger, orange is a risk, teal is the agent, green is done.
- Calm spacing and readable 14 px text.
- Keyboard: `j`/`k` to move, `/` to search.
- Skeletons while loading, and plain-language empty states ("Nothing needs you right now").
- Times are local to each place, with the zone named.
- It works on a phone.

## Honest limits

- The packet is a frozen snapshot, so the clock starts at 21 Oct 09:00 UTC and moves with real time.
- Drivers, sites, later sailings and recovery providers are simulated and labelled as such. Nothing is booked or sent outside the app.
- One operator identity (the shift lead). Per-desk views and approval limits are the next step.
