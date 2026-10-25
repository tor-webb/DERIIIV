# Handoff: where the work stands (2026-10-25, end of session)

Read this first. It is the short version; `docs/BOT_BUILDER_HANDOFF.md` has the deep detail on the bot engine
(block names, runner model, decisions not to undo).

Repo: `tor-webb/DERIIIV` (a white-label fork of the Deriv derivatives-trader monorepo, branded FiscoFX).
Everything described below lives in `packages/trader/src/AppV2/`.

## What changed this session

| Area             | What was done                                                                                                                                                                                                                                                                                                                                                                                  | Files                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Bot Builder look | White workspace and toolbox, plain bold category list (no coloured stripes). The four section blocks (Trade parameters, Purchase, Sell, Restart) are green; the blocks inside them are light grey with white dropdowns and dark text. Done with a Blockly theme (`getBlocklyTheme`, styles `deriv_section` and `deriv_setting`) plus CSS in `bot-builder.scss`.                                | `Containers/BotBuilder/blocks.ts`, `bot-builder.scss`    |
| Run panel        | New `RunPanel` component with the three tabs. Summary: live contract card (market, Rise/Fall, tick progress, profit, contract value, stake, payout, resale), take profit / stop loss / stop-after-trades inputs, totals grid, Reset. Transactions: Download (CSV) and View Detail buttons, rows with entry/exit spot dots and buy price with P/L, click a row to select it. Journal as before. | `run-panel.tsx`, `panel-utils.ts`                        |
| Run / Stop bar   | Centred bar at the bottom: teal Run, blue Stop, status text ("Bot is running", "Contract bought", ...) and a progress strip.                                                                                                                                                                                                                                                                   | `bot-builder.tsx`, `bot-builder.scss`                    |
| Run until TP/SL  | New `max_profit` (take profit) limit. When a take profit or stop loss is set the page passes `keep_running: true`, so the bot keeps trading until a limit is hit or Stop is pressed, even if the restart conditions do not say "trade again". Without a TP or SL the old behaviour holds (the bot stops when nothing asks to trade again). A real account still needs a stop loss.             | `Engine/runner.ts`, `Engine/types.ts`, `bot-builder.tsx` |
| Live data        | The runner now reports entry/exit spot, symbol and a live contract (`onLiveContract`).                                                                                                                                                                                                                                                                                                         | `Engine/runner.ts`                                       |
| Dashboard        | Rebuilt as a trading-site layout: dark hero with greeting, Start trading / Open Bot Builder buttons and a balance card with Demo/Real badge; tool cards with icons; account section; risk notice.                                                                                                                                                                                              | `Containers/Dashboard/`                                  |
| Tests            | 83 BotBuilder tests pass (new: take profit, keep running, live contract and spots, CSV export).                                                                                                                                                                                                                                                                                                | `__tests__/`                                             |

## What was checked, and how

- **Run:** Jest for the BotBuilder folder (83 passing), ESLint (0 errors), `tsc --noEmit` (no BotBuilder errors).
- **Looked at in a headless browser:** the real Bot Builder page, the run panel (Summary, Transactions, Journal with sample data) and the Dashboard were rendered in Chromium through a throwaway esbuild harness (stub store and API, outside the repo) and compared with the screenshots the user supplied. Colours and layout matched closely.
- **NOT checked:** the repo's real webpack build, the app inside the real shell (top nav, login), anything against the live Deriv websocket, mobile layout of the new panel on a real phone, the toolbox category rows (Blockly's own DOM, styled by CSS that could only be seen in the harness).

## Known gaps, in the order I would do them

1. **Importing Deriv XML bots.** Import exists (toolbar, Import) and is safe (allow-list scan, no DOCTYPE/ENTITY). It
   works for bots built from the blocks we support: trade parameters (including scripts that pick the trade options at
   run time), purchase/sell/restart sections, if/compare/logic/null, math (including even/odd/prime checks), text,
   prompts, variables, loops, functions, `read_details` (profit), `contract_check_result`, `total_profit`, `notify`,
   `timeout`. That covers stake-management bots (Martingale, D'Alembert, Oscar's Grind style). A bot that uses a block
   outside the allow-list is **refused with a list of the blocks missing**; it is not partly loaded. Not supported yet:
   indicators (SMA, EMA, RSI, Bollinger, MACD), candle and tick lists, `check_direction`, `ohlc`, most contract types
   (only Rise/Fall, Even/Odd, Over/Under, Matches/Differs), barrier trades. The imported KTH bot declares an `rsi`
   variable but no indicator block, so it never reads an RSI value here; its trades follow its own even/odd logic.
   Blockly logs a console warning for the two barrier-offset fields on legacy `tradeOptions` blocks; harmless for digits. Each new block needs: a definition, an
   entry in `ALLOWED_BLOCK_TYPES`, a compiler case, an interpreter or runner path and a test (see the other handoff,
   section 7). Get two or three real bot files from the user first and add what they actually use. The
   `deriv-bots.spec.ts` suite shows how to test a real export.
2. **Trashcan icon.** Blockly loads its sprite from `blockly-demo.appspot.com` because no `media` option is passed to
   `Blockly.inject`. Copy `node_modules/blockly/media` into the build (see `copyConfig` in `packages/core/build/config.js`)
   and pass `media: getUrlBase('/blockly/media/')`.
3. **Real webpack build and a browser smoke test on a demo account** (see section 6 of the other handoff for commands).
   Check the `proposal` payload in the network tab.
4. **Toolbar icons.** The toolbar is text buttons in a rounded bar. Deriv uses icon buttons; swap in icons, keep the
   text as `aria-label`s (the tests click by text).
5. **Top-nav tabs from the screenshots** (Bulk Trader, Trading Bots, DiffBot, Analysis Tool, DTrader) do not exist in this
   codebase. Adding one means `top-nav.tsx`, `packages/shared/src/utils/routes/routes.ts`, `AppV2/Routes/routes.tsx` and a
   card in `dashboard.tsx`.
6. **"Quick strategy" button and block search** from the Deriv screenshot are not built.
7. Websocket drop while a contract is open, a maximum stake cap and a real-account banner (other handoff, section 7).

## Commands

```bash
git clone https://github.com/tor-webb/deriiiv && cd deriiiv
npm ci --ignore-scripts --no-audit --no-fund          # about 40 s, Node 22.14+ or 24
cd packages/trader && npx jest src/AppV2/Containers/BotBuilder
npx tsc --noEmit -p tsconfig.json                      # filter for BotBuilder / Dashboard
cd ../.. && npx eslint packages/trader/src/AppV2/Containers --ext .ts,.tsx
npx prettier --write "packages/trader/src/AppV2/Containers/{BotBuilder,Dashboard}/**/*.{ts,tsx,scss}"
```

A push to `main` triggers the GitHub Pages deploy workflow. This work is on a branch and has not been merged.
Do not edit the generated colour SCSS (see `CLAUDE.md`).
