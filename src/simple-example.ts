import { config } from "dotenv"
import { TradeType } from "@summitx/swap-sdk-core"
import { TokenQuoter } from "./quoter/token-quoter"
import { baseTestnetTokens } from "./config/base-testnet"
import { logger } from "./utils/logger"

// Load environment variables
config()

async function main() {
  logger.header("SummitX Smart Router Token Quoter - Base Testnet Demo")

  // Initialize token quoter with smart router (same as UI)
  const quoter = new TokenQuoter({
    rpcUrl: "https://rpc-campnetwork.xyz/8708df38d9cc4bb39ac813ae005be495",
    slippageTolerance: 0.5, // 0.5% slippage
    maxHops: 3,
    maxSplits: 3,
    useStaticPools: false, // Use dynamic pool fetching like UI
    useMockPools: false, // Use real pools
  })

  // Test USDC to T12ETH quote (the problematic pair)
  logger.info("Testing USDC → T12ETH quote...")
  
  try {
    const quote = await quoter.getQuote(
      baseTestnetTokens.usdc,
      baseTestnetTokens.t12eth,
      "1000000", // 1 USDC (6 decimals)
      TradeType.EXACT_INPUT,
      true // shouldAdjustQuoteForGas
    )

    if (quote) {
      logger.success("✅ USDC → T12ETH Quote Found!", {
        inputAmount: quote.inputAmount,
        outputAmount: quote.outputAmount,
        priceImpact: quote.priceImpact,
        route: quote.route,
        pools: quote.pools,
        gasEstimate: quote.gasEstimate,
        executionPrice: quote.executionPrice,
        minimumReceived: quote.minimumReceived,
        routerTime: quote.routerTime,
      })
    } else {
      logger.warn("❌ No route found for USDC → T12ETH")
    }
  } catch (error) {
    logger.error("❌ Error getting USDC → T12ETH quote:", error)
  }

  // Test T12ETH to USDC quote (reverse direction)
  logger.info("Testing T12ETH → USDC quote...")
  
  try {
    const quote = await quoter.getQuote(
      baseTestnetTokens.t12eth,
      baseTestnetTokens.usdc,
      "1000000000000", // 1 T12ETH (12 decimals)
      TradeType.EXACT_INPUT,
      true // shouldAdjustQuoteForGas
    )

    if (quote) {
      logger.success("✅ T12ETH → USDC Quote Found!", {
        inputAmount: quote.inputAmount,
        outputAmount: quote.outputAmount,
        priceImpact: quote.priceImpact,
        route: quote.route,
        pools: quote.pools,
        gasEstimate: quote.gasEstimate,
        executionPrice: quote.executionPrice,
        minimumReceived: quote.minimumReceived,
        routerTime: quote.routerTime,
      })
    } else {
      logger.warn("❌ No route found for T12ETH → USDC")
    }
  } catch (error) {
    logger.error("❌ Error getting T12ETH → USDC quote:", error)
  }

  logger.success("Smart router examples completed!")
  logger.info("Note: This now uses the actual smart router like the UI. If no pools are available on Base testnet, the quotes may fail.")
}

// Run the examples
main().catch((error) => {
  logger.error("Failed to run examples", error)
  process.exit(1)
})

// Export for programmatic usage
export { TokenQuoter } from "./quoter/token-quoter"
export { baseTestnetTokens } from "./config/base-testnet"
export { logger } from "./utils/logger"
