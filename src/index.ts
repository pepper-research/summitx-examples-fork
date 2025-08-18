import { exec } from "child_process";
import { config } from "dotenv";
import { promisify } from "util";
import { logger } from "./utils/logger";

config();

const execAsync = promisify(exec);

async function runCommand(command: string, description: string) {
  logger.info(`Running: ${description}`);
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stdout) console.log(stdout);
    if (stderr && !stderr.includes("DeprecationWarning")) console.error(stderr);
    return true;
  } catch (error: any) {
    logger.error(`Failed: ${error?.message}`);
    return false;
  }
}

async function main() {
  logger.header("🚀 SummitX DEX - Complete Examples");
  logger.info("Base Camp Testnet (Chain ID: 123420001114)");
  logger.divider();

  if (!process.env.PRIVATE_KEY) {
    logger.error("Please set PRIVATE_KEY in .env file");
    process.exit(1);
  }

  // Run wrap/unwrap example
  logger.header("💱 Running Wrap/Unwrap Example");
  const wrapSuccess = await runCommand(
    "npx tsx src/wrap-unwrap-example.ts",
    "Wrap/Unwrap CAMP ↔ WCAMP"
  );

  if (!wrapSuccess) {
    logger.warn("Wrap/unwrap example failed, continuing...");
  }

  // Wait longer between operations to avoid rate limiting
  logger.info("⏳ Waiting 5 seconds before next operation...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Run native to ERC20 swap
  logger.header("🔄 Running Native to ERC20 Swap");
  const nativeToErc20Success = await runCommand(
    "npx tsx src/native-to-erc20-swap.ts",
    "Native CAMP → USDC"
  );

  if (!nativeToErc20Success) {
    logger.warn("Native to ERC20 swap failed, continuing...");
  }

  // Wait between operations
  logger.info("⏳ Waiting 5 seconds before next operation...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Run ERC20 to native swap
  logger.header("🔄 Running ERC20 to Native Swap");
  const erc20ToNativeSuccess = await runCommand(
    "npx tsx src/erc20-to-native-swap.ts",
    "USDC → Native CAMP"
  );

  if (!erc20ToNativeSuccess) {
    logger.warn("ERC20 to native swap failed, continuing...");
  }

  // Wait between operations
  logger.info("⏳ Waiting 5 seconds before next operation...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Run ERC20 to ERC20 swaps
  logger.header("🔄 Running ERC20 to ERC20 Swaps");
  const erc20ToErc20Success = await runCommand(
    "npx tsx src/erc20-to-erc20-swap.ts",
    "Multiple ERC20 Swaps"
  );

  if (!erc20ToErc20Success) {
    logger.warn("ERC20 to ERC20 swaps failed, continuing...");
  }

  // Wait longer between operations
  logger.info("⏳ Waiting 5 seconds to complete...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  logger.divider();
  logger.success("🎉 All examples completed!");
  logger.info("\nAvailable commands:");
  logger.info("  npm start                - Run all examples");
  logger.info("  npm run wrap-unwrap      - Run wrap/unwrap example only");
  logger.info("  npm run swap:native-to-erc20 - Run native to ERC20 swap");
  logger.info("  npm run swap:erc20-to-native - Run ERC20 to native swap");
  logger.info("  npm run swap:erc20-to-erc20  - Run ERC20 to ERC20 swaps");
  logger.info("  npm run swap:all         - Run all swap examples");
  logger.info("  npm run check:balance    - Check wallet balances");
}

// Run the main function
main().catch((error) => {
  logger.error("Fatal error:", error?.message || error);
  process.exit(1);
});
