# Handoff: where the work stands (2026-10-26)

## Session 2026-10-27: merge of fix branches, phone navigation on Trade

- Merged `fix/currency-text-and-mobile-nav` and `fix-balance-assistant` into one line. Balances use `formatMoneyText` (shared), so
  the currency shows as a symbol ("$9,987.00") and never as HTML. `AppV2/Utils/format-balance.ts` was dropped as a duplicate.
- The phone tab bar (Dashboard, Trade, Charts, Bot Builder, ...) now also shows on the Trade page (`/`). Before, phones on Trade
  got only the old Deriv Home/Trade/Menu bar and could not reach the dashboard or Bot Builder. Test: `AppShell/__tests__/app-shell.spec.tsx`.
- There is **no News tab** anywhere in the app. The only news content is the "News and crypto" lessons on the Learn page.
- Known: on phones the old core header still shows the "DT" logo and the old bottom bar sits under the new tab bar.

## Session 2026-10-26: Bulk Trader, What-if, Learn page, Telegram link

Branch **`simulators-bulk-and-whatif`** (off `main`). Not merged. A push to `main` triggers the Pages deploy, so review first.

| Page                  | Route          | What it is                                                                                                                                                                                                                                                             | Folder (`packages/trader/src/AppV2/Containers/`) |
| --------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Bulk Trader simulator | `/bulk-trader` | Fetches the latest real ticks of a market and a live payout quote, then settles every contract with the real rules. Shows the win rate next to the **break-even win rate** and the gap. Nothing is bought.                                                             | `BulkTrader/`                                    |
| What-if calculator    | `/what-if`     | The user types a win rate. Runs the stake plan 500 times at that rate and shows profit, range, chance of ruin and drawdown, plus a table at 0, 2, 5, 10 and 20 points **below** the assumed rate. The win rate is labelled "Assumption, not a prediction" in the page. | `WhatIfCalculator/`                              |
| Learn to trade        | `/learn`       | Beginner lessons (basics, charts and indicators, news, stocks, crypto, predictions and risk), glossary with search, a "before every trade" checklist, and the Telegram community card. Lessons are plain data in `learn-content.ts`.                                   | `Learn/`                                         |
| Shared maths and UI   | n/a            | `stake-math.ts` (payout, break-even, stake plans, `runPlan`, drawdown, seeded simulation) and `stake-tools-ui.tsx/.scss` (fields, gauge, chart). Both simulators settle through the same `runPlan`.                                                                    | `StakeTools/`                                    |

Also changed: route constants (`packages/shared/src/utils/routes/routes.ts`), `AppV2/Routes/routes.tsx`, `top-nav.tsx`
(Bulk Trader, What-if and Learn tabs), `dashboard.tsx` (three new cards), `brand.config.json` (new `community` block) and
`packages/shared/src/utils/brand/brand.ts` (`getCommunityConfig`, `isTelegramUrl`).

**Telegram:** put the invite link in `brand.config.json` under `community.telegram_url` (only `https://t.me/...` or
`https://telegram.me/...` is accepted) and rebuild. Empty means the page says "opening soon". See `docs/WHITE_LABEL.md`.

### Checked, and how

- Jest: the whole `src/AppV2` tree passes (181 suites, 1,458 tests), plus 3 new tests in `packages/shared`. New tests cover the
  maths (hand-checked numbers), tick settlement for every contract type, the API layer against a fake socket, each page,
  nav, dashboard and the Telegram link rules.
- ESLint: 0 errors in the new code (3 `no-restricted-exports` warnings on the new `index.ts` files, same as the existing pages).
  Stylelint clean. `tsc --noEmit` in `packages/trader` shows no errors in these files (4 older errors in `packages/components`).

### NOT checked (do these first)

1. **Never run against the live Deriv socket or inside the real app shell.** The three pages WERE rendered in headless Chromium
   through a throwaway esbuild harness (stub store, stub translations, fake ticks and quote), at desktop and 390px widths, in light
   and dark, and the layout bugs found there were fixed. Not seen: inside the real top nav and shell, or on a real phone.
2. **Tick timing convention.** `bulk-utils.ts` assumes a contract bought after tick `i` has its entry spot at tick `i + 1` and its
   exit spot at tick `i + duration`, and that Rise/Fall loses on a tie. This matches how Deriv describes tick contracts, but it
   was written from memory and is unconfirmed. Compare one simulated trade with a real demo contract on the same ticks.
3. **API shapes.** `bulk-api.ts` sends `ticks_history` (`adjust_start_time`, `count`, `end: 'latest'`, `style: 'ticks'`) and a
   `proposal` subscription, and reads `history.prices`, `history.times`, `pip_size`, `proposal.ask_price` and `proposal.payout`.
   Tested against a fake only. Check the network tab on a demo account.
4. **Contract limits from memory:** Rise/Fall minimum 5 ticks, maximum 10 ticks in the form, Over prediction 0 to 8, Under 1 to 9.
   The live quote will refuse a combination that is not offered, and the page then falls back to the typed payout and says so.
5. **Payout rounding.** `winProfit` rounds the payout to cents. A real contract can differ by a cent.
6. **The Learn page text** is general education written without a compliance review. Read it, and have it checked if you
   operate under a financial promotions rule where you live. It does not tell anyone what to buy.
7. The market list in `bulk-trader.tsx` is the Volatility indices only (same as the Bot Builder). Forex, stocks and crypto
   symbols are not in the picker yet.

