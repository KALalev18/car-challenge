<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working in this repo

The Car Delivery Control Room for Bahn's hackathon challenge: a worklist that shows operations only the orders that need a person, and the Journey agent, a real Claude agent for problems on the road. Read `docs/bahn/PARTICIPANT-BRIEF.md`, `docs/bahn/OPERATIONS-CONTEXT.md` and `dataset/SCHEMA.md` before changing behaviour; they explain the world better than the code.

## Map

- `lib/data/` reads the JSONL packet into memory (no database). `lib/state/store.ts` is the overlay of everything people and agents did, saved to `.state/overlay.json`.
- `lib/present/` is Bahn's starter reading layer (labels, attention, record view), kept as is except `load.ts`, which builds bundles from memory instead of Postgres.
- `lib/triage.ts` decides who must act on each order. `lib/case.ts` builds the case screen: briefing, decision, facts with sources, timeline.
- `lib/agent/` is the Journey agent: `prompt.ts` (standing instructions), `tools.ts` (read, ask, decide), `run.ts` (the loop), `sim.ts` (simulated drivers and sites), `model.ts` (the only place that calls Claude).
- `lib/actions.ts` is what happens when a person approves, rejects, asks or takes over.
- `app/` is the Next.js interface. `app/components/case-view.tsx` is the case screen.

## Rules that must hold

- No tool may contact a customer (whoever pays Bahn), book, cancel, or change a date, promise, cost or driver. Those are proposals a person approves. `tests/agent.test.ts` checks the tool names.
- Every fact shown to an operator names its source record. A quote is never shown as a booking; a driver's report is never shown as verified.
- Everything stays fictional. Do not add real people, companies, phone numbers or bookings.
- The tool list stays fixed and in order (prompt cache, resumable conversations). Gate permissions inside the tool.

## Before you hand back

`npm run typecheck && npm test`. For UI changes, look at the page in a browser at desktop and phone width.
