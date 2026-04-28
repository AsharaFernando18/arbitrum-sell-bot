require("dotenv").config();
require("./lib/logger");
const express = require("express");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { ethers } = require("ethers");
const session = require("./lib/session");
const { validateConfig } = require("./lib/config-validator");
const db = require("./lib/database");
const botManager = require("./lib/bot-manager");

const PORT = Number(process.env.UI_PORT || 3000);
const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

const state = {
  logs: [],
  clients: new Set(),
  currentUser: null,
};

const ENV_PATH = path.join(__dirname, ".env");
const CONFIG_FIELDS = [
  "RPC_URL",
  "TOKEN_ADDRESS",
  "USDT_ADDRESS",
  "MIN_USDT",
  "MAX_USDT",
  "MAX_DAILY_USDT",
  "WINDOW_START_HOUR",
  "WINDOW_END_HOUR",
  "SLIPPAGE_BPS",
  "MAX_GAS_GWEI",
  "DRY_RUN",
];

function getConfigFromRequest(body) {
  const config = {};
  for (const key of CONFIG_FIELDS) {
    if (key in body) {
      config[key] = body[key];
    }
  }
  return config;
}

function nowIso() {
  return new Date().toISOString();
}

function pushLog(source, line) {
  const safe = String(line).replace(/PRIVATE_KEY[=0-9a-fA-Fx]+/g, "PRIVATE_KEY=***");
  const entry = `[${nowIso()}] [${source}] ${safe}`;
  state.logs.push(entry);
  if (state.logs.length > 800) state.logs.shift();
  for (const client of state.clients) {
    client.write(`data: ${JSON.stringify(entry)}\n\n`);
  }
}

function runTestSell() {
  return new Promise((resolve) => {
    const runner = spawn("node", ["test-kyber.js"], {
      cwd: __dirname,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    pushLog("system", `dry-run test started (pid ${runner.pid})`);

    runner.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split("\n").filter(Boolean)) {
        pushLog("test", line);
      }
    });

    runner.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split("\n").filter(Boolean)) {
        pushLog("test:err", line);
      }
    });

    runner.on("exit", (code) => {
      pushLog("system", `dry-run test finished (code=${code ?? "null"})`);
      resolve({ code, output });
    });
  });
}

function getSessionUser(req) {
  const cookies = session.parseCookies(req.headers.cookie || "");
  const token = cookies[session.COOKIE];
  console.log('[DEBUG getSessionUser] Cookie header:', req.headers.cookie ? req.headers.cookie.substring(0, 100) : 'none');
  console.log('[DEBUG getSessionUser] Parsed cookies:', Object.keys(cookies));
  console.log('[DEBUG getSessionUser] Token found:', !!token);
  const user = token ? session.verifySession(token) : null;
  console.log('[DEBUG getSessionUser] User from token:', user);

  // If Firebase is enabled, reject local auth sessions
  if (user && user.isLocal && session.isFirebaseEnabled()) {
    return null;
  }

  return user;
}

function requireAuth(req, res, next) {
  if (!session.isAuthEnabled()) return next();
  const user = getSessionUser(req);
  if (user) {
    req.user = user;
    return next();
  }
  return res.status(401).json({
    ok: false,
    message: "Unauthorized",
    loginRequired: true,
  });
}

function requireAdmin(req, res, next) {
  const user = req.user;
  if (user && user.role === "admin") {
    return next();
  }
  return res.status(403).json({
    ok: false,
    message: "Forbidden - Admin access required",
  });
}

app.use(express.json());

app.get("/api/session", async (req, res) => {
  const need = session.isAuthEnabled();
  const sessionUser = getSessionUser(req);
  let user = null;
  if (sessionUser) {
    if (sessionUser.isLocal) {
      user = { id: sessionUser.userId, role: sessionUser.role, email: sessionUser.userId };
    } else {
      user = await db.getUserById(sessionUser.userId);
    }
  }
  res.json({
    loginRequired: need,
    authed: !!user,
    user: user ? {
      id: user.id,
      email: user.email || user.id,
      role: user.role,
    } : null,
  });
});

