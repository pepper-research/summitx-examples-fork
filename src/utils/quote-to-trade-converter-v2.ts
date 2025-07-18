import { 
  Currency, 
  CurrencyAmount, 
  Token as CoreToken,
  TradeType as CoreTradeType,
  Percent,
  Price,
  Fraction
} from "@summitx/swap-sdk-core"
import { 
  SmartRouterTrade,
  RouteType,
  PoolType,
  V2Pool,
  V3Pool,
  StablePool,
  BaseRoute
} from "@summitx/smart-router/evm"
import { parseUnits } from "viem"
import type { QuoteResult } from "../quoter/token-quoter"

/**
 * Enhanced converter that follows the interface project's patterns
 * for converting TokenQuoter output to SmartRouterTrade format
 */
export class QuoteToTradeConverterV2 {
  /**
   * Convert TokenQuoter output to SmartRouterTrade format
   * This follows the same structure used by the interface project
   */
  static convertQuoteToTrade(quote: QuoteResult): SmartRouterTrade<CoreTradeType> {
    // If raw trade is available, use it directly
    if (quote.rawTrade) {
      return quote.rawTrade
    }

    // Otherwise, build from quote data (fallback for backward compatibility)
    // Parse input/output amounts
    const inputAmount = CurrencyAmount.fromRawAmount(
      quote.inputToken,
      parseUnits(quote.inputAmount, quote.inputToken.decimals)
    )
    
    const outputAmount = CurrencyAmount.fromRawAmount(
      quote.outputToken,
      parseUnits(quote.outputAmount, quote.outputToken.decimals)
    )

    // Parse routes from the quote
    const routes = this.parseRoutes(quote, inputAmount, outputAmount)

    // Create the SmartRouterTrade object
    const trade: SmartRouterTrade<CoreTradeType> = {
      tradeType: CoreTradeType.EXACT_INPUT,
      inputAmount,
      outputAmount,
      routes,
      gasEstimate: quote.gasEstimate ? BigInt(quote.gasEstimate) : undefined,
      gasEstimateInUSD: undefined, // Would need price data to calculate
      blockNumber: undefined, // Not available from quote
    }

    return trade
  }

  /**
   * Parse routes from quote format to SmartRouterTrade route format
   * Note: This is a fallback method when rawTrade is not available
   */
  private static parseRoutes(
    quote: QuoteResult,
    totalInputAmount: CurrencyAmount<Currency>,
    totalOutputAmount: CurrencyAmount<Currency>
  ): BaseRoute[] {
    // Convert route string array to structured routes
    const routeStrings = Array.isArray(quote.route) ? quote.route : [quote.route]
    
    return routeStrings.map((routeStr, index) => {
      // Parse route string like "(50% [USDC-T12ETH V3 0.3% 0x...])"
      const routeInfo = this.parseRouteString(routeStr)
      
      // Calculate amounts for this route based on percentage
      const routeInputAmount = CurrencyAmount.fromRawAmount(
        totalInputAmount.currency,
        (totalInputAmount.quotient * BigInt(routeInfo.percent)) / BigInt(100)
      )
      
      const routeOutputAmount = CurrencyAmount.fromRawAmount(
        totalOutputAmount.currency,
        (totalOutputAmount.quotient * BigInt(routeInfo.percent)) / BigInt(100)
      )

      // Build pools and path for this route
      const { pools, path } = this.buildPoolsAndPath(
        routeInfo,
        quote.inputToken,
        quote.outputToken,
        quote.pools[index] || quote.pools[0]
      )

      // Determine route type based on pools
      const routeType = this.determineRouteType(pools)

      return {
        type: routeType,
        pools,
        path,
        input: quote.inputToken,
        output: quote.outputToken,
        inputAmount: routeInputAmount,
        outputAmount: routeOutputAmount,
        percent: routeInfo.percent,
      }
    })
  }

