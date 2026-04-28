/**
 * Test KyberSwap quote for SPACEL -> USDT
 */

require("dotenv").config();
const { ethers } = require("ethers");

const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || "0x60137Fca8149FFae539d0eEe96aa217e91865e41";
const USDT_ADDRESS = process.env.USDT_ADDRESS || "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
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

  const [symbol, tokenDec, usdtDec, balance] = await Promise.all([
    token.symbol(),
    token.decimals(),
    usdt.decimals(),
    token.balanceOf(wallet.address),
  ]);

  console.log(`\nWallet : ${wallet.address}`);
  console.log(`Token  : ${symbol} (${TOKEN_ADDRESS})`);
  console.log(`Balance: ${ethers.utils.formatUnits(balance, tokenDec)} ${symbol}\n`);

  if (balance.isZero()) {
    console.error("❌ Token balance is 0. No tokens to sell.");
    process.exit(1);
  }

  console.log("Fetching KyberSwap quote for full balance...");

  try {
    const url = `https://aggregator-api.kyberswap.com/arbitrum/api/v1/routes?tokenIn=${TOKEN_ADDRESS}&token` +
                `Out=${USDT_ADDRESS}&amountIn=${balance.toString()}`;
    const res = await fetch(url);
    const data = await res.json();

    console.log("Raw response:", JSON.stringify(data, null, 2));

    if (data.code !== 0) {
      console.error(`\n❌ KyberSwap returned error code: ${data.code}`);
      console.error(`Message: ${data.message}`);
      process.exit(1);
    }

    if (!data.data || !data.data.routeSummary) {
      console.error(`\n❌ KyberSwap quote failed: No routeSummary in response`);
      process.exit(1);
    }

    const routeSummary = data.data.routeSummary;
    console.log("\nRoute summary structure:", Object.keys(routeSummary));

    // Try different possible paths to amountOut
    let amountIn, amountOut;
    if (routeSummary.amount) {
      amountIn = routeSummary.amount.amountIn || routeSummary.amount.in;
      amountOut = routeSummary.amount.amountOut || routeSummary.amount.out;
    } else {
      amountIn = routeSummary.amountIn;
      amountOut = routeSummary.amountOut;
    }

    if (!amountOut) {
      console.error("\n❌ Could not find amountOut in routeSummary");
      process.exit(1);
    }

    const estUsdtOut = ethers.utils.formatUnits(amountOut, usdtDec);
    const tokensIn = ethers.utils.formatUnits(amountIn || balance, tokenDec);

    console.log(`\n✅ Quote OK via KyberSwap aggregator:`);
    console.log(`  Tokens in : ${tokensIn} ${symbol}`);
    console.log(`  USDT out  : ${estUsdtOut} USDT`);
    console.log(`  Gas       : ${routeSummary.gas || 'N/A'} units`);
    console.log(`  Route     : ${routeSummary.route?.length || 0} hops`);
    console.log(`\nBot can run with this configuration.`);
  } catch (e) {
    console.error(`\n❌ Quote failed: ${e.message}`);
    process.exit(1);
  }
}

main();
