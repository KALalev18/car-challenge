# Questions for Bahn

Things the brief and the packet leave open. For each, what we assumed in the build, so a quick answer tells us whether to change anything. Ask the most important ones first: on the event Discord, or at Bahn's booth.

## Ask first (they change the build or the demo)

1. **Will judges run the repository, or judge from the video and write-up?** If they run it, will they use their own Anthropic key, or should the repo work without one?
   *We assumed:* both. It runs without a key, with every non-agent feature, and a fresh clone can start from recorded agent runs (`state/seed.json`) so agent work shows without a key.

2. **Who counts as a customer when a site belongs to the paying dealer?** On CD-420322, the delivery site (Marvellin Hamburg) belongs to the paying customer (Marvellin Motorhandel). Is messaging that site's desk "contacting a customer"?
   *We assumed:* yes. The agent refuses to message any site owned by the paying customer and drafts the message for a person instead.

3. **Is the buyer at a private delivery address a customer?** On private handovers the receiver often is not the party who pays Bahn.
   *We assumed:* only the paying account is a customer. Private sellers and receivers are handoff contacts the agent may ask about access and keys.

4. **Does an approved delivery-promise change still need the customer's agreement?** The schema says an OPS or SYSTEM window is not customer approval.
   *We assumed:* yes. Approval records "new promise requested" and sends the customer message; the promise itself changes only when the customer agrees.

5. **Is our area acceptable as "On the road"** when it also covers ferry trouble (CD-420603, CD-420299) and a driver who cannot reach a pickup (CD-420399)? Those overlap "Driver travel".
   *We assumed:* yes. Anything that threatens a car already promised or moving is on the road. Booking new positioning travel is out of scope.

## Operations and judgement

6. **Who approves what?** Should approval depend on the desk (shift lead, driver travel, readiness), or on a cost limit (for example, tows over €500 need the shift lead)?
   *We assumed:* one operator identity, the shift lead. Desk views and limits are our next step.

7. **Which time zone does the team read in?** Helsinki for everyone, or each place's local time?
   *We assumed:* slots, promises and facts in the place's local time with the zone named. The timeline in Helsinki time, labelled.

8. **When a driver reports a breakdown, does Bahn ever authorise a restart or a short drive?** One of Bahn's own recorded proposals on CD-420322 suggested "try restarting the vehicle once".
   *We assumed:* never from the agent. It confirms safety, never gives mechanical advice, and leaves recovery to the owner through a person.

9. **What should the agent be allowed to do alone first?** Is closing a stale tracking alert after the driver confirms their position a good first step up the ladder? Would you rather it held quoted ferries?
   *We assumed:* reading and asking drivers and sites are on. Closing tracking alerts is a switch, off by default. Holding a quoted ferry for 2 hours is a switch, off by default; holds are simulated and never bookings.

10. **How many orders does one operator watch in a shift, and how many truly need them?** Our triage gives about 10 of 100 in "Needs you" for this packet, which you say is enriched with hard cases.
    *We assumed:* the "Needs you" list should stay short enough to clear, so owned and waiting items sit in a separate group.

11. **Should agent messages to drivers use the driver's language?** Some packet messages are in German or Finnish.
    *We assumed:* English, which every driver in the packet uses with Bahn.

12. **Do alerts need to reach Slack or another room,** as the operations guide mentions, or is the control room the place for now?
    *We assumed:* the control room only. Internal room activity from the packet is not shown.

## Data

13. **Should `display_lane` be ignored entirely?** The README says it is a convenience for the starter, not a source of truth.
    *We assumed:* we use it only for the "On track" counts per stage. Every decision comes from records: windows, assignments, alerts, incidents, proposals.

14. **The support inbox:** do you want unmatched threads in the control room, or is that a separate desk?
    *We assumed:* out of scope. Linked threads still show on the order through the starter's rules.

15. **Bahn's 14 recorded agent proposals:** should operators be able to approve those from our screen too?
    *We assumed:* yes. They appear with the same approve and reject card, labelled with the Bahn agent that made them.

## Submission

16. **Video length and content:** is 2½ minutes covering the demo plus how we used coding agents enough, or should the process have more time?
17. **Repository:** is a fresh repository fine instead of a fork? Ours includes a copy of the packet, with credit.
18. **Model cost:** any limit or preference on models? We use `claude-opus-5-5`, configurable with `AGENT_MODEL`.
