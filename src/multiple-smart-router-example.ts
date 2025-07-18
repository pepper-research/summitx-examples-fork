import { config } from "dotenv"
import { TradeType } from "@summitx/swap-sdk-core"
import { TokenQuoter } from "./quoter/token-quoter"
import { baseCampTestnetTokens } from "./config/base-testnet"
import { logger } from "./utils/logger"

// Load environment variables
config()

async function main() {
  logger.header("SummitX Smart Router Token Quoter - Base Testnet Demo")

  // Initialize token quoter with smart router
  const quoter = new TokenQuoter({
    rpcUrl: "https://rpc-campnetwork.xyz/8708df38d9cc4bb39ac813ae005be495",
    slippageTolerance: 1.0, // 1.0% slippage
    maxHops: 3,
    maxSplits: 3,
  })

  // Example 1: Get quote using smart router (USDC → WETH)
  logger.header("Example 1: USDC → WETH Quote with Smart Router")
  const shouldAdjustQuoteForGas = false // Set to true to adjust quote for gas costs
  const quote1 = await quoter.getQuote(
    baseCampTestnetTokens.usdc,
    baseCampTestnetTokens.weth,
    "100", // 100 USDC
    TradeType.EXACT_INPUT,
    shouldAdjustQuoteForGas
  )

  if (quote1) {
    logger.success("Smart Router Quote Details:", {
      input: `${quote1.inputAmount} ${quote1.inputToken.symbol}`,
      output: `${quote1.outputAmount} ${quote1.outputToken.symbol}`,
      minimumReceived: `${quote1.minimumReceived} ${quote1.outputToken.symbol}`,
      priceImpact: quote1.priceImpact,
      executionPrice: `1 ${quote1.inputToken.symbol} = ${quote1.executionPrice} ${quote1.outputToken.symbol}`,
      route: Array.isArray(quote1.route) ? quote1.route.join(" → ") : quote1.route,
      poolsUsed: quote1.pools.length,
      gasEstimate: quote1.gasEstimate || "N/A",
    })
  }

  logger.divider()

  // Example 2: Complex routing (SUMMIT → USDC)
  logger.header("Example 2: SUMMIT → USDC Quote (may route through WETH)")
  const quote2 = await quoter.getQuote(
    baseCampTestnetTokens.summit,
    baseCampTestnetTokens.usdc,
    "1000", // 1000 SUMMIT
    TradeType.EXACT_INPUT,
    shouldAdjustQuoteForGas
  )

  if (quote2) {
    logger.success("Complex Route Quote:", {
      input: `${quote2.inputAmount} ${quote2.inputToken.symbol}`,
      output: `${quote2.outputAmount} ${quote2.outputToken.symbol}`,
      minimumReceived: `${quote2.minimumReceived} ${quote2.outputToken.symbol}`,
      priceImpact: quote2.priceImpact,
      route: Array.isArray(quote2.route) ? quote2.route.join(" → ") : quote2.route,
      poolsUsed: quote2.pools.length,
    })
  }

  logger.divider()

  // Example 3: Batch quotes with various pairs
  logger.header("Example 3: Multiple Smart Router Quotes")
  const pairs = [
    {
      inputToken: baseCampTestnetTokens.usdc,
      outputToken: baseCampTestnetTokens.summit,
      amount: "50",
      shouldAdjustQuoteForGas: true,
    },
    {
      inputToken: baseCampTestnetTokens.weth,
      outputToken: baseCampTestnetTokens.summit,
      amount: "0.05",
      shouldAdjustQuoteForGas: false,
    },
    {
      inputToken: baseCampTestnetTokens.summit,
      outputToken: baseCampTestnetTokens.t12eth,
      amount: "500",
      shouldAdjustQuoteForGas: true,
    },
    {
      inputToken: baseCampTestnetTokens.t12eth,
      outputToken: baseCampTestnetTokens.usdc,
      amount: "100",
      shouldAdjustQuoteForGas: false,
    },
  ]

  const batchQuotes = await quoter.getMultipleQuotes(pairs)

  batchQuotes.forEach((quote, index) => {
    const pair = pairs[index]
    if (quote) {
      logger.success(`Quote ${index + 1}: ${pair.inputToken.symbol} → ${pair.outputToken.symbol}`, {
        input: `${quote.inputAmount} ${quote.inputToken.symbol}`,
        output: `${quote.outputAmount} ${quote.outputToken.symbol}`,
        priceImpact: quote.priceImpact,
        route: Array.isArray(quote.route) ? quote.route.join(" → ") : quote.route,
      })
    } else {
      logger.warn(`Quote ${index + 1}: No route found for ${pair.inputToken.symbol} → ${pair.outputToken.symbol}`)
    }
  })

  logger.divider()
  logger.success("Smart router examples completed!")
  
  logger.divider()
  logger.info("Note: If no pools are available on Base testnet, the quotes may fail. In production, ensure liquidity pools exist for the pairs you're quoting.")
}

// Run the examples
main().catch((error) => {
  logger.error("Failed to run smart router examples", error)
  process.exit(1)
})

// Export for programmatic usage
export { TokenQuoter } from "./quoter/token-quoter"
export { baseCampTestnetTokens } from "./config/base-testnet"