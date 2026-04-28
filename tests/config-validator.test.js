const assert = require("assert");
const { validateConfig } = require("../lib/config-validator");

assert.strictEqual(validateConfig(null).ok, false);
assert.strictEqual(validateConfig({ TOKEN_ADDRESS: "0xbad" }).ok, false);
assert.strictEqual(
  validateConfig({
    TOKEN_ADDRESS: "0x60137Fca8149FFae539d0eEe96aa217e91865e41",
    MIN_USDT: 2,
    MAX_USDT: 3,
  }).ok,
  true
);
assert.strictEqual(
  validateConfig({
    MIN_USDT: 5,
    MAX_USDT: 2,
  }).ok,
  false
);

console.log("config-validator tests: ok");
