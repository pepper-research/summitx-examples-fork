import { config } from "dotenv"
import { TradeType } from "@summitx/swap-sdk-core"
import { TokenQuoter } from "./quoter/token-quoter"
import { baseTestnetTokens } from "./config/base-testnet"
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
    maxSplits: 3
  })

  // Example 1: Get quote using smart router (USDC → WETH)
  logger.header("Example 1: T12ETH → USDC Quote with Smart Router")
  const shouldAdjustQuoteForGas = false // Set to true to adjust quote for gas costs
  const quote1 = await quoter.getQuote(
    baseTestnetTokens.t12eth,
    baseTestnetTokens.usdc,
    "1001", // 100 USDC
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
      pools: quote1.pools,
      
    })
  }

  logger.divider()

  // const pairs = [
  //   { inputToken: baseTestnetTokens.usdc, outputToken: baseTestnetTokens.weth, amount: "100" },
  //   { inputToken: baseTestnetTokens.summit, outputToken: baseTestnetTokens.usdc, amount: "1000" },
  // ]

  // const batchQuotes = await quoter.getMultipleQuotes(pairs)

  // batchQuotes.forEach((quote, index) => {
  //   const pair = pairs[index]
  //   if (quote) {
  //     logger.success(`Quote ${index + 1}: ${pair.inputToken.symbol} → ${pair.outputToken.symbol}`, {
  //       input: `${quote.inputAmount} ${quote.inputToken.symbol}`,
  //       output: `${quote.outputAmount} ${quote.outputToken.symbol}`,
  //       priceImpact: quote.priceImpact,
  //       route: Array.isArray(quote.route) ? quote.route.join(" → ") : quote.route,
  //     })
  //   } else {
  //     logger.warn(`Quote ${index + 1}: No route found for ${pair.inputToken.symbol} → ${pair.outputToken.symbol}`)
  //   }
  // })

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
export { baseTestnetTokens } from "./config/base-testnet"