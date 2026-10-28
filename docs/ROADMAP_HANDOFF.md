# Handoff and roadmap: what to build next (written 2026-10-28)

Read this first if you are picking the project up. It says where things stand, how to work in this repo without
losing time, and then lists **everything we agreed to build**, in order, with enough detail to start each one.
Older notes: `docs/HANDOFF.md` (site-wide state), `docs/BOT_BUILDER_HANDOFF.md` (bot engine),
`docs/TEMPLATES_AND_MARKETS_HANDOFF.md` (the two pages built on 2026-10-28, how their numbers are defined).

## 1. Where things stand

| Item                                                       | State                                     |
| ---------------------------------------------------------- | ----------------------------------------- |
| Bot Templates (5 ready-made bots, one-tap import)          | Merged to `main` (PR #7).                 |
| Markets / Watchlist page (`/markets`)                      | Merged to `main` (PR #7).                 |
| Help assistant knows Markets and Templates                 | This branch: `assistant-and-market-bots`. |
| "Build a bot for this market" (Markets row to Bot Builder) | This branch.                              |

Both merged features and this branch's work have **never been looked at in a browser** and **never run against the
live Deriv socket**. Section 3 lists the checks that need a person with a demo account. Do those before promoting the pages.

### What this branch changed

- **Assistant** (`Containers/Assistant/assistant-knowledge.ts`): topics `markets` and `bot_templates`, a hint for the
  Markets page in "where am I", two new suggested questions, greeting and fallback text. Tests route eight new
  questions and check the answers never promise results.
- **Markets to Bot Builder:**
    - `Markets/markets.tsx`: a **Bot** button on every row goes to `/bot-builder?market=SYMBOL`. It is disabled (with a
      tooltip) for markets Bot Builder cannot trade yet and for unavailable ones.
    - `BotBuilder/bot-builder.tsx`: reads `?market=` once on load (`readMarketParam`), opens the Templates drawer, and removes
      the parameter from the address when the drawer is closed, a template is loaded, or "Show all markets" is pressed.
    - `BotBuilder/templates.ts`: `getBotTemplates(symbol?)` rebuilds every bot for that market. **Digit bots are left out for forex**
      (digit contracts exist only on Derived markets) and **forex bots use 5 minute contracts** (forex has no tick contracts).
      This forex duration is a decision made without a live check; see section 3.
    - `BotBuilder/bot-markets.ts` (new): the market list (`MARKETS`) moved out of `blocks.ts` (which re-exports it) plus
      `findBotMarket(symbol)`. It has no Blockly import, so the Markets page chunk stays small (123 KB, checked in the build).
    - `BotBuilder/templates-panel.tsx`: a banner "Bots for EUR/USD." with a "Show all markets" link.

## 2. Working in this repo (things that cost time before)

- **Clone:** `git clone --depth 1 https://github.com/tor-webb/deriiiv` then `npm ci --ignore-scripts --no-audit --no-fund` (about 40 s, Node 22.14+ or 24).
- **Run tests from `packages/trader`:** `npx jest src/AppV2` (about 3 minutes). Running from the repo root misses the package config.
- **Lint and types:** `npx eslint packages/trader/src/AppV2 --ext .ts,.tsx` (warnings are normal, errors are not), `npx stylelint "packages/trader/src/AppV2/**/*.scss"`,
  `cd packages/trader && npx tsc --noEmit -p tsconfig.json` (filter the output for the folders you touched; the package has older noise).
- **Build check:** `cd packages/trader && npx webpack --config ./build/webpack.config.js --env base=/` (about 2 minutes). Catches what Jest cannot.
- **Pull requests from Claude Code sessions:** `gh pr create` fails because GraphQL is blocked. Use REST:
  `gh api repos/tor-webb/DERIIIV/pulls -X POST -f title=... -f head=BRANCH -f base=main -F body=@file.md`, and merge with
  `gh api repos/tor-webb/DERIIIV/pulls/N/merge -X PUT -f merge_method=merge`.
- **Shallow clone and the stop hook:** after pushing, the hook can claim the branch is unpushed because a shallow clone has no
  tracking ref. Check `git ls-remote --heads origin BRANCH`, then run
  `git fetch origin +refs/heads/BRANCH:refs/remotes/origin/BRANCH`.
- **Keep Blockly out of other pages.** Anything another page imports from `BotBuilder/` must not import `blockly`
  (that is why `bot-markets.ts` exists). Check the chunk after a change: a Markets chunk of about 120 KB is right; megabytes means Blockly leaked in.
- **Repo conventions:** styles use `@include mobile-screen`, tokens like `var(--color-surface-section)`, never edit the generated colour SCSS (see `CLAUDE.md`).
  Every new page needs: route in `shared/src/utils/routes/routes.ts`, a lazy entry in `AppV2/Routes/routes.tsx`, a tab in `TopNav`,
  an entry in `MOBILE_NAV_ROUTES` (`AppShell`), a Dashboard card, and a Help assistant topic.
- **Honesty rule for all trading copy:** no page, bot or label may suggest a result is likely. Keep a plain risk line on anything that places or suggests trades.
  Do not build tools that pick "mostly winning" results (see `HANDOFF.md`, Bulk Trader decision).

## 3. Checks that need a person with a browser and a Deriv demo account (do these first)

1. Open `/markets` and `/bot-builder` at 390 px and 1280 px. The phone row layout in `markets.scss` (now with two buttons in the last cell) and the Templates drawer were written without seeing them.
2. **Live data:** in the network tab confirm `ticks_history` with `style: candles`, `granularity: 60`, `count: 60` is accepted for all 20 symbols in `Markets/markets-config.ts`, and that `ticks` subscriptions return `tick.quote`, `tick.epoch`, `tick.pip_size`.
3. **Trade hand-off:** tap Trade on a market that is not the current one, including after the Trade page was already open in the same session (the store reads `?symbol=` once).
4. **Forex bots:** load a bot from a forex row (Markets, Bot, Import), run it on demo, and read the `proposal` payload. Confirm 5 minute Rise/Fall is accepted for that pair. If the server wants a different minimum, change `FOREX_MINUTES` in `BotBuilder/templates.ts`.
5. **Each template** (Rise/Fall, Even/Odd, Over 2, Win ladder, Martingale) once on demo; read the `proposal` payload (`underlying_symbol`, integer `duration`, `barrier` only for Over/Under).
6. Open the Help button and ask: "where are the ready-made bots", "how do I use the watchlist", "which market should I trade".

## 4. The roadmap (agreed; build in this order)

Each item lists the goal, where it goes, what to reuse, and how you know it is done. Every item also needs tests, the lint, types and build checks in section 2, a Help assistant topic, and a note in this file.

### A. Bot Builder safety (highest priority, before promoting bots for real money)

Goal: a bad bot or a dropped connection cannot hurt a user more than they chose.

- **Maximum stake cap.** Today the interpreter rounds stakes to 2 decimals but accepts any size. Add a "Max stake per trade" field next to the existing limits in the run panel (`run-panel.tsx`, limits state `TRunLimitsInput` in `bot-builder.tsx`), pass it to `BotRunner` limits, and refuse (stop the bot with a clear message) any trade above it. Real accounts should default to a sensible cap, demo to none.
- **Socket drop with an open contract.** `Engine/runner.ts` waits for contract updates forever if the socket dies. Add a watchdog: if no `proposal_open_contract` update for N seconds, resubscribe; after a few failures, stop the bot and show the contract id and "check Positions" in the journal. `Engine/ws-adapter.ts` is where the subscription is created.
- **Real-account banner while running.** A persistent red strip in `bot-builder.tsx` while `run_status` is running or stopping on a non-virtual account.
- Done when: unit tests with a fake API cover cap-exceeded, stalled contract and resubscribe; demo-account run shows each message.

### B. Markets quick wins

Goal: make the page faster to scan. All in `Containers/Markets/`.

- **Search box** over name and symbol (filter in `markets.tsx`, pure helper in `markets-utils.ts`).
- **Window switch** 1h / 4h / 1d: `WINDOW_MINUTES` and the candle `granularity` become state in `use-markets.ts` (4h: granularity 300 count 48; 1d: granularity 3600 count 24 are suggestions, confirm the API accepts them). Re-label "1h change/range" from the window.
- **Sparkline per row** from the candle closes already fetched (inline SVG, no library). Keep the closes in the entry (`TMarketEntry`).
- **"Open in Charts"** link: confirm how `ChartsPage` picks its symbol (it calls `useDefaultSymbol`), then reuse the same hand-off as the Trade button.
- **Watchlist on the Dashboard:** read `readWatchlist()` and show the starred markets with live price using the same hook, limited to the starred symbols so the Dashboard does not load all 20.
- **Symbols from `active_symbols`** instead of the fixed list in `markets-config.ts`, so new markets appear without code. Then Bot button support must follow `bot-markets.ts`, which still needs those symbols added (verify each symbol's submarket against a real `active_symbols` response before adding; do not guess).
- Done when: tests per helper, a manual look at both widths, chunk still light.

### C. Save your own bots as templates

Goal: "Bring it back" currently vanishes on reload; users should keep bots they like.

- Add "Save as template" in the toolbar: name prompt, store `exportWorkspaceXml(workspace)` in `localStorage` (key `bot_builder_saved_bots`, cap about 20 and about 200 KB each, handle quota errors like `saveWorkspaceToStorage` does).
- Show saved bots in the Templates drawer under the built-in ones with Import and Delete. Import goes through `parseBotFile` and `loadParsedBot` exactly like a file (never trust stored text).
- Also persist the replaced bot so "Bring it back" survives a reload (a single `bot_builder_previous` slot).
- Done when: tests for save, list, import, delete, corrupt storage, and quota error.

### D. More Bot Builder blocks (opens up many real Deriv bots)

Goal: bots exported from Deriv Bot stop being refused. Order by user value: more digit and up/down contract types; candle and indicator blocks (SMA, EMA, RSI, Bollinger); `check_direction`; more math and text blocks.

- Every block needs: a definition in `blocks.ts`, an entry in `ALLOWED_BLOCK_TYPES`, a compiler case in `Engine/compile.ts`, an interpreter or runner path, and a test. Change `Engine/types.ts`, the compiler and the tests together.
- First confirm the still-unconfirmed names in `BOT_BUILDER_HANDOFF.md` section 3 against a real Deriv Bot export that uses them.
- Wire the unused settings: `restart_buy_sell`, `candle_interval`, notify sound, account-currency stake label (currently hard-coded `USD` in templates and the block).
- Done when: a real exported bot using the new blocks imports and runs on demo.

### E. Trade journal and performance page

Goal: show a user their own results honestly (win rate against break-even, best and worst markets, stake over time).

- New container `Containers/Journal/` and route `/journal` (logged-in only). Source: the Deriv statement or profit-table API through the same `WS` helper used elsewhere (`@deriv/shared`); check how `packages/reports` already calls it before writing new calls.
- Compute in a pure `journal-utils.ts` (win rate, break-even from average payout, per-market totals, running stake). Reuse `Containers/StakeTools/stake-math.ts` for break-even maths.
- Copy must state results are past and do not predict the future. No ranking of users, no "hot streak" language.
- Done when: tests on the maths with fixed trade lists, an empty state, and a logged-out state that asks for login.

### F. Price alerts for watchlisted markets

Goal: a pop-up when a starred market moves more than a chosen amount in an hour.

- Reuse the alert plumbing in `Containers/News/news-notifier.tsx` and its "alerts on/off" switch (`areAlertsOn`). Add per-market thresholds stored in `localStorage` next to the watchlist.
- Data: `use-markets.ts` already has live rows, but it only runs while the Markets page is open. Decide between a light shared hook mounted in `AppShell` for starred markets only (preferred) or alerts only while the page is open (simple, weaker).
- Rate limit the pop-ups (one per market per hour) and let the user switch them off.
- Done when: tests for threshold crossing, de-duplication, and storage.

### G. Smaller items already on the list

- Phone tab bar: pin the Menu tab; hide the grey "Not logged in" strip when logged out (`HANDOFF.md`).
- Telegram link: set `telegram_url` in `brand.config.json` (must be a `t.me` link) so Learn shows its button.
- Bulk Trader decision (simulator stays; optionally a demo-account bulk bot through the Bot Builder engine).
- Delete merged branches: `bot-deriv-compat`, `bot-run-engine`, `bot-builder-page`, `bot-templates-and-markets`, `assistant-and-market-bots` once merged; confirm `github-pages-fix` is dead first.
- Check the latest "Deploy to GitHub Pages" run after every merge to `main`.

## 5. Decisions already made (do not undo without asking the user)

- Imports and templates go through the allow-list importer; nothing bypasses `parseBotFile`.
- Templates are examples, never advice; each card keeps its caution line. Both stake-changing bots cap their stake at 16 times the first stake.
- Volatility on Markets is the last hour's range ranked within Derived or Forex separately; it is described as past movement, not a forecast.
- The Help assistant is a keyword list, not live AI. New pages get a topic and tests.
- Real accounts need a stop-loss limit and a confirmation before a bot runs (already built); item A adds to this, never relaxes it.
