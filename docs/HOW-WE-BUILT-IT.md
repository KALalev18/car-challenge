# How we built it with a coding agent

We built this with Claude Code as the main pair: it wrote most of the code, and our job was to steer, check and say no. Below is what we asked for, what we checked, what we threw away, and where we did not take the first answer.

## 1. Read the world before writing code

We started by having the agent read Bahn's materials: `PARTICIPANT-BRIEF.md`, `OPERATIONS-CONTEXT.md`, the 26 KB `dataset/SCHEMA.md`, the starter's reading layer, and the raw records of every open alert, incident, work item and agent proposal. We had it dump everything linked to a few orders, which is how we found the cases that carry the demo:

- **CD-420322**: the Bentley with a red warning light from the brief. It is in the data with an acknowledged safety stop, a recovery decision pending with the customer, and a delivery site that belongs to the paying customer.
- **CD-420603** (ferry queue), **CD-420702** (missed relay at a transfer yard), **CD-420299** (sold-out ferry), **CD-420399** (driver cannot reach a pickup).

That reading decided the agent's area. "On the road" had eight or more live cases in the data, against one or two for most other areas.

We asked the agent before starting a build that needed decisions only we could make: which model provider we had a key for, and which agent area to build. Everything else it decided and told us.

## 2. Decisions we made, and the first answers we rejected

**Throw away the database, keep Bahn's reading layer.** The starter needs Docker, Postgres and an S3 store. The rule is "runs from a fresh clone", and judges will not debug Docker, so we read the JSONL straight into memory and keep everything people and agents do in a small overlay file. We did *not* rewrite Bahn's `lib/present` layer. Its attention rules already encode the packet's traps (acknowledged is not resolved, a quote is not a booking), so we swapped only its loader and kept the rest.

**Lanes are not the answer.** The starter shows seven lanes of cards. Bahn says the lanes are "how people have worked so far, not the answer". We replaced them with one question: *who has to act next?* That gives you, the agent, someone outside, or nobody. The lanes survive as a one-line count under "On track".

**The rules live in code, not only in the prompt.** The obvious design is a `message_customer` tool guarded by an approval flag. We decided against it: a guarded tool still lets the model try, and the guard becomes the only thing between the agent and a customer. There is no tool that can contact a customer, book, cancel or change a date. Those are proposals, and only `lib/actions.ts`, triggered by a person, carries them out. While reading the data we found that the Bentley's delivery site belongs to the customer. Messaging that site *is* messaging the customer, so `message_site` refuses customer-owned sites. A test checks that no tool name contains customer, book, cancel, promise or pay.

**Permissions without changing the tool list.** The first version showed the agent extra tools when operations granted more freedom. We checked the API notes and changed it. A tool list that changes mid-conversation breaks prompt caching, and with Opus 5.5's preserved thinking it risks invalidating a resumed conversation. So the tool list is now fixed, and each tool checks its permission when called.

**The simulated driver is labelled, not hidden.** The brief allows a simulated driver. Its replies come from a second model playing the driver with a short private note on "what is true on the ground". Every such message carries `simulated: true` and a "Simulated reply" tag in the interface.

## 3. What checking found (and what we fixed)

We did not trust "it compiles". Every layer got checked against the real data, and the interface got checked in a real browser.

**Triage, printed to the terminal** (`npm run queue`). The first pass had problems:
- CD-420439 sat under "Needs you" with the sentence for a *quiet* order. Its danger was an ETA after the promise, which the reason rules did not cover. We added that case.
- Several alerts read like reminders ("Review ferry cutoff for CD-420603; source is a conversation…"). Now the row quotes the person who raised it: *Driver: "The queue before the terminal has barely moved."*
- Some decisions had no next step. We added the usual next decision per signal.

**The case briefing contradicted the case.** The starter's lane headline said the Bentley's driver "is driving it to Hamburg" while the car was stopped with a warning light. For any order with something open, the briefing now leads with the problem, and the lane headline is used only for quiet orders.

**Performance, measured rather than guessed.** The worklist API took about 350 ms per poll. Profiling showed bundles took 33 ms and formatting dates took the rest, because the starter built a new `Intl.DateTimeFormat` on every call. Caching formatters and indexing messages and threads brought it to about 47 ms.

