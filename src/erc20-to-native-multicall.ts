import { SwapRouter } from "@summitx/smart-router/evm";
import { Percent, TradeType } from "@summitx/swap-sdk-core";
import { config } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
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
  WCAMP_ADDRESS,
} from "./config/base-testnet";
import { TokenQuoter } from "./quoter/token-quoter";
import { logger } from "./utils/logger";

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

const WETH_ABI = [
  {
    name: "withdraw",
    type: "function",
    inputs: [{ name: "wad", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

// SwapRouter02 multicall ABI
const ROUTER_MULTICALL_ABI = [
  {
    name: "multicall",
    type: "function",
    inputs: [
      {
        name: "data",
        type: "bytes[]",
      },
    ],
    outputs: [
      {
        name: "results",
        type: "bytes[]",
      },
    ],
    stateMutability: "payable",
  },
  {
    name: "unwrapWETH9",
    type: "function",
    inputs: [
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    name: "sweepToken",
    type: "function",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
] as const;

async function checkAndApproveToken(
  walletClient: any,
  publicClient: any,
  tokenAddress: Address,
  amount: bigint,
  walletAddress: Address
) {
  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [walletAddress, SMART_ROUTER_ADDRESS as Address],
  });

  if (allowance < amount) {
    logger.info(`Approving ${formatUnits(amount, 6)} USDC...`);
    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [SMART_ROUTER_ADDRESS as Address, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    logger.success("✅ Token approved");
  }
}

async function delay(ms: number) {
  logger.info(`⏳ Waiting ${ms / 1000} seconds...`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  logger.header("🔄 ERC20 to Native Swap with Multicall");
  logger.info("Swapping USDC to CAMP (native) in a single transaction");
  logger.divider();

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

  // Check USDC balance
  const usdcBalance = await publicClient.readContract({
    address: baseCampTestnetTokens.usdc.address as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  logger.info(`USDC Balance: ${formatUnits(usdcBalance, 6)}`);

  if (usdcBalance < parseUnits("0.5", 6)) {
    logger.error("Insufficient USDC balance. Need at least 0.5 USDC");
    process.exit(1);
  }

  // Initialize quoter
  const quoter = new TokenQuoter({
    rpcUrl: process.env.BASE_TESTNET_RPC_URL || "https://rpc-campnetwork.xyz",
    slippageTolerance: 1.0,
    maxHops: 2,
    maxSplits: 3,
    enableV2: true,
    enableV3: true,
  });

  try {
    // Add initial delay
    await delay(2000);

    // Define swap amount
    const swapAmount = "0.5"; // 0.5 USDC

    logger.info(`Getting quote for ${swapAmount} USDC → CAMP...`);

    // Get quote - swap to WCAMP first
    const quote = await quoter.getQuote(
      baseCampTestnetTokens.usdc,
      baseCampTestnetTokens.wcamp,
      swapAmount,
      TradeType.EXACT_INPUT,
      false
    );

    if (!quote || !quote.rawTrade) {
      logger.error("No route found for USDC → WCAMP");
      process.exit(1);
    }

    logger.success("Quote received:", {
      input: `${swapAmount} USDC`,
      output: `${quote.outputAmount} WCAMP`,
      priceImpact: quote.priceImpact,
      route: quote.route,
    });

    // Check initial balances
    const [initialNativeBalance, wcampBalanceBefore] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.readContract({
        address: WCAMP_ADDRESS as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      }),
    ]);

    logger.info(
      `Initial CAMP balance: ${formatUnits(initialNativeBalance, 18)}`
    );
    logger.info(
      `Initial WCAMP balance: ${formatUnits(wcampBalanceBefore, 18)}`
    );

    // Approve USDC
    await checkAndApproveToken(
      walletClient,
      publicClient,
      baseCampTestnetTokens.usdc.address as Address,
      parseUnits(swapAmount, 6),
      account.address
    );

    // Generate swap parameters - swap to router first to handle the unwrap
    const trade = quote.rawTrade;
    const swapParams = SwapRouter.swapCallParameters(trade, {
      slippageTolerance: new Percent(100, 10000), // 1%
      deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      recipient: SMART_ROUTER_ADDRESS as Address, // Send WCAMP to router for unwrapping
    });

    // Calculate minimum amount out with slippage
    const minAmountOut = BigInt(
      Math.floor(parseFloat(quote.outputAmount) * 0.99 * 1e18).toString()
    );

    // Create multicall data
    const multicallData = [
      // First: Execute the swap (USDC -> WCAMP to router)
      swapParams.calldata,
      // Second: Unwrap WCAMP to native CAMP and send to user
      encodeFunctionData({
        abi: ROUTER_MULTICALL_ABI,
        functionName: "unwrapWETH9",
        args: [minAmountOut, account.address],
      }),
    ];

    logger.info("Executing multicall swap + unwrap in single transaction...");

    // Execute multicall
    const txHash = await walletClient.writeContract({
      address: SMART_ROUTER_ADDRESS as Address,
      abi: ROUTER_MULTICALL_ABI,
      functionName: "multicall",
      args: [multicallData],
      value: 0n, // No native value needed for ERC20 swaps
    });

    logger.info(`Transaction sent: ${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    if (receipt.status === "success") {
      logger.success(
        `✅ Multicall swap + unwrap successful! Gas used: ${receipt.gasUsed}`
      );

      // Check final balances
      const [finalNativeBalance, wcampBalanceAfter, finalUsdcBalance] =
        await Promise.all([
          publicClient.getBalance({ address: account.address }),
          publicClient.readContract({
            address: WCAMP_ADDRESS as Address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [account.address],
          }),
          publicClient.readContract({
            address: baseCampTestnetTokens.usdc.address as Address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [account.address],
          }),
        ]);

      // Calculate net native received (accounting for gas)
      const gasSpent = receipt.gasUsed * receipt.effectiveGasPrice;
      const nativeReceived =
        finalNativeBalance - initialNativeBalance + gasSpent;

      logger.success("Balance changes:", {
        USDC: `${formatUnits(usdcBalance, 6)} → ${formatUnits(
          finalUsdcBalance,
          6
        )}`,
        WCAMP: `${formatUnits(wcampBalanceBefore, 18)} → ${formatUnits(
          wcampBalanceAfter,
          18
        )}`,
        "Native CAMP": `${formatUnits(
          initialNativeBalance,
          18
        )} → ${formatUnits(finalNativeBalance, 18)}`,
        "CAMP received": formatUnits(nativeReceived, 18),
        "Gas spent": formatUnits(gasSpent, 18),
      });

      logger.success(
        "✅ Successfully swapped USDC to native CAMP in a single transaction!"
      );
    } else {
      logger.error("❌ Multicall swap failed");
    }
  } catch (error: any) {
    if (error?.message?.includes("429")) {
      logger.error("⚠️ Rate limited - try again later");
    } else if (error?.message?.includes("unwrapWETH9")) {
      logger.error(
        "⚠️ Router doesn't support unwrapWETH9 - trying alternative approach"
      );
      // Fall back to alternative approach if needed
    } else {
      logger.error(
        "Error:",
        error?.shortMessage || error?.message || "Unknown error"
      );
      console.error("Full error:", error);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error("Fatal error:", error?.message || error);
  process.exit(1);
});