  /**
   * Parse route string to extract percentage and hops
   */
  private static parseRouteString(routeStr: string): {
    percent: number
    hops: Array<{
      tokenIn: string
      tokenOut: string
      poolType: string
      fee?: number
      address?: string
    }>
  } {
    // Extract percentage
    const percentMatch = routeStr.match(/\((\d+)%/)
    const percent = percentMatch ? parseInt(percentMatch[1]) : 100

    // Extract hops between brackets
    const hopsMatch = routeStr.match(/\[(.*?)\]/)
    if (!hopsMatch) {
      // Simple format without brackets
      return { percent: 100, hops: [] }
    }

    const hopsString = hopsMatch[1]
    const hopParts = hopsString.split(", ")
    
    const hops = hopParts.map(hop => {
      const parts = hop.split(" ")
      const [tokenIn, tokenOut] = parts[0].split("-")
      const poolType = parts[1] || "V2"
      
      let fee: number | undefined
      let address: string | undefined
      
      if (poolType === "V3" && parts[2]) {
        fee = parseFloat(parts[2].replace("%", "")) * 10000 // Convert to basis points
      }
      
      if (parts[poolType === "V3" ? 3 : 2]) {
        address = parts[poolType === "V3" ? 3 : 2]
      }
      
      return { tokenIn, tokenOut, poolType, fee, address }
    })

    return { percent, hops }
  }

  /**
   * Build pools and path from route info
   * WARNING: This method creates placeholder pools and should only be used
   * when the raw trade object is not available
   */
  private static buildPoolsAndPath(
    routeInfo: any,
    inputToken: Currency,
    outputToken: Currency,
    poolInfoStr: string
  ): { pools: Array<V2Pool | V3Pool | StablePool>; path: Currency[] } {
    console.warn("Building pools from string representation - this may not have accurate pool data")
    
    const pools: Array<V2Pool | V3Pool | StablePool> = []
    const path: Currency[] = [inputToken]

    if (routeInfo.hops.length === 0) {
      // Direct swap - parse pool info from the pools array
      const poolType = poolInfoStr.includes("V3") ? PoolType.V3 : 
                      poolInfoStr.includes("Stable") ? PoolType.STABLE : 
                      PoolType.V2

      const pool = this.createPool(
        inputToken,
        outputToken,
        poolType,
        poolInfoStr
      )
      pools.push(pool)
      path.push(outputToken)
    } else {
      // Multi-hop swap - this is problematic without actual token data
      throw new Error("Multi-hop swaps cannot be accurately converted without raw trade data. Please ensure rawTrade is included in the quote.")
    }

    return { pools, path }
  }

  /**
   * Create a pool object based on type
   * WARNING: This creates placeholder pools with dummy data
   */
  private static createPool(
    tokenA: Currency,
    tokenB: Currency,
    poolType: PoolType,
    poolInfoStr: string
  ): V2Pool | V3Pool | StablePool {
    // Extract address from pool info string
    const addressMatch = poolInfoStr.match(/0x[a-fA-F0-9]{40}/)
    const address = addressMatch ? addressMatch[0] : "0x0000000000000000000000000000000000000000"

    // Create token objects
    const token0 = tokenA.wrapped
    const token1 = tokenB.wrapped

    if (poolType === PoolType.V3) {
      // Extract fee from pool info
      const feeMatch = poolInfoStr.match(/(\d+\.?\d*)%/)
      const fee = feeMatch ? Math.round(parseFloat(feeMatch[1]) * 10000) : 3000

      return {
        type: PoolType.V3,
        token0,
        token1,
        fee,
        liquidity: BigInt("1000000000000000000"), // Placeholder
        sqrtRatioX96: BigInt("79228162514264337593543950336"), // 1:1 ratio placeholder
        tick: 0,
        address,
        ticks: [],
        token0ProtocolFee: new Percent(0, 100),
        token1ProtocolFee: new Percent(0, 100),
      } as V3Pool
    } else if (poolType === PoolType.STABLE) {
      return {
        type: PoolType.STABLE,
        balances: [
          CurrencyAmount.fromRawAmount(token0, BigInt("1000000000000000000")),
          CurrencyAmount.fromRawAmount(token1, BigInt("1000000000000000000"))
        ],
        amplifier: BigInt(100),
        fee: new Percent(4, 10000), // 0.04% default
        address,
      } as StablePool
    } else {
      // V2 Pool
      return {
        type: PoolType.V2,
        reserve0: CurrencyAmount.fromRawAmount(token0, BigInt("1000000000000000000")),
        reserve1: CurrencyAmount.fromRawAmount(token1, BigInt("1000000000000000000")),
        address,
      } as V2Pool
    }
  }

  /**
   * Determine route type based on pools
   */
  private static determineRouteType(pools: Array<V2Pool | V3Pool | StablePool>): RouteType {
    const hasV2 = pools.some(p => p.type === PoolType.V2)
    const hasV3 = pools.some(p => p.type === PoolType.V3)
    const hasStable = pools.some(p => p.type === PoolType.STABLE)

    if (hasV3 && !hasV2 && !hasStable) return RouteType.V3
    if (hasV2 && !hasV3 && !hasStable) return RouteType.V2
    if (hasStable && !hasV2 && !hasV3) return RouteType.STABLE
    return RouteType.MIXED
  }

  /**
   * Validate the converted trade matches the original quote
   */
  static validateConversion(quote: QuoteResult, trade: SmartRouterTrade<CoreTradeType>): boolean {
    // Check amounts match
    const inputMatches = trade.inputAmount.quotient === parseUnits(quote.inputAmount, quote.inputToken.decimals)
    const outputMatches = trade.outputAmount.quotient === parseUnits(quote.outputAmount, quote.outputToken.decimals)

    // Check route count
    const quoteRouteCount = Array.isArray(quote.route) ? quote.route.length : 1
    const tradeRouteCount = trade.routes.length

    // Check currencies match
    const inputCurrencyMatches = trade.inputAmount.currency.equals(quote.inputToken)
    const outputCurrencyMatches = trade.outputAmount.currency.equals(quote.outputToken)

    return inputMatches && outputMatches && 
           quoteRouteCount === tradeRouteCount && 
           inputCurrencyMatches && outputCurrencyMatches
  }
}