# Demo video plan (2½ minutes)

## Before you record

1. Put your key in `.env.local` and start the app: `npm run dev`.
2. Rehearse once on CD-420322, then clear it: **Agent settings → Reset demo → Start with no agent work**, or `npm run reset -- --clean`. The repo ships with recorded runs (including the Bentley), so a plain reset brings the finished Bentley back; the clean reset lets you show the agent working live.
3. Browser at 1440×900, zoom 100%, bookmarks bar hidden. Have the Claude Code session or the repo open in a second window for the process part.
4. The simulated driver answers in about 6 seconds and the agent takes 20 to 60 seconds per step. Keep talking while it works, or cut the wait in editing.

## Script

| Time | On screen | Say (in your own words) |
| --- | --- | --- |
| 0:00 – 0:15 | The worklist. | "Bahn's operations team runs 25,000 deliveries a year with 50 people. Today they scan lanes of cards. This is a control room that asks one question: who has to act next? Of 100 orders, 10 need a person. The rest are with the agent, waiting on someone else, or on track, folded away." |
| 0:15 – 0:35 | Move down the list with `j`/`k`. Point at a reason, a "Promise ends in 2 h" deadline, an owner. | "Each row says what is wrong, the next decision, and the deadline that matters. Alerts that read like reminders quote the person instead: here, the driver in the ferry queue." |
| 0:35 – 1:05 | Open CD-420322, the Bentley. Show the briefing, the facts with *Reported* and *Confirmed*, then click a source to open the drawer. | "The Bentley from your brief: red warning, driver stopped. Every fact says how sure it is and where it came from. The position is reported by the driver, not verified. One click shows the record behind it." |
| 1:05 – 1:40 | Click **Look into this case**. Show the agent trail: reads, then a question to the driver, then the driver's reply. | "The Journey agent is a real Claude agent. It reads first: the case, the messages, tracking. Only the driver knows exactly where he is, so it asks him, once. The driver here is simulated, and labelled. His reply wakes the agent." |
| 1:40 – 2:05 | The decision card: situation, recommendation, *If you approve*, the drafted customer message (edit one word), evidence chips. Click **Approve with my edits**. | "Now it brings me one decision: the owner must choose how the car is recovered. I see exactly what changes, the message I will send the dealer, and what it is based on. It never contacts the customer itself, and that is enforced in code. I edit, I approve…" |
| 2:05 – 2:15 | The "You approved it" card with *Next*. The order moves to Waiting on others. | "…and it says what was done and what happens next. The order steps out of my list." |
| 2:15 – 2:30 | Agent settings (trust ladder and "what the agent learned from your corrections"), then the Claude Code session or `docs/HOW-WE-BUILT-IT.md`. | "The agent earns freedom step by step. We built this with Claude Code. We had it read your schema and data before coding, checked every page in screenshots, rejected first answers like a guarded customer-messaging tool, and backed the rules with 15 tests." |

## Shots worth keeping as stills for the write-up

- The worklist with CD-420322 open (already in `docs/screenshots/worklist.png`).
- The decision card after a real run, showing evidence chips and the drafted messages.
- The agent trail with the driver's reply.
- The "You approved it" card.

## After recording

The repo already ships recorded runs in `state/seed.json` and `traces/`. To go back to them after recording: **Reset demo → Keep recorded agent work**, or `npm run reset`. Do not run `npm run seed:save` after a recording session unless you want that state to become what a fresh clone sees.
