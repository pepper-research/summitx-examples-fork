import { TokenQuoter } from "./quoter/token-quoter";
import { baseCampTestnetTokens } from "./config/base-testnet";
import { TradeType } from "@summitx/swap-sdk-core";
import { logger } from "./utils/logger";

async function testQuoter() {
  logger.header("🧪 Testing TokenQuoter");

  const quoter = new TokenQuoter({
    rpcUrl: "https://rpc-campnetwork.xyz",
    slippageTolerance: 1.0,
    maxHops: 2,
    maxSplits: 2,
    enableV2: false, // Disable V2 due to chain ID issues
    enableV3: true,
  });

  const testCases = [
    { 
      name: "USDC → USDT (0.1)",
      input: baseCampTestnetTokens.usdc,
      output: baseCampTestnetTokens.usdt,
      amount: "0.1"
    },
    { 
      name: "USDC → USDT (1.0)",
      input: baseCampTestnetTokens.usdc,
      output: baseCampTestnetTokens.usdt,
      amount: "1.0"
    },
    { 
      name: "USDT → USDC (0.1)",
      input: baseCampTestnetTokens.usdt,
      output: baseCampTestnetTokens.usdc,
      amount: "0.1"
    },
    { 
      name: "WCAMP → USDC (0.01)",
      input: baseCampTestnetTokens.wcamp,
      output: baseCampTestnetTokens.usdc,
      amount: "0.01"
    },
    { 
      name: "USDC → WCAMP (1.0)",
      input: baseCampTestnetTokens.usdc,
      output: baseCampTestnetTokens.wcamp,
      amount: "1.0"
    },
  ];

  for (const test of testCases) {
    logger.divider();
    logger.info(`Testing: ${test.name}`);
    
    try {
      const quote = await quoter.getQuote(
        test.input,
        test.output,
        test.amount,
        TradeType.EXACT_INPUT,
        false
      );

      if (quote) {
        const ratio = parseFloat(quote.outputAmount) / parseFloat(test.amount);
        logger.success(`✅ Quote received:`, {
          input: `${test.amount} ${test.input.symbol}`,
          output: `${quote.outputAmount} ${test.output.symbol}`,
          ratio: `1 ${test.input.symbol} = ${ratio.toFixed(6)} ${test.output.symbol}`,
          priceImpact: quote.priceImpact,
          pools: quote.pools.length,
          route: quote.route[0]
        });
      } else {
        logger.warn(`⚠️ No route found`);
      }
    } catch (error: any) {
      logger.error(`❌ Error: ${error?.message || error}`);
    }

    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  logger.divider();
  logger.success("🎉 Testing complete!");
}

testQuoter().catch((error) => {
  logger.error("Test failed:", error?.message || error);
  process.exit(1);
});