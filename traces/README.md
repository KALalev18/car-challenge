# Agent traces

Each file is one real run of the Journey agent on one order, written by

```sh
npm run agent:run -- CD-420322
```

It holds every step the agent took (what it read, who it asked, what it proposed), the replies it received, the full model conversation including tool calls and results, and the token use. The drivers and sites who answer are simulated by a second model; their messages are marked `simulated: true`.

| File | Case |
| --- | --- |
| `CD-420322.json` | Bentley stopped with a red warning light: asks the driver, corrects itself, proposes the dealer call |
| `CD-420603.json` | Ferry queue before the check-in cutoff: proposes the 21:00 fallback sailing |
| `CD-420299.json` | Sold-out ferry: holds the next sailing for 2 hours (permission granted for this run), then proposes |
| `CD-420702.json` | Missed relay at a transfer yard: proposes a new target for the dealer |
| `CD-420399.json` | Driver cannot reach a Leipzig pickup: proposes local drivers. Includes a real save error and the recovery after it |

All five are also in `state/seed.json`, the state a fresh clone starts from.
