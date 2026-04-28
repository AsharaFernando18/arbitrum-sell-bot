const { ethers } = require("ethers");
const provider = new ethers.providers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");
async function run() {
  const address = "0x8c536E634Dd93E27a5cf4cCDB0a80555eD4f480d";
  const bal = await provider.getBalance(address);
  console.log("ETH Balance:", ethers.utils.formatEther(bal));
}
run();