**Screenshots of every page** (Playwright, desktop and phone), read by the agent and by us. They found:
- The "Look into this case" button rendered its icon *above* its label: the agent panel's `.agent` class collided with `.btn.agent`.
- Drafted customer messages were cut off in a fixed-height box. They now grow to fit.
- Evidence chips showed UTC while the timeline showed local time. They now show relative time.
- Raw record-id chips under the agent's steps looked like a developer tool. Removed.
- After approving, the decision simply vanished, which fails Bahn's question "is it clear what happens next?". We added a "You approved it" card listing what was done and what comes next. An order you have decided on now steps back to "Waiting on others" until something new arrives.

**Bugs caught along the way:**
- A cache kept on `globalThis` survived hot reload with an old shape. Fixed by versioning the cache key.
- One approval made during hot reload did not persist. We reproduced it on a fresh server, where it persisted, so it was a dev-only reload artefact. We kept the end-to-end approval test that proves the path.

**Tests with a scripted model.** We had the agent write tests that replace Claude with a scripted model. That checks the loop, the tools, the simulated driver and the approval flow without a key or cost. The tests assert behaviour Bahn asked for:
- The agent reads before it asks, and proposes only after the driver replies.
- Evidence ids that do not exist are dropped.
- Approval sends the customer message *as the person*.
- A decision cannot be made twice.
- Rejecting sends the reason back to the agent.

## 4. Reading Bahn's deck, and the first real run

**The deck showed gaps the brief had not.** We gave the agent Bahn's slide deck halfway through and asked what we were missing. Three things:
- "For every hidden order, say what was checked. An order nobody checked is not fine." Our quiet orders only said "on track". Now each lists what was checked, and a moving car with no position for 4 hours is pulled out of *On track*. On this packet that caught one car with 8 hours of silence and no alert.
- "When it goes wrong, what does a person see?" A failed run now puts the order in *Needs you* with the reason.
- "How does an agent get a case back?" There is now *Hand back to the agent*. Rejecting became *Choose another step*, which asks what to do instead and keeps the answer as a lesson for later cases.

**The first real run.** Before this point the agent had only been tested against a scripted model. On its first real run (through OpenRouter) it did something we had not scripted: it spotted that the incident text and the stale tracking disagreed about where the Bentley was. It wrote that down, asked the driver, and then corrected its own note when the newer report arrived. We kept that run as the trace in `traces/`.

**One more bug the screenshots caught.** The page reloaded itself several times a second. It turned out we had run `next build` while `next dev` was running, and the two share a folder. We cleaned the folder, recorded it in the README, and stopped doing that.

**A switch that did nothing.** Reviewing the build against the brief's "build it so you could give the agent more freedom later", we noticed the "hold a ferry" step on the trust ladder was only a label. A switch that changes nothing is worse than no switch, so we built it: a `hold_sailing` tool, gated by the permission inside the tool, that places a simulated 2-hour hold. It writes a hold, never a reservation, and a test checks that no booking appears.

**Seeing agent work without a key.** A judge who clones the repo without a key would see an agent that never ran. We ran the real agent on five road cases, kept each full trace in `traces/`, and froze the result as the seed a fresh clone starts from. For the video there is a clean reset that starts with no agent work.

**Real runs found real bugs.** Running agents from the terminal while the app was open in the browser broke two things the tests never exercised:
- Saving state failed on Windows (`EPERM`, then `ENOENT`), because both processes used the same temp file and Windows will not rename over a file another process has open. Each process now has its own temp file, and the save retries briefly before writing in place.
- A run started in the browser was marked "stopped by a restart" the moment the terminal process started, because a cold start assumed every working run was orphaned. Runs now record which process owns them, and only runs whose process is gone are settled.

The failed run itself showed the failure path working: the case went to *Needs you* with the reason, and the next run picked up from where the agent had stopped. We kept that trace as it was.

**Cost.** We limited the background sweep to road cases that need a decision or carry a risk: 10 cases instead of 23, because every run costs real money.

## 5. What we would do next

- Give each desk (travel, shift, readiness) its own view and its own approval limits.
- Hold hotels as well as ferries, against a real carrier API instead of the simulated desk.
- Let replies in the driver's language (German, Finnish, Danish) be translated for the operator, with the original kept.
- Measure the agent: replay recorded cases, grade proposals against what operators actually decided, and grant new permissions on that evidence.
