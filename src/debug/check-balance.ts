import { config } from "dotenv";
import { createPublicClient, formatUnits, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { basecampTestnet, baseCampTestnetTokens } from "./config/base-testnet";
import { logger } from "./utils/logger";

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

async function checkBalances() {
  logger.header("💰 Checking Wallet Balances");

  if (!process.env.PRIVATE_KEY) {
    logger.error("Please set PRIVATE_KEY in .env file");
    process.exit(1);
  }

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
  logger.info(`Wallet address: ${account.address}`);

  const publicClient = createPublicClient({
    chain: basecampTestnet,
    transport: http("https://rpc-campnetwork.xyz"),
  });

  // Get native balance
  const nativeBalance = await publicClient.getBalance({ address: account.address });
  logger.info(`Native CAMP: ${formatUnits(nativeBalance, 18)}`);

  // Get token balances
  const tokens = [
    { name: "USDC", token: baseCampTestnetTokens.usdc, decimals: 6 },
    { name: "USDT", token: baseCampTestnetTokens.usdt, decimals: 6 },
    { name: "WCAMP", token: baseCampTestnetTokens.wcamp, decimals: 18 },
    { name: "WETH", token: baseCampTestnetTokens.weth, decimals: 18 },
    { name: "WBTC", token: baseCampTestnetTokens.wbtc, decimals: 18 },
    { name: "DAI", token: baseCampTestnetTokens.dai, decimals: 18 },
  ];

  logger.divider();
  logger.info("Token Balances:");
  
  for (const { name, token, decimals } of tokens) {
    const balance = await publicClient.readContract({
      address: token.address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
    
    const formatted = formatUnits(balance, decimals);
    if (parseFloat(formatted) > 0) {
      logger.success(`${name}: ${formatted}`);
    } else {
      logger.warn(`${name}: ${formatted}`);
    }
  }

  logger.divider();
  
  // Calculate recommended swap amounts
  const nativeBalanceFloat = parseFloat(formatUnits(nativeBalance, 18));
  const gasReserve = 0.01; // Reserve for gas
  const maxNativeSwap = Math.max(0, nativeBalanceFloat - gasReserve);
  
  logger.info("Recommended swap amounts:");
  if (maxNativeSwap > 0.001) {
    logger.success(`Native CAMP swap: up to ${maxNativeSwap.toFixed(4)} CAMP`);
    logger.info(`  Suggested: ${Math.min(0.01, maxNativeSwap * 0.5).toFixed(4)} CAMP`);
  } else {
    logger.error(`Insufficient CAMP balance for swaps (need at least ${gasReserve} CAMP for gas)`);
  }
}

checkBalances().catch((error) => {
  logger.error("Failed to check balances:", error?.message || error);
  process.exit(1);
});