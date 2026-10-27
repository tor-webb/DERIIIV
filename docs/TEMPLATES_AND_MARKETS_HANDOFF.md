# Handoff: Bot Templates and Markets (written 2026-10-28)

Branch: `bot-templates-and-markets` (off `main` at `827a54b`). Two features, both tested, **neither seen in a browser yet**.
An earlier session had built these but never pushed, and its sandbox was lost, so this is a rebuild from the brief:

1. **Bot Templates (strategy library):** a few ready-made bots users can import into Bot Builder in one tap.
2. **Markets / Watchlist:** live prices with top movers and volatility, so users can choose what to trade before they open the Trade page.

## What was built

### 1. Bot Templates, in `packages/trader/src/AppV2/Containers/BotBuilder/`

| File                             | Role                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `templates.ts`                   | `getBotTemplates()`: five bots as Deriv-style XML built by `buildBotXml`. Each has a name, description, level, risk, fact chips and a plain-language caution.                        |
| `templates-panel.tsx` / `.scss`  | The "Templates" drawer: cards, an Import button on each, a "Bring it back" link after a template replaced the user's bot.                                                            |
| `bot-builder.tsx`                | New toolbar button **Templates**; `importTemplate` and `restorePreviousBot`. Import is disabled while a bot runs.                                                                    |
| `__tests__/templates.spec.ts`    | Every template: passes `parseBotFile`, loads, has all four sections, no validation errors, compiles. Stake sequences of the two stake-changing bots are run through the interpreter. |
| `__tests__/bot-builder.spec.tsx` | Five new page tests (open/close, one-tap import, failed load, restore, disabled while running).                                                                                      |

The templates: **Rise/Fall steady stake**, **Even/Odd** (1 tick), **Digit Over 2**, **Win ladder** (stake + first stake after a win, reset after a loss),
**Martingale (capped)** (stake x2 after a loss, reset after a win). Both stake-changing bots reset to the first stake once the stake passes 16x,
so the largest stake either one sends is 16 (checked by tests).

Design decisions:

- A template is **just an XML string through the existing importer** (`parseBotFile` then `loadParsedBot`). It gets the same allow-list scan as a user file. Adding a template needs no new block types.
- Importing **replaces the workspace**, so the old bot is kept in memory (`previous_bot_ref`) and "Bring it back" restores it. It is lost on page reload.
- The risk wording is deliberate: no template is sold as profitable. Keep the `caution` line on every new template.
- The stake label is still `USD` inside the XML (known item 4 in `BOT_BUILDER_HANDOFF.md`).

### 2. Markets, in `packages/trader/src/AppV2/Containers/Markets/`

| File                    | Role                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `markets-config.ts`     | The 20 listed markets (10 Volatility indices, 10 forex pairs), the 60-minute window, the "stopped ticking" limit (10 min), the storage key.                                            |
| `markets-utils.ts`      | Pure logic: candle parsing, `applyTick`, `buildRow`, volatility levels, top movers, sorting, formatting, watchlist storage.                                                            |
| `use-markets.ts`        | Loads 60 one-minute candles per market (5 requests at a time), then follows live ticks. Ticks are batched and shown once a second.                                                     |
| `markets.tsx` / `.scss` | The page: status line, Top gainers / Top losers, filter pills (All, Watchlist, Derived, Forex), sort, rows with star, price, 1h change, 1h range, volatility badge and a Trade button. |
| `__tests__/`            | 47 tests: utils, the hook against a fake socket, the page.                                                                                                                             |

Wiring: `routes.markets = '/markets'` (`packages/shared/src/utils/routes/routes.ts`), lazy route in `Routes/routes.tsx`, a **Markets** tab in `TopNav`
(so it also appears in the phone tab bar), `MOBILE_NAV_ROUTES` in `AppShell`, and a Markets card on the Dashboard.

How the numbers are defined (so nobody has to guess):

- **1h change** = last price vs. the open of the first one-minute candle of the last 60.
- **1h range** = (hour high - hour low) / hour low. This is the page's measure of volatility.
- **Volatility badge** (Low / Medium / High) = the market's range ranked in thirds **within its own group** (Derived or Forex), because the two live on very different scales. A group with fewer than three live markets shows Medium.
- **Top movers** leave out closed and not-yet-loaded markets.
- A market with no tick for 10 minutes is tagged **Closed** and gets no badge.
- **Watchlist** is the starred markets, kept in `localStorage` (`markets_watchlist`, per browser, not per account).
- **Trade button:** sets the Trade store's symbol (`onChange` + `processContractsForV2`, the same calls `useDefaultSymbol` makes), then goes to `/?symbol=...`. If switching fails it still navigates, and the Trade store reads `?symbol=` the first time it loads.

## What is verified and what is not

**Verified by running it:** `npx jest src/AppV2` passes (191 suites, 1,595 tests at the last full run; Markets and Templates are among them); ESLint reports
0 errors on the new files (the only warning on new code is the `no-restricted-exports` on `Markets/index.ts`, the same one `BotBuilder/index.ts` has);
Stylelint exit 0; `tsc` shows no errors in the touched files.

**NOT verified, do these first (they need a browser and a Deriv demo account):**

1. **Never seen on screen.** Check the Templates drawer and the Markets page at 390px and 1280px. The phone row layout in `markets.scss` (`@include mobile-screen`) was written blind.
2. **Never run against the real socket.** Confirm in the network tab that `ticks_history` with `style: 'candles'`, `granularity: 60`, `count: 60` is accepted for every listed symbol, and that `ticks` subscriptions send `tick.quote`, `tick.epoch` and `tick.pip_size`. Any symbol the server refuses shows as "Unavailable" with a Try again link.
3. **Trade hand-off.** Open `/markets`, tap Trade on a market that is not the current one, and check the Trade page really switches to it, including after you have already visited Trade in the same session (the URL read happens once per store). Check a closed forex market too.
4. **Run each template once on a demo account** (Rise/Fall, Over/Under with prediction 2, Even/Odd, both stake-changing bots) and read the `proposal` payload. The stake-changing logic is tested against the interpreter, not against live contracts.
5. **webpack build** of the trader package was not run in this session.

## Ideas for next time

- Remember the last imported bot across reloads (today "Bring it back" lives only until the page reloads).
- Let the user save their own bot as a template.
- Markets: a search box, a 1h/4h/1d window switch, a sparkline per row, an "open in Charts" link, more symbols (use `active_symbols` instead of the fixed list in `markets-config.ts`).
- Show the watchlist on the Dashboard.
- Add the two pages to the Help assistant's keyword list (`Containers/Assistant/assistant-knowledge.ts`), which does not know about Markets yet.
