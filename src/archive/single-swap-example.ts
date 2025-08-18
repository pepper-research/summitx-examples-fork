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
  basecampTestnet,
  baseCampTestnetTokens,
  SMART_ROUTER_ADDRESS,
} from "../config/base-testnet";
import { TokenQuoter } from "../quoter/token-quoter";
import { logger } from "../utils/logger";

config();

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    name: "allowance",
    type: "function",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

async function main() {
  logger.header("🔄 Single Swap Example - Base Camp Testnet");

  if (!process.env.PRIVATE_KEY) {
    logger.error("Please set PRIVATE_KEY in .env file");
    process.exit(1);
  }

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);

  const publicClient = createPublicClient({
    chain: basecampTestnet,
    transport: http(
      process.env.BASE_TESTNET_RPC_URL || "https://rpc-campnetwork.xyz"
    ),
  });

  const walletClient = createWalletClient({
    account,
    chain: basecampTestnet,
    transport: http(
      process.env.BASE_TESTNET_RPC_URL || "https://rpc-campnetwork.xyz"
    ),
  });

  logger.info(`Wallet address: ${account.address}`);

  try {
    // Check USDC balance
    const usdcBalance = await publicClient.readContract({
      address: baseCampTestnetTokens.usdc.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });

    logger.info(`USDC Balance: ${formatUnits(usdcBalance, 6)} USDC`);

    if (usdcBalance === 0n) {
      logger.error("No USDC balance. Please get some USDC first.");
      process.exit(1);
    }

    // Initialize quoter with conservative settings
    const quoter = new TokenQuoter({
      rpcUrl: process.env.BASE_TESTNET_RPC_URL || "https://rpc-campnetwork.xyz",
      slippageTolerance: 1.0, // 1% slippage
      maxHops: 2,
      maxSplits: 2,
      enableV2: false, // Disable V2 due to chain ID issues
      enableV3: true,
    });

    // Simple USDC to USDT swap
    logger.header("Swapping USDC → USDT");

    const swapAmount = "0.1"; // 0.1 USDC
    const swapAmountBigInt = parseUnits(swapAmount, 6);

    logger.info(`Getting quote for ${swapAmount} USDC → USDT...`);

    const quote = await quoter.getQuote(
      baseCampTestnetTokens.usdc,
      baseCampTestnetTokens.usdt,
      swapAmount, // Pass decimal string, not raw amount
      TradeType.EXACT_INPUT,
      false // Don't adjust for gas like execute-swap-interface-style
    );

    if (!quote) {
      logger.error("No route found for USDC → USDT");
      process.exit(1);
    }

    logger.success("Quote received:", {
      input: `${swapAmount} USDC`,
      output: `${quote.outputAmount} USDT`,
      priceImpact: quote.priceImpact,
      route: quote.route,
    });

    // Check and approve USDC
    const allowance = await publicClient.readContract({
      address: baseCampTestnetTokens.usdc.address as Address,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, SMART_ROUTER_ADDRESS],
    });

    if (allowance < swapAmountBigInt) {
      logger.info(`Approving USDC...`);
      const approveHash = await walletClient.writeContract({
        address: baseCampTestnetTokens.usdc.address as Address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [SMART_ROUTER_ADDRESS, swapAmountBigInt],
      });

      logger.info(`Approval transaction: ${approveHash}`);
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      logger.success("✅ USDC approved");
    }

    // Use rawTrade directly from the quote
    if (!quote.rawTrade) {
      logger.error("No raw trade available in quote");
      process.exit(1);
    }
    const trade = quote.rawTrade;

    // Prepare swap parameters
    const methodParameters = SwapRouter.swapCallParameters(trade, {
      slippageTolerance: new Percent(100, 10000), // 1%
      deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      recipient: account.address,
    });

    // Log the method parameters for debugging
    logger.info("Swap parameters:", {
      to: SMART_ROUTER_ADDRESS,
      functionSelector: methodParameters.calldata.slice(0, 10),
      value: methodParameters.value,
    });

    // Execute swap
    logger.info(`Executing swap to router: ${SMART_ROUTER_ADDRESS}`);

    const swapHash = await walletClient.sendTransaction({
      to: SMART_ROUTER_ADDRESS as Address, // Use the router address directly
      data: methodParameters.calldata,
      value: methodParameters.value,
      gas: 500000n,
    });

    logger.info(`Swap transaction: ${swapHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: swapHash,
    });

    if (receipt.status === "success") {
      logger.success(`✅ Swap successful! Gas used: ${receipt.gasUsed}`);

      // Check final balances
      const [finalUsdcBalance, finalUsdtBalance] = await Promise.all([
        publicClient.readContract({
          address: baseCampTestnetTokens.usdc.address as Address,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [account.address],
        }),
        publicClient.readContract({
          address: baseCampTestnetTokens.usdt.address as Address,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [account.address],
        }),
      ]);

      logger.success("Final balances:", {
        USDC: formatUnits(finalUsdcBalance, 6),
        USDT: formatUnits(finalUsdtBalance, 6),
      });
    } else {
      logger.error("❌ Swap failed");
    }
  } catch (error: any) {
    // Handle rate limiting errors with cleaner output
    if (
      error?.message?.includes("429") ||
      error?.message?.includes("Too Many Requests")
    ) {
      logger.error("⚠️ Rate Limited: Too many requests to RPC endpoint");
      logger.info("💡 Tips:");
      logger.info("  - Wait a few seconds and try again");
      logger.info("  - Use a different RPC endpoint");
      logger.info("  - Add delays between requests");
    } else if (error?.shortMessage) {
      // Show short message if available
      logger.error("Error:", error.shortMessage);
    } else {
      // Show only the error message, not the full object
      logger.error("Error:", error?.message || "Unknown error occurred");
    }
    process.exit(1);
  }
}

main().catch((error: any) => {
  if (error?.message?.includes("429")) {
    logger.error("⚠️ Rate limited - try again later");
  } else {
    logger.error("Failed to run single swap example:", error?.message || error);
  }
  process.exit(1);
});
