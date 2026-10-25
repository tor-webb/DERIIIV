# Bot Builder: handoff notes

Written 2026-10-25 so another tool or person can continue exactly where the last session stopped.
Read this top to bottom before touching code. Section 3 says what is and is not verified.

## 1. What this is

A Deriv Bot style block builder inside the FiscoFX platform (`tor-webb/DERIIIV`, a fork of the Deriv
derivatives-trader monorepo). Users drag Blockly blocks, press Run, and a runner trades on their Deriv
account over the platform's websocket. The goal is that it **looks and behaves like Deriv's Bot Builder**
and that bots exported from Deriv Bot import here.

All code is in `packages/trader/src/AppV2/Containers/BotBuilder/`.

## 2. Repo state

| Branch | What it holds |
|---|---|
| `main` | Up to the top navigation. No Bot Builder. |
| `bot-builder-page` | First version: block workspace page only. |
| `bot-run-engine` | Page plus a first, simple run engine (PR #2). Last commit `d762be0` sends `underlying_symbol` and an integer `duration`. |
| **`bot-deriv-compat`** | **Current work.** One commit (`be62a61`) on top of `d762be0`. Contains everything below. No PR opened yet. |
| `github-pages-fix` | Older than `main`; probably dead. |

Merge order when ready: PR #2 (`bot-run-engine`), then `bot-deriv-compat`. The second branch already
contains the first branch's commits, so merging it alone also works.

## 3. Honest status

**Verified (by running it):** 68 Jest tests pass in the three BotBuilder suites; `tsc --noEmit` shows no
BotBuilder errors; ESLint shows 0 errors (2 warnings: `max-classes-per-file` in `interpreter.ts`,
`no-restricted-exports` in `index.ts`).

**NOT verified, and the most likely places for bugs:**

1. **Block and field names come from memory of Deriv Bot, not from the user's file.** The user said to use
   the names "exactly as they appear in your file", but the file was not available this session. Names
   such as `trade_definition`, `trade_definition_market`, `SYMBOL_LIST`, `PURCHASE_LIST`,
   `TRADETYPE_LIST`, `DURATIONTYPE_LIST`, `PREDICTION`, `NOTIFICATION_TYPE`, `BEFOREPURCHASE_STACK`,
   `DURING_PURCHASE_STACK`, `AFTERPURCHASE_STACK` must be checked against a real exported Deriv Bot
   `.xml`. **First job: get that file from the user and reconcile.**
2. **Never run in a browser.** No visual check of the layout (especially the mobile stacked layout), no
   webpack build, no check of the Blockly dropdowns that depend on other dropdowns (market > submarket >
   symbol, trade type category > trade type, contract type), or of the hidden Prediction input.
3. **Never run against the real Deriv socket.** The runner is tested only against a fake API.
   In particular, the digit prediction is sent as `barrier` (a string) in the proposal request because
   the platform's own proposal builder does, per the earlier session. Re-confirm in the network tab.
4. **Real Deriv Bot files use many blocks this vocabulary does not have** (indicators, candles, tick
   lists, `check_direction`, `ohlc`, `read_details` variants, accumulators, and so on). The import
   scanner refuses any block type outside `ALLOWED_BLOCK_TYPES`, so such bots are rejected with a list of
   the unsupported blocks. That is deliberate (safe), but it means many real Deriv bots will not import yet.
5. The Blockly 12 procedure blocks (`procedures_defnoreturn` etc.) load and compile in the tests using
   `extraState: { params: [...] }`. A real Deriv XML file may encode function parameters with a
   `<mutation>` element instead; that path is untested.

## 4. File map

| File | Role |
|---|---|
| `blocks.ts` | `BLOCK_TYPES`, `ROOT_BLOCK_TYPES`, `ALLOWED_BLOCK_TYPES` (import allow-list), markets, trade types (`TRADE_TYPES`: risefall, evenodd, overunder, matchesdiffers), `registerBlocks()`, `getToolbox()`. Some blocks are JSON-defined, the dependent-dropdown ones are defined in code. |
| `Engine/types.ts` | The compiled program shape (`TProgram`, `TExpr`, `TStmt`), `TTradeRequest`, `TBotApi`, stats and transaction types. **Single source of truth: change types, compiler and tests together.** |
| `Engine/compile.ts` | Blockly workspace to `TProgram`. Handles shadow defaults (`DEFAULT_INPUTS`), functions, loops, text, timeout, sections. Throws `CompileError` with user-readable messages. |
| `Engine/interpreter.ts` | Runs a `TStmt[]`. Scoped function parameters, `return`, call depth cap (64), step cap (`MAX_STEPS` 50,000), break/continue. Throws `RuntimeError`. |
| `Engine/runner.ts` | `BotRunner`: init section, tick loop, proposal then buy, open-contract tracking, sell, restart, limits, timeout queue, restart-on-error. Phases: `starting`, `waiting`, `buying`, `in_contract`, `restarting`. |
| `Engine/ws-adapter.ts` | Adapts the platform `WS` helper from `@deriv/shared` to `TBotApi`. **Untouched this session.** |
| `bot-utils.ts` | Starter bot, storage, `restoreWorkspace`, `parseBotFile` / `scanState` (safe import), `loadParsedBot`, `exportWorkspaceXml` (Deriv format, `is_dbot="true"`), `validateBot`. |
| `bot-builder.tsx` / `.scss` | The page. Toolbar, workspace, Summary / Transactions / Journal tabs, footer with status and Run/Stop. |
| `__tests__/` | `engine.spec.ts` (compiler, interpreter, runner incl. fake timers), `bot-utils.spec.ts` (validation, import safety), `bot-builder.spec.tsx` (page, with Blockly mocked). |

## 5. How a bot runs (the model to preserve)

1. **Init** ("Run once at start" inside the trade parameters block) runs once on Run.
2. The runner subscribes to ticks. On each tick, while waiting, it runs **purchase conditions**. A
   `purchase` block requests a trade.
3. Trade stake, duration and prediction are **re-evaluated for every trade** (so martingale-style variables work).
4. Proposal, then buy, then follow the open contract. On every contract update it runs **sell conditions**.
5. When the contract closes it records the result, checks the loss and trade limits, then runs
   **restart conditions**. `trade_again` (directly, or inside a function, or after a `timeout`) goes back to step 2.
   If nothing asks to trade again, the bot stops with a message.
6. `stop()` never abandons an open contract: it waits for it to close, records it, then tears down.

## 6. Setup and commands

```bash
git clone https://github.com/tor-webb/deriiiv && cd deriiiv
git checkout bot-deriv-compat
# repo wants Node 24 (.nvmrc); Node 22.14+ also works. The last session used Node 22.23.
npm ci --ignore-scripts --no-audit --no-fund      # ~35 s; the repo's own script is `npm run bootstrap`

cd packages/trader
npx jest src/AppV2/Containers/BotBuilder          # run from packages/trader, NOT the repo root
npx tsc --noEmit -p tsconfig.json                 # filter the output for BotBuilder
cd ../.. && npx eslint packages/trader/src/AppV2/Containers/BotBuilder --ext .ts,.tsx
npx prettier --write "packages/trader/src/AppV2/Containers/BotBuilder/**/*.{ts,tsx,scss}"
```

Lint rules that bit last time: `one-var` (combine uninitialised `let`s, split initialised ones),
`func-names` (use anonymous `function (this: ...)`, not a named one), `no-useless-constructor`.
Do not edit generated colour SCSS (see `CLAUDE.md`).

## 7. Remaining work, in order

1. **Get a real Deriv Bot `.xml` from the user and reconcile names.** Update `BLOCK_TYPES`, field names,
   the starter bot, compiler and tests. Add that file (sanitised) as a test fixture and test a real import.
2. **Browser smoke test on a demo account** (`npm run serve trader` or core): Rise/Fall, then Over/Under
   with prediction, then a bot with a function and a `timeout`. In the network tab check the `proposal`
   payload: `underlying_symbol`, integer `duration`, `barrier` only for digit contracts that need one.
3. **Visual pass against Deriv Bot**: toolbar order and icons, block colours, the Summary tiles, the
   mobile layout (workspace stacked above the panel at `max-height: 36%`).
4. **Wire the unused settings**: `restart_buy_sell` and `candle_interval` are parsed into `TTradeSetup`
   but nothing uses them; the notify sound field is ignored; the stake label on the trade options block is
   hard-coded `USD` and should show the account currency.
5. **Broaden the vocabulary** in this order of user value: more digit and up/down contract types, candle
   and indicator blocks, `check_direction`, more math and text blocks. Every new block type needs: a
   definition, an entry in `ALLOWED_BLOCK_TYPES`, a compiler case, an interpreter or runner path and a test.
6. **Websocket resilience:** decide what happens if the socket drops while a contract is open (today the
   runner would wait forever for an update). Add a timeout or resubscribe on reconnect.
7. **Real-money safety review** before any real-account launch: the loss limit is required and the confirm
   dialog exists, but also consider a maximum stake cap and a visible real-account banner while running.
8. **Open the PR** for `bot-deriv-compat`, run the repo-wide `npm run test` (only the BotBuilder suites
   were run), and fix anything outside this folder that it flags.
9. Cleanup: delete `github-pages-fix` if confirmed dead; consider splitting the three break, continue and
   return signal classes in `interpreter.ts` to clear the `max-classes-per-file` warning.

## 8. Decisions already made (do not undo without asking the user)

- Imports are **allow-list scanned** before anything touches the workspace; unknown blocks are refused.
  XML with `<!DOCTYPE` or `<!ENTITY` is refused. Limits: 2,000,000 characters, 5,000 blocks, depth 200.
- The runner has **no `eval` or dynamic code** anywhere; bots are data interpreted by `interpreter.ts`.
- Real accounts require a "Stop at total loss" value plus an explicit confirmation dialog.
- A saved workspace that fails the scan (for example one saved by the old block set) falls back to the
  starter bot instead of leaving the page empty.
- Export format is Deriv-style Blockly XML (`.xml`); JSON import is still accepted.