### Next steps, in order

1. Run the three pages in a browser on a demo account (`npm run serve trader`) and fix layout.
2. Add a few forex and crypto symbols to the Bulk Trader picker once their tick timing is confirmed.
3. Optional: save a run's settings in `localStorage`, or let the Bulk Trader export its trades as CSV (the Bot Builder already has one in `panel-utils.ts`).
4. Decide what the Telegram community rules are, and put them in the channel description.

---

# Earlier: where the work stood (2026-10-25, end of session)

Read this first. It is the short version; `docs/BOT_BUILDER_HANDOFF.md` has the deep detail on the bot engine
(block names, runner model, decisions not to undo).

Repo: `tor-webb/DERIIIV` (a white-label fork of the Deriv derivatives-trader monorepo, branded FiscoFX).
Everything described below lives in `packages/trader/src/AppV2/`.

## Session log, 2026-10-26 (newest first)

### Balance display fix, site guide assistant (branch `fix-balance-assistant`, not merged)

- **Bug fixed.** The dashboard, the top-nav balance and the Risk calculator printed `<span class="symbols usd"></span>9,987.00`
  as text. `formatMoney(currency, amount, false)` returns the currency as an HTML string, and React shows it literally.
  New `AppV2/Utils/format-balance.ts` (`formatBalance`, `formatBalanceWithCurrency`) returns plain text ("9,987.00",
  "9,987.00 USD"). Use it for every balance or money value in AppV2; do not call `formatMoney(..., false)` in JSX. The
  Trade page's own components (`risk-management-item`, contract details footer) were not touched. Tests added for the
  formatter, the top nav and the dashboard (the dashboard had no spec before).
- **Site guide assistant** (`Containers/Assistant/`), a "Help" button bottom-right on every page, mounted in `AppShell`.
  It is a built-in help list, **not a live AI model**: `assistant-knowledge.ts` holds topics with keywords, the best keyword
  match answers, and answers carry buttons (go to a page, or Log in via `redirectToLogin`). The panel says so ("not live AI,
  not financial advice"). Topics: log in, demo vs real (knows which you are on), balance, trade, charts, Bot Builder (what,
  import, limits, run), risk calculator, copy trading, positions, reports, "where am I", and an honest "no strategy guarantees
  profit" answer. To add a topic, add an entry to `topics()` and a case to `assistant-knowledge.spec.ts`.
  Making it a real AI would need a small server that holds the model key (GitHub Pages is static, and a key in the
  browser would be public). Put the call behind the same panel and keep the keyword list as the offline fallback.
- **Checked:** 22 new and changed tests pass; ESLint 0 errors; production build exit 0; headless Chromium at 1280px and 390px
  with the panel open (button clear of the Run bar and Reset button; the answer button navigates and closes the panel).
- **Bulk Trader: deliberately NOT built as asked.** The request was a Deriv-disconnected tool whose runs "mostly win with some
  losses". Results that are chosen in advance rather than coming from the market would present fake performance to users as
  a trading tool, which can push people towards real money. Two honest versions are possible and need a decision:
  (a) a clearly labelled **simulator** that replays real ticks and settles contracts with real payout maths, so its win rate
  is whatever the strategy genuinely does; (b) a bulk trader on the **Deriv demo account** through the existing Bot Builder
  engine (real demo contracts, real results). Both can use the Bot Builder look and be called "Bulk Trader".

### Merge to main and real-build check

- **Merged.** `bot-builder-deriv-look` was fast-forwarded into `main` (now `0586214`). Every other branch was already
  contained in `main`; `handoff-update` was left alone because `main` already has a newer handoff (#4). The old branches
  can be deleted on GitHub.
- **Deploy.** The GitHub Pages workflow for `0586214` ran the real webpack build and finished green.
- **Local production build** with the same commands and env as `.github/workflows/deploy_github_pages.yml` (note that
  `PUBLIC_BASE=DERIIIV/app` must be exported too, not only passed as the `base` argument, or the router base is wrong
  and every page shows 404): exit 0, warnings only (3, 49, 172, 169 for components, reports, trader, core).
- **Browser check** (headless Chromium, built app served at `/DERIIIV/app/`): `/bot-builder` renders the toolbar, the
  four green section blocks, the toolbox categories, the run panel (Summary / Transactions / Journal) and the Run bar.
  The only app-side failed request is Blockly's sprite from `blockly-demo.appspot.com` (the trashcan, gap 2 below).
- **NOT checked, and why:** a demo-account run. The sandbox cannot reach the Deriv websocket
  (`wss://staging-api.derivws.com` fails at the proxy) and has no account token. Someone with a Deriv demo login still
  needs to open the live site, log in, run Rise/Fall, then Matches/Differs with the KTH bot, and read the `proposal`
  payload in the network tab (`underlying_symbol`, integer `duration`, `barrier` for digit trades).
- **Uploaded KTH bot** was re-run through the importer and the simulated exchange: validates clean, DIGITDIFF on R_50,
  stake 0.35 to 0.70 after a loss and back after a win, durations vary. Its `rsi` variable is never calculated.

## What changed in the previous session

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
3. **Demo-account smoke test.** The real webpack build and a page-render check are done (see the session log above).
   What is left needs a Deriv demo login: run a bot on the live site and check the `proposal` payload in the network tab.
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
