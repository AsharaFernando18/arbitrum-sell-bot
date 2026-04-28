/**
 * Arbitrum Auto-Sell Bot — Multi-user support
 */

require("dotenv").config();
require("./lib/logger");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const cron = require("node-cron");
const db = require("./lib/database");

const USER_ID = process.env.USER_ID;

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function truthyEnv(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function localDayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const CONFIG = {
  RPC_URL: process.env.RPC_URL || "https://arb1.arbitrum.io/rpc",
  PRIVATE_KEY: process.env.PRIVATE_KEY,
  TOKEN_ADDRESS: process.env.TOKEN_ADDRESS || "0x60137Fca8149FFae539d0eEe96aa217e91865e41",
  USDT_ADDRESS: process.env.USDT_ADDRESS || "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  MIN_USDT: toNumber(process.env.MIN_USDT, 2),
  MAX_USDT: toNumber(process.env.MAX_USDT, 3),
  SLIPPAGE_BPS: toNumber(process.env.SLIPPAGE_BPS, 500),
  WINDOW_START_HOUR: toNumber(process.env.WINDOW_START_HOUR, 8),
  WINDOW_END_HOUR: toNumber(process.env.WINDOW_END_HOUR, 22),
  DRY_RUN: truthyEnv(process.env.DRY_RUN),
  MAX_DAILY_USDT: toNumber(process.env.MAX_DAILY_USDT, 1e9),
  MAX_GAS_GWEI: toNumber(process.env.MAX_GAS_GWEI, 0),
  USER_ID: USER_ID,
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
];

let sellTimeout = null;
let shuttingDown = false;

function log(msg) {
  const userPrefix = USER_ID ? `[${USER_ID}] ` : "";
  console.log(`[${new Date().toISOString()}] ${userPrefix}${msg}`);
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

async function withRetry(label, fn, { tries = 4, baseMs = 400 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === tries - 1) break;
      const wait = baseMs * 2 ** i;
;
      log(`WARN ${label} failed (attempt ${i + 1}/${tries}): ${err.message} — retry in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function mergeState(patch) {
  const prev = (await db.getBotState(USER_ID)) || {};
  const next = { ...prev, ...patch, version: 1 };
  await db.saveBotState(USER_ID, next);
  return next;
}

function randomDelayMs() {
  const now = new Date();
  const startH = parseInt(CONFIG.WINDOW_START_HOUR, 10) || 8;
  const endH = parseInt(CONFIG.WINDOW_END_HOUR, 10) || 22;

  let minTime = new Date(now);
  minTime.setHours(startH, 0, 0, 0);

  let maxTime = new Date(now);
  maxTime.setHours(endH, 0, 0, 0);

  const nowMs = now.getTime();
  let targetMs;

  if (nowMs >= maxTime.getTime()) {
    // Past today's window. Schedule for tomorrow.
    minTime.setDate(minTime.getDate() + 1);
    maxTime.setDate(maxTime.getDate() + 1);
    targetMs = minTime.getTime() + Math.random() * (maxTime.getTime() - minTime.getTime());
  } else if (nowMs < minTime.getTime()) {
    // Before today's window.
    targetMs = minTime.getTime() + Math.random() * (maxTime.getTime() - minTime.getTime());
  } else {
    // Currently inside the window.
    targetMs = now.getTime() + Math.random() * (maxTime.getTime() - now.getTime());
  }

  return Math.max(0, targetMs - now.getTime());
}

async function fetchKyberQuote(amountIn, tokenDecimals) {
  const url = `https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?tokenIn=${CONFIG.TOKEN_ADDRESS}&tokenOut=${CONFIG.USDT_ADDRESS}&amountIn=${amountIn.toString()}`;
  log(`Fetching quote from KyberSwap...`);
  const res = await fetch(url);
  const data = await res.json();
  if (data.code !== 0 || !data.data || !data.data.routeSummary) {
    throw new Error(`Kyber route failed: ${data.message || "No route found"}`);
  }
  return data.data.routeSummary;
}

async function buildKyberTransaction(routeSummary, walletAddress) {
  const url = `https://aggregator-api.kyberswap.com/arbitrum/api/v1/route/build`;
  const body = {
    routeSummary,
    sender: walletAddress,
    recipient: walletAddress,
    slippageTolerance: CONFIG.SLIPPAGE_BPS,
    deadline: Math.floor(Date.now() / 1000) + 300,
    source: "api"
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.code !== 0 || !data.data || !data.data.data) {
    throw new Error(`Kyber build failed: ${data.message || "Failed to build tx"}`);
  }
  return data.data;
}

async function executeSell() {
  if (shuttingDown) return;
  if (!CONFIG.PRIVATE_KEY) {
    log("ERROR: PRIVATE_KEY not set");
    await mergeState({ lastError: "missing_private_key" });
    return;
  }

  const dayKey = localDayKey();
  let st = await db.getBotState(USER_ID) || {};
  if (st.dayKey !== dayKey) {
    await mergeState({ dayKey, todayUsdtTotal: 0 });
  }
  st = await db.getBotState(USER_ID) || {};

  const provider = new ethers.providers.JsonRpcProvider(CONFIG.RPC_URL);
  const wallet = new ethers.Wallet(CONFIG.PRIVATE_KEY, provider);
  const token = new ethers.Contract(CONFIG.TOKEN_ADDRESS, ERC20_ABI, wallet);
  const usdt = new ethers.Contract(CONFIG.USDT_ADDRESS, ERC20_ABI, provider);

  await mergeState({ lastError: null });

  let usdtAmount = randomBetween(CONFIG.MIN_USDT, CONFIG.MAX_USDT);
  const usdtDecimals = await withRetry("usdt.decimals", () => usdt.decimals());
  const tokenBalance = await withRetry("token.balance", () => token.balanceOf(wallet.address));
  const tokenDecimals = await withRetry("token.decimals", () => token.decimals());
  const tokenSymbol = await withRetry("token.symbol", () => token.symbol());

  const todayTotal = toNumber(st.todayUsdtTotal, 0);
  const room = Math.max(0, CONFIG.MAX_DAILY_USDT - todayTotal);
  if (room <= 0) {
    log(`SKIP: daily USDT cap reached (${CONFIG.MAX_DAILY_USDT} USDT).`);
    await mergeState({ lastError: "daily_cap" });
    return;
  }
  if (usdtAmount > room) {
    log(`Clamping target USDT from ${usdtAmount.toFixed(4)} to ${room.toFixed(4)} (daily cap).`);
    usdtAmount = room;
  }

  log(`Target sell (max): ${usdtAmount.toFixed(4)} USDT (today total ~${todayTotal.toFixed(4)} USDT)`);
  log(`${tokenSymbol} balance: ${ethers.utils.formatUnits(tokenBalance, tokenDecimals)}`);

  if (tokenBalance.isZero()) {
    log("ERROR: Token balance is 0.");
    await mergeState({ lastError: "zero_balance" });
    return;
  }

  if (CONFIG.MAX_GAS_GWEI > 0) {
    const gasPrice = await withRetry("gasPrice", () => provider.getGasPrice());
    const gwei = Number(ethers.utils.formatUnits(gasPrice, "gwei"));
    if (gwei > CONFIG.MAX_GAS_GWEI) {
      log(`SKIP: gas ${gwei.toFixed(2)} gwei > MAX_GAS_GWEI (${CONFIG.MAX_GAS_GWEI}).`);
      await mergeState({ lastError: "gas_too_high", lastGasGwei: gwei });
      return;
    }
  }

  let routeSummary;
  try {
    routeSummary = await withRetry("fetchKyberQuote", () => fetchKyberQuote(tokenBalance, tokenDecimals));
  } catch (err) {
    log(`ERROR: Route quote failed — ${err.message}`);
    await mergeState({ lastError: "no_quote" });
    return;
  }

  let estUsdtOut = Number(ethers.utils.formatUnits(routeSummary.amountOut, usdtDecimals));
  let amountIn = tokenBalance;

  if (estUsdtOut > usdtAmount) {
    const ratio = usdtAmount / estUsdtOut;
    const scaledTokens = tokenBalance.mul(Math.floor(ratio * 10000)).div(10000);
    log(`Full balance gives ~${estUsdtOut.toFixed(4)} USDT. Scaling down input to ~${(ratio * 100).toFixed(2)}% to target ${usdtAmount.toFixed(4)} USDT.`);
    amountIn = scaledTokens;

    try {
      routeSummary = await withRetry("fetchKyberQuoteScaled", () => fetchKyberQuote(amountIn, tokenDecimals));
      estUsdtOut = Number(ethers.utils.formatUnits(routeSummary.amountOut, usdtDecimals));
    } catch (err) {
      log(`ERROR: Scaled route quote failed — ${err.message}`);
      await mergeState({ lastError: "no_scaled_quote" });
      return;
    }
  }

  if (estUsdtOut + todayTotal > CONFIG.MAX_DAILY_USDT + 1e-9) {
    log("SKIP: Swap would exceed daily USDT cap.");
    await mergeState({ lastError: "daily_cap_exceeded" });
    return;
  }

  if (CONFIG.DRY_RUN) {
    log(
      `[DRY_RUN] Would swap ~${ethers.utils.formatUnits(amountIn, tokenDecimals)} ${tokenSymbol} for ~${estUsdtOut.toFixed(4)} USDT via Kyber`
    );
    await mergeState({ lastError: null, lastDryRunAt: Date.now() });
    return;
  }

  let txData;
  try {
    txData = await withRetry("buildKyberTransaction", () => buildKyberTransaction(routeSummary, wallet.address));
  } catch (err) {
    log(`ERROR: Build tx failed — ${err.message}`);
    await mergeState({ lastError: "build_tx_failed" });
    return;
  }

  const routerAddress = txData.routerAddress;

  async function ensureApprove(spender, amountMax) {
    const allowance = await token.allowance(wallet.address, spender);
    if (allowance.lt(amountMax)) {
      log(`Approving Kyber Router (${spender})...`);
      const approveTx = await withRetry("approve", () =>
        token.approve(spender, ethers.constants.MaxUint256)
      );
      await approveTx.wait();
      log(`Approved. Tx: ${approveTx.hash}`);
    }
  }

  await ensureApprove(routerAddress, amountIn);

  try {
    log("Submitting swap transaction via Kyber...");
    const tx = await withRetry("sendTransaction", () => wallet.sendTransaction({
      to: routerAddress,
      data: txData.data,
      value: txData.transactionValue,
      gasLimit: Math.floor(Number(txData.gas || 500000) * 1.2)
    }));
    log(`Tx submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    log(`✅ Sell confirmed! Block: ${receipt.blockNumber}`);
    log(`   View: https://arbiscan.io/tx/${tx.hash}`);
    const nextTotal = todayTotal + estUsdtOut;
    await mergeState({
      todayUsdtTotal: nextTotal,
      lastSellAt: Date.now(),
      lastTxHash: tx.hash,
      lastError: null,
    });
    await db.appendHistory(USER_ID, {
      kind: "sell",
      mode: "aggregator",
      txHash: tx.hash,
      usdtEst: estUsdtOut,
      fee: "auto",
      tokenIn: ethers.utils.formatUnits(amountIn, tokenDecimals),
      symbol: tokenSymbol,
      userId: CONFIG.USER_ID,
    });
  } catch (err) {
    log(`ERROR: Swap transaction failed — ${err.message}`);
    await mergeState({ lastError: err.message?.slice(0, 200) || "swap_failed" });
  }
}

async function scheduleTodaySell() {
  if (sellTimeout) {
    clearTimeout(sellTimeout);
    sellTimeout = null;
  }
  const delayMs = randomDelayMs();
  const fireAt = Date.now() + delayMs;
  log(`Next sell scheduled at: ${new Date(fireAt).toLocaleString()} (in ${(delayMs / 60000).toFixed(1)} min)`);
  await mergeState({ nextSellAt: fireAt });
  sellTimeout = setTimeout(async () => {
    sellTimeout = null;
    log("─── Starting daily sell ───");
    await executeSell();
    log("─── Sell complete. Waiting for tomorrow. ───");
  }, delayMs);
}

cron.schedule("0 0 * * *", () => {
  log("Midnight reset — scheduling today's sell...");
  scheduleTodaySell();
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`Shutting down (${signal})...`);
  if (sellTimeout) {
    clearTimeout(sellTimeout);
    sellTimeout = null;
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

log("Bot started.");
if (USER_ID) {
  log(`Running in multi-user mode for user: ${USER_ID}`);
}

const dataDir = path.join(__dirname, "data", USER_ID || "");
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch {
    /* ignore */
  }
}

if (truthyEnv(process.env.INSTANT_SELL)) {
  log("Starting INSTANT SELL mode...");
  executeSell().then(() => {
    log("Instant sell completed.");
    process.exit(0);
  }).catch((err) => {
    log(`Instant sell failed: ${err.message}`);
    process.exit(1);
  });
} else {
  scheduleTodaySell();
}
