const { ethers } = require("ethers");
const provider = new ethers.providers.JsonRpcProvider("https://arb1.arbitrum.io/rpc");
async function run() {
  const gp = await provider.getGasPrice();
  const fd = await provider.getFeeData();
  console.log("gasPrice:", ethers.utils.formatUnits(gp, "gwei"), "gwei");
  console.log("feeData.maxFeePerGas:", ethers.utils.formatUnits(fd.maxFeePerGas || 0, "gwei"));
  console.log("feeData.maxPriorityFeePerGas:", ethers.utils.formatUnits(fd.maxPriorityFeePerGas || 0, "gwei"));
}
run();
