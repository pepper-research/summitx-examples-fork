import { ChainId } from "@summitx/chains";
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
import { basecampTestnet, baseCampTestnetTokens } from "./config/base-testnet";
import { getContractsForChain } from "./config/chains";
import { TokenQuoter } from "./quoter/token-quoter";
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

async function main() {
  logger.header("🔄 ERC20 to Native Swap Example");
  logger.info("Swapping USDC to CAMP (native) - includes automatic unwrap");
  logger.divider();

  const contracts = getContractsForChain(ChainId.BASECAMP_TESTNET);

  if (!process.env.PRIVATE_KEY) {
    logger.error("Please set PRIVATE_KEY in .env file");
    process.exit(1);
  }

  const account = privateKeyToAccount(process.env.SOLVER_PRIVATE_KEY as Hex);

  const publicClient = createPublicClient({
    chain: basecampTestnet,
    transport: http(basecampTestnet.rpcUrls.default.http[0]),
  });

  const walletClient = createWalletClient({
    account,
    chain: basecampTestnet,
    transport: http(basecampTestnet.rpcUrls.default.http[0]),
  });

  logger.info(`Wallet address: ${account.address}`);

  // Define tokens to use throughout the file
  const INPUT_TOKEN = baseCampTestnetTokens.usdc;
  const OUTPUT_TOKEN = baseCampTestnetTokens.wcamp; // WCAMP for native swaps

  // Check input token balance
  const inputBalance = await publicClient.readContract({
    address: INPUT_TOKEN.address as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  logger.info(
    `${INPUT_TOKEN.symbol} Balance: ${formatUnits(
      inputBalance,
      INPUT_TOKEN.decimals
    )}`
  );

  if (inputBalance < parseUnits("0.5", INPUT_TOKEN.decimals)) {
    logger.error(
      `Insufficient ${INPUT_TOKEN.symbol} balance. Need at least 0.5 ${INPUT_TOKEN.symbol}`
    );
    process.exit(1);
  }

  // Initialize quoter
  const quoter = new TokenQuoter({
    rpcUrl: basecampTestnet.rpcUrls.default.http[0],
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
    const swapAmount = "0.5"; // 0.5 of input token

    logger.info(
      `Getting quote for ${swapAmount} ${INPUT_TOKEN.symbol} → CAMP...`
    );

    // Get quote - first get to WCAMP, then we'll unwrap
    const quote = await quoter.getQuote(
      INPUT_TOKEN,
      OUTPUT_TOKEN,
      swapAmount,
      TradeType.EXACT_INPUT,
      false
    );

    if (!quote || !quote.rawTrade) {
      logger.error(`No route found for ${INPUT_TOKEN.symbol} → CAMP`);
      process.exit(1);
    }

    logger.success("Quote received:", {
      input: `${swapAmount} ${INPUT_TOKEN.symbol}`,
      output: `${quote.outputAmount} CAMP`,
      priceImpact: quote.priceImpact,
      route: quote.route,
    });

    // Check initial native balance
    const initialNativeBalance = await publicClient.getBalance({
      address: account.address,
    });
    logger.info(
      `Initial CAMP balance: ${formatUnits(
        initialNativeBalance,
        basecampTestnet.nativeCurrency.decimals
      )}`
    );

    // Approve input token with waiting period
    await approveTokenWithWait(
      walletClient,
      publicClient,
      INPUT_TOKEN.address as Address,
      contracts.SMART_ROUTER as Address,
      parseUnits(swapAmount, INPUT_TOKEN.decimals),
      INPUT_TOKEN.symbol,
      3000 // 3 second wait after approval
    );

    // Generate swap parameters
    const trade = quote.rawTrade;
    const methodParameters = SwapRouter.swapCallParameters(trade, {
      slippageTolerance: new Percent(100, 10000), // 1%
      deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      recipient: account.address,
    });

    // Add unwrap to get native CAMP
    // The router needs to swap to WCAMP and then unwrap to native
    logger.info("Executing swap with automatic unwrap to native CAMP...");

    // Check if WCAMP balance before (for debugging)
    const wcampBalanceBefore = await publicClient.readContract({
      address: OUTPUT_TOKEN.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
    logger.info(
      `WCAMP balance before: ${formatUnits(
        wcampBalanceBefore,
        OUTPUT_TOKEN.decimals
      )}`
    );

    const swapHash = await walletClient.sendTransaction({
      to: contracts.SMART_ROUTER as Address,
      data: methodParameters.calldata,
      value: 0n, // No native value for ERC20 swaps
    });

    logger.info(`Transaction sent: ${swapHash}`);

    await waitForTransaction(publicClient, swapHash, "swap transaction");

    // Add small delay after swap to ensure state is updated
    await delay(2000, "⏳ Waiting for blockchain state to update...");

    // Check balances after swap
    const [wcampBalanceAfter, finalUsdcBalance] = await Promise.all([
      publicClient.readContract({
        address: OUTPUT_TOKEN.address as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      }),
      publicClient.readContract({
        address: INPUT_TOKEN.address as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      }),
    ]);

    logger.info(
      `WCAMP balance after swap: ${formatUnits(
        wcampBalanceAfter,
        OUTPUT_TOKEN.decimals
      )}`
    );
    const wcampReceived = wcampBalanceAfter - wcampBalanceBefore;

    if (wcampReceived > 0n) {
      // We received WCAMP, need to unwrap it to native CAMP
      logger.info(
        `Received ${formatUnits(
          wcampReceived,
          OUTPUT_TOKEN.decimals
        )} WCAMP, unwrapping to native CAMP...`
      );

      // Unwrap WCAMP to native CAMP
      const WETH_ABI = [
        {
          name: "withdraw",
          type: "function",
          inputs: [{ name: "wad", type: "uint256" }],
          outputs: [],
          stateMutability: "nonpayable",
        },
      ] as const;

      const unwrapHash = await walletClient.writeContract({
        address: OUTPUT_TOKEN.address as Address,
        abi: WETH_ABI,
        functionName: "withdraw",
        args: [wcampReceived],
      });

      logger.info(`Unwrap transaction sent: ${unwrapHash}`);
      const unwrapReceipt = await publicClient.waitForTransactionReceipt({
        hash: unwrapHash,
      });

      if (unwrapReceipt.status === "success") {
        logger.success("✅ Unwrap successful!");
      }
    }

    // Check final native balance
    const finalNativeBalance = await publicClient.getBalance({
      address: account.address,
    });

    logger.success("Balance changes:", {
      [INPUT_TOKEN.symbol]: `${formatUnits(
        inputBalance,
        INPUT_TOKEN.decimals
      )} → ${formatUnits(finalUsdcBalance, INPUT_TOKEN.decimals)}`,
      "Native CAMP": `${formatUnits(
        initialNativeBalance,
        basecampTestnet.nativeCurrency.decimals
      )} → ${formatUnits(
        finalNativeBalance,
        basecampTestnet.nativeCurrency.decimals
      )}`,
    });
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
