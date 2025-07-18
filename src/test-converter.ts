import { TradeType } from "@summitx/swap-sdk-core"
import { TokenQuoter } from "./quoter/token-quoter"
import { baseCampTestnetTokens } from "./config/base-testnet"
import { QuoteToTradeConverterV2 } from "./utils/quote-to-trade-converter-v2"
import { logger } from "./utils/logger"

async function testConverter() {
  logger.header("Testing Quote to Trade Converter")

  // Initialize token quoter
  const quoter = new TokenQuoter({
    rpcUrl: "https://rpc-campnetwork.xyz/8708df38d9cc4bb39ac813ae005be495",
    slippageTolerance: 1.0,
    maxHops: 3,
    maxSplits: 3,
  })

  try {
    // Get a quote
    logger.info("Getting quote for USDC → T12ETH...")
    const quote = await quoter.getQuote(
      baseCampTestnetTokens.usdc,
      baseCampTestnetTokens.t12eth,
      "10",
      TradeType.EXACT_INPUT,
      false
    )

    if (!quote) {
      logger.error("No quote available")
      return
    }

    logger.success("Quote received:", {
      input: `${quote.inputAmount} ${quote.inputToken.symbol}`,
      output: `${quote.outputAmount} ${quote.outputToken.symbol}`,
      route: quote.route,
      pools: quote.pools,
    })

    // Convert to trade
    logger.info("Converting quote to SmartRouterTrade...")
    const trade = QuoteToTradeConverterV2.convertQuoteToTrade(quote)

    logger.success("Trade converted successfully!", {
      inputCurrency: trade.inputAmount.currency.symbol,
      outputCurrency: trade.outputAmount.currency.symbol,
      routes: trade.routes.length,
      routeDetails: trade.routes.map((route, i) => ({
        index: i,
        type: route.type,
        percent: route.percent,
        pools: route.pools.map(p => ({
          type: p.type,
          token0: p.token0.symbol,
          token1: p.token1.symbol,
          token0Address: p.token0.address,
          token1Address: p.token1.address,
        })),
        path: route.path.map(t => ({
          symbol: t.symbol,
          address: t.isToken ? t.address : 'native',
        })),
      })),
    })

    // Validate conversion
    const isValid = QuoteToTradeConverterV2.validateConversion(quote, trade)
    logger.info(`Conversion validation: ${isValid ? "✓ PASSED" : "✗ FAILED"}`)

  } catch (error) {
    logger.error("Test failed:", error)
  }
}

testConverter().catch(console.error)