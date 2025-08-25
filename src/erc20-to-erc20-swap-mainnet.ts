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
import {
  approveTokenWithWait,
  delay,
  waitForTransaction,
} from "./utils/transaction-helpers";

config();

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

async function executeSwap(
  inputToken: any,
  outputToken: any,
  amount: string,
  walletClient: any,
  publicClient: any,
  account: any,
  quoter: TokenQuoter
) {
  logger.divider();
  logger.info(
    `Swapping ${amount} ${inputToken.symbol} → ${outputToken.symbol}`
  );

  // Check input token balance
  const inputBalance = await publicClient.readContract({
    address: inputToken.address as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  const requiredAmount = parseUnits(amount, inputToken.decimals);

  logger.info(
    `${inputToken.symbol} Balance: ${formatUnits(
      inputBalance,
      inputToken.decimals
    )}`
  );

  if (inputBalance < requiredAmount) {
    logger.warn(`Insufficient ${inputToken.symbol} balance. Skipping...`);
    return false;
  }

  // Get quote
  logger.info(`Getting quote...`);
  const quote = await quoter.getQuote(
    inputToken,
    outputToken,
    amount,
    TradeType.EXACT_INPUT,
    false
  );

  if (!quote || !quote.rawTrade) {
    logger.warn(
      `No route found for ${inputToken.symbol} → ${outputToken.symbol}`
    );
    return false;
  }

  logger.success("Quote received:", {
    input: `${amount} ${inputToken.symbol}`,
    output: `${quote.outputAmount} ${outputToken.symbol}`,
    priceImpact: quote.priceImpact,
  });

  // Approve token with waiting period
  await approveTokenWithWait(
    walletClient,
    publicClient,
    inputToken.address as Address,
    SMART_ROUTER_ADDRESS as Address,
    requiredAmount,
    inputToken.symbol,
    3000 // 3 second wait after approval
  );

  // Generate swap parameters
  const trade = quote.rawTrade;
  const methodParameters = SwapRouter.swapCallParameters(trade, {
    slippageTolerance: new Percent(100, 10000), // 1%
    deadline: Math.floor(Date.now() / 1000) + 60 * 20,
    recipient: account.address,
  });

  // Execute swap
  logger.info("Executing swap...");

  const swapHash = await walletClient.sendTransaction({
    to: SMART_ROUTER_ADDRESS as Address,
    data: methodParameters.calldata,
    value: 0n, // No native value for ERC20 to ERC20 swaps
  });

  logger.info(`Transaction sent: ${swapHash}`);

  await waitForTransaction(publicClient, swapHash, "swap transaction");

  // Add small delay after swap to ensure state is updated
  await delay(2000, "⏳ Waiting for blockchain state to update...");

  // Check output token balance
  const outputBalance = await publicClient.readContract({
    address: outputToken.address as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  logger.success(
    `New ${outputToken.symbol} balance: ${formatUnits(
      outputBalance,
      outputToken.decimals
    )}`
  );
  return true;
}

async function main() {
  logger.header("🔄 ERC20 to ERC20 Swap Examples");
  logger.info("Multiple token pair swaps");
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

  // Initialize quoter
  const quoter = new TokenQuoter({
    rpcUrl: campMainnet.rpcUrls.default.http[0],
    slippageTolerance: 1.0,
    maxHops: 2,
    maxSplits: 2,
    enableV2: true,
    enableV3: true,
  });

  try {
    // Add initial delay
    await delay(2000);

    // Display all token balances
    logger.info("Checking token balances...");
    const tokens = [campMainnetTokens.usdc, campMainnetTokens.wcamp];

    for (const token of tokens) {
      const balance = await publicClient.readContract({
        address: token.address as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      });
      logger.info(`${token.symbol}: ${formatUnits(balance, token.decimals)}`);
    }

    // Example swaps
    const swaps = [
      {
        input: campMainnetTokens.usdc,
        output: campMainnetTokens.wcamp,
        amount: "0.001",
        description: "USDC → WCAMP",
      },
      {
        input: campMainnetTokens.wcamp,
        output: campMainnetTokens.usdc,
        amount: "0.001",
        description: "WCAMP → USDC",
      },
    ];

    let successCount = 0;
    let failureCount = 0;

    for (const swap of swaps) {
      logger.header(`📊 ${swap.description}`);

      const success = await executeSwap(
        swap.input,
        swap.output,
        swap.amount,
        walletClient,
        publicClient,
        account,
        quoter
      );

      if (success) {
        successCount++;
      } else {
        failureCount++;
      }

      // Wait between swaps
      await delay(5000);
    }

    // Final summary
    logger.divider();
    logger.header("📈 Summary");
    logger.success(`Successful swaps: ${successCount}`);
    if (failureCount > 0) {
      logger.warn(`Failed/Skipped swaps: ${failureCount}`);
    }

    // Display final balances
    logger.divider();
    logger.info("Final token balances:");

    for (const token of tokens) {
      const balance = await publicClient.readContract({
        address: token.address as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      });
      const formatted = formatUnits(balance, token.decimals);
      if (parseFloat(formatted) > 0) {
        logger.success(`${token.symbol}: ${formatted}`);
      }
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
