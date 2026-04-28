const { ethers } = require("ethers");
const provider = new ethers.providers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");
async function run() {
  const hash = "0xda2cfc228cbabdd6d2874cba507785a2ab9a5b16d379e0dd8cda74a9d99cb982";
  const receipt = await provider.getTransactionReceipt(hash);
  const tx = await provider.getTransaction(hash);
  
  const gasUsed = receipt.gasUsed;
  const gasPrice = receipt.effectiveGasPrice || tx.gasPrice;
  const feeWei = gasUsed.mul(gasPrice);
  const feeEth = ethers.utils.formatEther(feeWei);
  
  console.log("Gas Used:", gasUsed.toString());
  console.log("Gas Price (Gwei):", ethers.utils.formatUnits(gasPrice, "gwei"));
  console.log("Total Fee (ETH):", feeEth);
  console.log("Total Fee (USD approx): $" + (parseFloat(feeEth) * 3500).toFixed(4));
}
run();
