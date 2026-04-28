# Arbitrum Auto-Sell Bot

Automatically sells a random amount of your token (worth 2–3 USDT) at a random time each day on Uniswap V3 (Arbitrum).

---

## What it does
- Every day, picks a **random time between 8:00 AM – 10:00 PM**
- Sells a **random amount worth 2–3 USDT** of your token
- Uses **Uniswap V3 ExactOutput** swap (you get exactly the USDT, spend minimum tokens)
- Logs every action with Arbiscan transaction links

---

## Setup (5 steps)

### Step 1 — Install Node.js
Download from https://nodejs.org (v18 or higher)

### Step 2 — Install dependencies
```bash
cd arbitrum-sell-bot
npm install
```

### Step 3 — Configure your wallet
```bash
cp .env.example .env
```
Edit `.env` and add your private key:
```
PRIVATE_KEY=0xabc123...your_key_here
```

> ⚠️ **How to export from MetaMask:**
> MetaMask → Click your account → Account Details → Export Private Key

> ⚠️ **Never share your private key. Never commit .env to Git.**

### Step 4 — Test (no transaction, just a quote)
```bash
node test-sell.js
```
You should see your token balance and a successful quote. If the quote fails, set `AUTO_POOL_FEE=true` or change `POOL_FEE` in `.env` to `10000`.

### Step 5 — Run the bot
```bash
node bot.js
```
The bot will log when today's sell is scheduled and confirm after execution.

---

## New: Web Dashboard Interface

You can control the bot from a browser:

```bash
npm run ui
```

Then open:

`http://localhost:3000`

Dashboard features:
- Animated control UI, chain health, bot state, next-sell countdown, local fill history
- Start / stop bot, run `test-sell`, live console stream
- Save `.env` from the UI (private key never echoed back; leave blank to keep)
- Optional **`DASHBOARD_PASSWORD`**: when set, browser login (cookie session) is required for all API routes
- Run tests: `npm test`

Bot / safety extras (see `.env.example`):
- **`AUTO_POOL_FEE`**: quote 0.05% / 0.3% / 1% tiers and pick the best
- **`DRY_RUN`**: quotes and logs only, no swaps
- **`MAX_DAILY_USDT`**: approximate daily notional cap
- **`MAX_GAS_GWEI`**: skip swaps when base fee exceeds this (0 = off)
- **Retries** on RPC, **graceful shutdown** on SIGTERM, **`exactInput`** fallback when balance is below exact-output need
- State file `data/bot-state.json`, history append `data/history.jsonl`

---

## Run 24/7 (Recommended: PM2)

Install PM2 to keep the bot running even after you close the terminal:

```bash
npm install -g pm2
pm2 start bot.js --name sell-bot
pm2 save
pm2 startup   # auto-start on reboot
```

View logs:
```bash
pm2 logs sell-bot
```

---

## Configuration (environment / dashboard)

| Variable | Default | Description |
|---|---|---|
| `POOL_FEE` | 3000 | Fee tier when `AUTO_POOL_FEE` is false |
| `AUTO_POOL_FEE` | false | Pick best of 500 / 3000 / 10000 |
| `DRY_RUN` | false | No on-chain swaps |
| `MAX_DAILY_USDT` | large | Cap approximate USDT sold per local day |
| `MAX_GAS_GWEI` | 0 | Skip if gas price above this (0 = disabled) |
| `MIN_USDT` | 2 | Minimum USDT to receive per sell |
| `MAX_USDT` | 3 | Maximum USDT to receive per sell |
| `SLIPPAGE_BPS` | 500 | Slippage tolerance (500 = 5%) |
| `WINDOW_START_HOUR` | 8 | Earliest hour bot can sell |
| `WINDOW_END_HOUR` | 22 | Latest hour bot can sell |
| `DASHBOARD_PASSWORD` | unset | If set, dashboard requires login |
| `SESSION_SECRET` | optional | Cookie signing secret (defaults derive from password) |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Quote failed / no liquidity | Change `POOL_FEE` to `10000` in bot.js |
| Swap reverted | Increase `SLIPPAGE_BPS` to 1000 (10%) |
| "insufficient funds" | Add ETH to wallet for gas fees |
| Bot stops after reboot | Use PM2 (see above) |

---

## Security Tips
- Use a **dedicated wallet** just for this bot (not your main wallet)
- Only keep enough tokens + a small amount of ETH (for gas) in that wallet
- Never expose your `.env` file
