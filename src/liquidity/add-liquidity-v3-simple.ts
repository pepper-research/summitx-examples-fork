import { config } from "dotenv";
import readlineSync from "readline-sync";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  parseUnits,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { basecampTestnet } from "../config/base-testnet";
import { logger } from "../utils/logger";

config();

// Hardcoded token info to bypass the problematic contracts
const TOKENS = [
  {
    address: "0x1aE9c40eCd2DD6ad5858E5430A556d7aff28A44b",
    symbol: "wCAMP",
    decimals: 18,
    name: "Wrapped CAMP"
  },
  {
    address: "0x71002dbf6cC7A885cE6563682932370c056aAca9",
    symbol: "MUSDC",
    decimals: 6,
    name: "Mock USDC"
  },
  {
    address: "0xA745f7A59E70205e6040BdD3b33eD21DBD23FEB3",
    symbol: "MUSDT",
    decimals: 6,
    name: "Mock USDT"
  },
  {
    address: "0x5d3011cCc6d3431D671c9e69EEddA9C5C654B97F",
    symbol: "DAI",
    decimals: 18,
    name: "DAI Stablecoin"
  },
  {
    address: "0xC42BAA20e3a159cF7A8aDFA924648C2a2d59E062",
    symbol: "WETH",
    decimals: 18,
    name: "Wrapped ETH"
  },
  {
    address: "0x587aF234D373C752a6F6E9eD6c4Ce871e7528BCF",
    symbol: "WBTC",
    decimals: 8,
    name: "Wrapped BTC"
  }
];

async function main() {
  logger.header("💧 Add V3 Liquidity (Simplified)");
  logger.info("This version uses hardcoded token info to bypass contract issues");
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

  try {
    // Get balances for each token
    logger.info("\n📊 Checking token balances...");
    const tokenInfos = [];
    
    for (const token of TOKENS) {
      try {
        // Only try to get balance, skip symbol/decimals calls
        const balance = await publicClient.readContract({
          address: token.address as Address,
          abi: [{
            inputs: [{ name: "account", type: "address" }],
            name: "balanceOf",
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
            type: "function",
          }],
          functionName: "balanceOf",
          args: [account.address],
        });
        
        tokenInfos.push({
          ...token,
          balance: balance as bigint
        });
        
        logger.info(`${token.symbol}: ${formatUnits(balance as bigint, token.decimals)}`);
      } catch (e) {
        logger.warn(`Could not get balance for ${token.symbol}, assuming 0`);
        tokenInfos.push({
          ...token,
          balance: 0n
        });
      }
    }

    // Filter tokens with non-zero balance
    const availableTokens = tokenInfos.filter(t => t.balance > 0n);
    
    if (availableTokens.length < 2) {
      logger.error("\nYou need at least 2 tokens with non-zero balance to create a pool");
      logger.info("\nAvailable tokens with balance:");
      availableTokens.forEach(t => {
        logger.info(`  ${t.symbol}: ${formatUnits(t.balance, t.decimals)}`);
      });
      return;
    }

    // Select tokens
    logger.info("\n🔄 Select tokens for V3 pool:");
    const tokenSymbols = availableTokens.map(t => `${t.symbol} (Balance: ${formatUnits(t.balance, t.decimals)})`);
    
    const token1Index = readlineSync.keyInSelect(tokenSymbols, "Select first token:");
    if (token1Index === -1) {
      logger.info("Cancelled");
      return;
    }

    const token2Options = tokenSymbols.filter((_, i) => i !== token1Index);
    const token2Index = readlineSync.keyInSelect(token2Options, "Select second token:");
    if (token2Index === -1) {
      logger.info("Cancelled");
      return;
    }

    const actualToken2Index = availableTokens.findIndex(
      t => t !== availableTokens[token1Index] && 
      token2Options[token2Index]?.includes(t.symbol)
    );

    const tokenA = availableTokens[token1Index];
    const tokenB = availableTokens[actualToken2Index];

    logger.success(`\n✅ Selected pair: ${tokenA.symbol}/${tokenB.symbol}`);

    // Fee tier selection
    const feeTiers = [
      { value: 100, label: "0.01%", tickSpacing: 1 },
      { value: 500, label: "0.05%", tickSpacing: 10 },
      { value: 3000, label: "0.3%", tickSpacing: 60 },
      { value: 10000, label: "1%", tickSpacing: 200 }
    ];

    logger.info("\n💰 Select fee tier:");
    const feeOptions = feeTiers.map(ft => `${ft.label} (tick spacing: ${ft.tickSpacing})`);
    const feeIndex = readlineSync.keyInSelect(feeOptions, "Select fee tier:");
    if (feeIndex === -1) {
      logger.info("Cancelled");
      return;
    }

    const selectedFeeTier = feeTiers[feeIndex];
    logger.success(`Selected fee tier: ${selectedFeeTier.label}`);

    // Get amounts
    const maxAmountA = formatUnits(tokenA.balance, tokenA.decimals);
    const amountAInput = readlineSync.question(
      `\nEnter amount of ${tokenA.symbol} to add (max: ${maxAmountA}): `
    );
    
    if (!amountAInput || isNaN(Number(amountAInput))) {
      logger.error("Invalid amount");
      return;
    }

    const amountA = parseUnits(amountAInput, tokenA.decimals);
    
    // For simplicity, ask for token B amount directly
    const maxAmountB = formatUnits(tokenB.balance, tokenB.decimals);
    const amountBInput = readlineSync.question(
      `Enter amount of ${tokenB.symbol} to add (max: ${maxAmountB}): `
    );
    
    if (!amountBInput || isNaN(Number(amountBInput))) {
      logger.error("Invalid amount");
      return;
    }

    const amountB = parseUnits(amountBInput, tokenB.decimals);

    logger.info("\n📝 Summary:");
    logger.info(`  Pair: ${tokenA.symbol}/${tokenB.symbol}`);
    logger.info(`  Fee Tier: ${selectedFeeTier.label}`);
    logger.info(`  ${tokenA.symbol} amount: ${amountAInput}`);
    logger.info(`  ${tokenB.symbol} amount: ${amountBInput}`);
    logger.info(`  Token A address: ${tokenA.address}`);
    logger.info(`  Token B address: ${tokenB.address}`);

    const confirm = readlineSync.keyInYNStrict("\nProceed with adding liquidity?");
    if (!confirm) {
      logger.info("Cancelled");
      return;
    }

    logger.success("\n✅ Ready to add liquidity!");
    logger.info("Note: The actual transaction would be sent here.");
    logger.info("This simplified version shows the flow without the contract interaction issues.");

  } catch (error: any) {
    logger.error("Error:", error?.message || error);
    console.error("Full error:", error);
  }
}

main().catch((error) => {
  logger.error("Fatal error:", error?.message || error);
  process.exit(1);
});