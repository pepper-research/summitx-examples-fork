import { config } from "dotenv";
import { ethers } from "ethers";
import { formatUnits, parseUnits } from "viem";
import { WETH_ADDRESS } from "./config/base-testnet";
import { logger } from "./utils/logger";

config();

const WETH_ABI = [
  "function deposit() payable",
  "function withdraw(uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "event Deposit(address indexed dst, uint256 wad)",
  "event Withdrawal(address indexed src, uint256 wad)",
];

async function main() {
  logger.header("Wrap/Unwrap Example - Base Camp Testnet");

  if (!process.env.PRIVATE_KEY) {
    logger.error("Please set PRIVATE_KEY in .env file");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(process.env.BASE_TESTNET_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, wallet);

  logger.info(`Wallet address: ${wallet.address}`);

  try {
    const nativeBalance = await provider.getBalance(wallet.address);
    const wethBalance = await wethContract.balanceOf(wallet.address);

    logger.info("Current balances:", {
      nativeCAMP: formatUnits(nativeBalance, 18),
      wrappedCAMP: formatUnits(wethBalance, 18),
    });

    logger.header("1. Wrapping Native CAMP to WCAMP");

    const wrapAmount = parseUnits("0.01", 18);
    logger.info(`Wrapping ${formatUnits(wrapAmount, 18)} CAMP...`);

    const wrapTx = await wethContract.deposit({ value: wrapAmount });
    logger.info(`Wrap transaction sent: ${wrapTx.hash}`);

    const wrapReceipt = await wrapTx.wait();
    logger.success(
      `✅ Wrap successful! Gas used: ${wrapReceipt.gasUsed.toString()}`
    );

    const newWethBalance = await wethContract.balanceOf(wallet.address);
    logger.info(`New WCAMP balance: ${formatUnits(newWethBalance, 18)}`);

    logger.header("2. Unwrapping WCAMP to Native CAMP");

    const unwrapAmount = parseUnits("0.005", 18);

    if (newWethBalance >= unwrapAmount) {
      logger.info(`Unwrapping ${formatUnits(unwrapAmount, 18)} WCAMP...`);

      const unwrapTx = await wethContract.withdraw(unwrapAmount);
      logger.info(`Unwrap transaction sent: ${unwrapTx.hash}`);

      const unwrapReceipt = await unwrapTx.wait();
      logger.success(
        `✅ Unwrap successful! Gas used: ${unwrapReceipt.gasUsed.toString()}`
      );

      const finalNativeBalance = await provider.getBalance(wallet.address);
      const finalWethBalance = await wethContract.balanceOf(wallet.address);

      logger.success("Final balances:", {
        nativeCAMP: formatUnits(finalNativeBalance, 18),
        wrappedCAMP: formatUnits(finalWethBalance, 18),
      });
    } else {
      logger.warn("Insufficient WCAMP balance for unwrapping");
    }

    logger.success("🎉 Wrap/Unwrap example completed successfully!");
  } catch (error) {
    logger.error("Error during wrap/unwrap operations:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error("Failed to run wrap/unwrap example", error);
  process.exit(1);
});
