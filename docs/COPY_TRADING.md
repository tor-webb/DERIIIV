# Copy trading and risk calculator

Added 2026-10-25. Two pages in the trader app (`packages/trader/src/AppV2/Containers/`):

| Page            | Route              | Folder            |
| --------------- | ------------------ | ----------------- |
| Risk calculator | `/risk-calculator` | `RiskCalculator/` |
| Copy trading    | `/copy-trading`    | `CopyTrading/`    |

Both are linked from the dashboard cards and the top navigation. The sidebar **Home** button now opens the in-app
dashboard (`/dashboard`) instead of Deriv.

## How copy trading works (no server needed)

This uses Deriv's own copy trading, not a server of ours.

1. **You (the trader)** turn on copiers for your account (`set_settings` with `allow_copiers: 1`, or the Deriv
   settings page) and create a **read-only** API token at https://app.deriv.com/account/api-token. Read is the only
   scope that should be ticked.
2. Put that token in `brand.config.json`:

    ```json
    "copy_trading": { "enabled": true, "trader_name": "FiscoFX", "trader_token": "YOUR_READ_ONLY_TOKEN" }
    ```

    The token ends up in the public site bundle. That is acceptable only because it is read-only: it cannot place
    trades or move money. **Never put a token with Trade, Payments, Trading information or Admin scope here.**

3. **A follower** logs in with their Deriv account (OAuth, as for the rest of the app), ticks the risk box, optionally sets
   a smallest and largest stake, and presses _Start copying_. The page sends `copy_start` with your token on the
   follower's own session. Deriv then places your new trades on their account. _Stop copying_ sends `copy_stop`.
4. On load the page calls `copytrading_list` to see whether the account is already copying you.

The site never sees or stores a follower's password or API token.

## Not verified yet

- Never run against the real Deriv socket. Tests use a fake API. Try it with a demo follower account first and check
  the `copy_start`, `copy_stop` and `copytrading_list` messages in the network tab.
- `copytrading_list` is assumed to return each trader's `token` so the page can tell it is already copying you. If it
  does not, the page still works, but after a reload it shows _Start copying_ until the user presses it again.
- Whether Deriv allows copying onto demo accounts is not confirmed.
- Copy trading on Deriv covers options only (not MT5).
- The OAuth login scope in `packages/shared/src/utils/login/login.ts` is `trade`. Confirm it is enough for `copy_start`.
- Real-money and advertising rules for offering copy trading differ by country. Check yours before promoting it.

## Risk calculator

Pure maths lives in `RiskCalculator/risk-utils.ts` (tested in `__tests__/risk-utils.spec.ts`):

- **Position size:** `lots = (balance x risk%) / (stop loss pips x pip value per lot)`.
- **Reward to risk** and the win rate needed to break even.
- **Stake plan:** stake from risk %, expected result per trade, chance and drawdown of 3, 5 and 10 losses in a row,
  and how many trades a doubling (martingale) bot can fund before the balance runs out.
