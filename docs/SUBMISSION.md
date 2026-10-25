# Submission form text

Copy each field into the hackathon form.

## Project name

Bahn Control Room

## One-line pitch

A control room that shows Bahn's operations team only the orders that need a person, with a real AI agent that handles problems on the road and brings back one clear decision.

## Description

The problem
Bahn delivers 25,000 used cars a year across Finland, Denmark and Germany, with about 50 people in operations. Something changes every hour: a ferry sells out, a car shows a warning light, a driver can't reach a pickup. Each problem starts a chain (new booking, hotel, email, cost decision), and today a person holds that chain in their head while scanning lanes of 100 cards.

What we built
- A control room that asks one question instead of showing seven lanes: who has to act next? Of 100 orders, 9 need a person. The rest are with the agent, waiting on someone else, or on track, and every quiet order says what was checked.
- Each row says what is wrong, the next decision and the deadline that matters. Opening a case answers four questions: what is going on, what do I decide, can I trust the facts (each one is Confirmed, Reported, Booked or Quote only, with one click to its source record), and what happened.
- The Journey agent, a real Claude agent for problems on the road. It reads the records first, asks the driver once, and then either finishes or brings a person one decision, with the customer message drafted.

How it works, and what's AI about it
- Claude runs in a tool loop with 16 tools: reading records, checking later sailings and recovery options, messaging the driver or a site, writing notes, proposing a decision and finishing.
- The rules are enforced in code, not just in the prompt. No tool can message a customer, book, cancel or change a date or cost. It even refuses to message a delivery site that belongs to the paying dealer.
- A person approves, edits, or chooses another step. The correction is kept as a lesson the agent reads on every new case.
- A trust ladder grants more freedom one switch at a time, for example holding a ferry for 2 hours (free, never a booking).
- Drivers, ferries and recovery prices are simulated and labelled. The orders are Bahn's made-up challenge data.
- Five real agent runs ship with the repo as full traces. On the Bentley it noticed the stale GPS and the driver's report disagreed, asked the driver, corrected itself, and proposed calling the dealer to choose recovery.

How we built it
We built it with Claude Code. Before writing code we had it read Bahn's brief, schema and every open case. We rejected first answers (Postgres and Docker, a guarded "message customer" tool, a tool list that changes as trust grows), checked every page in screenshots, and wrote 15 tests that run the whole agent loop with a scripted model.

What's next
Replay recorded cases and grade the agent's proposals against what operators actually decided, then grant permissions on that evidence. Add per-desk views with their own approval limits, real carrier APIs behind the holds, and translation of driver replies.

## Screenshots (in docs/screenshots, upload in this order)

1. `1-worklist.png`: 9 of 100 orders need a person. Each says what's wrong, what's next and by when.
2. `2-decision.png`: The agent's briefing and its one decision on the Bentley with a red warning light.
3. `3-approve.png`: The drafted messages, the evidence behind them, and Approve or Choose another step.
4. `5-trust-ladder.png`: The trust ladder: what the agent may do alone, one switch at a time.
5. `6-shift-log.png`: The shift log: what the agent did, who it asked and what it brought a person.

## Links

- Repo: https://github.com/KALalev18/car-challenge
- Video: (your video link)
- Slides: (the deck's share link)
