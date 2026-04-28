const loginGate = document.getElementById("loginGate");
const appShell = document.getElementById("appShell");
const loginForm = document.getElementById("loginForm");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");
const loginSubmitBtn = document.getElementById("loginSubmitBtn");
const loginNoAuth = document.getElementById("loginNoAuth");
const loginSkipBtn = document.getElementById("loginSkipBtn");

const statusText = document.getElementById("statusText");
const statusChip = document.getElementById("statusChip");
const statusDot = document.getElementById("statusDot");
const pidText = document.getElementById("pidText");
const startedText = document.getElementById("startedText");
const nextSellText = document.getElementById("nextSellText");
const logsEl = document.getElementById("logs");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const instantSellBtn = document.getElementById("instantSellBtn");
const testBtn = document.getElementById("testBtn");
const clearBtn = document.getElementById("clearBtn");
const saveConfigBtn = document.getElementById("saveConfigBtn");
const toggleKeyBtn = document.getElementById("toggleKeyBtn");
const copyLogsBtn = document.getElementById("copyLogsBtn");
const pauseScroll = document.getElementById("pauseScroll");
const toggleConfigBtn = document.getElementById("toggleConfigBtn");
const configBody = document.getElementById("configBody");
const emptyHistory = document.getElementById("emptyHistory");

const streamPill = document.getElementById("streamPill");
const streamLabel = document.getElementById("streamLabel");

const healthBlock = document.getElementById("healthBlock");
const healthGas = document.getElementById("healthGas");
const healthEth = document.getElementById("healthEth");
const healthTok = document.getElementById("healthTok");

const stateToday = document.getElementById("stateToday");
const stateErr = document.getElementById("stateErr");
const stateTx = document.getElementById("stateTx");

const historyBody = document.getElementById("historyBody");
const pkHint = document.getElementById("pkHint");
const dashUserHint = document.getElementById("dashUserHint");
const dashPwHint = document.getElementById("dashPwHint");
const sessHint = document.getElementById("sessHint");

const toastRoot = document.getElementById("toastRoot");
const privateKeyInput = document.getElementById("cfg_PRIVATE_KEY");

const CONFIG_KEYS = [
  "PRIVATE_KEY",
  "RPC_URL",
  "TOKEN_ADDRESS",
  "USDT_ADDRESS",
  "UNISWAP_ROUTER",
  "QUOTER_ADDRESS",
  "POOL_FEE",
  "MIN_USDT",
  "MAX_USDT",
  "SLIPPAGE_BPS",
  "WINDOW_START_HOUR",
  "WINDOW_END_HOUR",
  "MAX_DAILY_USDT",
  "MAX_GAS_GWEI",
  "DASHBOARD_USERNAME",
  "DASHBOARD_PASSWORD",
  "SESSION_SECRET",
];

let stream;
let streamErrOnce = false;
let countdownTimer = null;
let configCollapsed = false;
let isRegisterMode = false;
let currentUserPassword = "";