app.post("/api/register", async (req, res) => {
  console.log('[DEBUG] Register request body:', JSON.stringify(req.body));
  console.log('[DEBUG] Content-Type:', req.get('Content-Type'));

  if (!session.isFirebaseEnabled()) {
    return res.status(400).json({
      ok: false,
      message: "Firebase is not enabled. Set Firebase Admin SDK JSON key",
    });
  }

  const body = req.body;
  const email = body && body.email;
  const password = body && body.password;

  console.log('[DEBUG] Extracted email:', email, 'password provided:', !!password);

  if (!email || !password) {
    return res.status(400).json({
      ok: false,
      message: "Email and password are required",
    });
  }

  const result = await session.firebaseSignUp(email, password);
  if (result.success) {
    pushLog("system", `User registered: ${email}`);
    return res.json({
      ok: true,
      user: result.user,
    });
  }

  return res.status(400).json({
    ok: false,
    error: result.error,
  });
});

app.get("/api/firebase-config", (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
  });
});

// ─── Server-Side Google OAuth (bypasses MetaMask SES & popup issues) ───────
app.get("/auth/google", (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  if (!clientId) return res.status(500).send("Google OAuth not configured");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/auth/google/callback`,
    response_type: "code",
    scope: "email profile",
    access_type: "offline",
    prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/auth/google/callback", async (req, res) => {
  const { code, error } = req.query;
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  if (error || !code) return res.redirect("/?google_error=cancelled");
  try {
    // Exchange auth code for access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: `${appUrl}/auth/google/callback`,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      console.error("Token exchange failed:", tokens);
      return res.redirect("/?google_error=token_failed");
    }
    // Get user info from Google
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = await userRes.json();
    if (!userInfo.email) return res.redirect("/?google_error=no_email");

    // Create or find user in Firebase DB
    const result = await db.createGoogleUser(userInfo.email, userInfo.id, "user");
    if (!result.success) {
      return res.redirect(`/?google_error=${encodeURIComponent(result.error)}`);
    }
    // Set session cookie and redirect to dashboard
    const sessCookie = session.signSession(result.user.id, result.user.role, false);
    res.setHeader("Set-Cookie", session.authCookieHeader(sessCookie));
    pushLog("system", `Google OAuth login: ${userInfo.email}`);
    res.redirect("/");
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    res.redirect("/?google_error=server_error");
  }
});
// ────────────────────────────────────────────────────────────────────────────


app.post("/api/login-google", async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) {
    return res.status(400).json({ ok: false, message: "Missing ID token" });
  }

  if (session.isFirebaseEnabled()) {
    const result = await session.verifyGoogleToken(idToken);
    if (result.success) {
      const sessCookie = session.signSession(result.user.id, result.user.role, false);
      res.setHeader("Set-Cookie", session.authCookieHeader(sessCookie));
      pushLog("system", `User logged in via Google: ${result.user.email}`);
      return res.status(200).json({ ok: true, user: result.user });
    }
    pushLog("auth:err", `Google login failed: ${result.error}`);
    return res.status(401).json({ ok: false, message: result.error });
  }

  return res.status(400).json({ ok: false, message: "Firebase is not enabled" });
});

app.post("/api/login", async (req, res) => {
  if (!session.isAuthEnabled()) {
    return res.json({ ok: true, skipped: true });
  }

  const body = req.body;
  const email = body && body.email;
  const username = body && body.username;
  const password = body && body.password;

  if (!password) {
    return res.status(400).json({
      ok: false,
      message: "Password is required",
    });
  }

  if (session.isFirebaseEnabled()) {
    if (!email) {
      return res.status(400).json({
        ok: false,
        message: "Email is required for Firebase authentication",
      });
    }
    const result = await session.firebaseSignIn(email, password);
    if (result.success) {
      const token = session.signSession(result.user.id, result.user.role);
      const cookieHeader = session.authCookieHeader(token);
      console.log('[DEBUG Login] Setting cookie:', cookieHeader.substring(0, 100));
      res.setHeader("Set-Cookie", cookieHeader);
      pushLog("system", `User logged in: ${email}`);
      return res.json({
        ok: true,
        user: result.user,
      });
    }
    return res.status(401).json({
      ok: false,
      error: result.error || "Invalid credentials",
    });
  }

  // Local auth only (when Firebase is not enabled)
  if (username || !email) {
    const expectedUser = process.env.DASHBOARD_USERNAME;
    const expectedPw = process.env.DASHBOARD_PASSWORD;
    const userMatch = !expectedUser || String(username) === String(expectedUser);
    const pwMatch = !expectedPw || String(password) === String(expectedPw);
    if (userMatch && pwMatch) {
      const token = session.signSession(username || "local-admin", "admin", true);
      res.setHeader("Set-Cookie", session.authCookieHeader(token));
      pushLog("system", `User logged in: ${username}`);
      return res.json({
        ok: true,
        user: { id: username || "local-admin", role: "admin" },
      });
    }
  }

  return res.status(401).json({
    ok: false,
    error: "Invalid credentials",
  });
});

app.post("/api/logout", async (_req, res) => {
  await session.firebaseSignOut();
  res.setHeader("Set-Cookie", session.clearCookieHeader());
  res.json({ ok: true });
});

app.get("/api/user/me", requireAuth, async (req, res) => {
  let user = null;
  if (req.user) {
    if (req.user.isLocal) {
      user = { id: req.user.userId, role: req.user.role, email: req.user.userId };
    } else {
      user = await db.getUserById(req.user.userId);
    }
  }
  res.json({
    ok: (user !== null),
    user: user ? {
      id: user.id,
      email: user.email || user.id,
      role: user.role,
    } : null,
  });
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await db.getAllUsers();
    const usersWithStatus = [];

    for (const user of users) {
      const botStatus = await botManager.getUserBotStatus(user.id);
      usersWithStatus.push({
        ...user,
        botStatus: botStatus,
      });
    }

    res.json({
      ok: true,
      users: usersWithStatus,
    });
  } catch (error) {
    console.error("Error getting users:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.delete("/api/admin/users/:userId", requireAuth, requireAdmin, async (req, res) => {
  const userId = req.params.userId;

  const stopResult = await botManager.stopUserBot(userId);
  if (!stopResult.success) {
    pushLog("system", `Failed to stop bot for user ${userId}: ${stopResult.error}`);
  }

  const deleteResult = await db.deleteUser(userId);
  if (deleteResult.success) {
    pushLog("system", `User deleted: ${userId}`);
    return res.json({ ok: true });
  }

  return res.status(400).json({
    ok: false,
    error: deleteResult.error,
  });
});

app.post("/api/admin/users/:userId/start", requireAuth, requireAdmin, async (req, res) => {
  const userId = req.params.userId;
  const body = req.body;
  const password = body && body.password;

  const result = await botManager.startUserBot(userId, password);
  if (result.success) {
    pushLog("system", `Bot started for user: ${userId}`);
    return res.json(result);
  }

  return res.status(400).json(result);
});

app.post("/api/admin/users/:userId/stop", requireAuth, requireAdmin, async (req, res) => {
  const userId = req.params.userId;
  const result = await botManager.stopUserBot(userId);

  if (result.success) {
    pushLog("system", `Bot stopped for user: ${userId}`);
  }

  return res.status(result.success ? 200 : 400).json(result);
});

app.get("/api/status", requireAuth, async (req, res) => {
  const userId = req.user && req.user.userId;
  const isLocalUser = req.user && req.user.isLocal;

  if (isLocalUser || !session.isFirebaseEnabled()) {
    const botState = readBotState();
    const running = !!(state.botProcess && !state.botProcess.killed);
    res.json({
      running: running,
      pid: running ? state.botProcess.pid : null,
      startedAt: state.botStartedAt || null,
      nextSellAt: botState && botState.nextSellAt ? botState.nextSellAt : null,
    });
    return;
  }

  if (!userId) {
    return res.status(400).json({
      ok: false,
      message: "User ID not found in session",
    });
  }

  const botStatus = await botManager.getUserBotStatus(userId);
  res.json({
    running: botStatus && botStatus.running,
    pid: botStatus && botStatus.pid,
    startedAt: botStatus && botStatus.dbStatus && botStatus.dbStatus.updated_at,
    nextSellAt: botStatus && botStatus.dbStatus && botStatus.dbStatus.next_sell_at,
  });
});

app.get("/api/logs", requireAuth, (_req, res) => {
  res.json({ logs: state.logs });
});

app.get("/api/bot-state", requireAuth, async (req, res) => {
  const userId = req.user && req.user.userId;
  const isLocalUser = req.user && req.user.isLocal;

  if (isLocalUser || !session.isFirebaseEnabled()) {
    return res.json({ state: {} });
  }

  if (!userId) {
    return res.json({ state: {} });
  }

  const botStatus = await botManager.getUserBotStatus(userId);
  const botState = await db.getBotState(userId) || {};

  return res.json({
    state: {
      ...botState,
      nextSellAt: botState.nextSellAt || null,
    },
  });
});

app.get("/api/history", requireAuth, async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));
  const userId = req.user && req.user.userId;
  if (!userId || !session.isFirebaseEnabled()) {
    return res.json({ entries: [] });
  }
  const entries = await db.getHistoryLines(userId, limit);
  res.json({ entries });
});

app.get("/api/health", requireAuth, async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    let privateKey, rpcUrl, tokenAddress;

    if (userId && session.isFirebaseEnabled()) {
      const password = req.query && req.query.password;
      const config = await db.getUserConfig(userId, password);
      if (config) {
        privateKey = config.privateKey;
        rpcUrl = config.rpcUrl;
        tokenAddress = config.tokenAddress;
      }
    } else {
      privateKey = process.env.PRIVATE_KEY;
      rpcUrl = process.env.RPC_URL || "https://arb1.arbitrum.io/rpc";
      tokenAddress = process.env.TOKEN_ADDRESS || "0x60137Fca8149FFae539d0eEe96aa217e91865e41";
    }

    if (!privateKey || !rpcUrl) {
      return res.json({
        ok: false,
        message: "Private key not configured or invalid session",
      });
    }

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const blockNumber = await provider.getBlockNumber();
    let gasGwei = null;
    try {
      const gp = await provider.getGasPrice();
      gasGwei = Number(ethers.utils.formatUnits(gp, "gwei"));
    } catch {
      /* ignore */
    }

    let walletAddress = null;
    let ethBalance = null;
    let tokenBalance = null;

    if (privateKey) {
      const w = new ethers.Wallet(privateKey, provider);
      walletAddress = w.address;
      const wei = await provider.getBalance(w.address);
      ethBalance = ethers.utils.formatEther(wei);

      const usdtAddress = process.env.USDT_ADDRESS || "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
      const erc20 = new ethers.Contract(
        tokenAddress,
        [
          "function balanceOf(address) view returns (uint256)",
          "function decimals() view returns (uint8)",
          "function symbol() view returns (string)",
        ],
        provider
      );
      const [dec, sym, bal] = await Promise.all([
        erc20.decimals(),
        erc20.symbol(),
        erc20.balanceOf(w.address),
      ]);
      tokenBalance = {
        symbol: sym,
        formatted: ethers.utils.formatUnits(bal, dec),
      };
    }

    res.json({
      ok: true,
      rpc: rpcUrl,
      blockNumber,
      gasGwei,
      walletAddress,
      ethBalance,
      tokenBalance,
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || "health check failed" });
  }
});

app.post("/api/bot/start", requireAuth, async (req, res) => {
  const userId = req.user && req.user.userId;
  const body = req.body;
  const password = body && body.password;

  if (userId && session.isFirebaseEnabled()) {
    const result = await botManager.startUserBot(userId, password, (source, line) => {
      pushLog(source, line);
    });
    if (result.success) {
      pushLog("system", `Bot started for user: ${userId}`);
      return res.json({ ok: true, message: "Bot started successfully", ...result });
    }

    return res.status(400).json(result);
  }

  if (!state.botProcess || state.botProcess.killed) {
    const child = spawn("node", ["bot.js"], {
      cwd: __dirname,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    state.botProcess = child;
    state.botStartedAt = Date.now();
    pushLog("system", `Bot started (pid ${child.pid})`);

    child.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        pushLog("bot", line);
      }
    });

    child.stderr.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        pushLog("bot:err", line);
      }
    });

    child.on("exit", (code, sig) => {
      pushLog("system", `Bot exited (code=${code ?? "null"}, signal=${sig ?? "null"})`);
      state.botProcess = null;
      state.botStartedAt = null;
    });

    return res.status(200).json({ ok: true, message: "Bot started" });
  }
});

app.post("/api/bot/stop", requireAuth, async (req, res) => {
  const userId = req.user && req.user.userId;

  if (userId && session.isFirebaseEnabled()) {
    const result = await botManager.stopUserBot(userId);
    return res.status(result.ok ? 200 : 400).json(result);
  }

  if (!state.botProcess || state.botProcess.killed) {
    return res.status(400).json({
      ok: false,
      message: "Bot is not running",
    });
  }

  state.botProcess.kill("SIGTERM");
  pushLog("system", "Stop signal sent to bot");
  return res.status(200).json({ ok: true, message: "Stopping bot" });
});

app.post("/api/bot/instant-sell", requireAuth, async (req, res) => {
  const userId = req.user && req.user.userId;
  const body = req.body;
  const password = body && body.password;

  if (userId && session.isFirebaseEnabled()) {
    const result = await botManager.runInstantSell(userId, password, (source, line) => {
      pushLog(source, line);
    });
    return res.status(result.success ? 200 : 400).json(result);
  }

  // Fallback for local single-user mode
  if (state.botProcess && !state.botProcess.killed) {
    return res.status(400).json({ ok: false, message: "Bot is already running. Please stop it first." });
  }

  const env = readEnvFile();
  const child = spawn("node", ["bot.js"], {
    cwd: __dirname,
    env: { ...process.env, ...env, INSTANT_SELL: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      pushLog("bot:instant", line);
    }
  });

  child.stderr.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) {
      pushLog("bot:err", line);
    }
  });

  return res.status(200).json({ ok: true, message: "Instant sell executed" });
});

app.post("/api/test-sell", requireAuth, async (_req, res) => {
  const result = await runTestSell();
  res.json({
    ok: result.code === 0,
    code: result.code,
    output: result.output,
  });
});

app.get("/api/config", requireAuth, async (req, res) => {
  const userId = req.user && req.user.userId;

  if (userId && session.isFirebaseEnabled()) {
    const password = req.query && req.query.password;
    const config = await db.getUserConfig(userId, password);
    if (!config) {
      return res.json({ config: {} });
    }

    const configForUi = getConfigFromRequest(config);
    configForUi.privateKeySet = !!config.privateKey;
    return res.json({ config: configForUi });
  }

  const env = readEnvFile();
  const merged = { ...process.env, ...env };
  const config = {};
  for (const key of CONFIG_FIELDS) {
    if (key === "PRIVATE_KEY") {
      config[key] = "";
    } else {
      config[key] = merged[key] ?? "";
    }
  }
  config.privateKeySet = Boolean(merged.PRIVATE_KEY);
  return res.json({ config });
});

app.post("/api/config", requireAuth, async (req, res) => {
  const userId = req.user && req.user.userId;

  if (userId && session.isFirebaseEnabled()) {
    const body = req.body;
    const password = body && body.password;
    const input = body && body.config;

    if (!input || typeof input !== "object") {
      return res.status(400).json({
        ok: false,
        message: "Invalid config payload",
      });
    }

    if (!input.PRIVATE_KEY) {
      return res.status(400).json({
        ok: false,
        message: "Private key is required to save config",
      });
    }

    const v = validateConfig(input);
    if (!v.ok) {
      return res.status(400).json({ ok: false, message: v.error });
    }

    const configFromReq = getConfigFromRequest(input);
    const config = {
      rpcUrl: configFromReq.RPC_URL,
      tokenAddress: configFromReq.TOKEN_ADDRESS,
      usdtAddress: configFromReq.USDT_ADDRESS,
      privateKey: input.PRIVATE_KEY,
      tradingParams: {
        MIN_USDT: configFromReq.MIN_USDT,
        MAX_USDT: configFromReq.MAX_USDT,
        MAX_DAILY_USDT: configFromReq.MAX_DAILY_USDT,
        WINDOW_START_HOUR: configFromReq.WINDOW_START_HOUR,
        WINDOW_END_HOUR: configFromReq.WINDOW_END_HOUR,
        SLIPPAGE_BPS: configFromReq.SLIPPAGE_BPS,
        MAX_GAS_GWEI: configFromReq.MAX_GAS_GWEI,
        DRY_RUN: configFromReq.DRY_RUN,
      }
    };
    const result = await db.saveUserConfig(userId, password, config);

    if (result.success) {
      pushLog("system", `Configuration saved for user: ${userId}`);
      return res.json({ ok: true, message: "Config saved to database" });
    }

    return res.status(400).json({
      ok: false,
      error: result.error,
    });
  }

  if (!state.botProcess || state.botProcess.killed) {
    return res.status(400).json({
      ok: false,
      message: "Stop bot before saving config",
    });
  }

  const input = req.body && req.body.config;
  if (!input || typeof input !== "object") {
    return res.status(400).json({
      ok: false,
      message: "Invalid config payload",
    });
  }

  const v = validateConfig(input);
  if (!v.ok) {
    return res.status(400).json({
      ok: false,
      message: v.error,
    });
  }

  const env = readEnvFile();
  const next = { ...env };
  for (const key of CONFIG_FIELDS) {
    if (!(key in input)) continue;
    const str = input[key] == null ? "" : String(input[key]).trim();
    if (str === "" && key === "PRIVATE_KEY") continue;
    if (str === "") {
      delete next[key];
    } else {
      next[key] = str;
    }
  }

  const lines = [
    "# Managed by dashboard — keep secret; do not commit",
    "",
  ];
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || v === null || String(v) === "") continue;
    lines.push(`${k}=${String(v)}`);
  }
  fs.writeFileSync(ENV_PATH, `${lines.join("\n")}\n`, "utf8");

  for (const key of CONFIG_FIELDS) {
    if (next[key] !== undefined) process.env[key] = String(next[key]);
    else delete process.env[key];
  }

  pushLog("system", "Configuration saved");
  return res.json({ ok: true, message: "Config saved to .env" });
});

app.get("/api/logs/stream", requireAuth, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  state.clients.add(res);
  req.on("close", () => {
    state.clients.delete(res);
  });
});

app.use(express.static(path.join(__dirname, "ui")));

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, "ui", "index.html"));
});

app.listen(PORT, async () => {
  pushLog("system", `Dashboard at http://localhost:${PORT}`);
  console.log(`Dashboard at http://localhost:${PORT}`);

  if (session.isFirebaseEnabled()) {
    console.log("Auth: Firebase enabled — multi-user mode");
    await botManager.recoverRunningBots();
  } else if (session.isAuthEnabled()) {
    console.log("Auth: Single-user mode (DASHBOARD_PASSWORD set)");
  } else {
    console.log("Auth: disabled (set SUPABASE_URL or DASHBOARD_PASSWORD to enable)");
  }
});
