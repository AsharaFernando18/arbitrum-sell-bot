const ADDR = /^0x[a-fA-F0-9]{40}$/;

function toNum(v, name, min, max) {
  if (v === undefined || v === null || v === "") return { ok: true, value: undefined };
  const n = Number(v);
  if (!Number.isFinite(n)) return { ok: false, error: `${name} must be a number` };
  if (min !== undefined && n < min) return { ok: false, error: `${name} must be >= ${min}` };
  if (max !== undefined && n > max) return { ok: false, error: `${name} must be <= ${max}` };
  return { ok: true, value: n };
}

function validateConfig(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Invalid payload" };
  }

  const errs = [];
  const optionalAddr = (key) => {
    const v = input[key];
    if (v === undefined || v === null || String(v).trim() === "") return;
    if (!ADDR.test(String(v).trim())) errs.push(`${key} must be a 0x-prefixed 40-hex address`);
  };

  optionalAddr("TOKEN_ADDRESS");
  optionalAddr("USDT_ADDRESS");

  const pk = input.PRIVATE_KEY;
  if (pk !== undefined && pk !== null && String(pk).trim() !== "") {
    const s = String(pk).trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(s)) errs.push("PRIVATE_KEY must be 64 hex chars with 0x prefix");
  }


  const minU = toNum(input.MIN_USDT, "MIN_USDT", 0.000001, 1e9);
  if (!minU.ok) errs.push(minU.error);
  const maxU = toNum(input.MAX_USDT, "MAX_USDT", 0.000001, 1e9);
  if (!maxU.ok) errs.push(maxU.error);
  const slip = toNum(input.SLIPPAGE_BPS, "SLIPPAGE_BPS", 0, 5000);
  if (!slip.ok) errs.push(slip.error);
  const ws = toNum(input.WINDOW_START_HOUR, "WINDOW_START_HOUR", 0, 23);
  if (!ws.ok) errs.push(ws.error);
  const we = toNum(input.WINDOW_END_HOUR, "WINDOW_END_HOUR", 0, 23);
  if (!we.ok) errs.push(we.error);

  const maxDaily = toNum(input.MAX_DAILY_USDT, "MAX_DAILY_USDT", 0, 1e9);
  if (!maxDaily.ok) errs.push(maxDaily.error);
  const maxGas = toNum(input.MAX_GAS_GWEI, "MAX_GAS_GWEI", 0, 10000);
  if (!maxGas.ok) errs.push(maxGas.error);

  for (const b of ["DRY_RUN"]) {
    const v = input[b];
    if (v === undefined || v === null || String(v).trim() === "") continue;
    const s = String(v).trim().toLowerCase();
    if (!["0", "1", "true", "false", "yes", "no"].includes(s)) {
      errs.push(`${b} must be true/false or 1/0`);
    }
  }

  if (errs.length) return { ok: false, error: errs.join("; ") };

  const minUsdt = minU.value ?? 2;
  const maxUsdt = maxU.value ?? 3;
  if (minU.value !== undefined && maxU.value !== undefined && minUsdt > maxUsdt) {
    return { ok: false, error: "MIN_USDT cannot exceed MAX_USDT" };
  }

  return { ok: true };
}

module.exports = { validateConfig, ADDR };
