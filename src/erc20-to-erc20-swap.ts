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
  walletAddress: Address,
  tokenSymbol: string,
  decimals: number
) {
  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [walletAddress, SMART_ROUTER_ADDRESS as Address],
  });

  if (allowance < amount) {
    logger.info(`Approving ${formatUnits(amount, decimals)} ${tokenSymbol}...`);
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
  logger.info(`Swapping ${amount} ${inputToken.symbol} → ${outputToken.symbol}`);

  // Check input token balance
  const inputBalance = await publicClient.readContract({
    address: inputToken.address as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  const requiredAmount = parseUnits(amount, inputToken.decimals);

  logger.info(`${inputToken.symbol} Balance: ${formatUnits(inputBalance, inputToken.decimals)}`);

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
    logger.warn(`No route found for ${inputToken.symbol} → ${outputToken.symbol}`);
    return false;
  }

  logger.success("Quote received:", {
    input: `${amount} ${inputToken.symbol}`,
    output: `${quote.outputAmount} ${outputToken.symbol}`,
    priceImpact: quote.priceImpact,
  });

  // Approve token
  await checkAndApproveToken(
    walletClient,
    publicClient,
    inputToken.address as Address,
    requiredAmount,
    account.address,
    inputToken.symbol,
    inputToken.decimals
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
  
  const receipt = await publicClient.waitForTransactionReceipt({ 
    hash: swapHash 
  });

  if (receipt.status === "success") {
    logger.success(`✅ Swap successful! Gas used: ${receipt.gasUsed}`);
    
    // Check output token balance
    const outputBalance = await publicClient.readContract({
      address: outputToken.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });

    logger.success(`New ${outputToken.symbol} balance: ${formatUnits(outputBalance, outputToken.decimals)}`);
    return true;
  } else {
    logger.error("❌ Swap failed");
    return false;
  }
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
    chain: basecampTestnet,
    transport: http(process.env.BASE_TESTNET_RPC_URL || "https://rpc-campnetwork.xyz"),
  });

  const walletClient = createWalletClient({
    account,
    chain: basecampTestnet,
    transport: http(process.env.BASE_TESTNET_RPC_URL || "https://rpc-campnetwork.xyz"),
  });

  logger.info(`Wallet address: ${account.address}`);

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

    // Display all token balances
    logger.info("Checking token balances...");
    const tokens = [
      baseCampTestnetTokens.usdc,
      baseCampTestnetTokens.usdt,
      baseCampTestnetTokens.dai,
      baseCampTestnetTokens.weth,
      baseCampTestnetTokens.wbtc,
    ];

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
        input: baseCampTestnetTokens.usdc,
        output: baseCampTestnetTokens.usdt,
        amount: "1",
        description: "USDC → USDT (Stablecoin swap)",
      },
      {
        input: baseCampTestnetTokens.usdt,
        output: baseCampTestnetTokens.dai,
        amount: "1",
        description: "USDT → DAI (Stablecoin swap)",
      },
      {
        input: baseCampTestnetTokens.usdc,
        output: baseCampTestnetTokens.weth,
        amount: "1",
        description: "USDC → WETH",
      },
      {
        input: baseCampTestnetTokens.weth,
        output: baseCampTestnetTokens.wbtc,
        amount: "0.001",
        description: "WETH → WBTC",
      },
      {
        input: baseCampTestnetTokens.dai,
        output: baseCampTestnetTokens.usdc,
        amount: "1",
        description: "DAI → USDC (Reverse stablecoin swap)",
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
      logger.error("Error:", error?.shortMessage || error?.message || "Unknown error");
    }
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error("Fatal error:", error?.message || error);
  process.exit(1);
});