function toast(msg, variant = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${variant === "err" ? "err" : "ok"}`;
  el.textContent = msg;
  toastRoot.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
    el.style.transition = "opacity 0.25s ease, transform 0.25s ease";
    setTimeout(() => el.remove(), 260);
  }, 3400);
}

function shouldAutoScroll() {
  return !pauseScroll.checked;
}

function getLogClass(line) {
  if (/\[system\]/.test(line)) return "log-system";
  if (/\[bot:err\]/.test(line)) return "log-bot-err";
  if (/\[bot\]/.test(line)) return "log-bot";
  if (/\[test:err\]/.test(line)) return "log-test-err";
  if (/\[test\]/.test(line)) return "log-test";
  if (/\[ui\]/.test(line)) return "log-ui";
  return "";
}

function appendLog(line) {
  const span = document.createElement("span");
  span.textContent = `${line}\n`;
  const cls = getLogClass(line);
  if (cls) span.className = cls;
  logsEl.appendChild(span);
  if (shouldAutoScroll()) logsEl.scrollTop = logsEl.scrollHeight;
}

async function callApi(path, method = "GET", payload) {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const raw = await res.text();
  let body = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error(raw.slice(0, 100));
    }
  }

  if (res.status === 401 && body.loginRequired) {
    const err = new Error("Unauthorized");
    err.code = 401;
    throw err;
  }

  if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
  return body;
}

function setStreamLive(on) {
  streamPill.dataset.live = on ? "1" : "0";
  streamLabel.textContent = on ? "Live" : "Offline";
}

function startEventStream() {
  if (stream) {
    stream.close();
    stream = null;
  }
  streamErrOnce = false;
  setStreamLive(false);
  stream = new EventSource("/api/logs/stream");
  stream.onopen = () => {
    setStreamLive(true);
    streamErrOnce = false;
  };
  stream.onmessage = (ev) => {
    appendLog(JSON.parse(ev.data));
    refreshStatus();
  };
  stream.onerror = () => {
    setStreamLive(false);
    if (!streamErrOnce) {
      appendLog("[ui] Stream interrupted (retrying)...");
      streamErrOnce = true;
    }
  };
}

function boolToStr(cb) {
  return cb && cb.checked ? "true" : "false";
}

function strToBool(s) {
  return ["1", "true", "yes"].includes(String(s || "").toLowerCase());
}

function collectConfig() {
  const config = {};
  for (const key of CONFIG_KEYS) {
    const el = document.getElementById(`cfg_${key}`);
    if (el) config[key] = el.value.trim();
  }
  config.DRY_RUN = boolToStr(document.getElementById("cfg_DRY_RUN"));
  return config;
}

function applyConfig(data) {
  const c = data.config || {};
  for (const key of CONFIG_KEYS) {
    const el = document.getElementById(`cfg_${key}`);
    if (!el) continue;
    if (key === "PRIVATE_KEY") {
      el.value = "";
      pkHint.textContent = c.privateKeySet ? "(saved — leave blank to keep)" : "";
    } else if (key === "DASHBOARD_USERNAME" || key === "DASHBOARD_PASSWORD" || key === "SESSION_SECRET") {
      el.value = "";
    } else {
      el.value = c[key] ?? "";
    }
  }
  dashUserHint.textContent = c.dashboardUsernameSet ? "set" : "not set";
  dashPwHint.textContent = c.dashboardPasswordSet ? "set" : "not set";
  sessHint.textContent = c.sessionSecretSet ? "set" : "not set";
  document.getElementById("cfg_DRY_RUN").checked = strToBool(c.DRY_RUN);
}

async function refreshStatus() {
  try {
    const data = await callApi("/api/status");
    const running = Boolean(data.running);
    statusText.textContent = running ? "Running" : "Stopped";
    statusText.classList.toggle("running", running);
    statusText.classList.toggle("stopped", !running);

    if (statusChip) {
      statusChip.dataset.status = running ? "running" : "stopped";
    }

    pidText.textContent = data.pid != null ? String(data.pid) : "—";
    startedText.textContent = data.startedAt ? new Date(data.startedAt).toLocaleString() : "—";
    startBtn.disabled = running;
    stopBtn.disabled = !running;
    instantSellBtn.disabled = running;
  } catch (e) {
    if (e.code === 401) return;
    appendLog(`[ui] status: ${e.message}`);
  }
}

async function loadLogs() {
  try {
    const data = await callApi("/api/logs");
    logsEl.textContent = "";
    for (const line of data.logs) appendLog(line);
  } catch (e) {
    if (e.code === 401) return;
    appendLog(`[ui] logs: ${e.message}`);
  }
}

async function loadConfig() {
  try {
    const url = currentUserPassword ? `/api/config?password=${encodeURIComponent(currentUserPassword)}` : "/api/config";
    const data = await callApi(url);
    applyConfig(data);
  } catch (e) {
    if (e.code === 401) return;
    toast(e.message, "err");
  }
}

async function refreshHealth() {
  try {
    // For multi-user mode, need password to decrypt private key
    if (currentUserPassword) {
      const h = await callApi(`/api/health?password=${encodeURIComponent(currentUserPassword)}`);
      healthBlock.textContent = h.blockNumber != null ? String(h.blockNumber) : "—";
      healthGas.textContent = h.gasGwei != null ? `${h.gasGwei.toFixed(2)} gwei` : "—";
      healthEth.textContent = h.ethBalance != null ? Number(h.ethBalance).toFixed(4) : "—";
      healthTok.textContent = h.tokenBalance ? `${h.tokenBalance.formatted} ${h.tokenBalance.symbol}` : "—";
    } else {
      const h = await callApi("/api/health");
      healthBlock.textContent = h.blockNumber != null ? String(h.blockNumber) : "—";
      healthGas.textContent = h.gasGwei != null ? `${h.gasGwei.toFixed(2)} gwei` : "—";
      healthEth.textContent = h.ethBalance != null ? Number(h.ethBalance).toFixed(4) : "—";
      healthTok.textContent = h.tokenBalance ? `${h.tokenBalance.formatted} ${h.tokenBalance.symbol}` : "—";
    }
  } catch {
    healthBlock.textContent = "—";
    healthGas.textContent = "—";
    healthEth.textContent = "—";
    healthTok.textContent = "—";
  }
}

async function refreshBotState() {
  try {
    const { state } = await callApi("/api/bot-state");
    if (!state) {
      stateToday.textContent = "—";
      stateErr.textContent = "—";
      stateTx.textContent = "—";
      nextSellText.textContent = "—";
      return;
    }
    stateToday.textContent =
      state.todayUsdtTotal != null ? `${Number(state.todayUsdtTotal).toFixed(4)} (day ${state.dayKey || "—"})` : "—";
    stateErr.textContent = state.lastError || "—";
    stateTx.textContent = state.lastTxHash
      ? state.lastTxHash.slice(0, 10) + "…"
      : "—";
    stateTx.title = state.lastTxHash || "";
    if (state.nextSellAt) {
      nextSellText.dataset.ts = String(state.nextSellAt);
    } else {
      nextSellText.textContent = "—";
      delete nextSellText.dataset.ts;
    }
  } catch {
    /* ignore */
  }
}

function tickCountdown() {
  const ts = nextSellText.dataset.ts;
  if (!ts) return;
  const t = Number(ts);
  if (!Number.isFinite(t)) return;
  const sec = Math.max(0, Math.floor((t - Date.now()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  nextSellText.textContent = `${h}h ${m}m ${s}s · ${new Date(t).toLocaleString()}`;
}

function updateEmptyState() {
  if (!emptyHistory) return;
  const hasRows = historyBody && historyBody.children.length > 0;
  emptyHistory.classList.toggle("empty-state--hidden", hasRows);
}

async function refreshHistory() {
  try {
    const { entries } = await callApi("/api/history?limit=40");
    historyBody.innerHTML = "";
    for (const row of entries.slice().reverse()) {
      const tr = document.createElement("tr");
      const t = row.t ? new Date(row.t).toLocaleString() : "—";
      const mode = row.mode || row.kind || "—";
      const usdt = row.usdt != null ? String(row.usdt) : row.usdtEst != null ? `~${row.usdtEst}` : "—";
      const tx = row.txHash ? row.txHash.slice(0, 12) + "…" : "—";
      tr.innerHTML = `
        <td class="py-4 px-5 text-gray-300 font-medium text-sm">${t}</td>
        <td class="py-4 px-5">
            <span class="px-2.5 py-1 rounded-lg bg-white/5 text-[0.65rem] font-black uppercase tracking-wider text-gray-400 border border-white/5">
                ${mode}
            </span>
        </td>
        <td class="py-4 px-5 font-mono text-success font-bold">${usdt}</td>
        <td class="py-4 px-5 font-mono text-primary/60 text-xs" title="${row.txHash || ""}">${tx}</td>
      `;
      historyBody.appendChild(tr);
    }
    updateEmptyState();
  } catch {
    updateEmptyState();
  }
}

function showApp() {
  loginGate.classList.add("opacity-0");
  setTimeout(() => loginGate.classList.add("hidden"), 500);
  
  appShell.classList.remove("hidden");
  setTimeout(() => appShell.classList.remove("opacity-0"), 50);
}

function showLogin() {
  appShell.classList.add("opacity-0");
  setTimeout(() => appShell.classList.add("hidden"), 500);
  
  loginGate.classList.remove("hidden");
  setTimeout(() => loginGate.classList.remove("opacity-0"), 50);
}

async function checkSession() {
  const res = await fetch("/api/session", { credentials: "include" });
  const data = await res.json();
  if (!data.loginRequired) {
    if (loginNoAuth && loginForm) {
      loginForm.style.display = "none";
      loginNoAuth.style.display = "block";
    }
    showLogin();
    return false;
  }
  if (data.loginRequired && !data.authed) {
    if (loginNoAuth) loginNoAuth.style.display = "none";
    if (loginForm) loginForm.style.display = "";
    showLogin();
    return false;
  }
  showApp();
  return true;
}

async function updateLogoutVisibility() {
  try {
    const r = await fetch("/api/session", { credentials: "include" });
    const d = await r.json();
    logoutBtn.style.display = d.loginRequired ? "inline-flex" : "none";
  } catch {
    logoutBtn.style.display = "none";
  }
}

function initDashboard() {
  updateLogoutVisibility();
  loadLogs();
  loadConfig();
  refreshStatus();
  refreshHealth();
  refreshBotState();
  refreshHistory();
  startEventStream();

  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(tickCountdown, 1000);
  tickCountdown();

  setInterval(refreshStatus, 15000);
  setInterval(refreshHealth, 20000);
  setInterval(refreshBotState, 5000);
  setInterval(refreshHistory, 30000);
}

/* ─── Toggle config collapse ──────────────────────────────── */
if (toggleConfigBtn && configBody) {
  toggleConfigBtn.addEventListener("click", () => {
    configCollapsed = !configCollapsed;
    configBody.classList.toggle("config-body--collapsed", configCollapsed);
    toggleConfigBtn.textContent = configCollapsed ? "Expand" : "Collapse";
  });
}

toggleKeyBtn.addEventListener("click", () => {
  const on = privateKeyInput.type === "text";
  privateKeyInput.type = on ? "password" : "text";
  toggleKeyBtn.textContent = on ? "Show" : "Hide";
  toggleKeyBtn.setAttribute("aria-pressed", String(!on));
});

copyLogsBtn.addEventListener("click", async () => {
  const t = logsEl.textContent.trim();
  if (!t) return toast("Nothing to copy", "err");
  try {
    await navigator.clipboard.writeText(t);
    toast("Copied");
  } catch {
    toast("Clipboard blocked", "err");
  }
});

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  try {
    const payload = currentUserPassword ? { password: currentUserPassword } : {};
    const r = await callApi("/api/bot/start", "POST", payload);
    toast(r.message);
    appendLog(`[ui] ${r.message}`);
  } catch (e) {
    toast(e.message, "err");
    appendLog(`[ui] ${e.message}`);
  } finally {
    refreshStatus();
  }
});

stopBtn.addEventListener("click", async () => {
  stopBtn.disabled = true;
  try {
    const r = await callApi("/api/bot/stop", "POST");
    toast(r.message);
    appendLog(`[ui] ${r.message}`);
  } catch (e) {
    toast(e.message, "err");
  } finally {
    refreshStatus();
  }
});

// Custom confirm modal for Instant Sell
const instantSellModal = document.getElementById("instantSellModal");
const instantSellModalBg = document.getElementById("instantSellModalBg");
const instantSellCancelBtn = document.getElementById("instantSellCancelBtn");
const instantSellConfirmBtn = document.getElementById("instantSellConfirmBtn");

function showInstantSellModal() {
  return new Promise((resolve) => {
    instantSellModal.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();

    function close(result) {
      instantSellModal.classList.add("hidden");
      instantSellModalBg.removeEventListener("click", onBg);
      instantSellCancelBtn.removeEventListener("click", onCancel);
      instantSellConfirmBtn.removeEventListener("click", onConfirm);
      resolve(result);
    }

    const onBg = () => close(false);
    const onCancel = () => close(false);
    const onConfirm = () => close(true);

    instantSellModalBg.addEventListener("click", onBg);
    instantSellCancelBtn.addEventListener("click", onCancel);
    instantSellConfirmBtn.addEventListener("click", onConfirm);
  });
}

instantSellBtn.addEventListener("click", async () => {
  const confirmed = await showInstantSellModal();
  if (!confirmed) return;

  instantSellBtn.disabled = true;
  toast("Initiating instant sell...", "ok");
  appendLog("[ui] Initiating instant sell...");

  try {
    const payload = currentUserPassword ? { password: currentUserPassword } : {};
    const r = await callApi("/api/bot/instant-sell", "POST", payload);
    toast(r.message || "Instant sell request sent", "ok");
    appendLog(`[ui] instant-sell: ${r.message}`);
  } catch (e) {
    toast(e.message, "err");
    appendLog(`[ui] instant-sell error: ${e.message}`);
  } finally {
    refreshStatus();
  }
});

testBtn.addEventListener("click", async () => {
  testBtn.disabled = true;
  toast("Running test sell...");
  try {
    const r = await callApi("/api/test-sell", "POST");
    appendLog(`[ui] test-sell exit ${r.code}`);
    toast(r.ok ? "Test OK" : "Test failed", r.ok ? "ok" : "err");
  } catch (e) {
    toast(e.message, "err");
  } finally {
    testBtn.disabled = false;
  }
});

clearBtn.addEventListener("click", () => {
  logsEl.textContent = "";
  toast("Cleared");
});

saveConfigBtn.addEventListener("click", async () => {
  saveConfigBtn.disabled = true;
  try {
    const config = collectConfig();
    // For multi-user mode, backend needs password separately for encryption
    const payload = {
      config: config,
      password: currentUserPassword
    };
    const r = await callApi("/api/config", "POST", payload);
    toast(r.message);
    appendLog(`[ui] ${r.message}`);
    await loadConfig();
  } catch (e) {
    toast(e.message, "err");
  } finally {
    saveConfigBtn.disabled = false;
  }
});

loginForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  loginError.textContent = "";
  if (loginSubmitBtn) loginSubmitBtn.classList.add("pointer-events-none", "opacity-80");
  const loginSpinner = document.getElementById("loginSpinner");
  const btnIcon = loginSubmitBtn.querySelectorAll(".btn-label");
  if (loginSpinner) loginSpinner.classList.remove("hidden");
  btnIcon.forEach(i => i.classList.add("hidden"));
  loginSubmitBtn.disabled = true;
  
  const endpoint = isRegisterMode ? "/api/register" : "/api/login";
  // Send email/password for both register and login (Supabase mode uses email)
  const payload = {
    email: loginUsername.value,
    password: loginPassword.value
  };

  console.log('[DEBUG] Submitting to:', endpoint, 'with payload:', payload);
  console.log('[DEBUG] loginUsername.value:', loginUsername.value, 'loginPassword.value:', loginPassword.value);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log('[DEBUG] Response status:', res.status, res.statusText);
    const body = await res.json().catch(() => ({}));
    console.log('[DEBUG] Response body:', body);
    if (!res.ok) {
      loginError.textContent = body.message || (isRegisterMode ? "Registration failed" : "Login failed");
      return;
    }
    
    if (isRegisterMode) {
      toast("Account created! Please sign in.");
      // Automatically switch to login mode after registration
      toggleRegBtn.click();
      return;
    }

    currentUserPassword = loginPassword.value;
    loginPassword.value = "";
    showApp();
    initDashboard();
  } catch (e) {
    loginError.textContent = e.message;
  } finally {
    if (loginSubmitBtn) loginSubmitBtn.classList.remove("pointer-events-none", "opacity-80");
    if (loginSpinner) loginSpinner.classList.add("hidden");
    btnIcon.forEach(i => i.classList.remove("hidden"));
    loginSubmitBtn.disabled = false;
  }
});

const toggleRegBtn = document.getElementById("toggleRegBtn");
if (toggleRegBtn) {
  toggleRegBtn.addEventListener("click", () => {
    isRegisterMode = !isRegisterMode;
    const loginTitle = document.getElementById("loginTitle");
    const loginSubtitle = document.getElementById("loginSubtitle");
    const loginSubmitLabel = document.getElementById("loginSubmitLabel");
    
    if (isRegisterMode) {
      loginTitle.textContent = "Create Account";
      loginSubtitle.textContent = "Join NexusFlow to automate your DCA strategy.";
      loginSubmitLabel.textContent = "Create Account";
      toggleRegBtn.textContent = "Already have an account? Sign in";
    } else {
      loginTitle.textContent = "Secure Access";
      loginSubtitle.textContent = "Authenticate to access the command center.";
      loginSubmitLabel.textContent = "Initialize Session";
      toggleRegBtn.textContent = "Don't have an account? Create one";
    }
  });
}

if (loginSkipBtn) {
  loginSkipBtn.addEventListener("click", () => {
    showApp();
    initDashboard();
  });
}

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "include" });
  if (stream) stream.close();
  stream = null;
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  logsEl.textContent = "";
  currentUserPassword = "";
  toast("Signed out");
  const r = await fetch("/api/session", { credentials: "include" });
  const data = await r.json();
  if (data.loginRequired && !data.authed) {
    showLogin();
  } else {
    showApp();
    initDashboard();
  }
});

const bootOverlay = document.getElementById("bootOverlay");

function hideBoot() {
  if (!bootOverlay) return;
  bootOverlay.classList.add("boot-overlay--gone");
  bootOverlay.setAttribute("aria-busy", "false");
  setTimeout(() => bootOverlay.remove(), 400);
}

/* ─── Tab Navigation ────────────────────────────────────────── */
const tabBtns = document.querySelectorAll(".tab-btn");
tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    // Remove active from all tabs
    tabBtns.forEach((b) => b.classList.remove("active"));
    // Add active to clicked
    btn.classList.add("active");

    // Hide all tab views
    document.querySelectorAll(".tab-view").forEach((view) => {
      view.style.display = "none";
      view.classList.remove("active");
    });

    // Show target view
    const targetId = btn.getAttribute("data-target");
    const targetView = document.getElementById(targetId);
    if (targetView) {
      targetView.style.display = "";
      // Add small delay to trigger animation
      setTimeout(() => {
        targetView.classList.add("active");
      }, 10);
    }
  });
});


/* ─── Card Glow Effect ────────────────────────────────────────── */
document.querySelectorAll(".card").forEach((card) => {
  card.addEventListener("mousemove", (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty("--mouse-x", `${x}px`);
    card.style.setProperty("--mouse-y", `${y}px`);
  });
});

/* ─── Particle Background Removed (Using CSS Mesh) ────────────────────────────────────── */
let firebaseApp = null;
let firebaseAuth = null;

async function initFirebaseClient() {
  try {
    const res = await fetch("/api/firebase-config");
    const config = await res.json();
    if (config.apiKey && config.projectId) {
      firebaseApp = firebase.initializeApp(config);
      firebaseAuth = firebase.auth();
      const googleBtn = document.getElementById("googleLoginBtn");
      if (googleBtn) {
        googleBtn.classList.remove("hidden");
        googleBtn.addEventListener("click", handleGoogleLogin);
      }
    }
  } catch (err) {
    console.error("Failed to init Firebase Client:", err);
  }
}

async function exchangeFirebaseToken(user) {
  const idToken = await user.getIdToken(true);
  const res = await fetch("/api/login-google", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const el = document.getElementById("loginError");
    if (el) el.textContent = body.message || "Google login failed";
    return false;
  }
  return true;
}

async function handleGoogleLogin() {
  // Server-side OAuth — no Firebase client SDK, no MetaMask interference
  window.location.href = "/auth/google";
}

async function handleRedirectResult() {
  // Check for google_error param in URL
  const params = new URLSearchParams(window.location.search);
  const googleError = params.get("google_error");
  if (googleError) {
    const el = document.getElementById("loginError");
    if (el) el.textContent = `Google login failed: ${googleError}`;
    window.history.replaceState({}, "", "/"); // Clean URL
  }
  return false; // Session will be checked by checkSession()
}

(async () => {
  if (window.lucide) lucide.createIcons();
  await initFirebaseClient();
  await handleRedirectResult(); // Handle any error params from OAuth callback
  const ok = await checkSession();
  if (ok) initDashboard();
  hideBoot();
})();
