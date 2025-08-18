import { TradeType } from "@summitx/swap-sdk-core";
import { config } from "dotenv";
import { baseCampTestnetTokens } from "../config/base-testnet";
import { TokenQuoter } from "../quoter/token-quoter";
import { logger } from "../utils/logger";

// Load environment variables
config();

async function main() {
  logger.header("SummitX Token Quoter - Base Testnet");

  // Initialize quoter with options
  const quoter = new TokenQuoter({
    rpcUrl: process.env.BASE_TESTNET_RPC_URL,
    maxHops: 3,
    maxSplits: 3,
    distributionPercent: 5,
    slippageTolerance: 0.5, // 0.5%
  });

  // Example 1: Simple swap quote (USDC → WETH)
  logger.header("Example 1: USDC → WETH Quote");
  const quote1 = await quoter.getQuote(
    baseCampTestnetTokens.usdc,
    baseCampTestnetTokens.weth,
    "100", // 100 USDC
    TradeType.EXACT_INPUT
  );

  if (quote1) {
    logger.success("Quote Details:", {
      input: `${quote1.inputAmount} ${quote1.inputToken.symbol}`,
      output: `${quote1.outputAmount} ${quote1.outputToken.symbol}`,
      minimumReceived: `${quote1.minimumReceived} ${quote1.outputToken.symbol}`,
      priceImpact: quote1.priceImpact,
      executionPrice: `1 ${quote1.inputToken.symbol} = ${quote1.executionPrice} ${quote1.outputToken.symbol}`,
      route: quote1.route,
    });
  }

  logger.divider();

  // Example 2: Reverse quote (WETH → USDC)
  logger.header("Example 2: WETH → USDC Quote");
  const quote2 = await quoter.getQuote(
    baseCampTestnetTokens.weth,
    baseCampTestnetTokens.usdc,
    "0.1", // 0.1 WETH
    TradeType.EXACT_INPUT
  );

  if (quote2) {
    logger.success("Quote Details:", {
      input: `${quote2.inputAmount} ${quote2.inputToken.symbol}`,
      output: `${quote2.outputAmount} ${quote2.outputToken.symbol}`,
      minimumReceived: `${quote2.minimumReceived} ${quote2.outputToken.symbol}`,
      priceImpact: quote2.priceImpact,
      executionPrice: `1 ${quote2.inputToken.symbol} = ${quote2.executionPrice} ${quote2.outputToken.symbol}`,
      route: quote2.route,
    });
  }

  logger.divider();

  // Example 3: Multi-hop quote (WBTC → USDC, potentially through WETH)
  logger.header("Example 3: WBTC → USDC Quote (Multi-hop)");
  const quote3 = await quoter.getQuote(
    baseCampTestnetTokens.wbtc,
    baseCampTestnetTokens.usdc,
    "0.01", // 0.01 WBTC
    TradeType.EXACT_INPUT
  );

  if (quote3) {
    logger.success("Quote Details:", {
      input: `${quote3.inputAmount} ${quote3.inputToken.symbol}`,
      output: `${quote3.outputAmount} ${quote3.outputToken.symbol}`,
      minimumReceived: `${quote3.minimumReceived} ${quote3.outputToken.symbol}`,
      priceImpact: quote3.priceImpact,
      executionPrice: `1 ${quote3.inputToken.symbol} = ${quote3.executionPrice} ${quote3.outputToken.symbol}`,
      route: quote3.route,
      pools: quote3.pools,
    });
  }

  logger.divider();

  // Example 4: Batch quotes
  logger.header("Example 4: Multiple Quotes");
  const batchQuotes = await quoter.getMultipleQuotes([
    {
      inputToken: baseCampTestnetTokens.usdc,
      outputToken: baseCampTestnetTokens.wbtc,
      amount: "50",
    },
    {
      inputToken: baseCampTestnetTokens.weth,
      outputToken: baseCampTestnetTokens.dai,
      amount: "0.05",
    },
    {
      inputToken: baseCampTestnetTokens.dai,
      outputToken: baseCampTestnetTokens.usdc,
      amount: "50",
    },
  ]);

  batchQuotes.forEach((quote, index) => {
    if (quote) {
      logger.success(`Quote ${index + 1}:`, {
        pair: `${quote.inputToken.symbol} → ${quote.outputToken.symbol}`,
        input: `${quote.inputAmount} ${quote.inputToken.symbol}`,
        output: `${quote.outputAmount} ${quote.outputToken.symbol}`,
        priceImpact: quote.priceImpact,
      });
    } else {
      logger.warn(`Quote ${index + 1}: No route found`);
    }
  });

  logger.divider();

  // Example 5: Exact output quote
  logger.header("Example 5: Exact Output Quote (Get exactly 100 USDC)");
  const quote5 = await quoter.getQuote(
    baseCampTestnetTokens.weth,
    baseCampTestnetTokens.usdc,
    "100", // Want exactly 100 USDC output
    TradeType.EXACT_OUTPUT
  );

  if (quote5) {
    logger.success("Quote Details:", {
      inputRequired: `${quote5.inputAmount} ${quote5.inputToken.symbol}`,
      outputExact: `${quote5.outputAmount} ${quote5.outputToken.symbol}`,
      maximumSent: `${quote5.inputAmount} ${quote5.inputToken.symbol}`,
      priceImpact: quote5.priceImpact,
      executionPrice: `1 ${quote5.inputToken.symbol} = ${quote5.executionPrice} ${quote5.outputToken.symbol}`,
      route: quote5.route,
    });
  }

  logger.divider();
  logger.success("All examples completed!");
}

// Run the examples
main().catch((error: any) => {
  if (error?.message?.includes("429")) {
    logger.error("⚠️ Rate limited - try again later");
  } else {
    logger.error("Failed to run examples:", error?.message || error);
  }
  process.exit(1);
});

// Export for programmatic usage
export { baseCampTestnetTokens } from "../config/base-testnet";
export { TokenQuoter } from "../quoter/token-quoter";
export { logger } from "../utils/logger";
