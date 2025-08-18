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

  // Run swap examples
  logger.header("🔄 Running Swap Examples");
  const swapSuccess = await runCommand(
    "npx tsx src/swap-examples.ts",
    "All Swap Examples"
  );

  if (!swapSuccess) {
    logger.warn("Single swap example failed, continuing...");
  }

  // Wait longer between operations
  logger.info("⏳ Waiting 5 seconds to complete...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  logger.divider();
  logger.success("🎉 All examples completed!");
  logger.info("\nAvailable commands:");
  logger.info("  npm start          - Run this combined example");
  logger.info("  npm run wrap-unwrap - Run wrap/unwrap example only");
  logger.info("  npm run swap       - Run comprehensive swap examples");
  logger.info("  npm run check:balance - Check wallet balances");
}

// Run the main function
main().catch((error) => {
  logger.error("Fatal error:", error?.message || error);
  process.exit(1);
});
