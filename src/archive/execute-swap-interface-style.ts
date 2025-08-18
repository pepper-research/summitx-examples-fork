import { SwapRouter, type MethodParameters } from "@summitx/smart-router/evm";
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
import { baseCampTestnetTokens } from "../config/base-testnet";
import { TokenQuoter } from "../quoter/token-quoter";
import { logger } from "../utils/logger";
import { QuoteToTradeConverterV2 } from "../utils/quote-to-trade-converter-v2";

// Load environment variables
config();

// Chain configuration
const CHAIN_ID = 123420001114;
const CHAIN_CONFIG = {
  id: CHAIN_ID,
  name: "Base Camp Testnet",
  network: "basecamp",
  nativeCurrency: { name: "CAMP", symbol: "CAMP", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc-campnetwork.xyz"] },
    public: { http: ["https://rpc-campnetwork.xyz"] },
  },
};

// Router address
const SMART_ROUTER_ADDRESS =
  "0x197b7c9fC5c8AeA84Ab2909Bf94f24370539722D" as Address;

// ERC20 ABI for approval
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
  logger.header("SummitX Swap Execution - Interface Style");

  // Check for private key
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    logger.error("Please set PRIVATE_KEY in your .env file");
    process.exit(1);
  }

  // Setup account and clients
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: CHAIN_CONFIG as any,
    transport: http(
      "https://rpc-campnetwork.xyz/8708df38d9cc4bb39ac813ae005be495"
    ),
  });

  const publicClient = createPublicClient({
    chain: CHAIN_CONFIG as any,
    transport: http(
      "https://rpc-campnetwork.xyz/8708df38d9cc4bb39ac813ae005be495"
    ),
  });

  logger.info(`Wallet address: ${account.address}`);

  // Initialize token quoter
  const quoter = new TokenQuoter({
    rpcUrl: "https://rpc-campnetwork.xyz/8708df38d9cc4bb39ac813ae005be495",
    slippageTolerance: 5.0,
    maxHops: 3,
    maxSplits: 4,
    enableV2: false, // Disable V2 due to chain ID issues
    enableV3: true,
  });

  // Define swap parameters
  const inputToken = baseCampTestnetTokens.usdt;
  const outputToken = baseCampTestnetTokens.usdc;
  const inputAmount = "1.50"; // 1.50 USDT
  const slippageTolerancePercent = new Percent(1000, 10000); // 1%

  logger.header("Step 1: Check Balances");

  const usdcBalance = await publicClient.readContract({
    address: inputToken.address as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  logger.info(
    `USDC Balance: ${formatUnits(usdcBalance, inputToken.decimals)} USDC`
  );

  if (usdcBalance < parseUnits(inputAmount, inputToken.decimals)) {
    logger.error(
      `Insufficient USDC balance. Need at least ${inputAmount} USDC`
    );
    return;
  }

  logger.header("Step 2: Get Quote and Convert to SmartRouterTrade");

  try {
    // Get quote from TokenQuoter
    const quote = await quoter.getQuote(
      inputToken,
      outputToken,
      inputAmount,
      TradeType.EXACT_INPUT,
      false
    );

    if (!quote) {
      logger.error("No quote available");
      return;
    }

    logger.success("Quote received:", {
      input: `${quote.inputAmount} ${quote.inputToken.symbol}`,
      output: `${quote.outputAmount} ${quote.outputToken.symbol}`,
      route: Array.isArray(quote.route) ? quote.route : [quote.route],
      pools: quote.pools,
    });

    // Convert to SmartRouterTrade format
    logger.header("Step 3: Convert to SmartRouterTrade");

    if (!quote.rawTrade) {
      console.log("No raw trade available, converting to SmartRouterTrade");
      return;
    }
    const trade = quote.rawTrade;
    logger.success("Trade converted:", {
      inputAmount: `${formatUnits(
        trade.inputAmount.quotient,
        trade.inputAmount.currency.decimals
      )} ${trade.inputAmount.currency.symbol}`,
      outputAmount: `${formatUnits(
        trade.outputAmount.quotient,
        trade.outputAmount.currency.decimals
      )} ${trade.outputAmount.currency.symbol}`,
      routes: trade.routes.length,
      routeDetails: trade.routes.map((route) => ({
        type: route.type,
        percent: `${route.percent}%`,
        pools: route.pools.length,
        path: route.path.map((t) => t.symbol).join(" → "),
      })),
    });

    // Validate conversion
    const isValid = QuoteToTradeConverterV2.validateConversion(quote, trade);
    logger.info(`Conversion validation: ${isValid ? "✓ PASSED" : "✗ FAILED"}`);

    // Build swap parameters using SwapRouter (interface style)
    logger.header("Step 4: Build Swap Parameters");

    const swapOptions = {
      slippageTolerance: slippageTolerancePercent,
      recipient: account.address,
      deadlineOrPreviousBlockhash: Math.floor(Date.now() / 1000) + 300, // 5 minutes
    };

    const methodParameters: MethodParameters = SwapRouter.swapCallParameters(
      trade,
      swapOptions
    );

    logger.info("Swap parameters built:", {
      to: SMART_ROUTER_ADDRESS,
      value: methodParameters.value,
      calldataLength: methodParameters.calldata.length,
    });

    // Handle approval
    const inputTokenAddress = trade.inputAmount.currency.isToken
      ? (trade.inputAmount.currency.address as Address)
      : undefined;

    if (inputTokenAddress) {
      const currentAllowance = await publicClient.readContract({
        address: inputTokenAddress,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account.address, SMART_ROUTER_ADDRESS],
      });

      if (currentAllowance < trade.inputAmount.quotient) {
        logger.header("Step 5: Approve Router");

        const approvalTx = await walletClient.writeContract({
          address: inputTokenAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [SMART_ROUTER_ADDRESS, trade.inputAmount.quotient],
        });

        logger.info(`Approval transaction: ${approvalTx}`);

        const approvalReceipt = await publicClient.waitForTransactionReceipt({
          hash: approvalTx,
        });

        logger.success(
          `Approval confirmed in block ${approvalReceipt.blockNumber}`
        );
      }
    }

    logger.header("Step 6: Execute Swap");
    logger.info("Sending swap transaction in 3 seconds... (Ctrl+C to cancel)");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Execute the swap
    const swapTx = await walletClient.sendTransaction({
      to: SMART_ROUTER_ADDRESS as Address, // Ensure router address is used
      data: methodParameters.calldata as Hex,
      value: BigInt(methodParameters.value),
      gas: 500000n,
    });

    logger.info(`Swap transaction sent: ${swapTx}`);
    logger.info("Waiting for confirmation...");

    const swapReceipt = await publicClient.waitForTransactionReceipt({
      hash: swapTx,
    });

    logger.success(`Swap confirmed!`, {
      block: swapReceipt.blockNumber,
      gasUsed: swapReceipt.gasUsed.toString(),
      txHash: swapReceipt.transactionHash,
      status: swapReceipt.status === "success" ? "✓ Success" : "✗ Failed",
    });

    // Check final balances
    logger.header("Step 7: Verify Results");

    const [finalUsdcBalance, finalUsdtBalance] = await Promise.all([
      publicClient.readContract({
        address: inputToken.address as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      }),
      publicClient.readContract({
        address: outputToken.address as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      }),
    ]);

    const usdcSpent = formatUnits(
      usdcBalance - finalUsdcBalance,
      inputToken.decimals
    );
    const usdtReceived = formatUnits(finalUsdtBalance, outputToken.decimals);

    logger.success("Swap completed successfully!", {
      spent: `${usdcSpent} USDC`,
      received: `${usdtReceived} USDT`,
      finalUsdcBalance: `${formatUnits(
        finalUsdcBalance,
        inputToken.decimals
      )} USDC`,
      finalUsdtBalance: `${usdtReceived} USDT`,
    });

    // Log trade details for debugging
    logger.divider();
    logger.info("Trade execution details:", {
      tradeType:
        trade.tradeType === TradeType.EXACT_INPUT
          ? "EXACT_INPUT"
          : "EXACT_OUTPUT",
      routerMethod: "SwapRouter.swapCallParameters",
      slippage: `${slippageTolerancePercent.toFixed(2)}%`,
      deadline: new Date(
        (swapOptions.deadlineOrPreviousBlockhash as number) * 1000
      ).toLocaleString(),
    });
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
    } else if (error?.shortMessage) {
      // Show short message if available
      logger.error("Failed to execute swap:", error.shortMessage);
    } else {
      // Show only the error message, not the full object
      logger.error(
        "Failed to execute swap:",
        error?.message || "Unknown error occurred"
      );
    }
  }
}

// Run the example
main().catch((error: any) => {
  // Clean error output
  if (error?.message?.includes("429")) {
    logger.error("⚠️ Rate limited by RPC endpoint");
  } else {
    logger.error("Failed to run swap execution:", error?.message || error);
  }
  process.exit(1);
});
