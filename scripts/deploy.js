const hre = require("hardhat"), fs = require("fs");
async function main() {
  const c = await hre.ethers.deployContract("CertiChain");
  await c.waitForDeployment();
  const address = await c.getAddress();
  fs.writeFileSync("backend/contract.json", JSON.stringify({ address, abi: JSON.parse(c.interface.formatJson()) }, null, 2));
  console.log("CertiChain deployed to", address);
}
main().catch(e => { console.error(e); process.exit(1); });
