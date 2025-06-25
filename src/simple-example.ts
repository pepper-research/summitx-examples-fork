import { config } from "dotenv"
import { TradeType } from "@summitx/swap-sdk-core"
import { SimpleQuoter } from "./quoter/simple-quoter"
import { baseTestnetTokens } from "./config/base-testnet"
import { logger } from "./utils/logger"

// Load environment variables
config()

async function main() {
  logger.header("SummitX Simple Token Quoter - Base Testnet Demo")

  // Initialize simple quoter
  const quoter = new SimpleQuoter(0.5) // 0.5% slippage

  // Example 1: Simple swap quote (USDC → WETH)
  logger.header("Example 1: USDC → WETH Quote")
  const quote1 = await quoter.getQuote(
    baseTestnetTokens.usdc,
    baseTestnetTokens.weth,
    "100", // 100 USDC
    TradeType.EXACT_INPUT
  )

  if (quote1) {
    logger.success("Quote Details:", {
      input: `${quote1.inputAmount} ${quote1.inputToken.symbol}`,
      output: `${quote1.outputAmount} ${quote1.outputToken.symbol}`,
      minimumReceived: `${quote1.minimumReceived} ${quote1.outputToken.symbol}`,
      priceImpact: quote1.priceImpact,
      executionPrice: `1 ${quote1.inputToken.symbol} = ${quote1.executionPrice} ${quote1.outputToken.symbol}`,
    })
  }

  logger.divider()

  // Example 2: Reverse quote (WETH → USDC)
  logger.header("Example 2: WETH → USDC Quote")
  const quote2 = await quoter.getQuote(
    baseTestnetTokens.weth,
    baseTestnetTokens.usdc,
    "0.1", // 0.1 WETH
    TradeType.EXACT_INPUT
  )

  if (quote2) {
    logger.success("Quote Details:", {
      input: `${quote2.inputAmount} ${quote2.inputToken.symbol}`,
      output: `${quote2.outputAmount} ${quote2.outputToken.symbol}`,
      minimumReceived: `${quote2.minimumReceived} ${quote2.outputToken.symbol}`,
      priceImpact: quote2.priceImpact,
      executionPrice: `1 ${quote2.inputToken.symbol} = ${quote2.executionPrice} ${quote2.outputToken.symbol}`,
    })
  }

  logger.divider()

  // Example 3: Batch quotes
  logger.header("Example 3: Multiple Quotes")
  const batchQuotes = await quoter.getMultipleQuotes([
    {
      inputToken: baseTestnetTokens.usdc,
      outputToken: baseTestnetTokens.summit,
      amount: "50",
    },
    {
      inputToken: baseTestnetTokens.weth,
      outputToken: baseTestnetTokens.summit,
      amount: "0.05",
    },
    {
      inputToken: baseTestnetTokens.summit,
      outputToken: baseTestnetTokens.t12eth,
      amount: "500",
    },
  ])

  batchQuotes.forEach((quote, index) => {
    if (quote) {
      logger.success(`Quote ${index + 1}:`, {
        pair: `${quote.inputToken.symbol} → ${quote.outputToken.symbol}`,
        input: `${quote.inputAmount} ${quote.inputToken.symbol}`,
        output: `${quote.outputAmount} ${quote.outputToken.symbol}`,
        priceImpact: quote.priceImpact,
      })
    } else {
      logger.warn(`Quote ${index + 1}: No route found`)
    }
  })

  logger.divider()
  logger.success("All examples completed!")
  
  logger.divider()
  logger.info("Note: This is a simplified demo. In production, quotes would come from actual liquidity pools via the smart-router.")
}

// Run the examples
main().catch((error) => {
  logger.error("Failed to run examples", error)
  process.exit(1)
})

// Export for programmatic usage
export { SimpleQuoter } from "./quoter/simple-quoter"
export { baseTestnetTokens } from "./config/base-testnet"export { logger } from "./utils/logger"
