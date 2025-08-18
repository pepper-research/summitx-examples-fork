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
import {
  basecampTestnet,
  baseCampTestnetTokens,
  SMART_ROUTER_ADDRESS,
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
    args: [walletAddress, SMART_ROUTER_ADDRESS],
  });

  if (allowance < amount) {
    logger.info(`Approving ${formatUnits(amount, 18)} tokens...`);
    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [SMART_ROUTER_ADDRESS, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    logger.success("✅ Token approved");
  }
}

async function getBalances(publicClient: any, address: Address) {
  const [
    nativeBalance,
    usdcBalance,
    usdtBalance,
    wethBalance,
    wbtcBalance,
    daiBalance,
  ] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({
      address: baseCampTestnetTokens.usdc.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    }),
    publicClient.readContract({
      address: baseCampTestnetTokens.usdt.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    }),
    publicClient.readContract({
      address: baseCampTestnetTokens.weth.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    }),
    publicClient.readContract({
      address: baseCampTestnetTokens.wbtc.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    }),
    publicClient.readContract({
      address: baseCampTestnetTokens.dai.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);

  return {
    native: formatUnits(nativeBalance, 18),
    usdc: formatUnits(usdcBalance, 6),
    usdt: formatUnits(usdtBalance, 6),
    weth: formatUnits(wethBalance, 18),
    wbtc: formatUnits(wbtcBalance, 18),
    dai: formatUnits(daiBalance, 18),
  };
}

async function executeSwap(
  walletClient: any,
  publicClient: any,
  methodParameters: MethodParameters,
  swapType: string
) {
  logger.info(`Executing ${swapType} swap...`);

  // Log the value being sent for debugging
  if (methodParameters.value && methodParameters.value !== "0x00") {
    logger.info(
      `Sending ${formatUnits(
        BigInt(methodParameters.value),
        18
      )} CAMP with transaction`
    );
  }

  const hash = await walletClient.sendTransaction({
    to: SMART_ROUTER_ADDRESS as Address, // Use the router address directly
    data: methodParameters.calldata,
    value: BigInt(methodParameters.value || 0),
    // Don't specify gas, let viem estimate it
  });

  logger.info(`Transaction sent: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "success") {
    logger.success(
      `✅ ${swapType} swap successful! Gas used: ${receipt.gasUsed}`
    );
  } else {
    logger.error(`❌ ${swapType} swap failed`);
  }

  return receipt;
}

async function delay(ms: number) {
  logger.info(`⏳ Waiting ${ms / 1000} seconds before next transaction...`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  logger.header("🔄 Comprehensive Swap Examples - Base Camp Testnet");

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

  const quoter = new TokenQuoter({
    rpcUrl: process.env.BASE_TESTNET_RPC_URL || "https://rpc-campnetwork.xyz",
    slippageTolerance: 0.5,
    maxHops: 3,
    maxSplits: 3,
    enableV2: false, // Disable V2 due to chain ID issues
    enableV3: true,
  });

  // Converter is a static class, no need to instantiate

  logger.info(`Wallet address: ${account.address}`);

  const initialBalances = await getBalances(publicClient, account.address);
  logger.info("Initial balances:", initialBalances);

  try {
    // Add initial delay to avoid immediate rate limiting
    await delay(3000);

    // ============================================
    // 1. NATIVE TO ERC20 SWAP (CAMP → USDC)
    // ============================================
    logger.header("1️⃣ Native to ERC20 Swap: CAMP → USDC");

    const nativeToErc20Amount = "1"; // 1 CAMP
    const nativeToErc20Quote = await quoter.getQuote(
      baseCampTestnetTokens.wcamp, // Use WCAMP for native
      baseCampTestnetTokens.usdc,
      nativeToErc20Amount, // Pass decimal string
      TradeType.EXACT_INPUT,
      false // Don't adjust for gas like execute-swap-interface-style
    );

    if (nativeToErc20Quote) {
      logger.info("Quote received:", {
        input: `${nativeToErc20Amount} CAMP`,
        output: `${nativeToErc20Quote.outputAmount} USDC`,
        priceImpact: nativeToErc20Quote.priceImpact,
      });

      // Use rawTrade directly from the quote
      if (!nativeToErc20Quote.rawTrade) {
        logger.error("No raw trade available in quote");
        return;
      }
      const trade = nativeToErc20Quote.rawTrade;
      const methodParameters = SwapRouter.swapCallParameters(trade, {
        slippageTolerance: new Percent(50, 10000),
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        recipient: account.address,
      });

      // For native token swap, ensure value is set
      const swapValue = parseUnits(nativeToErc20Amount, 18); // Native CAMP has 18 decimals
      methodParameters.value = swapValue.toString();

      await executeSwap(
        walletClient,
        publicClient,
        methodParameters,
        "CAMP → USDC"
      );
      await delay(5000); // Wait 5 seconds before next transaction
    } else {
      logger.warn("No route found for CAMP → USDC");
    }

    // ============================================
    // 2. ERC20 TO NATIVE SWAP (USDC → CAMP)
    // ============================================
    logger.header("2️⃣ ERC20 to Native Swap: USDC → CAMP");

    const erc20ToNativeAmount = "1"; // 1 USDC
    const erc20ToNativeQuote = await quoter.getQuote(
      baseCampTestnetTokens.usdc,
      baseCampTestnetTokens.wcamp, // Use WCAMP for native
      erc20ToNativeAmount, // Pass decimal string
      TradeType.EXACT_INPUT,
      false // Don't adjust for gas
    );

    if (erc20ToNativeQuote) {
      logger.info("Quote received:", {
        input: `${erc20ToNativeAmount} USDC`,
        output: `${erc20ToNativeQuote.outputAmount} CAMP`,
        priceImpact: erc20ToNativeQuote.priceImpact,
      });

      // Approve USDC
      await checkAndApproveToken(
        walletClient,
        publicClient,
        baseCampTestnetTokens.usdc.address as Address,
        parseUnits(erc20ToNativeAmount, 6),
        account.address
      );

      // Use rawTrade directly from the quote
      if (!erc20ToNativeQuote.rawTrade) {
        logger.error("No raw trade available in quote");
        return;
      }
      const trade = erc20ToNativeQuote.rawTrade;

      // For swaps to native token, we might need to handle unwrapping
      // The router should handle this automatically with the right parameters
      const methodParameters = SwapRouter.swapCallParameters(trade, {
        slippageTolerance: new Percent(50, 10000),
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        recipient: account.address,
      });

      await executeSwap(
        walletClient,
        publicClient,
        methodParameters,
        "USDC → CAMP"
      );
      await delay(5000); // Wait 5 seconds before next transaction
    } else {
      logger.warn("No route found for USDC → CAMP");
    }

    // ============================================
    // 3. ERC20 TO ERC20 SWAP (USDC → USDT)
    // ============================================
    logger.header("3️⃣ ERC20 to ERC20 Swap: USDC → USDT");

    const erc20ToErc20Amount = "1"; // 1 USDC
    const erc20ToErc20Quote = await quoter.getQuote(
      baseCampTestnetTokens.usdc,
      baseCampTestnetTokens.usdt,
      erc20ToErc20Amount, // Pass decimal string
      TradeType.EXACT_INPUT,
      false // Don't adjust for gas
    );

    if (erc20ToErc20Quote) {
      logger.info("Quote received:", {
        input: `${erc20ToErc20Amount} USDC`,
        output: `${erc20ToErc20Quote.outputAmount} USDT`,
        priceImpact: erc20ToErc20Quote.priceImpact,
      });

      // Approve USDC
      await checkAndApproveToken(
        walletClient,
        publicClient,
        baseCampTestnetTokens.usdc.address as Address,
        parseUnits(erc20ToErc20Amount, 6),
        account.address
      );

      // Use rawTrade directly from the quote
      if (!erc20ToErc20Quote.rawTrade) {
        logger.error("No raw trade available in quote");
        return;
      }
      const trade = erc20ToErc20Quote.rawTrade;
      const methodParameters = SwapRouter.swapCallParameters(trade, {
        slippageTolerance: new Percent(50, 10000),
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        recipient: account.address,
      });

      await executeSwap(
        walletClient,
        publicClient,
        methodParameters,
        "USDC → USDT"
      );
      await delay(5000); // Wait 5 seconds before next transaction
    } else {
      logger.warn("No route found for USDC → USDT");
    }

    // ============================================
    // 4. ERC20 TO ERC20 SWAP (WETH → WBTC)
    // ============================================
    logger.header("4️⃣ ERC20 to ERC20 Swap: WETH → WBTC");

    const wethToWbtcAmount = "0.001"; // 0.001 WETH
    const wethToWbtcQuote = await quoter.getQuote(
      baseCampTestnetTokens.weth,
      baseCampTestnetTokens.wbtc,
      wethToWbtcAmount, // Pass decimal string
      TradeType.EXACT_INPUT,
      false // Don't adjust for gas
    );

    if (wethToWbtcQuote) {
      logger.info("Quote received:", {
        input: `${wethToWbtcAmount} WETH`,
        output: `${wethToWbtcQuote.outputAmount} WBTC`,
        priceImpact: wethToWbtcQuote.priceImpact,
      });

      // Approve WETH
      await checkAndApproveToken(
        walletClient,
        publicClient,
        baseCampTestnetTokens.weth.address as Address,
        parseUnits(wethToWbtcAmount, 18),
        account.address
      );

      // Use rawTrade directly from the quote
      if (!wethToWbtcQuote.rawTrade) {
        logger.error("No raw trade available in quote");
        return;
      }
      const trade = wethToWbtcQuote.rawTrade;
      const methodParameters = SwapRouter.swapCallParameters(trade, {
        slippageTolerance: new Percent(50, 10000),
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        recipient: account.address,
      });

      await executeSwap(
        walletClient,
        publicClient,
        methodParameters,
        "WETH → WBTC"
      );
      await delay(5000); // Wait 5 seconds before next transaction
    } else {
      logger.warn("No route found for WETH → WBTC");
    }

    // ============================================
    // 5. ERC20 TO ERC20 SWAP (USDC → DAI)
    // ============================================
    logger.header("5️⃣ ERC20 to ERC20 Swap: USDC → DAI");

    const usdcToDaiAmount = "1"; // 1 USDC
    const usdcToDaiQuote = await quoter.getQuote(
      baseCampTestnetTokens.usdc,
      baseCampTestnetTokens.dai,
      usdcToDaiAmount, // Pass decimal string
      TradeType.EXACT_INPUT,
      false // Don't adjust for gas
    );

    if (usdcToDaiQuote) {
      logger.info("Quote received:", {
        input: `${usdcToDaiAmount} USDC`,
        output: `${usdcToDaiQuote.outputAmount} DAI`,
        priceImpact: usdcToDaiQuote.priceImpact,
      });

      // Approve USDC
      await checkAndApproveToken(
        walletClient,
        publicClient,
        baseCampTestnetTokens.usdc.address as Address,
        parseUnits(usdcToDaiAmount, 6),
        account.address
      );

      // Use rawTrade directly from the quote
      if (!usdcToDaiQuote.rawTrade) {
        logger.error("No raw trade available in quote");
        return;
      }
      const trade = usdcToDaiQuote.rawTrade;
      const methodParameters = SwapRouter.swapCallParameters(trade, {
        slippageTolerance: new Percent(50, 10000),
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        recipient: account.address,
      });

      await executeSwap(
        walletClient,
        publicClient,
        methodParameters,
        "USDC → DAI"
      );
      await delay(5000); // Wait 5 seconds before next transaction
    } else {
      logger.warn("No route found for USDC → DAI");
    }

    // ============================================
    // FINAL BALANCES
    // ============================================
    logger.header("📊 Final Results");

    const finalBalances = await getBalances(publicClient, account.address);
    logger.success("Final balances:", finalBalances);

    logger.info("Balance changes:", {
      native: `${initialBalances.native} → ${finalBalances.native} CAMP`,
      usdc: `${initialBalances.usdc} → ${finalBalances.usdc} USDC`,
      usdt: `${initialBalances.usdt} → ${finalBalances.usdt} USDT`,
      weth: `${initialBalances.weth} → ${finalBalances.weth} WETH`,
      wbtc: `${initialBalances.wbtc} → ${finalBalances.wbtc} WBTC`,
      dai: `${initialBalances.dai} → ${finalBalances.dai} DAI`,
    });

    logger.success("🎉 All swap examples completed!");
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
      logger.info("  - Increase delays between transactions");
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
    logger.error("Failed to run swap examples:", error?.message || error);
  }
  process.exit(1);
});
