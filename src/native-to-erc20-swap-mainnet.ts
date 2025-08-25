import { SwapRouter } from "@summitx/smart-router/evm";
import { Percent, TradeType } from "@summitx/swap-sdk-core";
import { config } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  campMainnet,
  campMainnetTokens,
  SMART_ROUTER_ADDRESS,
} from "./config/camp-mainnet";
import { TokenQuoter } from "./quoter/token-quoter-mainnet";
import { logger } from "./utils/logger";

config();

async function delay(ms: number) {
  logger.info(`⏳ Waiting ${ms / 1000} seconds...`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  logger.header("🔄 Native to ERC20 Swap Example");
  logger.info("Swapping CAMP (native) to USDC");
  logger.divider();

  if (!process.env.PRIVATE_KEY) {
    logger.error("Please set PRIVATE_KEY in .env file");
    process.exit(1);
  }

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);

  const publicClient = createPublicClient({
    chain: campMainnet,
    transport: http(campMainnet.rpcUrls.default.http[0]),
  });

  const walletClient = createWalletClient({
    account,
    chain: campMainnet,
    transport: http(campMainnet.rpcUrls.default.http[0]),
  });

  logger.info(`Wallet address: ${account.address}`);

  // Check native balance
  const nativeBalance = await publicClient.getBalance({
    address: account.address,
  });
  logger.info(`Native CAMP balance: ${formatUnits(nativeBalance, 18)}`);

  if (nativeBalance < parseUnits("0.1", 18)) {
    logger.error("Insufficient CAMP balance. Need at least 0.1 CAMP");
    process.exit(1);
  }

  // Initialize quoter
  const quoter = new TokenQuoter({
    rpcUrl: campMainnet.rpcUrls.default.http[0],
    slippageTolerance: 1.0,
    maxHops: 2,
    maxSplits: 2,
    enableV2: false,
    enableV3: true,
  });

  try {
    // Add initial delay
    await delay(2000);

    // Define swap amount
    const swapAmount = "0.01"; // 0.01 CAMP

    logger.info(`Getting quote for ${swapAmount} CAMP → USDC...`);

    // Get quote
    const quote = await quoter.getQuote(
      campMainnetTokens.wcamp, // Use WCAMP for native
      campMainnetTokens.usdc,
      swapAmount,
      TradeType.EXACT_INPUT,
      false
    );

    if (!quote || !quote.rawTrade) {
      logger.error("No route found for CAMP → USDC");
      process.exit(1);
    }

    logger.success("Quote received:", {
      input: `${swapAmount} CAMP`,
      output: `${quote.outputAmount} USDC`,
      priceImpact: quote.priceImpact,
      route: quote.route,
    });

    // Generate swap parameters
    const trade = quote.rawTrade;
    const methodParameters = SwapRouter.swapCallParameters(trade, {
      slippageTolerance: new Percent(100, 10000), // 1%
      deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      recipient: account.address,
    });

    // For native token swap, set the value
    const nativeValue = parseUnits(swapAmount, 18);

    logger.info(
      `Sending ${formatUnits(nativeValue, 18)} CAMP with transaction`
    );

    // Execute swap
    logger.info("Executing swap...");

    const swapHash = await walletClient.sendTransaction({
      to: SMART_ROUTER_ADDRESS as Address,
      data: methodParameters.calldata,
      value: nativeValue, // Send native CAMP
    });

    logger.info(`Transaction sent: ${swapHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: swapHash,
    });

    if (receipt.status === "success") {
      logger.success(`✅ Swap successful! Gas used: ${receipt.gasUsed}`);

      // Check USDC balance
      const usdcBalance = await publicClient.readContract({
        address: campMainnetTokens.usdc.address as Address,
        abi: [
          {
            name: "balanceOf",
            type: "function",
            inputs: [{ name: "account", type: "address" }],
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
          },
        ] as const,
        functionName: "balanceOf",
        args: [account.address],
      });

      logger.success("New USDC balance:", formatUnits(usdcBalance, 6));
    } else {
      logger.error("❌ Swap failed");
    }
  } catch (error: any) {
    if (error?.message?.includes("429")) {
      logger.error("⚠️ Rate limited - try again later");
    } else {
      logger.error(
        "Error:",
        error?.shortMessage || error?.message || "Unknown error"
      );
    }
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error("Fatal error:", error?.message || error);
  process.exit(1);
});
