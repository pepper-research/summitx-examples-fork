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
  logger.header("🔄 ERC20 to Native Swap Example");
  logger.info("Swapping USDC to CAMP (native) - includes automatic unwrap");
  logger.divider();

  if (!process.env.PRIVATE_KEY) {
    logger.error("Please set PRIVATE_KEY in .env file");
    process.exit(1);
  }

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);

  const publicClient = createPublicClient({
    chain: basecampTestnet,
    transport: http(process.env.BASE_TESTNET_RPC_URL || "https://rpc-campnetwork.xyz"),
  });

  const walletClient = createWalletClient({
    account,
    chain: basecampTestnet,
    transport: http(process.env.BASE_TESTNET_RPC_URL || "https://rpc-campnetwork.xyz"),
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
    maxSplits: 2,
    enableV2: false,
    enableV3: true,
  });

  try {
    // Add initial delay
    await delay(2000);

    // Define swap amount
    const swapAmount = "0.5"; // 0.5 USDC

    logger.info(`Getting quote for ${swapAmount} USDC → CAMP...`);

    // Get quote - first get to WCAMP, then we'll unwrap
    const quote = await quoter.getQuote(
      baseCampTestnetTokens.usdc,
      baseCampTestnetTokens.wcamp,
      swapAmount,
      TradeType.EXACT_INPUT,
      false
    );

    if (!quote || !quote.rawTrade) {
      logger.error("No route found for USDC → CAMP");
      process.exit(1);
    }

    logger.success("Quote received:", {
      input: `${swapAmount} USDC`,
      output: `${quote.outputAmount} CAMP`,
      priceImpact: quote.priceImpact,
      route: quote.route,
    });

    // Check initial native balance
    const initialNativeBalance = await publicClient.getBalance({ address: account.address });
    logger.info(`Initial CAMP balance: ${formatUnits(initialNativeBalance, 18)}`);

    // Approve USDC
    await checkAndApproveToken(
      walletClient,
      publicClient,
      baseCampTestnetTokens.usdc.address as Address,
      parseUnits(swapAmount, 6),
      account.address
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
      address: WCAMP_ADDRESS as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
    logger.info(`WCAMP balance before: ${formatUnits(wcampBalanceBefore, 18)}`);
    
    const swapHash = await walletClient.sendTransaction({
      to: SMART_ROUTER_ADDRESS as Address,
      data: methodParameters.calldata,
      value: 0n, // No native value for ERC20 swaps
    });

    logger.info(`Transaction sent: ${swapHash}`);
    
    const receipt = await publicClient.waitForTransactionReceipt({ 
      hash: swapHash 
    });

    if (receipt.status === "success") {
      logger.success(`✅ Swap successful! Gas used: ${receipt.gasUsed}`);
      
      // Check balances after swap
      const [wcampBalanceAfter, finalUsdcBalance] = await Promise.all([
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

      logger.info(`WCAMP balance after swap: ${formatUnits(wcampBalanceAfter, 18)}`);
      const wcampReceived = wcampBalanceAfter - wcampBalanceBefore;
      
      if (wcampReceived > 0n) {
        // We received WCAMP, need to unwrap it to native CAMP
        logger.info(`Received ${formatUnits(wcampReceived, 18)} WCAMP, unwrapping to native CAMP...`);
        
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
          address: WCAMP_ADDRESS as Address,
          abi: WETH_ABI,
          functionName: "withdraw",
          args: [wcampReceived],
        });
        
        logger.info(`Unwrap transaction sent: ${unwrapHash}`);
        const unwrapReceipt = await publicClient.waitForTransactionReceipt({ hash: unwrapHash });
        
        if (unwrapReceipt.status === "success") {
          logger.success("✅ Unwrap successful!");
        }
      }
      
      // Check final native balance
      const finalNativeBalance = await publicClient.getBalance({ address: account.address });
      const nativeReceived = finalNativeBalance - initialNativeBalance + (receipt.gasUsed * receipt.effectiveGasPrice);
      
      logger.success("Balance changes:", {
        USDC: `${formatUnits(usdcBalance, 6)} → ${formatUnits(finalUsdcBalance, 6)}`,
        "Native CAMP": `${formatUnits(initialNativeBalance, 18)} → ${formatUnits(finalNativeBalance, 18)}`,
        "Approx CAMP received": formatUnits(nativeReceived, 18),
      });
    } else {
      logger.error("❌ Swap failed");
    }

  } catch (error: any) {
    if (error?.message?.includes("429")) {
      logger.error("⚠️ Rate limited - try again later");
    } else {
      logger.error("Error:", error?.shortMessage || error?.message || "Unknown error");
    }
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error("Fatal error:", error?.message || error);
  process.exit(1);
});