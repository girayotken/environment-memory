# Setup and live AI

## Safe local preview

```sh
npm ci
npm run build:demo
npm run demo
```

Open http://127.0.0.1:7460/mobile. Create a room (for example, Robot workbench)
in Room and settings. Start scan, move around the virtual bench,
and finish. Views are saved locally; recognition is disabled. This launcher
ignores `.env` and disables paid providers even if enable flags exist in its environment.

For a separate workspace: `npm run demo -- 7461 data/another-preview`.
Do not reuse a port already running a different workspace.

## Provider-enabled session

The included live adapter uses Meta Model API and requires your own account access.
This source package does not include credentials, credits or previous budgets.

1. Copy `.env.example` to `.env` and add your key on the server only.
2. Choose and explicitly enable a budgeted session in that file. Confirm the model,
   service access and current provider pricing before running. Pricing estimates
   in code are a development snapshot, not a current invoice or guaranteed cap.
3. Build the demo, then run:

```sh
node scripts/check-node.mjs && node --env-file=.env --import tsx scripts/meta-demo-server.ts data/live-session data/live-budget 7461
```

Required flags: `ENABLE_META_DEMO=true`, `ENABLE_ROOM_OBSERVER=true`,
`META_CREDITS_CONFIRMED=true`. Required budget fields are shown in `.env.example`.
The launcher never prints the key. Blank/default-disabled configuration fails closed.

Open http://127.0.0.1:7461/mobile. Create/select a room in Room and settings,
then enable Update memory from automatically saved views. Scan a few objects; hold the view steady.
Wait for recognized objects to enter the list. Select one, type a name/group/tag
instruction, then use My memory to ask for its location. The exact saved name
usually takes the local lookup route. Broader wording may invoke the interpreter.

Each visual generation may have a separate token-count HTTP request. A comparison
with historical images can use more than one generation. The ledger counts HTTP
requests, frame allowances and conservative cost reservations, including failed
attempts. It is persistent. Do not delete or rotate it to evade a limit; a new
session requires an explicit new allowance.

You may hit a guard before the nominal cap when a worst-case request reservation
would exceed the remaining allowance. This is expected, not a reason to bypass it.
Keep your account's provider-side billing limits configured as well.

Local runtime folders contain images and model outputs. They are private; never
commit or copy them into the public source package. Optional speech tools require
separate Python/model/FFmpeg setup. Typed commands work without them.
