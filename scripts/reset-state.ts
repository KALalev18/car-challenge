// Puts the demo back to the seed: the packet plus any recorded agent runs.
// `npm run reset -- --clean` starts from the bare packet instead, with no agent work.
import { resetState } from "../lib/state/store"

const clean = process.argv.includes("--clean")
resetState({ clean })
console.log(clean ? "Demo state cleared to the bare packet." : "Demo state reset to the seed.", "Restart `npm run dev` if it is running.")
