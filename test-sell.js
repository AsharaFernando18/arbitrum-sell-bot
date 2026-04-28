/**
 * Dry-run: balance + quote (no on-chain tx).
 */

require("dotenv").config();
const { ethers } = require("ethers");

const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "0x60137Fca8149FFae539d0eEe96aa217e91865e41";
const USDT_ADDRESS = process.env.USDT_ADDRESS || "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
const QUOTER = process.env.QUOTER_ADDRESS || "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const POOL_FEE = Number(process.env.POOL_FEE || 3000);
const AUTO = ["1", "true", "yes"].includes(String(process.env.AUTO_POOL_FEE || "").toLowerCase());
const FEE_TIERS = [500, 3000, 10000];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];
const QUOTER_ABI = [
  "function quoteExactOutputSingle(address,address,uint24,uint256,uint160) external returns (uint256)",
];

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error("Set PRIVATE_KEY in .env first");
    process.exit(1);
  }

  const provider = new ethers.providers.JsonRpcProvider(
    process.env.RPC_URL || "https://arb1.arbitrum.io/rpc"
  );
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const token = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, provider);
  const usdt = new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider);
  const quoter = new ethers.Contract(QUOTER, QUOTER_ABI, provider);

  const [symbol, tokenDec, usdtDec, balance] = await Promise.all([
    token.symbol(),
    token.decimals(),
    usdt.decimals(),
    token.balanceOf(wallet.address),
  ]);

  console.log(`\nWallet : ${wallet.address}`);
  console.log(`Token  : ${symbol} (${TOKEN_ADDRESS})`);
  console.log(`Balance: ${ethers.utils.formatUnits(balance, tokenDec)} ${symbol}\n`);

  const amountOut = ethers.utils.parseUnits("2.5", usdtDec);
  const fees = AUTO ? FEE_TIERS : [POOL_FEE];
  let best = null;

  for (const fee of fees) {
    try {
      const amountIn = await quoter.callStatic.quoteExactOutputSingle(
        TOKEN_ADDRESS,
        USDT_ADDRESS,
        fee,
        amountOut,
        0
      );
      if (!best || amountIn.lt(best.amountIn)) best = { fee, amountIn };
    } catch (e) {
      console.error(`Fee ${fee}: quote failed — ${e.message}`);
    }
  }

  if (!best) {
    console.error("\n❌ No fee tier produced a quote.");
    process.exit(1);
  }

  console.log(`Quote (2.5 USDT out) @ fee ${best.fee}:`);
  console.log(`  Tokens needed : ${ethers.utils.formatUnits(best.amountIn, tokenDec)} ${symbol}`);
  console.log(`  AUTO_POOL_FEE : ${AUTO ? "on" : "off"}`);
  console.log(`\n✅ Quote OK — bot can run with POOL_FEE=${best.fee} or AUTO_POOL_FEE=true`);
}

main();
